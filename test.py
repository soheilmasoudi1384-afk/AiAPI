#!/usr/bin/env python3
"""
ChatGPT web scraper (Playwright, async, lightweight).

tasks.json  ->  open chatgpt.com  ->  send prompt  ->  read answer  ->  results.json

How the answer is read (markup-independent, so site redesigns don't break it):
  1. snapshot the page text BEFORE sending
  2. after sending, diff the page text -> new lines (minus the echo of our own prompt) = answer
  3. "done" = the streaming network request finished (+ text stable), not a guess

Usage:
  python scraper.py --login            # optional: log in manually, session is saved
  python scraper.py --check            # health check
  python scraper.py                    # run all pending tasks
  python scraper.py --html             # also save the full page HTML for each task
  python scraper.py --headless         # no window (may trigger Cloudflare; headed is safer)
"""
import argparse
import asyncio
import html
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import TimeoutError as PWTimeout
from playwright.async_api import async_playwright

URL = "https://chatgpt.com/"

# Selectors live in one place: if the site changes its markup, edit only here.
SEL_INPUT = '#prompt-textarea, div.ProseMirror[contenteditable="true"], textarea[placeholder]'
SEL_SEND = 'button[data-composer-submit][aria-label="Send message"], button[aria-label="Send message"], [data-testid="send-button"]'
SEL_STOP = '[data-testid="stop-button"], button[aria-label="Stop generating"], button[data-composer-submit][aria-label*="Stop"]'
LOAD_TIMEOUT_MS = 60000  # slow networks / VPN

# Safety net: cut everything from the first footer / login-popup line onward.
JUNK_RE = re.compile(
    r"^(ChatGPT (is AI and )?can make mistakes|Check important info|Log in or sign up|Stay logged out)",
    re.I | re.M,
)


def clean_answer(text: str) -> str:
    m = JUNK_RE.search(text)
    return (text[: m.start()] if m else text).strip()


# ---- user-friendly report (browser renders mixed Persian/English correctly) ----
REPORT_TEMPLATE = """<!doctype html>
<html lang="fa"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>نتایج</title>
<style>
  body { font-family: Tahoma, "Segoe UI", system-ui, sans-serif; background:#f4f5f7;
         color:#1b1b1f; max-width:820px; margin:24px auto; padding:0 16px; line-height:1.9; }
  h1 { font-size:20px; }
  .card { background:#fff; border-radius:12px; padding:16px 18px; margin:14px 0;
          box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .card.err { border-right:4px solid #d33; }
  .card.ok  { border-right:4px solid #2a9d5c; }
  .meta { font-size:12px; color:#777; display:flex; justify-content:space-between; gap:8px; }
  .q { background:#eaf0ff; border-radius:10px; padding:8px 12px; margin:10px 0; }
  .a p, .q p { margin:4px 0; unicode-bidi:plaintext; }
  button { font:inherit; font-size:12px; border:1px solid #ccc; background:#fafafa;
           border-radius:6px; padding:2px 10px; cursor:pointer; }
</style></head><body>
<h1>نتایج (__COUNT__ مورد)</h1>
__CARDS__
</body></html>"""


def _paragraphs(text: str) -> str:
    # one <p dir="auto"> per line -> each line gets its own correct direction
    return "".join(f'<p dir="auto">{html.escape(line)}</p>' for line in (text or "").split("\n") if line.strip())


def write_report(results: list[dict], path: Path) -> None:
    try:
        cards = []
        for r in results:
            ok = r.get("status") == "ok"
            cards.append(
                f'<section class="card {"ok" if ok else "err"}">'
                f'<div class="meta"><span>#{html.escape(str(r.get("id")))} · {"✅" if ok else "❌"}'
                f' {r.get("duration_s", "")}s</span>'
                f'<button onclick="navigator.clipboard.writeText('
                f'this.closest(\'section\').querySelector(\'.a\').innerText)">کپی جواب</button></div>'
                f'<div class="q">{_paragraphs(r.get("prompt", ""))}</div>'
                f'<div class="a">{_paragraphs(r.get("answer") or r.get("error") or "")}</div>'
                f"</section>"
            )
        doc = REPORT_TEMPLATE.replace("__COUNT__", str(len(results))).replace("__CARDS__", "\n".join(cards))
        path.write_text(doc, encoding="utf-8")
    except Exception as e:  # the report must never break the scraping run
        log(f"report skipped: {e}")


