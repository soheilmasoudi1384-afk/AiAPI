"""
وضعیت داغ سرویس: rate limit، شمارنده‌ی توکن روزانه، موجودی، کش پاسخ، سلامت کلیدها.

- MemState:   همه‌چیز در حافظه‌ی همین پروسه (برای اجرای ساده و تست)
- RedisState: مشترک بین چند worker/instance. اگر Redis وسط کار قطع شود، خودکار به حالت حافظه
              (degraded) برمی‌گردد و سرویس از کار نمی‌افتد.

PostgreSQL مرجع نهایی حساب‌هاست؛ Redis فقط کپی سریع است و با /admin/rebuild-state از روی
دیتابیس دوباره ساخته می‌شود.
"""
import json
import random
import time
from collections import OrderedDict, deque

REDIS_TTL_DAYS = 2 * 86400

# ورودی: KEYS = [zset درخواست‌ها, شمارنده‌ی توکن امروز, hash موجودی]
# ARGV  = [now_ms, window_ms, rpm, uid, quota, billing(0/1), member یکتا]
# خروجی: {وضعیت, retry_after, توکن‌های امروز, موجودی(رشته)}   وضعیت: 0 مجاز، 1 RPM، 2 سهمیه، 3 اعتبار
LUA_CHECK = """
local now = tonumber(ARGV[1]); local win = tonumber(ARGV[2]); local rpm = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - win)
local n = redis.call('ZCARD', KEYS[1])
local tok = tonumber(redis.call('GET', KEYS[2]) or '0')
local bal = tonumber(redis.call('HGET', KEYS[3], ARGV[4]) or '0')
if n >= rpm then
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = math.ceil((tonumber(first[2]) + win - now) / 1000)
  return {1, retry, tok, tostring(bal)}
end
if tok >= tonumber(ARGV[5]) then return {2, 0, tok, tostring(bal)} end
if ARGV[6] == '1' and bal <= 0 then return {3, 0, tok, tostring(bal)} end
redis.call('ZADD', KEYS[1], now, ARGV[7])
redis.call('PEXPIRE', KEYS[1], win + 1000)
return {0, 0, tok, tostring(bal)}
"""

# مقدار timestamp را فقط وقتی ثبت می‌کند که از مقدار فعلی بزرگ‌تر باشد (max-merge بین instance ها)
LUA_MAX = """
local cur = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
if tonumber(ARGV[2]) > cur then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  redis.call('EXPIRE', KEYS[1], 25200)
end
return 1
"""


def today():
    return time.strftime("%Y-%m-%d", time.gmtime())


class MemState:
    name = "memory"

    def __init__(self, cache_max=2000, unknown_balance_ok=False):
        self.windows, self.tokens, self.bal = {}, {}, {}
        self.cache, self.cache_max = OrderedDict(), cache_max
        self.once_map, self.ver = {}, 0
        # در حالت degraded اگر موجودی کاربر را نمی‌دانیم، درخواست را رد نمی‌کنیم
        self.unknown_ok = unknown_balance_ok

    async def connect(self): pass
    async def close(self): pass
    async def claim_init(self): return True

    async def load(self, bal, tokens):
        self.bal = {k: float(v) for k, v in bal.items()}
        self.tokens = {uid: [today(), int(n)] for uid, n in tokens.items()}

    def _tok(self, uid):
        e = self.tokens.get(uid)
        if not e or e[0] != today():
            self.tokens[uid] = e = [today(), 0]
        return e[1]

    async def check(self, uid, rpm, quota, billing):
        now = time.time()
        w = self.windows.setdefault(uid, deque())
        while w and w[0] < now - 60:
            w.popleft()
        tok = self._tok(uid)
        known = uid in self.bal
        bal = self.bal.get(uid, 0.0)
        if len(w) >= rpm:
            return 1, int(60 - (now - w[0])) + 1, tok, bal
        if tok >= quota:
            return 2, 0, tok, bal
        if billing and bal <= 0 and (known or not self.unknown_ok):
            return 3, 0, tok, bal
        w.append(now)
        return 0, 0, tok, bal

    async def add_usage(self, uid, tokens, cost):
        self._tok(uid)
        self.tokens[uid][1] += tokens
        if cost:
            self.bal[uid] = self.bal.get(uid, 0.0) - cost

    async def tokens_get(self, uid): return self._tok(uid)
    async def bal_get(self, uid): return self.bal.get(uid, 0.0)

    async def bal_add(self, uid, amount):
        self.bal[uid] = self.bal.get(uid, 0.0) + amount
        return self.bal[uid]

    async def cache_get(self, key):
        e = self.cache.get(key)
        if e and e[0] > time.time():
            self.cache.move_to_end(key)
            return json.loads(json.dumps(e[1]))  # کپی، تا تغییرات بیرونی کش را خراب نکند
        self.cache.pop(key, None)
        return None

    async def cache_put(self, key, obj, ttl):
        self.cache[key] = (time.time() + ttl, obj)
        while len(self.cache) > self.cache_max:
            self.cache.popitem(last=False)

    async def cache_size(self): return len(self.cache)
    async def publish_health(self, kh, field, value): pass
    async def read_health(self, khs): return {}
    async def clear_health(self, khs): pass
    async def users_version(self): return self.ver

    async def bump_users(self):
        self.ver += 1
        return self.ver

    async def once(self, name, ttl):
        now = time.time()
        if self.once_map.get(name, 0) > now:
            return False
        self.once_map[name] = now + ttl
        return True


