# مسیر «تحلیل فقط با نام محله» (ARA-NB-2.0)

کاربر فقط نام محله را وارد می‌کند؛ سامانه محله را در گزتیر پیدا می‌کند، روی **مرز رسمی نسخه‌دار** شواهد را از همهٔ کانال‌ها
جمع می‌کند، هر عدد را با منبع/تاریخ/پایایی مستند می‌کند و فقط وقتی شواهد کافی است حکم صادر می‌کند. نبودِ داده به
**امتناع صریح** و فهرست «چه داده‌ای این حکم را تغییر می‌دهد» می‌رسد، نه به عدد ساختگی.

```
نام → resolver (نرمال‌سازی فارسی، Jaro-Winkler، هم‌نام‌ها → انتخاب کاربر)
    → مرز نسخه‌دار (تهران: ۳۹۱ محلهٔ رسمی؛ کرج: OSM/تقریبی) → ثبت append-only در kernel
    → بافت: جمعیت (قرارداد مرکز آمار → WorldPop zonal → نامعلوم)، شبکهٔ ۲۵۰ متری وزن‌دار
    → شواهد موازی: دادهٔ باز (OSM/Overpass، Open-Meteo/CAMS، رسترها) | قرارداد تأییدشده | پیمایش | ممیزی میدانی
    → ادغام با اولویت ردهٔ شاهد و هم‌گرایی → نرمال‌سازی (هنجاری یا صدک شهری)
    → دروازهٔ انتشار (PUBLISHABLE / PROVISIONAL / INSUFFICIENT) → موتور فقط روی مقادیر مجاز → کارت V2
```

## API

| مسیر | نقش لازم | کار |
|---|---|---|
| `GET /api/decision-support/neighborhoods/resolve?name=…&city=…` | viewer | نامزدهای گزتیر |
| `GET /api/decision-support/neighborhoods/cities` | viewer | شهرهای پوشش‌داده‌شده |
| `GET /api/decision-support/neighborhoods/:id/boundary` | viewer | مرز و نسخه |
| `POST /api/decision-support/neighborhoods/analyze` `{name \| neighborhoodId, city?, asOf?, purpose?}` | analyst | کارت V2 (+ `engineCard` اگر مجاز) یا `NEEDS_DISAMBIGUATION` |
| `GET …/neighborhoods/:id/card \| evidence \| missing-data \| history` | viewer | آخرین کارت، شواهد، کمبودها، تاریخچه |
| `GET …/ingestion/templates[/:file]` | viewer | الگوهای قرارداد داده (`templates/data-contracts`) |
| `POST …/ingestion/upload?template=…` (text/csv) | operator | بارگذاری دسته ← `PENDING_REVIEW` |
| `POST …/ingestion/batches/:id/approve` `{decision}` | admin (چهار چشم) | تأیید/رد؛ فقط دستهٔ تأییدشده وارد تحلیل می‌شود |
| `GET …/survey/questionnaire`، `POST …/survey/:id/responses`، `GET …/survey/:id/summary` | viewer/operator | پیمایش ادراکی با کنترل کیفیت، raking، آلفای کرونباخ |
| `GET …/field-audit/checklist`، `POST …/field-audit/:id`، `GET …/field-audit/:id/summary` | viewer/operator | ممیزی میدانی، کاپا |
| `GET /metrics` | — | Prometheus |

## اجرای محلی

```bash
npm ci && pip install -r kernel/requirements.txt
npm run neighborhood:layers -- tehran          # کش لایه‌های OSM شهر (یک‌بار؛ تازه‌سازی ۳۰روزه با زمان‌بند)
npm run neighborhood:open-data -- tehran       # دادهٔ باز جهانی برای N4/N5/R5 (یک‌بار؛ فقط پنجرهٔ شهر خوانده می‌شود)
WORLDPOP_COG_PATH=/data/rasters/irn_pop_2025_CN_100m_R2025A_v1.tif npm run neighborhood:reference -- --city tehran --use-kernel
WORLDPOP_COG_PATH=… npm run sci:server
curl -X POST localhost:4001/api/decision-support/neighborhoods/analyze -H 'content-type: application/json' -d '{"name":"یوسف آباد"}'
```

رستر WorldPop (۱۰۰ متری ۲۰۲۵، `irn_pop_2025_CN_100m_R2025A_v1.tif`) در مخزن نیست و باید از WorldPop دریافت شود.
جمع جمعیت تهران با این رستر ≈۱۰٫۲ میلیون است (≈۹–۱۳٪ بیش از آمار رسمی)؛ به همین دلیل ردهٔ آن `open_model` است و قرارداد مرکز آمار (`POP`) بر آن اولویت دارد.

## دادهٔ باز جهانی (N4، N5، R2، R5)

`npm run neighborhood:open-data -- <city>` فقط پنجرهٔ محدودهٔ شهر را از فایل‌های راه‌دور می‌خواند و در `server/data/` می‌گذارد:

