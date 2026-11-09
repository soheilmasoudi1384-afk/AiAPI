"""
لایه‌ی دیتابیس: PostgreSQL (با asyncpg) یا SQLite به‌عنوان جایگزین.

SQL را یک بار با placeholder به شکل `?` می‌نویسیم؛ برای PostgreSQL خودکار به $1, $2, ... تبدیل می‌شود.
آدرس‌ها:
    postgresql://user:pass@localhost:5432/ai_gateway
    sqlite:///gateway_v2.db
"""
import asyncio
import re
import sqlite3
import threading

SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, plan TEXT, active INTEGER DEFAULT 1,
    rpm INTEGER, daily_tokens INTEGER, ip_allow TEXT DEFAULT '', created REAL);
CREATE TABLE IF NOT EXISTS api_keys(
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER, key_hash TEXT UNIQUE, prefix TEXT,
    label TEXT, active INTEGER DEFAULT 1, created REAL, last_used REAL);
CREATE TABLE IF NOT EXISTS usage(
    ts REAL, uid INTEGER, kid INTEGER, model TEXT, upstream TEXT, pt INTEGER, ct INTEGER,
    cost REAL, latency_ms INTEGER, status INTEGER, cached INTEGER);
CREATE TABLE IF NOT EXISTS credits(ts REAL, uid INTEGER, amount REAL, note TEXT);
CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
CREATE INDEX IF NOT EXISTS usage_uid ON usage(uid, ts);
"""

SCHEMA_PG = """
CREATE TABLE IF NOT EXISTS users(
    id BIGSERIAL PRIMARY KEY, name TEXT, plan TEXT, active INTEGER DEFAULT 1,
    rpm INTEGER, daily_tokens BIGINT, ip_allow TEXT DEFAULT '', created DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS api_keys(
    id BIGSERIAL PRIMARY KEY, uid BIGINT, key_hash TEXT UNIQUE, prefix TEXT,
    label TEXT, active INTEGER DEFAULT 1, created DOUBLE PRECISION, last_used DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS usage(
    ts DOUBLE PRECISION, uid BIGINT, kid BIGINT, model TEXT, upstream TEXT, pt INTEGER, ct INTEGER,
    cost DOUBLE PRECISION, latency_ms INTEGER, status INTEGER, cached INTEGER);
CREATE TABLE IF NOT EXISTS credits(ts DOUBLE PRECISION, uid BIGINT, amount DOUBLE PRECISION, note TEXT);
CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
CREATE INDEX IF NOT EXISTS usage_uid ON usage(uid, ts);
"""


def to_pg(sql: str) -> str:
    n = 0

    def rep(_):
        nonlocal n
        n += 1
        return f"${n}"

    return re.sub(r"\?", rep, sql)


class Database:
    def __init__(self):
        self.kind = None      # "pg" یا "sqlite"
        self.pool = None
        self.conn = None
        self.lock = threading.Lock()

    # ───── اتصال ─────
    async def connect(self, url: str, pool_max: int = 10):
        if url.startswith(("postgres://", "postgresql://")):
            import asyncpg  # فقط وقتی PostgreSQL انتخاب شده لازم است
            self.kind = "pg"
            self.pool = await asyncpg.create_pool(url, min_size=1, max_size=pool_max, command_timeout=30)
        else:
            path = url.removeprefix("sqlite:///") if url.startswith("sqlite:") else url
            self.kind = "sqlite"
            self.conn = sqlite3.connect(path, check_same_thread=False)
            self.conn.execute("PRAGMA journal_mode=WAL")

    async def close(self):
        if self.pool:
            await self.pool.close()
        if self.conn:
            self.conn.close()

    async def init_schema(self):
        if self.kind == "pg":
            async with self.pool.acquire() as c:
                await c.execute(SCHEMA_PG)
        else:
            await self._lite(lambda c: c.executescript(SCHEMA_SQLITE))

    def day_expr(self, col: str) -> str:
        """عبارت SQL برای تبدیل timestamp به روز UTC."""
        if self.kind == "pg":
            return f"to_char(to_timestamp({col}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
        return f"strftime('%Y-%m-%d', {col}, 'unixepoch')"

    # ───── SQLite در thread جدا (تا event loop بلاک نشود) ─────
    async def _lite(self, fn):
        def run():
            with self.lock:
                res = fn(self.conn)
                self.conn.commit()
                return res
        return await asyncio.to_thread(run)

    # ───── API مشترک ─────
    async def execute(self, sql, *args):
        if self.kind == "pg":
            async with self.pool.acquire() as c:
                await c.execute(to_pg(sql), *args)
        else:
            await self._lite(lambda c: c.execute(sql, args))

    async def fetch(self, sql, *args):
        if self.kind == "pg":
            async with self.pool.acquire() as c:
                rows = await c.fetch(to_pg(sql), *args)
            return [tuple(r) for r in rows]
        return await self._lite(lambda c: c.execute(sql, args).fetchall())

    async def fetchval(self, sql, *args):
        rows = await self.fetch(sql, *args)
        return rows[0][0] if rows else None

    async def insert_id(self, sql, *args):
        """INSERT را اجرا می‌کند و id ردیف جدید را برمی‌گرداند (جدول باید ستون id داشته باشد)."""
        if self.kind == "pg":
            async with self.pool.acquire() as c:
                return await c.fetchval(to_pg(sql) + " RETURNING id", *args)

        def run(c):
            try:
                return c.execute(sql + " RETURNING id", args).fetchone()[0]
            except sqlite3.OperationalError:  # SQLite قدیمی‌تر از 3.35
                return c.execute(sql, args).lastrowid
        return await self._lite(run)

    async def executemany(self, sql, rows):
        if not rows:
            return
        if self.kind == "pg":
            async with self.pool.acquire() as c:
                await c.executemany(to_pg(sql), rows)
        else:
            await self._lite(lambda c: c.executemany(sql, rows))
