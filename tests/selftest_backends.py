"""
تست واقعی PostgreSQL و Redis روی سیستم خودت. قبل از اجرای سرویس این را یک بار اجرا کن:

    python tests/selftest_backends.py

از DATABASE_URL و REDIS_URL در .env (یا محیط) استفاده می‌کند. فقط داده‌های موقتی با نام
__selftest__ و uid خیلی بزرگ می‌سازد و در پایان پاکشان می‌کند؛ به داده‌ی واقعی دست نمی‌زند.
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from db import Database
from state import RedisState

FAILED = []


def check(name, cond, extra=""):
    print(("  ✓ " if cond else "  ✗ ") + name + (f"   {extra}" if (extra and not cond) else ""))
    if not cond:
        FAILED.append(name)


async def test_db():
    url = os.environ.get("DATABASE_URL", "")
    print(f"\n[دیتابیس] {url.split('@')[-1] if url else 'DATABASE_URL تنظیم نشده → SQLite'}")
    db = Database()
    await db.connect(url or "sqlite:///selftest.db")
    print(f"  نوع: {db.kind}")
    await db.init_schema()
    check("ساخت جدول‌ها", True)
    uid = None
    try:
        uid = await db.insert_id("INSERT INTO users(name,plan,created) VALUES(?,?,?)", "__selftest__", "free", time.time())
        check("insert_id عدد صحیح برمی‌گرداند", isinstance(uid, int), repr(uid))
        kid = await db.insert_id("INSERT INTO api_keys(uid,key_hash,prefix,label,created) VALUES(?,?,?,?,?)",
                                 uid, f"selftest-{uid}-{time.time()}", "sk-test", "t", time.time())
        check("insert_id برای api_keys", isinstance(kid, int))
        now = time.time()
        rows = [(now, uid, kid, "m", "up", 10, 5, 0.001, 120, 200, 0),
                (now, uid, kid, "m", "up", 20, 7, 0.002, 80, 502, 0)]
        await db.executemany("INSERT INTO usage(ts,uid,kid,model,upstream,pt,ct,cost,latency_ms,status,cached) "
                             "VALUES(?,?,?,?,?,?,?,?,?,?,?)", rows)
        check("executemany", True)
        await db.execute("INSERT INTO credits(ts,uid,amount,note) VALUES(?,?,?,?)", now, uid, 2.5, "t")
        r = (await db.fetch(
            "SELECT model, COUNT(*), SUM(pt), SUM(ct), AVG(latency_ms), SUM(CASE WHEN status<>200 THEN 1 ELSE 0 END), "
            "SUM(cost), SUM(cached) FROM usage WHERE uid=? GROUP BY model", uid))[0]
        check("COUNT/SUM مقدار درست دارند", (int(r[1]), int(r[2]), int(r[3]), int(r[5])) == (2, 30, 12, 1), repr(r))
        check("SUM(cost) عدد اعشاری است", abs(float(r[6]) - 0.003) < 1e-9, repr(r[6]))
        check("نوع خروجی SUM(pt) عدد صحیح است (نه Decimal)", isinstance(r[2], int), type(r[2]).__name__)
        day = (await db.fetch("SELECT %s FROM usage WHERE uid=? GROUP BY 1" % db.day_expr("ts"), uid))[0][0]
        check("day_expr تاریخ UTC امروز را می‌دهد", day == time.strftime("%Y-%m-%d", time.gmtime()), repr(day))
        await db.execute("UPDATE api_keys SET last_used=? WHERE id=?", now, kid)
        check("UPDATE با placeholder", (await db.fetchval("SELECT last_used FROM api_keys WHERE id=?", kid)) is not None)
        check("fetchval", (await db.fetchval("SELECT COUNT(*) FROM usage WHERE uid=?", uid)) == 2)
    finally:
        if uid is not None:
            for t, col in (("usage", "uid"), ("credits", "uid"), ("api_keys", "uid")):
                await db.execute(f"DELETE FROM {t} WHERE {col}=?", uid)
            await db.execute("DELETE FROM users WHERE id=?", uid)
        await db.close()


async def test_redis():
    url = os.environ.get("REDIS_URL", "").strip()
    if not url:
        print("\n[Redis] REDIS_URL تنظیم نشده؛ رد شد.")
        return
    print(f"\n[Redis] {url}")
    s = RedisState(url)
    try:
        await s.connect()
    except Exception as e:  # noqa
        check("اتصال به Redis", False, f"{type(e).__name__}: {e}")
        return
    check("اتصال و ping", True)
    uid, kh = 999_999_999, "selftest"
    try:
        # rate limit با اسکریپت Lua: rpm=2
        r1 = await s.check(uid, 2, 1000, False); r2 = await s.check(uid, 2, 1000, False); r3 = await s.check(uid, 2, 1000, False)
        check("دو درخواست اول مجاز", r1[0] == 0 and r2[0] == 0, repr((r1, r2)))
        check("درخواست سوم با RPM رد می‌شود و retry_after مثبت دارد", r3[0] == 1 and r3[1] >= 1, repr(r3))
        check("Redis واقعاً استفاده شد (حالت degraded نیست)", not s.degraded)

        # سهمیه‌ی توکن
        await s.r.delete(f"gw:rl:{uid}")
        await s.add_usage(uid, 500, 0)
        check("شمارنده‌ی توکن", await s.tokens_get(uid) == 500)
        st = (await s.check(uid, 100, 400, False))[0]
        check("وقتی توکن از سهمیه گذشت status=2", st == 2, repr(st))

        # اعتبار
        await s.r.delete(f"gw:rl:{uid}")
        check("بدون اعتبار برای پلن پولی status=3", (await s.check(uid, 100, 10_000, True))[0] == 3)
        await s.bal_add(uid, 1.0)
        await s.add_usage(uid, 0, 0.25)
        bal = await s.bal_get(uid)
        check("موجودی ۱ منهای ۰٫۲۵ = ۰٫۷۵", abs(bal - 0.75) < 1e-9, repr(bal))
        check("با اعتبار مثبت مجاز است", (await s.check(uid, 100, 10_000, True))[0] == 0)

        # کش
        await s.cache_put("selftest", {"a": [1, "سلام"]}, 30)
        check("کش JSON با حروف فارسی", await s.cache_get("selftest") == {"a": [1, "سلام"]})

        # اشتراک سلامت کلیدها (حداکثرگیری)
        await s.publish_health(kh, "m:x", 200.0); await s.publish_health(kh, "m:x", 100.0); await s.publish_health(kh, "d", 50.0)
        h = (await s.read_health([kh]))[kh]
        check("publish_health مقدار بزرگ‌تر را نگه می‌دارد", h.get("m:x") == 200.0 and h.get("d") == 50.0, repr(h))
        await s.clear_health([kh])
        check("clear_health", not (await s.read_health([kh]))[kh])

        # نسخه‌ی کاربران و هشدار یکتا
        v = await s.users_version(); check("bump_users نسخه را زیاد می‌کند", await s.bump_users() == v + 1)
        await s.r.delete("gw:once:selftest")
        check("once: بار اول True، بار دوم False", await s.once("selftest", 5) and not await s.once("selftest", 5))
        check("در تمام تست‌ها حالت degraded نشد", not s.degraded)
    finally:
        try:
            keys = [f"gw:rl:{uid}", f"gw:tok:{uid}:{time.strftime('%Y-%m-%d', time.gmtime())}",
                    f"gw:cache:selftest", f"gw:h:{kh}", "gw:once:selftest"]
            await s.r.delete(*keys)
            await s.r.hdel("gw:bal", str(uid))
        except Exception:  # noqa
            pass
        await s.close()


async def main():
    await test_db()
    await test_redis()
    print("\n" + ("همه‌ی تست‌ها موفق بودند." if not FAILED else f"{len(FAILED)} تست ناموفق: " + "، ".join(FAILED)))
    sys.exit(1 if FAILED else 0)

asyncio.run(main())
