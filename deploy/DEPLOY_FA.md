# راهنمای استقرار «سامانه آرا» روی اینترنت

> این راهنما عملیاتی است: از اجرای محلی تا انتشار عمومی با دامنه، TLS، پایداری داده و امنیت.
> فایل‌های همراه: `Dockerfile` · `docker-compose.yml` · `.dockerignore` · `deploy/nginx.conf` · این سند.

---

## ۱. معماری استقرار (چه چیزی بالا می‌آید؟)

یک فرایند Node، **همه‌چیز را روی یک origin سرو می‌کند** (`server/index.ts`):

```
مرورگر ──► nginx با TLS ──► کانتینر Ara :4001 (Node/tsx)
                              ├── UI ساخته‌شده از dist/  (HTML/CSS/JS + داده‌های عمومی)
                              ├── /api/sci, /api/typology, /api/decision-support,
                              │   /api/kernel, /api/satellite, /api/sources,
                              │   /api/external-data, /api/anthropic, /api/health
                              ├── سرویس Python داخلی (kernel) — خودکار از تقاضای اول راه می‌افتد
                              ├── Workerهای پایتون ماهواره (rasterio/numpy)
                              └── volume: /app/server/data  (اجراها، حافظه، متادیتا، کش، COG)
```

- چون UI و API روی یک دامنه‌اند، **`VITE_API_BASE_URL` باید خالی بماند** و نیازی به تنظیم CORS نیست.
- `tsx` در `dependencies` نیست؛ پس از `npm ci --omit=optional` هم نصب می‌شود چون `npm start` = `tsx server/index.ts`. پس **نصب کامل (npm ci بدون حذف devDependencies) لازم است** — همان‌کاری که Dockerfile انجام می‌دهد.

### فایل‌هایی که در استقرار نقش کلیدی دارند
| مسیر داخل تصویر | نقش | اگر نباشد |
|---|---|---|
| `dist/` | UI ساخته‌شده (SPA) | `/` مقدار ۴۰۴ می‌دهد |
| `server/`, `src/algorithm/` | API + منطق | سرویس بالا نمی‌آید |
| `kernel/` | موتور محاسبات پایتون + رجیسترها (وزن/آستانه) | `/api/kernel` خطا می‌دهد |
| `mahalat/*.geojson` | مرز محلات تهران/کرج برای ژئوکد | جست‌وجوی مرز کرج/تهران خالی می‌ماند |
| `public/data/pbf/*.json` (از طریق پیوند `public → dist`) | لایه‌های OSM محلی + `places.json` | کانکتور OSM محلی و انتخاب‌گر محله کند/خاموش می‌شود |
| `docs/decision-support/indicator-automation-plan-164.csv` + CSV رجیستر ۱۶۴ در ریشه | لودر رجیستر تصمیم‌یار | `/api/decision-support/registry` پاسخ نمی‌دهد |
| `neighborhood_typology/config.yml` | آستانه‌های گونه‌بندی (اعتبار مرز، نرخ پاسخ …) | با پیش‌فرض‌ها بالا می‌آید |
| `scripts/satellite_*.py` | کارگر COG + رندر تایل | job ماهواره‌ای `failed` می‌شود (بقیه سالم) |
| `server/data/` (volume) | اجرای تصمیم‌یار، حافظه، متادیتای ماهواره، کش منابع | پس از ری‌استارت همه چیز از نو شروع می‌شود |

---

## ۲. پیش‌نیازها

| مورد | حداقل | توضیح |
|---|---|---|
| سرور | ۲ vCPU / ۴GB RAM / ۲۵GB دیسک | اگر «پردازش ماهواره‌ای» فعال است: ۴GB و ۴۰GB دیسک |
| سیستم‌عامل | Ubuntu 22.04+/Debian 12 | دستورها بر پایهٔ همین‌هاست |
| Docker | 24+ با Compose 2.24+ | (از `env_file: required: false` پشتیبانی می‌کند) |
| دامنه | یک FQDN + DNS A record | برای TLS |
| دسترسی شبکه به بیرون (Egress) | HTTP/HTTPS | `api.justwoker.icu` (سرویس مدل)، `api.openaq.org`، `healthsites.io`، `*.earth-search.aws.element84.com`، `opensky`/`copernicus` و منابع OSM — در شبکه‌های بسته سازمانی باید اجازه داده شود |

---

## ۳. روش «الف» — پیشنهادی: سرور + Docker + nginx