# ---- "API mode": make ChatGPT answer like an endpoint, not like a chatbot ----
START_MARK = "[[ANSWER_START]]"
END_MARK = "[[ANSWER_END]]"

DEFAULT_SYSTEM = f"""You are the backend of a chat API. A program sends you the user's message and shows your reply to the end user.
Rules:
1. Reply directly to the user's message, in the same language the user wrote in. If the user greets you or makes small talk (e.g. "سلام", "hello"), greet back naturally and briefly - that is fine and expected.
2. If the message asks you to write or build something (text, code, a script, a website, a whole project ...), deliver the complete, finished result in this reply. Do not ask for more details; assume sensible defaults and go ahead.
3. Do not offer menus of options, do not end with follow-up questions or offers of more help, and do not describe what you are about to do.
4. Do not use tools, canvas, interactive widgets or buttons; write everything in the reply itself. Put code in fenced code blocks with the language name. For several files, use one code block per file with the file path on the line right before it. Unless told otherwise, a website is one self-contained HTML file with inline CSS and JS.
5. Give a single answer, not alternatives.
6. Output format: put your whole reply between a line containing only {START_MARK} and a line containing only {END_MARK}. Write nothing outside these two markers."""


def parse_marked(text: str):
    """-> (answer, found_end_marker). Everything outside the markers is discarded."""
    i = text.rfind(END_MARK)
    if i < 0:
        return text.strip(), False
    body = text[:i]
    j = body.rfind(START_MARK)
    if j >= 0:
        body = body[j + len(START_MARK):]
    body = body.strip()
    if not body:  # markers present but empty -> never return nothing, fall back to the raw reply
        raw = text.replace(START_MARK, "").replace(END_MARK, "").strip()
        return raw, False
    return body, True


def build_prompt(task: dict, file_system, args) -> str:
    """Priority: per-task "system" > --no-system > --system > file-level "system" > default."""
    if "system" in task:
        system = task["system"]
    elif args.no_system:
        system = ""
    elif args.system:
        system = args.system
    elif file_system is not None:
        system = file_system
    else:
        system = DEFAULT_SYSTEM
    system = (system or "").strip()
    if system and args.always_greet:
        system += "\n7. Inside the markers, always start your reply with a short friendly greeting in the user's language."
    question = str(task["prompt"]).strip()
    return f"{system}\n\nRequest:\n{question}" if system else question


BLOCKED_RESOURCES = {"image", "media", "font"}  # keeps the page light and fast
BLOCKED_HOSTS = (  # analytics / tracking: useless for us, only costs CPU and bandwidth
    "google-analytics.com", "googletagmanager.com", "doubleclick.net",
    "segment.io", "segment.com", "sentry.io", "datadoghq.com",
)
PROFILE_DIR = Path("./browser_profile")
DEBUG_DIR = Path("./debug")
HTML_DIR = Path("./html")

# ---- page-text snapshot / diff (no selectors needed) ------------------------
JS_LINES = r"""
() => document.body.innerText.split('\n')
        .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
"""

JS_DIFF = r"""
([baseline, prompt]) => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const base = new Map();
  baseline.forEach(l => base.set(l, (base.get(l) || 0) + 1));
  const p = norm(prompt);
  const promptLines = new Set(prompt.split('\n').map(norm).filter(Boolean));
  const isEcho = l => promptLines.has(l) || (l.length >= 20 && p.includes(l));
  // text that lives in popups / composer / footer is never part of the answer
  const skip = new Set();
  document.querySelectorAll('[role="dialog"], dialog, form, footer').forEach(el =>
    (el.innerText || '').split('\n').forEach(s => { s = norm(s); if (s) skip.add(s); }));
  const lines = document.body.innerText.split('\n').map(norm).filter(Boolean);
  const out = [];
  let echo = true;                       // leading new lines that belong to our own prompt
  for (const l of lines) {
    if (skip.has(l)) continue;
    const c = base.get(l) || 0;
    if (c > 0) { base.set(l, c - 1); continue; }   // already on the page before -> UI text
    if (echo && isEcho(l)) continue;
    echo = false;
    out.push(l);
  }
  return out.join('\n');
}
"""


# ----------------------------------------------------------------- helpers
def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def atomic_write_json(path: Path, data) -> None:
    """Write via temp file so a crash never leaves a half-written JSON."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def load_tasks(path: Path):
    """Returns (tasks, file_level_system_or_None)."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    file_system = raw.get("system") if isinstance(raw, dict) else None
    items = raw["tasks"] if isinstance(raw, dict) else raw
    tasks = []
    for i, item in enumerate(items, 1):
        if isinstance(item, str):
            item = {"prompt": item}
        item.setdefault("id", i)
        if not str(item.get("prompt", "")).strip():
            log(f"skip task {item['id']}: empty prompt")
            continue
        tasks.append(item)
    return tasks, file_system