| شاخص | منبع | خروجی | روش |
|---|---|---|---|
| N4 مواجهه با خطر | JRC CEMS-GloFAS سیل T100 v2.1 · GEM Global Active Faults (CC BY-SA 4.0) · Copernicus DEM GLO-30 | `open-rasters/jrc_flood__<city>.tif`، `open-vector/<city>/faults.json`، `open-rasters/slope__<city>.tif` | سهم جمعیت در سلول‌هایی که در سیل، حریم گسل (`ARA_FAULT_BUFFER_M`=۵۰۰) یا شیب تند (`ARA_STEEP_SLOPE_PCT`=۲۰٪) هستند |
| N5 تاب‌آوری اقلیمی | ESA WorldCover 10m 2021 v200 (CC BY 4.0) + N4 | `open-rasters/worldcover__<city>.tif` | میانگین جمعیت‌وزن‌دار: درخت ×۰٫۴ + سایر گیاهی ×۰٫۲ + نفوذپذیر ×۰٫۲ + بیرون از خطر ×۰٫۲ (proxy) |
| R2 دسترسی به فرصت شغلی | لایهٔ commerce همان OSM | — | میانهٔ جمعیت‌وزن‌دار تعداد بنگاه‌ها در `ARA_JOB_WALK_MIN`=۲۰ دقیقه پیاده (proxy) |
| R5 اتصال دیجیتال | Speedtest by Ookla Open Data (CC BY-NC-SA 4.0؛ فقط غیرتجاری) | `open-vector/<city>/ookla_{fixed,mobile}.json` | میانهٔ جمعیت‌وزن‌دار سرعت دانلود (Mbps)؛ آخرین فصلی که برای شهر داده دارد (تا ۸ فصل عقب) |

نقشهٔ گسل رسمی (مثلاً ریزپهنه‌بندی) با `ARA_FAULTS_GEOJSON_PATH` جایگزین GEM می‌شود. بعد از آماده‌سازی، مرجع شهر را دوباره بسازید (`neighborhood:reference`).

## متغیرهای محیطی

`ARA_API_TOKENS` (`token:role,…`)، `ARA_ALLOWED_ORIGINS`، `ARA_ANTHROPIC_MAX_TOKENS`،
`ARA_PUBLIC_DATA_DIR`، `ARA_SERVER_DATA_DIR`، `ARA_GAZETTEER_DIRS`، `ARA_REFERENCE_DIR`،
`WORLDPOP_COG_PATH`، `NDVI_COG_PATH`، `JRC_FLOOD_COG_PATH`، `GHSL_COG_PATH`، `WORLDCOVER_COG_PATH`، `DEM_COG_PATH`، `SLOPE_COG_PATH`، `ARA_OPEN_RASTER_DIR`،
`ARA_FAULTS_GEOJSON_PATH`، `ARA_FAULT_BUFFER_M`، `ARA_STEEP_SLOPE_PCT`، `ARA_JOB_WALK_MIN`،
`VALHALLA_URL`، `OVERPASS_ENDPOINTS`، `ARA_SCHEDULER_ENABLED`، `ARA_STORAGE` (`json`|`postgres`) + `DATABASE_URL`،
`ARA_PRIVACY_MIN_CELL`، `ARA_SURVEY_MIN_SECONDS`. نمونه در `.env.example`.

Docker: `docker compose up -d` (فقط روی 127.0.0.1)، با PostGIS: `docker compose --profile postgis up -d`
(جدول‌های `ara.*` از `neighborhood_typology/sql/zz_ara_runtime.sql`)، با مسیریابی: `--profile valhalla`.

## سطح انتشار — واقع‌بینانه

| شواهد موجود | نتیجهٔ معمول |
|---|---|
| فقط دادهٔ باز | **INSUFFICIENT** (حدود ۱۰ از ۴۰ شاخص: P2، P4، P5، N1، N2، N3، R1، R3، C1، E2) — موتور اجرا نمی‌شود |
| + قرارداد دستگاه‌ها برای همهٔ محلات شهر | **PROVISIONAL** — تیپ و گلوگاه صادر می‌شود؛ علّیت «اولیه» |
| + پیمایش n≥۳۸۴، α≥۰٫۷ و دادهٔ گروهی n≥۳۰ | امکان **PUBLISHABLE**، حکم عدالت، علّیت هم‌گرا |
| + کالیبراسیون و تأیید کمیتهٔ روش‌شناسی | PUBLISHABLE بدون قید «کالیبره‌نشده» |

شاخص‌های صدکی (مثل H2، G1، C2) فقط وقتی امتیاز می‌گیرند که توزیع شهری وجود داشته باشد: یا در `data/reference`،
یا از قراردادهای تأییدشدهٔ دست‌کم ۲۰ محلهٔ همان شهر (توزیع زنده). مقدار یک محلهٔ تنها، امتیاز نسبی نمی‌گیرد.

## آزمون‌ها

CI در `.github/workflows/ci.yml` روی هر push به main و هر PR اجرا می‌شود.

`npm run test:all` — شامل `server/noFabrication.test.ts` (رد مقادیر ملی/استانی، حذف سازندهٔ ابتکاری، امتناع در نبود داده)،
resolver روی هر ۳۹۱ نام رسمی تهران، دروازهٔ انتشار، احراز هویت، قرارداد داده و آزمون‌های kernel (شامل `gis/test_zonal.py`).
