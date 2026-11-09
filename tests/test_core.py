"""منطق pool، breaker، پلن، اعتبار و دفتر دیتابیس (SQLite + حافظه)."""
import asyncio, os, sys, tempfile, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.update(GROQ_API_KEYS="gsk_aaaaaaaaaaaa1111,gsk_bbbbbbbbbbbb2222", GROQ_PAID_API_KEY="gsk_paidpaidpaid3333",
                  OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxx", ADMIN_TOKEN="adm")
import app as A
from state import make_state


async def main():
    await A.db.connect("sqlite:///" + tempfile.mktemp(suffix=".db")); await A.db.init_schema()
    A.state = await make_state("")
    uid = await A.db.insert_id("INSERT INTO users(name,plan,created) VALUES(?,?,?)", "ali", "basic", time.time())
    kid, key = await A.make_key(uid, "default"); await A.reload_users()
    u = {**A.USERS[uid], "kid": kid}
    assert A.KEYS[A.sha(key)] == (kid, uid)

    # پلن و اعتبار
    plan = A.PLANS["basic"]
    try: await A.check_limits(u, plan); raise SystemExit("باید اعتبار بخواهد")
    except A.ApiError as e: assert e.status == 402, e.status
    await A.db.execute("INSERT INTO credits(ts,uid,amount,note) VALUES(?,?,?,?)", time.time(), uid, 5.0, "t")
    await A.state.bal_add(uid, 5.0)
    await A.check_limits(u, plan)
    await A.record(u, "my-ai", "groq:x", 1000, 500, 120, 200)
    exp = (1000 * 0.60 + 500 * 1.20) / 1e6
    assert abs(await A.state.bal_get(uid) - (5 - exp)) < 1e-9

    # tier ها: basic اول paid، free فقط کلید رایگان
    ks = A.pick_keys("groq", "m", ["paid", "free"]); assert ks[0].tier == "paid" and len(ks) == 3
    ks = A.pick_keys("groq", "m", ["free"]); assert all(k.tier == "free" for k in ks) and len(ks) == 2

    # ۴۲۹ فقط همان مدل را روی همان کلید خنک می‌کند؛ ۴۰۱ کل کلید را
    k0 = ks[0]; A.penalize(k0, "m", 429, {"retry-after": "30"}, "rl")
    assert k0 not in A.pick_keys("groq", "m", ["free"]) and k0 in A.pick_keys("groq", "other", ["free"])
    k1 = ks[1]; A.penalize(k1, "other", 401, {}, "bad")
    assert k1 not in A.pick_keys("groq", "other", ["free"])
    w = A.next_available_in([("groq", "m")], ["free"]); assert w is not None and 25 < w <= 30, w

    # breaker
    for _ in range(3): A.breaker_fail("groq", "zzz")
    assert A.breaker_open("groq", "zzz"); A.breaker_ok("groq", "zzz"); assert not A.breaker_open("groq", "zzz")

    # مسیریابی بر اساس latency
    cfg = A.ALIASES["my-ai-fast"]
    A.LAT[("groq", "llama-3.1-8b-instant", False)] = 0.5
    A.LAT[("openrouter", "nvidia/nemotron-3.5-lightning:free", False)] = 0.1
    assert A.ordered_routes(cfg, False)[0][0] == "openrouter"

    # کش حافظه کپی برمی‌گرداند
    await A.state.cache_put("k", {"a": 1}, 60)
    c = await A.state.cache_get("k"); c["a"] = 2
    assert (await A.state.cache_get("k")) == {"a": 1}

    # محدودیت RPM
    A.state.windows.clear()
    u2 = {**u, "plan": "free"}
    try:
        for _ in range(11): await A.check_limits(u2, A.PLANS["free"])
        raise SystemExit("rpm اعمال نشد")
    except A.ApiError as e: assert e.status == 429

    # دفتر: ذخیره‌ی مصرف و بازسازی موجودی از دیتابیس
    await A.record(u, "my-ai", "groq:x", 100, 100, 50, 200)
    await A.flush()
    live = await A.state.bal_get(uid)
    bal, tokens = await A.load_ledger()
    assert abs(bal[uid] - live) < 1e-9, (bal[uid], live)
    assert tokens[uid] == 1700, tokens

    # گزارش روزانه با عبارت تاریخ سازگار
    rows = await A.db.fetch("SELECT %s, COUNT(*) FROM usage GROUP BY 1" % A.db.day_expr("ts"))
    assert rows[0][0] == time.strftime("%Y-%m-%d", time.gmtime()), rows
    print("CORE OK")

asyncio.run(main())
