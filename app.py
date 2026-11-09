"""
AI Gateway v3: یک API سازگار با OpenAI روی چند ارائه‌دهنده و چندین کلید.

ذخیره‌سازی:
  - PostgreSQL (DATABASE_URL)  مرجع نهایی کاربران، کلیدها، اعتبار و لاگ مصرف. بدون آن SQLite.
  - Redis (REDIS_URL)          rate limit، شمارنده‌ها، موجودی، کش و سلامت کلیدها، مشترک بین worker ها.
                               بدون آن حافظه‌ی همین پروسه. اگر وسط کار قطع شود سرویس از کار نمی‌افتد.

- pool کلیدها با دو tier (free/paid)، cooldown جدا برای هر (کلید، مدل)، circuit breaker برای هر مسیر
- مسیریابی بر اساس ترتیب یا میانگین latency، صف انتظار با backpressure
- پلن‌ها، اعتبار پیش‌پرداخت، چند کلید برای هر کاربر، کش دقیق، /metrics، هشدار، allowlist آی‌پی
- پنل کاربر (/panel)، پنل ادمین (/admin-ui)، صفحه‌ی وضعیت (/status)
"""
import asyncio
import calendar
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from db import Database
from state import make_state

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BASE_DIR = Path(__file__).parent

# ───────────────────────── تنظیمات ─────────────────────────


def env_list(*names):
    for n in names:
        v = os.environ.get(n, "")
        if v.strip():
            return [x.strip() for x in v.split(",") if x.strip()]
    return []


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def load_json(env_name, default_file, fallback):
    for p in (Path(os.environ.get(env_name, default_file)), BASE_DIR / default_file):
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    return fallback


SITE_URL = os.environ.get("SITE_URL", "http://localhost:8000")
SITE_NAME = os.environ.get("SITE_NAME", "My AI")
BRAND_PROMPT = os.environ.get("BRAND_PROMPT", "").strip()
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
DATABASE_URL = os.environ.get("DATABASE_URL") or "sqlite:///" + os.environ.get("DB_PATH", "gateway_v2.db")
REDIS_URL = os.environ.get("REDIS_URL", "").strip()
TRUST_PROXY = os.environ.get("TRUST_PROXY", "").lower() in ("1", "true", "yes")

MAX_ATTEMPTS = env_int("MAX_ATTEMPTS", 8)
KEYS_PER_ROUTE = env_int("KEYS_PER_ROUTE", 3)
MAX_BODY = env_int("MAX_BODY_BYTES", 1_000_000)
CACHE_TTL = env_int("CACHE_TTL", 3600)          # ثانیه؛ ۰ یعنی کش خاموش
CACHE_MAX = env_int("CACHE_MAX", 2000)          # فقط برای کش حافظه
QUEUE_WAIT = env_float("QUEUE_WAIT", 8.0)
MAX_QUEUE = env_int("MAX_QUEUE", 200)
BREAKER_THRESHOLD = env_int("BREAKER_THRESHOLD", 3)
ANOMALY_IPS = env_int("ANOMALY_IPS", 8)
MAX_USAGE_BUFFER = env_int("MAX_USAGE_BUFFER", 100_000)
TG_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT = os.environ.get("TELEGRAM_CHAT_ID", "")
ALERT_WEBHOOK = os.environ.get("ALERT_WEBHOOK_URL", "")

PROVIDER_DEFS = {
    "groq": ("https://api.groq.com/openai/v1", {}),
    "openrouter": ("https://openrouter.ai/api/v1", {"HTTP-Referer": SITE_URL, "X-Title": SITE_NAME}),
    "cerebras": ("https://api.cerebras.ai/v1", {}),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai", {}),
}
PROVIDERS = {n: {"base": b, "headers": h} for n, (b, h) in PROVIDER_DEFS.items()}

# قیمت‌ها قیمت «فروش» تو هستند: دلار برای هر یک میلیون توکن
DEFAULT_MODELS = {
    "my-ai-fast": {
        "strategy": "latency",
        "price": {"in": 0.10, "out": 0.30},
        "routes": [
            ["groq", "llama-3.1-8b-instant"],
            ["cerebras", "llama3.1-8b"],
            ["openrouter", "nvidia/nemotron-3.5-lightning:free"],
        ],
    },
    "my-ai": {
        "strategy": "latency",
        "price": {"in": 0.60, "out": 1.20},
        "routes": [
            ["groq", "llama-3.3-70b-versatile"],
            ["cerebras", "llama-3.3-70b"],
            ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
        ],
    },
    "my-ai-pro": {
        "strategy": "order",
        "price": {"in": 1.50, "out": 3.00},
        "routes": [
            ["openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"],
            ["groq", "llama-3.3-70b-versatile"],
        ],
    },
}
DEFAULT_PLANS = {
    "free": {"rpm": 10, "daily_tokens": 50_000, "max_tokens": 1024, "tiers": ["free"],
             "models": ["my-ai-fast", "my-ai"], "billing": False},
    "basic": {"rpm": 60, "daily_tokens": 2_000_000, "max_tokens": 4096, "tiers": ["paid", "free"],
              "models": ["*"], "billing": True},
    "pro": {"rpm": 300, "daily_tokens": 20_000_000, "max_tokens": 8192, "tiers": ["paid", "free"],
            "models": ["*"], "billing": True},
    "team": {"rpm": 600, "daily_tokens": 100_000_000, "max_tokens": 8192, "tiers": ["paid", "free"],
             "models": ["*"], "billing": False},
}
PLAN_BASE = {"rpm": 60, "daily_tokens": 1_000_000, "max_tokens": 4096,
             "tiers": ["paid", "free"], "models": ["*"], "billing": False}


def norm_alias(v):
    if isinstance(v, list):
        v = {"routes": v}
    return {"strategy": "order", "price": {"in": 0, "out": 0}, **v}


