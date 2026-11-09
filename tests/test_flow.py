import os, sys, asyncio, time, tempfile, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.update(GROQ_API_KEYS="gsk_aaaaaaaaaaaa1111,gsk_bbbbbbbbbbbb2222", OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxx",
                  DB_PATH=tempfile.mktemp(suffix=".db"), ADMIN_TOKEN="adm", QUEUE_WAIT="2")
import httpx, app as A
from state import make_state

def J(r):
    b = getattr(r, 'body', None)
    return json.loads(b) if isinstance(b, (bytes, bytearray)) else r.content
def ITER(r):
    return getattr(r, 'body_iterator', None) or r.content
def TEXT(r):
    b = getattr(r, 'body', None)
    return b.decode() if isinstance(b, (bytes, bytearray)) else r.content


CALLS = []
BEHAVIOR = {}   # key suffix -> function(model) -> (status, body/None, headers)
class FResp:
    def __init__(s, status, body, headers=None, lines=None):
        s.status_code, s._b, s.headers, s._lines = status, body, headers or {}, lines
        s.content = b"x"; s.text = json.dumps(body)
    def json(s): return s._b
    async def aread(s): return b"x"
    async def aclose(s): pass
    async def aiter_lines(s):
        for l in s._lines: yield l
class FClient:
    def build_request(s, method, url, headers=None, json=None): return {"key": headers["Authorization"][-4:], "json": json, "url": url}
    async def send(s, req, stream=False):
        CALLS.append((req["key"], req["json"]["model"]))
        return BEHAVIOR.get(req["key"], BEHAVIOR["default"])(req, stream)
def ok(req, stream):
    if stream:
        L = ['data: ' + json.dumps({"id": "x", "model": "real", "provider": "Groq", "choices": [{"delta": {"content": "سلام"}}]}), "",
             'data: ' + json.dumps({"id": "x", "choices": [], "usage": {"prompt_tokens": 7, "completion_tokens": 3}}), "", "data: [DONE]"]
        return FResp(200, None, lines=L)
    return FResp(200, {"id": "x", "model": "real", "provider": "Groq", "choices": [{"message": {"content": "hi"}}], "usage": {"prompt_tokens": 5, "completion_tokens": 2}})
def rl(req, stream): return FResp(429, {"error": {"message": "slow down"}}, {"retry-after": "1"})
def boom(req, stream): return FResp(500, {"error": {"message": "oops"}})
class Req:
    def __init__(s, body): s._b = json.dumps(body).encode(); s.client = type("C", (), {"host": "1.2.3.4"})(); s.headers = {}
    async def body(s): return s._b