### گام ۱ — آماده‌سازی
```bash
git clone <repo> /srv/ara && cd /srv/ara
```

### گام ۲ — متغیرهای محیطی (`.env.local`)
```bash
cp .env.example .env.local
nano .env.local
```
```dotenv
# الزامی برای دستیار هوشمند (بدون آن برنامه کار می‌کند ولی چت به حالت محلی می‌رود)
ARA_ANTHROPIC_API_KEY="sk-..."
ARA_ANTHROPIC_BASE_URL="https://api.justwoker.icu"
VITE_ANTHROPIC_MODEL="claude-opus-5-thinking"

# اختیاری — کلیدهای منابع برخط
# OPENAQ_API_KEY="..."
# HEALTHSITES_API_KEY="..."
# GEMINI_API_KEY="..."
```
> این فایل در `.gitignore` است و **هرگز وارد تصویر Docker نمی‌شود** (در `.dockerignore` هم استثنا شده). در Compose با `env_file` به کانتینر می‌رسد.

### گام ۳ — ساخت و اجرا
```bash
docker compose up -d --build
docker compose ps            # باید (healthy) باشد
docker compose logs -f ara   # مشاهدهٔ راه‌اندازی
```
ساعت‌سنج ساخت اول: **۵ تا ۱۵ دقیقه** (دانلود پایه‌ها + `npm ci` + ساخت Vite با Cesium + `pip install rasterio`).

### گام ۴ — تست محلی پیش از باز کردن روی اینترنت
```bash
curl -s http://127.0.0.1:8080/api/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/          # باید 200 باشد
curl -s http://127.0.0.1:8080/api/decision-support/registry | head -c 300
curl -s http://127.0.0.1:8080/api/typology/health | head -c 300
```

### گام ۵ — nginx + TLS (دسترسی عمومی)
```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ara
sudo ln -s /etc/nginx/sites-available/ara /etc/nginx/sites-enabled/ara
sudo nano /etc/nginx/sites-available/ara      # server_name را به دامنه تغییر بده
sudo nginx -t && sudo systemctl enable --now nginx
sudo certbot --nginx -d ara.example.ir -d www.ara.example.ir   # گواهی رایگان ۹۰ روزه + تمدید خودکار
```
نکات پیکربندی nginx که در `deploy/nginx.conf` رعایت شده:
- `proxy_buffering off` برای `/api/anthropic/` تا پاسخ استریم (SSE) بی‌وقفه برسد.
- `proxy_read_timeout 600s` برای مسیرهای `decision-support/typology/kernel/satellite` (کارهای طولانی).
- `gzip` برای JSON/GeoJSON (کاهش حجم لایه‌های ۴۵ مگابایتی نقشه تا ۵ برابر).
- `Cache-Control: immutable` برای `/assets/` و `/data/pbf/` (کاشی‌های برداری).
- نرخ‌محدودسازی ۲۰ درخواست/ثانیه برای API و ۲ درخواست/ثانیه برای مسیر مدل.

### گام ۶ — فایروال
```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable
# پورت 8080 عمداً فقط روی 127.0.0.1 است — در گام ۳ از docker-compose.yml باز شد.
```

### گام ۷ — تأیید نهایی از بیرون
```bash
curl -s https://ara.example.ir/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://ara.example.ir/    # 200
```

---

## ۴. روش «ب» — بدون Docker (Node روی سرور)
اگر Docker در دسترس نیست:
```bash
sudo apt-get install -y nodejs npm python3 python3-pip build-essential
npm ci                                   # توجه: بدون حذف devDependencies (لزوم tsx)
python3 -m pip install numpy rasterio shapely
npm run build                            # تولید dist/
SCI_PORT=4001 npm start                  # یا با systemd پایدارش کنید
```
فایل واحد systemd (`/etc/systemd/system/ara.service`):
```ini
[Unit]
Description=Ara decision platform
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/srv/ara
Environment=NODE_ENV=production
Environment=SCI_PORT=4001
Environment=KERNEL_PYTHON=python3
EnvironmentFile=/srv/ara/.env.local
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=ara

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ara
journalctl -u ara -f
```
سپس همان nginx از گام ۵ را نصب کنید.

---

## ۵. روش «ج» — سرویس‌های PaaS (Render / Railway / Fly.io)

Dockerfile آماده است، فقط این تنظیمات را بدهید:

| فیلد | مقدار |
|---|---|
| Build command | `npm ci --omit=optional && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Persist disk | مسیر `/app/server/data` (برای نگه‌داشتن اجراها و متادیتای ماهواره) |
| Environment | متغیرهای فصل «۷» |

**چرا Vercel / Netlify انتخاب مناسبی نیستند:**
1. حجم `dist/` حدود **۴۰۰ مگابایت در ۲۷۶۴ فایل** است (لایه‌های OSM + کاشی‌ها + Cesium) و بستهٔ استقرار Vercel محدودیت ۲۵۰MB دارد.
2. اپ نیاز به **فرایند طولانی‌عمر Node**، **Python** و **نوشتن فایل** دارد (jobهای ماهواره‌ای، کش منابع) — قابل اجرا روی Functions نیست.
3. درخواست‌های `/api/satellite/pipeline/jobs` تا دقیقه‌ها اجرا می‌شوند که با محدودیت زمان توابع سازگار نیست.

اگر می‌خواهید فقط UI را روی CDN ببرید: `npm run build` و آپلود `dist/` در یک هاست استاتیک (با `VITE_API_BASE_URL` روی آدرس API) — اما چون `/api/anthropic` یکسان‌مبدأ فرض شده، در این حالت چت فقط با تنظیم مجدد مسیر کار می‌کند.

## ۶. روش «د» — Google Cloud Run / AI Studio
این مخزن یک اپ AI Studio است (`metadata.json` با `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`). برای Cloud Run:
```bash
gcloud run deploy ara \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --memory 2Gi --cpu 2 \
  --port 8080
```
- `PORT` را به ۸۰۸۰ تغییر ندهید: سرور از `SCI_PORT` می‌خواند؛ پس `--port 4001` یا `Environment=SCI_PORT=8080` بدهید.
- Cloud Run فایل‌سیستم غیرپایدار دارد؛ برای `server/data` یا Cloud Storage Mount بگذارید یا با دادهٔ اجرایی کنار بیایید (تاریخچهٔ اجراها پس از ری‌استارت پاک می‌شود).
- محدودیت زمان درخواست پیش‌فرض ۳۰۰ ثانیه است؛ `--timeout=600` برای jobهای ماهواره‌ای لازم است.

---

## ۷. متغیرهای محیطی

| متغیر | پیش‌فرض | الزام | توضیح |
|---|---|---|---|
| `ARA_ANTHROPIC_API_KEY` | — | توصیه‌شده | کلید سرویس مدل؛ **فقط سمت سرور** (پراکسی `/api/anthropic`). بدون آن، چت به حالت محلی می‌رود و `/api/health` گزارش `anthropicProxy: false` می‌دهد |
| `ARA_ANTHROPIC_BASE_URL` | `https://api.justwoker.icu` | خیر | پایهٔ سرویس سازگار با Anthropic |
| `ARA_LLM_MODEL` | `claude-opus-4-8` | خیر | مدل سمت سرور (پرسشنامه‌ساز و پراکسی؛ درخواست‌ها به همین مدل اجبار می‌شوند) |
| `VITE_ANTHROPIC_MODEL` | `claude-opus-5-thinking` | خیر | مدل چت؛ چون `import.meta.env` است **باید پیش از `npm run build` تنظیم شود** |
| `SCI_PORT` | `4001` | خیر | پورت API/UI |
| `TRUST_PROXY_HOPS` | `1` | پشت nginx | تا IP واقعی کاربر در `req.ip` درست باشد |
| `NODE_ENV` | `production` در کانتینر | خیر | پنهان‌کردن پیام خطای داخلی |
| `KERNEL_PYTHON` / `KERNEL_SERVICE_PORT` | `python3` / `4105` | خیر | سرویس محاسبات پایتون |
| `SOURCE_CACHE_DIR` | `server/data/source-cache` | خیر | کش دوسابقهٔ منابع برخط |
| `OPENAQ_API_KEY`، `HEALTHSITES_API_KEY` | — | اختیاری | بدون کلید، منبع «کمبود داده» ثبت می‌شود (صفرسازی نمی‌شود) |
| `GEMINI_API_KEY` | — | اختیاری | قابلیت‌های Gemini |
| `VITE_API_BASE_URL` | خالی بماند | — | فقط برای استقرار دومرحله‌ای؛ در یک‌origin خالی بماند |
| `ARA_API_PROXY_TARGET` | `http://localhost:4001` | — | فقط برای `npm run dev` |

