# AI Gateway v3

یک API سازگار با OpenAI که پشتش چند ارائه‌دهنده و چندین کلید هست. کاربر فقط اسم مدل‌ها و برند تو را می‌بیند.

## ذخیره‌سازی: PostgreSQL و Redis (لوکال)

| | نقش | بدون آن |
|---|---|---|
| **PostgreSQL** (`DATABASE_URL`) | مرجع نهایی: کاربران، کلیدها، دفتر اعتبار، لاگ مصرف | SQLite |
| **Redis** (`REDIS_URL`) | کپی سریع: rate limit، مصرف روزانه، موجودی، کش پاسخ، سلامت کلیدها | حافظه‌ی همین پروسه |

با هر دو، می‌شود چند worker اجرا کرد و همه‌ی آن‌ها rate limit، موجودی، کش و وضعیت کلیدها را مشترک می‌بینند. اگر Redis وسط کار قطع شود، سرویس از کار نمی‌افتد و موقتاً با حافظه‌ی محلی ادامه می‌دهد (در پنل ادمین و `/metrics` دیده می‌شود).

### آماده‌سازی روی سیستم خودت

```bash
createdb ai_gateway                      # یا در psql:  CREATE DATABASE ai_gateway;
redis-cli ping                           # باید PONG بدهد
pip install -r requirements.txt
cp .env.example .env                     # DATABASE_URL (رمز پستگرس)، REDIS_URL، کلیدها، ADMIN_TOKEN
python tests/selftest_backends.py        # تست واقعی هر دو؛ قبل از اجرای سرویس
```

جدول‌ها هنگام اولین اجرا خودکار ساخته می‌شوند.

## اجرا

```bash
python app.py                                   # ساده‌ترین راه (PORT و WORKERS را از .env می‌خواند)
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 4   # معادلش
```

روی ویندوز اول با `cd` وارد پوشه‌ی پروژه شو (که `app.py` و `.env` آنجاست) و بعد دستور را بزن. بعد از اجرا باید خطی شبیه `gateway up: db=... state=...` ببینی؛ سپس `http://localhost:8000/panel` را باز کن.

`--workers` فقط با PostgreSQL و Redis معنی دارد. بدون Redis فقط یک worker بگذار.

چیزهایی که بین worker ها **مشترک** است: کاربران و کلیدهای آن‌ها (تغییر در یکی، ≤۲ ثانیه بعد در همه)، rate limit، مصرف روزانه، موجودی، کش، cooldown/غیرفعال‌شدن کلیدها، و یکتا بودن هشدارها.
**محلی هر worker** است: circuit breaker، میانگین latency و صف انتظار.

| آدرس | کاربرد |
|---|---|
| `/panel` | پنل کاربر (React): نمای کلی، کلیدها، مصرف، مدل‌ها، شروع سریع |
| `/admin-ui` | پنل مدیر (React): زیرساخت و کلیدها، کاربران و شارژ، آمار و درآمد |
| `/status` و `/api/status` | صفحه‌ی وضعیت عمومی |
| `/docs` | مستندات Swagger برای API کاربر |
| `/health` | سلامت سرویس، دیتابیس و Redis |
| `/metrics` | خروجی Prometheus (با `Authorization: Bearer ADMIN_TOKEN`) |

## ساخت اولین کاربر

از `/admin-ui` یا با curl:

```bash
curl -X POST localhost:8000/admin/users -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"ali","plan":"basic"}'
curl -X POST localhost:8000/admin/users/1/credit -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"amount":10}'
```

## اگر Redis خالی شد یا موجودی‌ها ناسازگار به نظر رسید

دفتر دیتابیس (اعتبارها منهای هزینه‌ها) همیشه درست است. Redis را از روی آن دوباره بساز:

```bash
curl -X POST localhost:8000/admin/rebuild-state -H "Authorization: Bearer $ADMIN_TOKEN"
```

اولین worker هم هر وقت Redis خالی باشد (مثلاً بعد از `FLUSHALL`) خودکار این کار را موقع راه‌اندازی می‌کند.

## کلیدهای رایگان و پولی

کلیدهای `*_API_KEYS` رایگان و `*_PAID_API_KEYS` پولی‌اند. هر پلن با `tiers` مشخص می‌کند از کدام‌ها و با چه اولویتی استفاده کند: پلن `free` فقط رایگان می‌بیند و پلن‌های پولی اول پولی و بعد رایگان.

## مدل‌ها و پلن‌ها (اختیاری)

بدون فایل، پیش‌فرض‌های داخل `app.py` استفاده می‌شود. برای تغییر، `models.json` و `plans.json` کنار `app.py` بساز:

```json
{
  "my-ai": {
    "strategy": "latency",
    "price": {"in": 0.6, "out": 1.2},
    "routes": [["groq", "llama-3.3-70b-versatile"], ["openrouter", "some/model:free"]]
  }
}
```

- `strategy`: `order` (به ترتیب لیست) یا `latency` (سریع‌ترین مسیر اول)
- `price`: قیمت فروش به دلار برای هر یک میلیون توکن ورودی و خروجی
- نام مدل‌های واقعی را خودت چک کن؛ مدل‌های رایگان مدام عوض می‌شوند.

```json
{ "gold": {"rpm": 500, "daily_tokens": 50000000, "max_tokens": 8192,
           "tiers": ["paid"], "models": ["*"], "billing": true} }
```

`billing: true` یعنی قبل از هر درخواست موجودی باید مثبت باشد و بعدش هزینه کم می‌شود.

## رفتار سرویس

- **failover:** خطا یا محدودیت یک کلید، کلید بعدی؛ بعد مدل و ارائه‌دهنده‌ی بعدی. در استریم هم قبل از اولین بایت.
- **cooldown دقیق:** ۴۲۹ فقط همان مدل را روی همان کلید مسدود می‌کند، ۴۰۱/۴۰۳ کل کلید را شش ساعت. وضعیت بین worker ها به اشتراک گذاشته می‌شود.
- **circuit breaker:** سه خطای پشت‌سرهم، مسیر را از ۳۰ ثانیه تا ۵ دقیقه قطع می‌کند.
- **صف:** اگر همه‌ی کلیدها موقتاً محدودند و زود آزاد می‌شوند، درخواست تا `QUEUE_WAIT` ثانیه منتظر می‌ماند.
- **کش:** فقط درخواست‌های غیراستریم با `temperature: 0` و بدون tools؛ با Redis بین worker ها مشترک است.
- **دقت حسابداری:** هزینه با پایان هر درخواست از موجودی کم می‌شود. اگر ارائه‌دهنده usage ندهد، توکن‌ها تخمینی (۴ کاراکتر = ۱ توکن) است و یک درخواست بزرگ می‌تواند موجودی را کمی منفی کند.
- **امنیت:** کلید کاربر هش‌شده ذخیره می‌شود؛ کلیدهای upstream هرگز در Redis ننوشته می‌شوند (فقط هش کوتاه). سقف اندازه‌ی بدنه، سقف `max_tokens` هر پلن، allowlist آی‌پی، هشدار استفاده‌ی مشکوک.
- **حریم خصوصی:** متن پیام‌ها ذخیره نمی‌شود؛ فقط تعداد توکن، مدل، زمان و هزینه.
- **هشدار:** با `TELEGRAM_BOT_TOKEN` و `TELEGRAM_CHAT_ID` یا `ALERT_WEBHOOK_URL`.

## استقرار

پشت Caddy یا Nginx با HTTPS بگذار و `TRUST_PROXY=true` کن. برای Nginx، روی مسیر `/v1/` باید `proxy_buffering off;` باشد.

## تست

```bash
python tests/selftest_backends.py   # PostgreSQL و Redis واقعی (روی سیستم خودت)
python tests/test_core.py           # منطق pool، breaker، پلن، اعتبار، دفتر
python tests/test_flow.py           # مسیر کامل chat با upstream جعلی
```

## هنوز پیاده نشده

درگاه پرداخت، کش معنایی، hedged requests، `/v1/embeddings`، فیلتر محتوا، Docker.

## تذکر

استفاده از ده‌ها کلید رایگان برای دور زدن محدودیت نرخ ممکن است شرایط استفاده‌ی ارائه‌دهنده‌ها را نقض کند. برای فروش به کاربر واقعی از کلید پولی و پلن‌های `billing: true` استفاده کن.


## فرانت‌اند (React)

کد در پوشه‌ی `frontend/` است (React 18 + TypeScript + Vite). خروجی بیلد‌شده در `frontend/dist` هست و FastAPI مستقیم سرو می‌کند، پس برای اجرای عادی نیازی به Node نداری.

```bash
cd frontend
npm install
npm run dev      # توسعه با hot reload روی :5173 (API را به :8000 پراکسی می‌کند)
npm run build    # بیلد نهایی در frontend/dist
```

ساختار: `src/pages/<user|admin|status>/` هر صفحه کنار فایل `*.module.css` خودش؛ `src/components/` اجزای مشترک؛ `src/styles/global.css` فقط توکن‌های رنگ/فاصله و تم روشن/تاریک.