def guard(fn):
    """اگر Redis خطا بدهد، همان کار را روی حافظه‌ی محلی انجام می‌دهد."""
    async def wrapper(self, *a, **k):
        try:
            return await fn(self, *a, **k)
        except Exception as e:  # noqa
            self._note(e)
            return await getattr(self.mem, fn.__name__)(*a, **k)
    wrapper.__name__ = fn.__name__
    return wrapper


class RedisState:
    name = "redis"

    def __init__(self, url, cache_max=2000):
        self.url = url
        self.mem = MemState(cache_max, unknown_balance_ok=True)
        self.r = None
        self.last_error_log = 0.0
        self.degraded = False

    def _note(self, e):
        self.degraded = True
        if time.time() - self.last_error_log > 30:
            self.last_error_log = time.time()
            print(f"[redis] خطا ({type(e).__name__}: {e}); موقتاً با حافظه‌ی محلی ادامه می‌دهیم")

    async def connect(self):
        import redis.asyncio as redis
        self.r = redis.from_url(self.url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2)
        await self.r.ping()
        self.check_script = self.r.register_script(LUA_CHECK)
        self.max_script = self.r.register_script(LUA_MAX)

    async def close(self):
        if self.r:
            await self.r.aclose()

    async def ping(self):
        await self.r.ping()
        self.degraded = False

    # ───── راه‌اندازی اولیه از روی دیتابیس ─────
    @guard
    async def claim_init(self):
        if await self.r.exists("gw:ready"):
            return False
        return bool(await self.r.set("gw:init:lock", "1", nx=True, ex=60))

    @guard
    async def load(self, bal, tokens):
        p = self.r.pipeline()
        p.delete("gw:bal")
        if bal:
            p.hset("gw:bal", mapping={str(k): float(v) for k, v in bal.items()})
        for uid, n in tokens.items():
            p.set(f"gw:tok:{uid}:{today()}", int(n), ex=REDIS_TTL_DAYS)
        p.set("gw:ready", "1")
        p.delete("gw:init:lock")
        await p.execute()
        self.degraded = False

    # ───── مسیر داغ هر درخواست: یک رفت‌وبرگشت ─────
    @guard
    async def check(self, uid, rpm, quota, billing):
        now_ms = int(time.time() * 1000)
        res = await self.check_script(
            keys=[f"gw:rl:{uid}", f"gw:tok:{uid}:{today()}", "gw:bal"],
            args=[now_ms, 60000, rpm, uid, quota, 1 if billing else 0, f"{now_ms}-{random.getrandbits(32)}"],
        )
        return int(res[0]), int(res[1]), int(res[2]), float(res[3])

    @guard
    async def add_usage(self, uid, tokens, cost):
        k = f"gw:tok:{uid}:{today()}"
        p = self.r.pipeline()
        p.incrby(k, tokens)
        p.expire(k, REDIS_TTL_DAYS)
        if cost:
            p.hincrbyfloat("gw:bal", str(uid), -cost)
        await p.execute()

    @guard
    async def tokens_get(self, uid):
        return int(await self.r.get(f"gw:tok:{uid}:{today()}") or 0)

    @guard
    async def bal_get(self, uid):
        return float(await self.r.hget("gw:bal", str(uid)) or 0)

    @guard
    async def bal_add(self, uid, amount):
        return float(await self.r.hincrbyfloat("gw:bal", str(uid), amount))

    # ───── کش ─────
    @guard
    async def cache_get(self, key):
        v = await self.r.get(f"gw:cache:{key}")
        return json.loads(v) if v else None

    @guard
    async def cache_put(self, key, obj, ttl):
        await self.r.set(f"gw:cache:{key}", json.dumps(obj, ensure_ascii=False), ex=ttl)

    async def cache_size(self):
        return None  # شمردن کلیدهای Redis گران است

    # ───── اشتراک سلامت کلیدها بین instance ها ─────
    @guard
    async def publish_health(self, kh, field, value):
        await self.max_script(keys=[f"gw:h:{kh}"], args=[field, value])

    @guard
    async def read_health(self, khs):
        p = self.r.pipeline()
        for kh in khs:
            p.hgetall(f"gw:h:{kh}")
        out = await p.execute()
        return {kh: {f: float(v) for f, v in (h or {}).items()} for kh, h in zip(khs, out)}

    @guard
    async def clear_health(self, khs):
        if khs:
            await self.r.delete(*[f"gw:h:{kh}" for kh in khs])

    # ───── نسخه‌ی کاربران و هشدارهای یکتا ─────
    @guard
    async def users_version(self):
        return int(await self.r.get("gw:users:ver") or 0)

    @guard
    async def bump_users(self):
        return int(await self.r.incr("gw:users:ver"))

    @guard
    async def once(self, name, ttl):
        return bool(await self.r.set(f"gw:once:{name}", "1", nx=True, ex=ttl))


async def make_state(redis_url, cache_max=2000):
    """اگر REDIS_URL تنظیم شده و در دسترس باشد RedisState، وگرنه MemState."""
    if not redis_url:
        return MemState(cache_max)
    try:
        s = RedisState(redis_url, cache_max)
        await s.connect()
        return s
    except Exception as e:  # noqa
        print(f"WARNING: اتصال به Redis ممکن نشد ({type(e).__name__}: {e}). با حافظه‌ی محلی ادامه می‌دهیم.")
        return MemState(cache_max)