ALIASES = {k: norm_alias(v) for k, v in load_json("MODELS_FILE", "models.json", DEFAULT_MODELS).items()}
PLANS = {k: {**PLAN_BASE, **v} for k, v in load_json("PLANS_FILE", "plans.json", DEFAULT_PLANS).items()}
DEFAULT_ALIAS = os.environ.get("DEFAULT_MODEL", next(iter(ALIASES)))
DEFAULT_PLAN = os.environ.get("DEFAULT_PLAN", "free")
if DEFAULT_PLAN not in PLANS:
    DEFAULT_PLAN = next(iter(PLANS))

ALLOWED_PARAMS = {
    "temperature", "top_p", "stop", "presence_penalty", "frequency_penalty",
    "seed", "tools", "tool_choice", "response_format",
}

# ───────────────────────── ابزارهای کوچک ─────────────────────────

db = Database()
state = None          # بعد از راه‌اندازی MemState یا RedisState
client: httpx.AsyncClient = None
BG = set()


class ApiError(Exception):
    def __init__(self, status, message, typ="api_error", headers=None):
        self.status, self.message, self.typ, self.headers = status, message, typ, headers or {}


def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


def today():
    return time.strftime("%Y-%m-%d", time.gmtime())


def fire(coro):
    """اجرای یک coroutine در پس‌زمینه؛ اگر event loop نباشد بی‌سروصدا رد می‌شود."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        coro.close()
        return
    t = loop.create_task(coro)
    BG.add(t)
    t.add_done_callback(BG.discard)


# ───────────────────────── pool کلیدها ─────────────────────────


@dataclass
class KeyState:
    provider: str
    key: str
    tier: str = "free"
    kh: str = ""                       # هش کوتاه کلید برای اشتراک‌گذاری وضعیت در Redis
    disabled_until: float = 0.0
    cooldown_until: float = 0.0
    model_cd: dict = field(default_factory=dict)
    inflight: int = 0
    last_used: float = 0.0
    ok: int = 0
    fail: int = 0
    last_error: str = ""


def build_pool():
    pool = {}
    for name in PROVIDERS:
        up = name.upper()
        free = env_list(f"{up}_API_KEYS", f"{up}_API_KEY")
        paid = env_list(f"{up}_PAID_API_KEYS", f"{up}_PAID_API_KEY")
        pool[name] = ([KeyState(name, k, "free", sha(k)[:16]) for k in free]
                      + [KeyState(name, k, "paid", sha(k)[:16]) for k in paid])
    return pool


POOL = build_pool()
LAT = {}     # (provider, model, stream) -> میانگین متحرک latency
BREAK = {}   # (provider, model) -> [خرابی‌های پشت‌سرهم, زمان باز بودن breaker]
UPERR = defaultdict(int)


def mask(k):
    return f"{k[:6]}…{k[-4:]}" if len(k) > 12 else "***"


def breaker_open(p, m):
    b = BREAK.get((p, m))
    return bool(b and b[1] > time.time())


def breaker_fail(p, m):
    b = BREAK.setdefault((p, m), [0, 0.0])
    b[0] += 1
    if b[0] >= BREAKER_THRESHOLD:
        b[1] = time.time() + min(300, 30 * 2 ** (b[0] - BREAKER_THRESHOLD))


def breaker_ok(p, m):
    BREAK.pop((p, m), None)


def pick_keys(provider, model, tiers):
    now = time.time()
    ks = [
        k for k in POOL.get(provider, [])
        if k.tier in tiers and k.disabled_until < now and k.cooldown_until < now
        and k.model_cd.get(model, 0) < now
    ]
    ks.sort(key=lambda k: (tiers.index(k.tier), k.inflight, k.last_used))
    return ks


def ordered_routes(cfg, stream):
    routes = [(p, m) for p, m in cfg["routes"] if POOL.get(p)]
    if cfg["strategy"] == "latency":
        routes.sort(key=lambda r: LAT.get((r[0], r[1], stream), 0.0))  # ناشناخته‌ها اول (کاوش)
    closed = [r for r in routes if not breaker_open(*r)]
    return closed + [r for r in routes if breaker_open(*r)]  # مسیرهای قطع‌شده فقط آخرین راه


def next_available_in(routes, tiers):
    """کمترین زمان تا آزاد شدن یک کلید. None اگر اصلاً کلیدی نباشد."""
    now, best = time.time(), None
    for p, m in routes:
        for k in POOL.get(p, []):
            if k.tier not in tiers:
                continue
            w = max(k.disabled_until, k.cooldown_until, k.model_cd.get(m, 0)) - now
            best = max(w, 0) if best is None else min(best, max(w, 0))
    return best


def publish(ks, field_name, value):
    """وضعیت جدید کلید را برای بقیه‌ی worker ها در Redis منتشر می‌کند."""
    if state is not None:
        fire(state.publish_health(ks.kh, field_name, value))


def penalize(ks, model, status, headers, msg):
    now = time.time()
    ks.fail += 1
    ks.last_error = f"{status}: {msg}"[:300]
    UPERR[(ks.provider, status)] += 1
    if status == 429:
        try:
            secs = float((headers or {}).get("retry-after", 30))
        except (ValueError, TypeError):
            secs = 30
        until = now + min(max(secs, 5), 6 * 3600)
        ks.model_cd[model] = until
        publish(ks, f"m:{model}", until)
    elif status in (401, 403):
        ks.disabled_until = now + 6 * 3600
        publish(ks, "d", ks.disabled_until)
    elif status == 402:
        ks.disabled_until = now + 3600
        publish(ks, "d", ks.disabled_until)
    elif status == 404:
        ks.model_cd[model] = now + 600
        publish(ks, f"m:{model}", now + 600)
        breaker_fail(ks.provider, model)
    elif status in (400, 422):
        pass
    else:
        ks.cooldown_until = now + 10
        publish(ks, "c", ks.cooldown_until)
        breaker_fail(ks.provider, model)


async def merge_health():
    """وضعیت کلیدها را که worker های دیگر منتشر کرده‌اند با وضعیت محلی ادغام می‌کند (بیشینه‌ی زمان‌ها)."""
    keys = [k for v in POOL.values() for k in v]
    if not keys:
        return
    data = await state.read_health([k.kh for k in keys])
    for k in keys:
        for f, v in (data.get(k.kh) or {}).items():
            if f == "d":
                k.disabled_until = max(k.disabled_until, v)
            elif f == "c":
                k.cooldown_until = max(k.cooldown_until, v)
            elif f.startswith("m:"):
                k.model_cd[f[2:]] = max(k.model_cd.get(f[2:], 0), v)


# ───────────────────────── کاربران و دیتابیس ─────────────────────────

USERS = {}      # uid -> dict
KEYS = {}       # key_hash -> (kid, uid)
IPS = {}        # uid -> {ip: آخرین زمان}
ANOMALY_SENT = {}
KEY_LAST = {}
USAGE_BUF = []
LOCAL = {"ver": 0}

REQ = defaultdict(int)
TOK = defaultdict(int)
RECENT = deque(maxlen=1000)
CACHE_STATS = {"hit": 0, "miss": 0}
QSTATE = {"n": 0}


def new_key():
    return "sk-" + secrets.token_urlsafe(32)


async def make_key(uid, label=""):
    key = new_key()
    kid = await db.insert_id(
        "INSERT INTO api_keys(uid,key_hash,prefix,label,created) VALUES(?,?,?,?,?)",
        uid, sha(key), key[:8], label, time.time())
    return kid, key


async def reload_users():
    ver = await state.users_version()
    users, keys = {}, {}
    for r in await db.fetch("SELECT id,name,plan,active,rpm,daily_tokens,ip_allow FROM users"):
        users[r[0]] = {
            "id": r[0], "name": r[1], "plan": r[2] if r[2] in PLANS else DEFAULT_PLAN, "active": bool(r[3]),
            "rpm": r[4] or None, "daily_tokens": r[5] or None,
            "ip_allow": [x for x in (r[6] or "").split(",") if x],
        }
    for kid, uid, h in await db.fetch("SELECT id,uid,key_hash FROM api_keys WHERE active=1"):
        if uid in users:
            keys[h] = (kid, uid)
    USERS.clear(); USERS.update(users)   # جایگزینی بدون await تا auth وضعیت نیمه‌کاره نبیند
    KEYS.clear(); KEYS.update(keys)
    LOCAL["ver"] = ver


async def users_changed():
    await state.bump_users()
    await reload_users()


async def load_ledger():
    """موجودی و مصرف امروز را از روی دفتر دیتابیس (اعتبارها منهای هزینه‌ها) محاسبه می‌کند."""
    bal = {uid: 0.0 for uid in USERS}
    for uid, s in await db.fetch("SELECT uid, SUM(amount) FROM credits GROUP BY uid"):
        bal[uid] = bal.get(uid, 0.0) + float(s or 0)
    for uid, s in await db.fetch("SELECT uid, SUM(cost) FROM usage GROUP BY uid"):
        bal[uid] = bal.get(uid, 0.0) - float(s or 0)
    start = float(calendar.timegm(time.strptime(today(), "%Y-%m-%d")))
    tokens = {uid: int(t or 0) for uid, t in await db.fetch(
        "SELECT uid, SUM(pt+ct) FROM usage WHERE ts>=? GROUP BY uid", start)}
    return bal, tokens


async def record(user, alias, upstream, pt, ct, latency_ms, status, cached=0):
    pt, ct = int(pt or 0), int(ct or 0)
    plan, cost = PLANS[user["plan"]], 0.0
    if plan["billing"] and status == 200:
        pr = ALIASES.get(alias, {}).get("price", {})
        cost = (pt * pr.get("in", 0) + ct * pr.get("out", 0)) / 1e6
    await state.add_usage(user["id"], pt + ct, cost)
    now = time.time()
    if len(USAGE_BUF) < MAX_USAGE_BUFFER:
        USAGE_BUF.append((now, user["id"], user["kid"], alias, upstream, pt, ct, cost, int(latency_ms), int(status), cached))
    REQ[(alias, status)] += 1
    TOK[(alias, "prompt")] += pt
    TOK[(alias, "completion")] += ct
    RECENT.append((now, status == 200))


USAGE_SQL = ("INSERT INTO usage(ts,uid,kid,model,upstream,pt,ct,cost,latency_ms,status,cached) "
             "VALUES(?,?,?,?,?,?,?,?,?,?,?)")


async def flush():
    global USAGE_BUF
    if USAGE_BUF:
        rows, USAGE_BUF = USAGE_BUF, []
        try:
            await db.executemany(USAGE_SQL, rows)
        except Exception:
            USAGE_BUF = rows + USAGE_BUF   # اگر دیتابیس لحظه‌ای قطع بود ردیف‌ها از دست نروند
            raise
    if KEY_LAST:
        items = [(float(t), k) for k, t in KEY_LAST.items()]
        KEY_LAST.clear()
        await db.executemany("UPDATE api_keys SET last_used=? WHERE id=?", items)


async def flusher():
    while True:
        await asyncio.sleep(2)
        try:
            await flush()
        except Exception as e:  # noqa
            print("flush error:", type(e).__name__, e)


async def syncer():
    """هر ۲ ثانیه: اگر worker دیگری کاربران را عوض کرده بازخوانی کن و سلامت کلیدها را ادغام کن."""
    while True:
        await asyncio.sleep(2)
        try:
            if await state.users_version() != LOCAL["ver"]:
                await reload_users()
            await merge_health()
        except Exception as e:  # noqa
            print("sync error:", type(e).__name__, e)


# ───────────────────────── هشدار ─────────────────────────


async def send_alert(text):
    print("[alert]", text)
    try:
        if TG_TOKEN and TG_CHAT:
            await client.post(f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                              json={"chat_id": TG_CHAT, "text": f"[{SITE_NAME}] {text}"}, timeout=10)
        if ALERT_WEBHOOK:
            await client.post(ALERT_WEBHOOK, json={"text": f"[{SITE_NAME}] {text}"}, timeout=10)
    except Exception as e:  # noqa
        print("alert send failed:", type(e).__name__)


async def monitor():
    alerted = set()

    async def flip(tag, bad, bad_msg, ok_msg):
        # state.once باعث می‌شود با چند worker هر هشدار فقط یک بار ارسال شود
        if bad and tag not in alerted:
            alerted.add(tag)
            if await state.once("alert:" + tag, 600):
                await send_alert(bad_msg)
        elif not bad and tag in alerted:
            alerted.discard(tag)
            if await state.once("ok:" + tag, 600):
                await send_alert(ok_msg)

    while True:
        await asyncio.sleep(20)
        try:
            now = time.time()
            for name, keys in POOL.items():
                if not keys:
                    continue
                ready = [k for k in keys if k.disabled_until < now and k.cooldown_until < now]
                await flip(f"p:{name}", not ready,
                           f"⚠️ همه‌ی کلیدهای {name} غیرفعال یا در cooldown هستند",
                           f"✅ کلیدهای {name} دوباره فعال شدند")
                for k in keys:
                    await flip(f"k:{k.kh}", k.disabled_until > now,
                               f"🔑 کلید {name} ({mask(k.key)}) غیرفعال شد: {k.last_error}",
                               f"✅ کلید {name} ({mask(k.key)}) دوباره فعال شد")
            for (p, m), (_, until) in list(BREAK.items()):
                await flip(f"b:{p}:{m}", until > now,
                           f"🔌 مسیر {p}:{m} به‌خاطر خطاهای پشت‌سرهم موقتاً قطع شد",
                           f"✅ مسیر {p}:{m} برگشت")
        except Exception as e:  # noqa
            print("monitor error:", e)


# ───────────────────────── احراز هویت و محدودیت ─────────────────────────


def get_ip(request: Request):
    if TRUST_PROXY:
        xf = request.headers.get("x-forwarded-for", "")
        if xf:
            return xf.split(",")[0].strip()
    return request.client.host if request.client else "?"


async def anomaly_alert(user, n):
    if await state.once(f"anom:{user['id']}", 3600):
        await send_alert(f"🚨 کاربر «{user['name']}» در یک ساعت از {n} آی‌پی مختلف استفاده کرده")


def note_ip(user, ip):
    now = time.time()
    d = IPS.setdefault(user["id"], {})
    d[ip] = now
    for old in [i for i, t in d.items() if t < now - 3600]:
        del d[old]
    if len(d) > ANOMALY_IPS and ANOMALY_SENT.get(user["id"], 0) < now - 3600:
        ANOMALY_SENT[user["id"]] = now
        fire(anomaly_alert(user, len(d)))


async def auth(request: Request, authorization: str = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip()
    hit = KEYS.get(sha(token)) if token else None
    user = USERS.get(hit[1]) if hit else None
    if not user or not user["active"]:
        raise ApiError(401, "Invalid API key", "authentication_error")
    ip = get_ip(request)
    if user["ip_allow"] and ip not in user["ip_allow"]:
        raise ApiError(403, "Request from this IP is not allowed", "permission_error")
    note_ip(user, ip)
    KEY_LAST[hit[0]] = time.time()
    return {**user, "kid": hit[0]}


async def check_limits(user, plan):
    rpm = user["rpm"] or plan["rpm"]
    quota = user["daily_tokens"] or plan["daily_tokens"]
    st, retry, _, _ = await state.check(user["id"], rpm, quota, plan["billing"])
    if st == 1:
        raise ApiError(429, "Rate limit exceeded", "rate_limit_error", {"Retry-After": str(max(retry, 1))})
    if st == 2:
        raise ApiError(429, "Daily token quota exceeded", "quota_error")
    if st == 3:
        raise ApiError(402, "Insufficient credit. Please top up your balance.", "billing_error")


async def admin(authorization: str = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not ADMIN_TOKEN or not hmac.compare_digest(token, ADMIN_TOKEN):
        raise ApiError(403, "Forbidden", "permission_error")


# ───────────────────────── ارتباط با upstream ─────────────────────────


def est_tokens(n_chars):
    return max(1, n_chars // 4)


async def try_upstream(ks: KeyState, model, payload, stream):
    p = PROVIDERS[ks.provider]
    headers = {"Authorization": f"Bearer {ks.key}", "Content-Type": "application/json", **p["headers"]}
    ks.inflight += 1
    ks.last_used = time.time()
    try:
        req = client.build_request("POST", f"{p['base']}/chat/completions",
                                   headers=headers, json={**payload, "model": model})
        resp = await client.send(req, stream=stream)
    except httpx.HTTPError as e:
        ks.inflight -= 1
        penalize(ks, model, 0, None, f"network: {type(e).__name__}")
        return None
    if resp.status_code == 200:
        return resp
    try:
        await resp.aread()
        body = resp.json()
        msg = (body.get("error") or {}).get("message") or str(body)[:200]
    except Exception:  # noqa
        msg = resp.text[:200] if resp.content else "no body"
    await resp.aclose()
    ks.inflight -= 1
    penalize(ks, model, resp.status_code, resp.headers, msg)
    print(f"[upstream] {ks.provider}:{model} key={mask(ks.key)} -> {resp.status_code} {str(msg)[:120]}")
    return None


async def dispatch(routes, tiers, payload, stream, state_):
    for provider, model in routes:
        for ks in pick_keys(provider, model, tiers)[:KEYS_PER_ROUTE]:
            if state_["attempts"] >= MAX_ATTEMPTS:
                return None
            state_["attempts"] += 1
            t = time.time()
            resp = await try_upstream(ks, model, payload, stream)
            if resp is None:
                continue
            lat, k = time.time() - t, (provider, model, stream)
            LAT[k] = lat if k not in LAT else 0.7 * LAT[k] + 0.3 * lat
            breaker_ok(provider, model)
            return resp, ks, provider, model
    return None


async def finish_stream(resp, user, alias, upstream, t0, prompt_tokens, usage, out_chars, status):
    """کارهای بعد از استریم در یک task مستقل؛ حتی اگر کلاینت قطع کرده باشد کامل اجرا می‌شود."""
    try:
        await resp.aclose()
    except Exception:  # noqa
        pass
    pt = (usage or {}).get("prompt_tokens") or prompt_tokens
    ct = (usage or {}).get("completion_tokens") or est_tokens(out_chars)
    await record(user, alias, upstream, pt, ct, int((time.time() - t0) * 1000), status)


async def stream_gen(resp, ks, user, alias, upstream, rid, t0, prompt_tokens):
    usage, out_chars, status = None, 0, 499  # ۴۹۹ = کلاینت وسط استریم قطع کرد
    try:
        async for line in resp.aiter_lines():
            if not line.startswith("data:"):
                continue
            d = line[5:].strip()
            if d == "[DONE]":
                yield "data: [DONE]\n\n"
                continue
            try:
                obj = json.loads(d)
            except ValueError:
                continue
            obj["model"], obj["id"] = alias, rid
            obj.pop("provider", None)
            obj.pop("system_fingerprint", None)
            u = obj.get("usage") or (obj.get("x_groq") or {}).get("usage")
            if u:
                usage = u
            for c in obj.get("choices") or []:
                out_chars += len((c.get("delta") or {}).get("content") or "")
            yield f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
        ks.ok += 1
        status = 200
    except httpx.HTTPError:
        ks.fail += 1
        status = 599
        err = {"error": {"message": "upstream stream interrupted", "type": "api_error", "code": 502}}
        yield f"data: {json.dumps(err)}\n\n"
        yield "data: [DONE]\n\n"
    finally:
        ks.inflight -= 1
        fire(finish_stream(resp, user, alias, upstream, t0, prompt_tokens, usage, out_chars, status))


# ───────────────────────── اپلیکیشن ─────────────────────────


@asynccontextmanager
async def lifespan(app):
    global client, state
    await db.connect(DATABASE_URL, env_int("PG_POOL_MAX", 10))
    await db.init_schema()
    state = await make_state(REDIS_URL, CACHE_MAX)
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(120, connect=10),
        limits=httpx.Limits(max_connections=2000, max_keepalive_connections=200),
    )
    await reload_users()
    if await state.claim_init():           # فقط اولین worker، Redis را از روی دفتر دیتابیس می‌سازد
        await state.load(*await load_ledger())
    tasks = [asyncio.create_task(f()) for f in (flusher, monitor, syncer)]
    n_free = sum(1 for v in POOL.values() for k in v if k.tier == "free")
    n_paid = sum(1 for v in POOL.values() for k in v if k.tier == "paid")
    print(f"gateway up: db={db.kind} state={state.name} | {n_free} free + {n_paid} paid keys, "
          f"{len(ALIASES)} models, {len(PLANS)} plans, {len(USERS)} users")
    if not ADMIN_TOKEN:
        print("WARNING: ADMIN_TOKEN تنظیم نشده؛ پنل ادمین غیرفعال است.")
    yield
    for t in tasks:
        t.cancel()
    try:
        await flush()
    except Exception as e:  # noqa
        print("final flush failed:", e)
    await client.aclose()
    await state.close()
    await db.close()


app = FastAPI(
    title=f"{SITE_NAME} API",
    version="3.0",
    description="API سازگار با OpenAI. با هر SDK رسمی OpenAI کار می‌کند: فقط `base_url` و `api_key` را عوض کن.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
# فرانت React (frontend/ → npm run build → frontend/dist)
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
if (FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.exception_handler(ApiError)
async def api_error_handler(request, e: ApiError):
    return JSONResponse({"error": {"message": e.message, "type": e.typ, "code": e.status}},
                        status_code=e.status, headers=e.headers)


def spa():
    index = FRONTEND_DIST / "index.html"
    if not index.is_file():
        return HTMLResponse(
            "<meta charset=utf-8><body dir=rtl style='font-family:sans-serif;padding:2rem'>"
            "فرانت هنوز بیلد نشده. داخل پوشه‌ی <code>frontend</code> دستور "
            "<code>npm install &amp;&amp; npm run build</code> را اجرا کن.", status_code=503)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse("/panel")


@app.get("/panel", include_in_schema=False)
@app.get("/panel/{path:path}", include_in_schema=False)
async def panel_page(path: str = ""):
    return spa()


@app.get("/admin-ui", include_in_schema=False)
@app.get("/admin-ui/{path:path}", include_in_schema=False)
async def admin_page(path: str = ""):
    return spa()


@app.get("/status", include_in_schema=False)
async def status_page():
    return spa()


@app.get("/health")
async def health():
    now = time.time()
    live = sum(1 for v in POOL.values() for k in v if k.disabled_until < now and k.cooldown_until < now)
    db_ok = True
    try:
        await db.fetchval("SELECT 1")
    except Exception:  # noqa
        db_ok = False
    redis_state = "disabled"
    if state.name == "redis":
        try:
            await state.ping()
            redis_state = "ok"
        except Exception:  # noqa
            redis_state = "degraded"
    return {"status": "ok" if db_ok else "degraded", "live_keys": live,
            "db": db.kind if db_ok else "down", "redis": redis_state}


@app.get("/api/status")
async def api_status():
    """وضعیت عمومی بدون افشای نام ارائه‌دهنده‌ها یا کلیدها."""
    models = []
    for alias, cfg in ALIASES.items():
        routes = [(p, m) for p, m in cfg["routes"] if POOL.get(p)]
        up = sum(1 for p, m in routes if pick_keys(p, m, ["paid", "free"]) and not breaker_open(p, m))
        st = "down" if up == 0 else ("operational" if up == len(routes) else "degraded")
        models.append({"id": alias, "status": st})
    now = time.time()
    recent = [ok for t, ok in RECENT if t > now - 900]
    overall = "operational" if all(m["status"] == "operational" for m in models) else (
        "down" if all(m["status"] == "down" for m in models) else "degraded")
    return {
        "site": SITE_NAME, "status": overall, "models": models, "updated": int(now),
        "success_rate_15m": round(sum(recent) / len(recent), 4) if recent else None,
    }


@app.get("/v1/models")
async def list_models(user=Depends(auth)):
    plan = PLANS[user["plan"]]
    return {"object": "list", "data": [
        {"id": a, "object": "model", "created": 0, "owned_by": SITE_NAME}
        for a in ALIASES if "*" in plan["models"] or a in plan["models"]
    ]}


@app.post("/v1/chat/completions")
async def chat(request: Request, user=Depends(auth)):
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise ApiError(413, "Request body too large", "invalid_request_error")
    try:
        body = json.loads(raw)
    except ValueError:
        raise ApiError(400, "Invalid JSON body", "invalid_request_error")
    if not isinstance(body, dict):
        raise ApiError(400, "Body must be a JSON object", "invalid_request_error")

    alias = body.get("model") or DEFAULT_ALIAS
    cfg, plan = ALIASES.get(alias), PLANS[user["plan"]]
    if not cfg or ("*" not in plan["models"] and alias not in plan["models"]):
        raise ApiError(404, f"Model '{alias}' not found", "invalid_request_error")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages or not all(
            isinstance(m, dict) and "role" in m for m in messages):
        raise ApiError(400, "'messages' must be a non-empty list of {role, content}", "invalid_request_error")

    await check_limits(user, plan)

    if BRAND_PROMPT:
        messages = [{"role": "system", "content": BRAND_PROMPT}] + [m for m in messages if m.get("role") != "system"]
    payload = {k: body[k] for k in ALLOWED_PARAMS if k in body}
    try:
        mt = int(body.get("max_tokens") or body.get("max_completion_tokens") or plan["max_tokens"])
    except (TypeError, ValueError):
        raise ApiError(400, "'max_tokens' must be an integer", "invalid_request_error")
    payload["max_tokens"] = max(1, min(mt, plan["max_tokens"]))
    payload["messages"] = messages
    stream = bool(body.get("stream"))
    payload["stream"] = stream

    rid, t0 = "chatcmpl-" + uuid.uuid4().hex[:24], time.time()
    prompt_tokens = est_tokens(len(json.dumps(messages, ensure_ascii=False)))

    ckey = None
    if not stream and CACHE_TTL > 0 and payload.get("temperature") == 0 and "tools" not in payload:
        ckey = sha(json.dumps([alias, payload], sort_keys=True, ensure_ascii=False))
        hit = await state.cache_get(ckey)
        if hit:
            CACHE_STATS["hit"] += 1
            hit["id"] = rid
            u = hit.get("usage") or {}
            await record(user, alias, "cache", u.get("prompt_tokens", 0), u.get("completion_tokens", 0),
                         int((time.time() - t0) * 1000), 200, 1)
            return JSONResponse(hit, headers={"X-Request-ID": rid, "X-Cache": "HIT"})
        CACHE_STATS["miss"] += 1

    tiers, attempts, got, queued = plan["tiers"], {"attempts": 0}, None, False
    routes, deadline = ordered_routes(cfg, stream), t0 + QUEUE_WAIT
    try:
        while True:
            got = await dispatch(routes, tiers, payload, stream, attempts)
            if got or attempts["attempts"] > 0:
                break
            wait = next_available_in(routes, tiers)  # همه‌ی کلیدها در cooldown؛ شاید زود آزاد شوند
            if wait is None or time.time() + wait > deadline:
                break
            if not queued:
                if QSTATE["n"] >= MAX_QUEUE:
                    break
                QSTATE["n"] += 1
                queued = True
            await asyncio.sleep(wait + 0.05)
            routes = ordered_routes(cfg, stream)
    finally:
        if queued:
            QSTATE["n"] -= 1

    if not got:
        await record(user, alias, "none", 0, 0, int((time.time() - t0) * 1000), 503)
        raise ApiError(503, "All upstream capacity is busy, please retry shortly", "overloaded_error",
                       {"Retry-After": "5"})

    resp, ks, provider, model = got
    upstream = f"{provider}:{model}"
    headers = {"X-Request-ID": rid, "Cache-Control": "no-cache", "X-Accel-Buffering": "no"}

    if stream:
        return StreamingResponse(
            stream_gen(resp, ks, user, alias, upstream, rid, t0, prompt_tokens),
            media_type="text/event-stream", headers=headers)

    try:
        data = resp.json()
        msg = ((data.get("choices") or [{}])[0]).get("message") or {}
        has_output = bool((msg.get("content") or "").strip() or msg.get("tool_calls"))
    except Exception:  # noqa
        data, msg, has_output = None, {}, False
    finally:
        ks.inflight -= 1

    if not has_output:
        penalize(ks, model, 0, None, "empty response")
        await record(user, alias, upstream, 0, 0, int((time.time() - t0) * 1000), 502)
        raise ApiError(502, "Upstream returned an empty response, please retry", "api_error")

    ks.ok += 1
    data["model"], data["id"] = alias, rid
    data.pop("provider", None)
    data.pop("system_fingerprint", None)
    u = data.get("usage") or {}
    await record(user, alias, upstream,
                 u.get("prompt_tokens") or prompt_tokens,
                 u.get("completion_tokens") or est_tokens(len(msg.get("content") or "")),
                 int((time.time() - t0) * 1000), 200)
    if ckey:
        await state.cache_put(ckey, data, CACHE_TTL)
    return JSONResponse(data, headers=headers)


# ───────────────────────── حساب کاربر (پنل کاربر) ─────────────────────────

account = APIRouter(prefix="/account", tags=["account"])


class KeyReq(BaseModel):
    label: str = ""


@account.get("/me")
async def me(user=Depends(auth)):
    plan = PLANS[user["plan"]]
    return {
        "name": user["name"], "plan": user["plan"], "billing": plan["billing"],
        "balance": round(await state.bal_get(user["id"]), 4),
        "limits": {"rpm": user["rpm"] or plan["rpm"], "daily_tokens": user["daily_tokens"] or plan["daily_tokens"],
                   "max_tokens": plan["max_tokens"]},
        "tokens_today": await state.tokens_get(user["id"]),
        "models": [{"id": a, "price": c["price"]} for a, c in ALIASES.items()
                   if "*" in plan["models"] or a in plan["models"]],
        "site": SITE_NAME,
    }


@account.get("/keys")
async def list_keys(user=Depends(auth)):
    rows = await db.fetch("SELECT id,prefix,label,created,last_used FROM api_keys "
                          "WHERE uid=? AND active=1 ORDER BY id", user["id"])
    return [{"id": r[0], "prefix": r[1], "label": r[2], "created": r[3], "last_used": r[4],
             "current": r[0] == user["kid"]} for r in rows]


@account.post("/keys")
async def create_key(req: KeyReq, user=Depends(auth)):
    n = await db.fetchval("SELECT COUNT(*) FROM api_keys WHERE uid=? AND active=1", user["id"])
    if n >= 10:
        raise ApiError(400, "You can have at most 10 active keys", "invalid_request_error")
    kid, key = await make_key(user["id"], req.label[:60])
    await users_changed()
    return {"id": kid, "api_key": key, "note": "این کلید فقط همین یک بار نمایش داده می‌شود"}


@account.delete("/keys/{kid}")
async def revoke_key(kid: int, user=Depends(auth)):
    n = await db.fetchval("SELECT COUNT(*) FROM api_keys WHERE uid=? AND active=1", user["id"])
    if n <= 1:
        raise ApiError(400, "You can't revoke your only key. Create another one first.", "invalid_request_error")
    await db.execute("UPDATE api_keys SET active=0 WHERE id=? AND uid=?", kid, user["id"])
    await users_changed()
    return {"ok": True}


@account.get("/usage")
async def my_usage(days: int = 7, user=Depends(auth)):
    await flush()
    since = time.time() - min(max(days, 1), 90) * 86400
    q = ("SELECT {g}, COUNT(*), SUM(pt), SUM(ct), SUM(cost) FROM usage "
         "WHERE uid=? AND ts>=? AND status=200 GROUP BY 1 ORDER BY 1")
    daily = await db.fetch(q.format(g=db.day_expr("ts")), user["id"], since)
    by_model = await db.fetch(q.format(g="model"), user["id"], since)
    fmt = lambda r: {"key": r[0], "requests": int(r[1]), "prompt_tokens": int(r[2] or 0),
                     "completion_tokens": int(r[3] or 0), "cost": round(float(r[4] or 0), 5)}
    return {"daily": [fmt(r) for r in daily], "models": [fmt(r) for r in by_model]}


app.include_router(account)

# ───────────────────────── ادمین ─────────────────────────

adm = APIRouter(prefix="/admin", dependencies=[Depends(admin)], include_in_schema=False)


class NewUser(BaseModel):
    name: str
    plan: str = DEFAULT_PLAN
    rpm: Optional[int] = None
    daily_tokens: Optional[int] = None
    ip_allow: List[str] = []


class UserPatch(BaseModel):
    plan: Optional[str] = None
    rpm: Optional[int] = None
    daily_tokens: Optional[int] = None
    active: Optional[bool] = None
    ip_allow: Optional[List[str]] = None


class Credit(BaseModel):
    amount: float
    note: str = ""


@adm.get("/overview")
async def overview():
    return {"plans": PLANS, "models": list(ALIASES), "queued": QSTATE["n"], "cache_entries": await state.cache_size(),
            "cache": CACHE_STATS, "default_plan": DEFAULT_PLAN,
            "backend": {"db": db.kind, "state": state.name, "degraded": bool(getattr(state, "degraded", False))}}


@adm.post("/users")
async def create_user(u: NewUser):
    if u.plan not in PLANS:
        raise ApiError(400, f"Unknown plan '{u.plan}'", "invalid_request_error")
    uid = await db.insert_id("INSERT INTO users(name,plan,rpm,daily_tokens,ip_allow,created) VALUES(?,?,?,?,?,?)",
                             u.name, u.plan, u.rpm, u.daily_tokens, ",".join(u.ip_allow), time.time())
    _, key = await make_key(uid, "default")
    await users_changed()
    return {"id": uid, "name": u.name, "api_key": key, "note": "این کلید فقط همین یک بار نمایش داده می‌شود"}


@adm.get("/users")
async def list_users():
    kc = dict(await db.fetch("SELECT uid,COUNT(*) FROM api_keys WHERE active=1 GROUP BY uid"))
    out = []
    for u in list(USERS.values()):
        out.append({"id": u["id"], "name": u["name"], "plan": u["plan"], "active": u["active"], "rpm": u["rpm"],
                    "daily_tokens": u["daily_tokens"], "ip_allow": u["ip_allow"], "keys": int(kc.get(u["id"], 0)),
                    "tokens_today": await state.tokens_get(u["id"]),
                    "balance": round(await state.bal_get(u["id"]), 4)})
    return out


@adm.patch("/users/{uid}")
async def patch_user(uid: int, p: UserPatch):
    data = getattr(p, "model_dump", p.dict)(exclude_unset=True)
    if "plan" in data and data["plan"] not in PLANS:
        raise ApiError(400, "Unknown plan", "invalid_request_error")
    for col, val in data.items():
        if col == "active":
            val = int(val)
        elif col == "ip_allow":
            val = ",".join(val or [])
        elif col in ("rpm", "daily_tokens"):
            val = val or None
        await db.execute(f"UPDATE users SET {col}=? WHERE id=?", val, uid)  # col از فیلدهای ثابت مدل می‌آید
    await users_changed()
    return {"ok": True}


@adm.post("/users/{uid}/credit")
async def add_credit(uid: int, c: Credit):
    if uid not in USERS:
        raise ApiError(404, "User not found", "invalid_request_error")
    await db.execute("INSERT INTO credits(ts,uid,amount,note) VALUES(?,?,?,?)", time.time(), uid, c.amount, c.note)
    return {"balance": round(await state.bal_add(uid, c.amount), 4)}


@adm.post("/users/{uid}/keys")
async def admin_new_key(uid: int, req: KeyReq):
    if uid not in USERS:
        raise ApiError(404, "User not found", "invalid_request_error")
    kid, key = await make_key(uid, req.label or "admin")
    await users_changed()
    return {"id": kid, "api_key": key}


@adm.delete("/users/{uid}")
async def delete_user(uid: int):
    await db.execute("DELETE FROM api_keys WHERE uid=?", uid)
    await db.execute("DELETE FROM users WHERE id=?", uid)
    await users_changed()
    return {"ok": True}


@adm.post("/rebuild-state")
async def rebuild_state():
    """اگر Redis خالی یا ناسازگار شد، موجودی و مصرف امروز را از روی دفتر دیتابیس دوباره می‌سازد."""
    await flush()
    bal, tokens = await load_ledger()
    await state.load(bal, tokens)
    return {"ok": True, "users": len(bal)}


@adm.get("/pool")
async def pool_status():
    now, out = time.time(), []
    for name, keys in POOL.items():
        for k in keys:
            out.append({
                "provider": name, "tier": k.tier, "key": mask(k.key),
                "state": "disabled" if k.disabled_until > now else "cooldown" if k.cooldown_until > now else "ready",
                "limited_models": {m: int(t - now) for m, t in k.model_cd.items() if t > now},
                "inflight": k.inflight, "ok": k.ok, "fail": k.fail, "last_error": k.last_error,
            })
    routes = [{"route": f"{p}:{m}", "open": until > now, "fails": f, "latency_ms":
               {str(s): int(v * 1000) for (pp, mm, s), v in LAT.items() if (pp, mm) == (p, m)}}
              for (p, m), (f, until) in BREAK.items()]
    return {"keys": out, "breakers": routes}


@adm.post("/pool/reset")
async def pool_reset():
    keys = [k for v in POOL.values() for k in v]
    for k in keys:
        k.disabled_until = k.cooldown_until = 0
        k.model_cd.clear()
    BREAK.clear()
    await state.clear_health([k.kh for k in keys])
    return {"ok": True}


@adm.get("/stats")
async def stats(hours: int = 24):
    await flush()
    since = time.time() - hours * 3600
    rows = await db.fetch(
        "SELECT model, COUNT(*), SUM(pt), SUM(ct), AVG(latency_ms), "
        "SUM(CASE WHEN status<>200 THEN 1 ELSE 0 END), SUM(cost), SUM(cached) "
        "FROM usage WHERE ts>=? GROUP BY model", since)
    return [{"model": r[0], "requests": int(r[1]), "prompt_tokens": int(r[2] or 0), "completion_tokens": int(r[3] or 0),
             "avg_latency_ms": int(r[4] or 0), "errors": int(r[5] or 0), "revenue": round(float(r[6] or 0), 4),
             "cache_hits": int(r[7] or 0)} for r in rows]


app.include_router(adm)


@app.get("/metrics", include_in_schema=False, dependencies=[Depends(admin)])
async def metrics():
    now, L = time.time(), []
    L.append("# TYPE gateway_requests_total counter")
    L += [f'gateway_requests_total{{model="{a}",status="{s}"}} {v}' for (a, s), v in REQ.items()]
    L.append("# TYPE gateway_tokens_total counter")
    L += [f'gateway_tokens_total{{model="{a}",kind="{k}"}} {v}' for (a, k), v in TOK.items()]
    L.append("# TYPE gateway_upstream_errors_total counter")
    L += [f'gateway_upstream_errors_total{{provider="{p}",status="{s}"}} {v}' for (p, s), v in UPERR.items()]
    L.append("# TYPE gateway_keys gauge")
    for name, keys in POOL.items():
        for st in ("ready", "cooldown", "disabled"):
            n = sum(1 for k in keys if (
                "disabled" if k.disabled_until > now else "cooldown" if k.cooldown_until > now else "ready") == st)
            L.append(f'gateway_keys{{provider="{name}",state="{st}"}} {n}')
    L.append("# TYPE gateway_route_latency_seconds gauge")
    L += [f'gateway_route_latency_seconds{{provider="{p}",model="{m}",stream="{int(s)}"}} {v:.4f}'
          for (p, m, s), v in LAT.items()]
    L.append(f"gateway_queue_waiting {QSTATE['n']}")
    L.append(f"gateway_cache_hits_total {CACHE_STATS['hit']}")
    L.append(f"gateway_cache_misses_total {CACHE_STATS['miss']}")
    L.append(f"gateway_state_degraded {int(bool(getattr(state, 'degraded', False)))}")
    return PlainTextResponse("\n".join(L) + "\n")


if __name__ == "__main__":
    # اجرای مستقیم:  python app.py   (معادل uvicorn app:app)
    import uvicorn
    uvicorn.run("app:app", host=os.environ.get("HOST", "0.0.0.0"), port=env_int("PORT", 8000),
                workers=env_int("WORKERS", 1))