> قاعدهٔ مهم: متغیرهای `VITE_*` در لحظهٔ **ساخت** در باندل جاسازی می‌شوند؛ پس تغییرشان بعد از ساخت بی‌اثر است و باید `npm run build` را دوباره بزنید.

---

## ۸. سلامت، مانیتورینگ و روزآمدسازی

### نقطهٔ سلامت
`GET /api/health` پاسخ می‌دهد:
```json
{ "ok": true, "service": "ara-decision-platform", "startedAt": "...", "uptimeSeconds": 172,
  "node": "v24.14.1", "port": 4199, "envFiles": [".env.local"], "ui": "built",
  "python": "python", "integrations": { "anthropicProxy": true } }
```
برای مانیتورینگ می‌توانید روی `ui == "built"` و `integrations.anthropicProxy == true` هشدار بگذارید.

### به‌روزرسانی
```bash
cd /srv/ara
mkdir -p /srv/backups/$(date +%F) && cp -r server/data /srv/backups/$(date +%F)/   # پشتیبان
git pull
docker compose up -d --build
docker compose ps       # باید healthy باشد
```

### پشتیبان‌گیری (فقط volume لازم است)
```bash
docker run --rm -v ara-data:/data -v /srv/backups:/out ubuntu tar czf /out/ara-data-$(date +%F).tar.gz -C /data .
```

---

## ۹. چک‌لیست امنیت
- [ ] `.env.local` فقط روی سرور؛ هرگز commit نمی‌شود (در `.gitignore` و `.dockerignore`).
- [ ] پورت‌های ۴۰۰۱/۸۰۸۰ فقط روی `127.0.0.1` باز‌اند؛ بیرون فقط 80/443.
- [ ] TLS با `certbot` و هدر HSTS (در `deploy/nginx.conf`).
- [ ] نرخ‌محدودسازی nginx فعال است؛ `/api/anthropic` به ۲ درخواست/ثانیه محدود.
- [ ] `/api/health` کلید را افشا نمی‌کند (فقط `true/false`).
- [ ] خطاهای ۵۰۰ در تولید پیام ساده می‌دهند، نه پشتهٔ فایل (میدلور خطای جدید).
- [ ] **سرویس فعلاً بدون احراز هویت است**؛ برای کار عمومی حتماً `/api/decision-support/analyze` را پشت auth بگیرید (مثلاً `auth_basic` در nginx یا middleware اختصاصی).
- [ ] `docker compose logs ara` را دوره‌ای ببینید؛ دیسک COG‌ها می‌تواند رشد کند.

---

## ۱۰. عیب‌یابی

| علامت | علت محتمل | راه‌حل |
|---|---|---|
| `docker compose up` خطای `env_file` | Compose قدیمی (<2.24) | بلوک `env_file` را حذف و متغیرها را مستقیم در `environment:` بگذارید |
| `/` خالی است ولی `/api/health` سبز است | `dist/` ساخته نشده | `docker compose build` را دوباره بزنید و لاگ مرحلهٔ builder را ببینید |
| `/api/decision-support/registry` خطا | CSV رجیستر ۱۶۴ در تصویر نیست | فایل `*164*.csv` باید در ریشهٔ مخزن باشد (مرحلهٔ builder آن را کپی می‌کند) |
| چت «در دسترس نیست» | کلید ست نشده یا نبود `.env.local` | `/api/health` → `integrations.anthropicProxy` را ببینید |
| `502 AI_UPSTREAM_ERROR` | `ARA_ANTHROPIC_BASE_URL` اشتباه یا بلاک شدن egress | سرور را با یک آدرس سالم تست کنید |
| job ماهواره‌ای `failed` | `rasterio` نصب نیست | داخل کانتینر `python3 -m pip install rasterio numpy` یا بازساخت تصویر |
| `/api/kernel` خطا | `shapely` نصب نیست / `python3` پیدا نشد | `KERNEL_PYTHON=python3` و `pip install shapely` |
| پاسخ‌های کند | لایهٔ `roads.json` ۴۵MB در حافظه | gzip در nginx فعال است؛ در صورت نیاز حافظه را ۴GB کنید |
| کارت تصمیم `EVIDENCE_ONLY` | رفتار درست سیستم (کمبود داده) | به اسناد داده مراجعه کنید: `docs/decision-support/required-input-dataset-fa.md` |