async def main():
    await A.db.connect("sqlite:///" + tempfile.mktemp(suffix=".db")); await A.db.init_schema()
    A.state = await make_state(""); A.client = FClient()
    uid = await A.db.insert_id("INSERT INTO users(name,plan,created) VALUES(?,?,?)", "t", "team", time.time())
    kid, key = await A.make_key(uid); await A.reload_users()
    user = await A.auth(Req({}), "Bearer " + key)
    chat = lambda body: A.chat(Req(body), user)
    msgs = [{"role": "user", "content": "hello"}]
    A.LAT.clear()

    # 1) failover: both groq keys rate-limited -> openrouter answers
    BEHAVIOR.update({"1111": rl, "2222": rl, "xxxx": ok, "default": ok})
    r = await chat({"model": "my-ai", "messages": msgs})
    assert r.status_code == 200 and J(r)["model"] == "my-ai" and "provider" not in J(r), J(r)
    assert any(c[0] == "xxxx" for c in CALLS); print("failover ok", CALLS)
    # those two keys are now cooling for that model only
    assert not A.pick_keys("groq", "llama-3.3-70b-versatile", ["free"])
    assert len(A.pick_keys("groq", "llama-3.1-8b-instant", ["free"])) == 2

    # 2) streaming through alias rewrite + usage accounting
    A.pick_keys  # noqa
    for k in A.POOL["groq"]: k.model_cd.clear()
    BEHAVIOR.update({"1111": ok, "2222": ok, "xxxx": ok})
    r = await chat({"model": "my-ai-fast", "messages": msgs, "stream": True})
    out = [c async for c in ITER(r)]
    await asyncio.sleep(0.05)   # task پایان استریم مستقل اجرا می‌شود
    txt = "".join(out); assert '"model": "my-ai-fast"' in txt and "Groq" not in txt and "[DONE]" in txt, txt
    assert A.USAGE_BUF[-1][5:7] == (7, 3) and A.USAGE_BUF[-1][9] == 200; print("stream ok")
    assert all(k.inflight == 0 for v in A.POOL.values() for k in v), "inflight leak"

    # 3) cache for temperature 0
    n = len(CALLS)
    a = await chat({"model": "my-ai-fast", "messages": msgs, "temperature": 0})
    b = await chat({"model": "my-ai-fast", "messages": msgs, "temperature": 0})
    assert len(CALLS) == n + 1 and b.headers.get("X-Cache") == "HIT" and J(a)["id"] != J(b)["id"]; print("cache ok")

    # 4) queue: everything in cooldown for ~0.5s -> request waits then succeeds
    now = time.time()
    for v in A.POOL.values():
        for k in v: k.cooldown_until = now + 0.5
    t = time.time(); r = await chat({"model": "my-ai-fast", "messages": [{"role": "user", "content": "queue"}]})
    assert r.status_code == 200 and 0.4 < time.time() - t < 1.5 and A.QSTATE["n"] == 0; print("queue ok", round(time.time() - t, 2))

    # 5) all upstreams failing -> 503 + breaker opens
    BEHAVIOR.update({"1111": boom, "2222": boom, "xxxx": boom})
    for k in (k for v in A.POOL.values() for k in v): k.cooldown_until = 0; k.model_cd.clear()
    try:
        await chat({"model": "my-ai-pro", "messages": [{"role": "user", "content": "x"}]}); raise SystemExit("expected 503")
    except A.ApiError as e: assert e.status == 503, e.status
    print("503 ok; breakers:", {k: v[0] for k, v in A.BREAK.items()})

    # 6) validation + plan model restriction + token clamp
    for bad, st in (({"messages": []}, 400), ({"model": "nope", "messages": msgs}, 404)):
        try: await chat(bad); raise SystemExit("expected error")
        except A.ApiError as e: assert e.status == st, (bad, e.status)
    BEHAVIOR.update({"1111": ok, "2222": ok, "xxxx": ok}); [setattr(k, "cooldown_until", 0) for v in A.POOL.values() for k in v]
    A.BREAK.clear(); CALLS.clear()
    await chat({"model": "my-ai-fast", "messages": [{"role": "user", "content": "clamp"}], "max_tokens": 10**9})
    
    # 7) اعتبار: کاربر پولی بدون اعتبار رد می‌شود، با اعتبار هزینه کم می‌شود
    uid2 = await A.db.insert_id("INSERT INTO users(name,plan,created) VALUES(?,?,?)", "b", "basic", time.time())
    _, key2 = await A.make_key(uid2); await A.reload_users()
    user2 = await A.auth(Req({}), "Bearer " + key2)
    try: await A.chat(Req({"model": "my-ai-fast", "messages": msgs}), user2); raise SystemExit("expected 402")
    except A.ApiError as e: assert e.status == 402
    await A.db.execute("INSERT INTO credits(ts,uid,amount,note) VALUES(?,?,?,?)", time.time(), uid2, 1.0, "t")
    await A.state.bal_add(uid2, 1.0)
    await A.chat(Req({"model": "my-ai-fast", "messages": msgs}), user2)
    assert 0 < 1.0 - await A.state.bal_get(uid2) < 0.001, await A.state.bal_get(uid2)
    # 8) ادمین: موجودی در دفتر دیتابیس با Redis/حافظه سازگار است
    await A.flush(); bal, _ = await A.load_ledger()
    assert abs(bal[uid2] - await A.state.bal_get(uid2)) < 1e-9
    print("status:", (await A.api_status())["status"], "| metrics lines:", len(TEXT(await A.metrics()).splitlines()))
    print("ALL ASYNC OK")
asyncio.run(main())