def load_results(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {str(r["id"]): r for r in data}
    except Exception:
        return {}


async def block_heavy(route):
    req = route.request
    if req.resource_type in BLOCKED_RESOURCES or any(h in req.url for h in BLOCKED_HOSTS):
        await route.abort()
    else:
        await route.continue_()


# ------------------------------------------------------------------ health
async def diagnose(page) -> str:
    """Explain WHY the input box is missing."""
    try:
        title = (await page.title()).lower()
        url = page.url.lower()
        body = (await page.locator("body").inner_text(timeout=3000)).lower()
    except Exception:
        return "page_unreachable"
    if "just a moment" in title or "verify you are human" in body or "cloudflare" in body:
        return "captcha_or_cloudflare"
    # Guest mode is fine: "log in" text on the page does NOT mean we're blocked.
    if "/auth/" in url or "/log-in" in url or "/login" in url:
        return "redirected_to_login_page"
    return f"input_not_found (url={page.url}, title={title!r}) - see debug/ screenshot"


async def dismiss_popups(page) -> None:
    """Close guest-mode / cookie popups that can cover the input box."""
    for text in ("Stay logged out", "Accept all", "Reject non-essential", "Got it", "Okay, let’s go"):
        try:
            btn = page.get_by_text(text, exact=False).first
            if await btn.is_visible(timeout=500):
                await btn.click(timeout=1500)
        except Exception:
            pass


async def safe_eval(page, js, arg=None, timeout: float = 25):
    """page.evaluate has NO timeout in Playwright: a busy/frozen page would hang us forever."""
    try:
        coro = page.evaluate(js) if arg is None else page.evaluate(js, arg)
        return await asyncio.wait_for(coro, timeout)
    except asyncio.TimeoutError:
        log(f"page.evaluate timed out after {timeout}s (page is busy or frozen)")
        return None


async def stop_visible(page) -> bool:
    try:
        return await asyncio.wait_for(page.locator(SEL_STOP).count(), 10) > 0
    except Exception:
        return True  # page not answering -> treat as "still busy"


async def fresh_page(ctx, old):
    try:
        await asyncio.wait_for(old.close(), 10)
    except Exception:
        pass
    page = await ctx.new_page()
    log("tab replaced (the previous one was stuck or failed)")
    return page


async def save_debug(page, tag: str) -> None:
    DEBUG_DIR.mkdir(exist_ok=True)
    stamp = f"{tag}_{int(time.time())}"

    async def _dump():
        await page.screenshot(path=str(DEBUG_DIR / f"{stamp}.png"))
        (DEBUG_DIR / f"{stamp}.html").write_text(await page.content(), encoding="utf-8")
        text = await page.evaluate("() => document.body.innerText")
        (DEBUG_DIR / f"{stamp}.txt").write_text(text, encoding="utf-8")

    try:
        await asyncio.wait_for(_dump(), 20)
    except Exception:
        pass


async def health_check(page) -> bool:
    log("health: opening site ...")
    try:
        await page.goto(URL, wait_until="domcontentloaded", timeout=LOAD_TIMEOUT_MS)
        await dismiss_popups(page)
        await page.locator(SEL_INPUT).first.wait_for(state="visible", timeout=LOAD_TIMEOUT_MS)
    except Exception:
        log(f"health: FAIL -> {await diagnose(page)}")
        await save_debug(page, "health_fail")
        return False
    log("health: OK (page loaded, input box found)")
    return True


# -------------------------------------------------------------------- core
async def copy_answer(page):
    """Best effort: click ChatGPT's own Copy button and read the clipboard (full-fidelity text/code)."""
    try:
        btn = page.locator('[data-testid="copy-turn-action-button"], button[aria-label="Copy"]').last
        await page.bring_to_front()  # clipboard.readText() hangs forever if the page is not focused
        await btn.click(timeout=3000)
        await asyncio.sleep(0.3)
        txt = (await asyncio.wait_for(page.evaluate("navigator.clipboard.readText()"), 5) or "").strip()
        if not txt or "backend of a chat API" in txt:  # copied the wrong thing
            return None
        return txt
    except Exception:
        return None


async def ask(page, prompt: str, timeout_s: int, want_html: bool) -> dict:
    await page.goto(URL, wait_until="domcontentloaded", timeout=LOAD_TIMEOUT_MS)  # fresh chat each time
    try:  # kill animations / transitions: less rendering work while streaming
        await page.add_style_tag(
            content="*,*::before,*::after{animation:none!important;transition:none!important;"
                    "scroll-behavior:auto!important}"
        )
    except Exception:
        pass
    await dismiss_popups(page)

    box = page.locator(SEL_INPUT).first
    try:
        await box.wait_for(state="visible", timeout=LOAD_TIMEOUT_MS)
    except PWTimeout:
        raise RuntimeError(await diagnose(page))

    # snapshot of everything already on the page (sidebar, placeholders, disclaimers ...)
    baseline = await safe_eval(page, JS_LINES) or []

    # real "answer finished" signal: the streaming POST .../conversation completes
    stream_done = asyncio.Event()

    def on_finished(req):
        try:
            if req.method == "POST" and urlparse(req.url).path.endswith("/conversation"):
                stream_done.set()
        except Exception:
            pass

    page.on("requestfinished", on_finished)
    try:
        # 1) write the prompt
        await box.click()
        await box.fill(prompt)
        current = await box.evaluate("el => (el.value ?? el.innerText ?? '').trim()")
        if not current:  # fill() sometimes doesn't register in the rich editor
            await box.click()
            await page.keyboard.insert_text(prompt)
        log("prompt typed")

        # 2) click send (waits until enabled); fallback: Enter
        try:
            await page.locator(SEL_SEND).first.click(timeout=8000)
        except Exception:
            log("send button not clickable, pressing Enter instead")
            await page.keyboard.press("Enter")
        t_sent = time.monotonic()
        log("sent, waiting for answer ...")

        # 3) wait CHEAPLY: no page-text reads while the answer streams (that is what makes
        #    Chrome lag on long answers). Only light checks once per second.
        deadline = t_sent + timeout_s
        probe_prev, idle, warned = "", 0, False
        next_probe = t_sent + 10
        while time.monotonic() < deadline:
            await asyncio.sleep(1.0)
            streaming = await stop_visible(page)
            idle = 0 if streaming else idle + 1
            finished = stream_done.is_set() and idle >= 2

            # fallback if the network signal never arrives: compare two text probes 5s apart
            if not finished and not streaming and time.monotonic() >= next_probe:
                next_probe = time.monotonic() + 5
                probe = clean_answer(await safe_eval(page, JS_DIFF, [baseline, prompt]) or "")
                finished = bool(probe) and probe == probe_prev
                probe_prev = probe

            if finished:
                break
            if not warned and time.monotonic() - t_sent > 45 and not stream_done.is_set():
                warned = True
                log("still waiting (no stream signal yet) - saving debug snapshot")
                await save_debug(page, "slow")
        else:
            raise TimeoutError(f"no complete answer within {timeout_s}s")

        log("answer finished, reading it ...")
        await asyncio.sleep(0.6)  # let the last render land
        last = clean_answer(await safe_eval(page, JS_DIFF, [baseline, prompt]) or "")
        if not last:
            await asyncio.sleep(2)
            last = clean_answer(await safe_eval(page, JS_DIFF, [baseline, prompt]) or "")
        if not last:
            raise RuntimeError("answer finished but no text could be read from the page")
    finally:
        page.remove_listener("requestfinished", on_finished)

    answer, marked = parse_marked(last)
    log("copying the answer ...")
    copied = await copy_answer(page)  # prefer the exact text ChatGPT itself copies
    if copied:
        c_answer, c_marked = parse_marked(copied)
        if c_marked or not marked:
            answer, marked = c_answer, c_marked
    if not marked:
        log("warning: model ignored the output format; returning the raw reply")

    result = {"answer": answer, "format_ok": marked}
    if want_html:
        HTML_DIR.mkdir(exist_ok=True)
        return result | {"_html": await page.content()}
    return result


async def run(args) -> int:
    PROFILE_DIR.mkdir(exist_ok=True)
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=args.headless and not args.login,
            channel=args.channel or None,
            viewport={"width": 1100, "height": 750},
            reduced_motion="reduce",
            args=[
                "--disable-blink-features=AutomationControlled",
                # never let Chrome slow us down when the window is hidden / minimized / unfocused
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                "--disable-extensions",
                "--disable-dev-shm-usage",
                *(["--disable-gpu"] if args.no_gpu else []),
            ],
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        # ---- optional manual login
        if args.login:
            await page.goto(URL)
            log("Log in in the opened window, then press ENTER here ...")
            await asyncio.get_running_loop().run_in_executor(None, input)
            await ctx.close()
            log("session saved.")
            return 0

        try:  # lets us read ChatGPT's own "Copy" output
            await ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin="https://chatgpt.com")
        except Exception:
            pass
        if args.no_css:
            BLOCKED_RESOURCES.add("stylesheet")  # experimental: unstyled page
        await ctx.route("**/*", block_heavy)  # context-level: also applies to recycled pages
        ctx.set_default_timeout(20000)

        if args.check:
            ok = await health_check(page)
            await ctx.close()
            return 0 if ok else 1

        if not await health_check(page):
            await ctx.close()
            return 1

        tasks, file_system = load_tasks(Path(args.input))
        out_path = Path(args.output)
        results = load_results(out_path)  # resume support
        failures = 0
        processed = 0

        for t in tasks:
            tid = str(t["id"])
            if results.get(tid, {}).get("status") == "ok" and not args.redo:
                log(f"task {tid}: already done, skipping")
                continue

            rec = {"id": t["id"], "prompt": t["prompt"], "answer": None, "status": "error", "error": None}
            for attempt in range(1, args.retries + 2):
                t0 = time.monotonic()
                try:
                    log(f"task {tid}: attempt {attempt}")
                    # hard ceiling: whatever hangs inside, we never wait forever
                    res = await asyncio.wait_for(
                        ask(page, build_prompt(t, file_system, args), args.timeout, args.html),
                        args.timeout + 120,
                    )
                    html = res.pop("_html", None)
                    if html:
                        f = HTML_DIR / f"{tid}.html"
                        f.write_text(html, encoding="utf-8")
                        rec["html_file"] = str(f)
                    rec.update(res, status="ok", error=None, duration_s=round(time.monotonic() - t0, 1))
                    log(f"task {tid}: OK ({rec['duration_s']}s)")
                    break
                except Exception as e:
                    rec["error"] = f"{type(e).__name__}: {e}"
                    log(f"task {tid}: {rec['error']}")
                    await save_debug(page, f"task{tid}")
                    if "captcha" in str(e) or "login_page" in str(e):
                        break  # retrying will not help
                    await asyncio.sleep(2 * attempt)
                    page = await fresh_page(ctx, page)  # a stuck tab must not poison the retry

            if rec["status"] != "ok":
                failures += 1
            results[tid] = rec
            atomic_write_json(out_path, list(results.values()))  # save after every task
            write_report(list(results.values()), out_path.with_suffix(".html"))
            await asyncio.sleep(args.delay)

            processed += 1
            if args.recycle and processed % args.recycle == 0:  # fresh tab = frees leaked memory
                try:
                    await page.close()
                except Exception:
                    pass
                page = await ctx.new_page()
                log("tab recycled (frees memory)")

        await ctx.close()
        log(f"done. ok={len(tasks) - failures} failed={failures} -> {out_path}  (readable report: {out_path.with_suffix('.html')})")
        return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-i", "--input", default="tasks.json")
    ap.add_argument("-o", "--output", default="results.json")
    ap.add_argument("--login", action="store_true", help="manual login, saves session")
    ap.add_argument("--check", action="store_true", help="health check only")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--html", action="store_true", help="also save full page HTML per task")
    ap.add_argument("--redo", action="store_true", help="re-run tasks already done")
    ap.add_argument("--system", default="", help="custom instructions prepended to every prompt")
    ap.add_argument("--no-system", action="store_true", help="send prompts as-is (no API-mode instructions)")
    ap.add_argument("--always-greet", action="store_true", help="make every reply start with a short greeting")
    ap.add_argument("--no-gpu", action="store_true", help="disable GPU rendering (fixes some Windows freezes)")
    ap.add_argument("--no-css", action="store_true", help="experimental: block stylesheets (unstyled page)")
    ap.add_argument("--recycle", type=int, default=8, help="open a fresh tab every N tasks (0 = never)")
    ap.add_argument("--timeout", type=int, default=180, help="seconds to wait per answer")
    ap.add_argument("--retries", type=int, default=2)
    ap.add_argument("--delay", type=float, default=3.0, help="pause between tasks")
    ap.add_argument("--channel", default="", help='e.g. "chrome" to use installed Google Chrome')
    sys.exit(asyncio.run(run(ap.parse_args())))


if __name__ == "__main__":
    main()