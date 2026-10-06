# الگوهای قرارداد داده (Data Contracts)

هر فایل CSV یک الگو برای یک دستگاه داده‌دار است. ستون‌ها در همهٔ الگوها یکسان‌اند (`CONTRACT_COLUMNS` در `server/ingestion/contractData.ts`).
ردیف نمونه با شناسهٔ `tehran:m605` (یوسف‌آباد) فقط **مثال قالب** است و عدد واقعی نیست؛ پیش از بارگذاری حذف شود.

| ستون | توضیح |
|---|---|
| indicator_code | کد شاخص (H1…R5) یا متغیر بافت (POP، POP_25PLUS، …) |
| neighborhood_id | شناسهٔ گزتیر (از `GET /api/decision-support/neighborhoods/resolve?name=…`) |
| block_id / postal_prefix | اختیاری؛ برای تجمیع بلوکی/پیش‌شمارهٔ پستی |
| numerator / denominator / value | صورت، مخرج و مقدار نهایی (درصدها ۰ تا ۱۰۰) |
| period_start / period_end | بازهٔ مشاهده (YYYY-MM-DD) — `period_end` الزامی |
| group_key / group_value | برای شکاف گروهی: sex، ageBand، tenure، disability |
| source_org / dataset_id / extraction_date / contact | منبع و ردگیری |
| district | اختیاری؛ برای دادهٔ منتشرشده فقط در سطح منطقهٔ شهرداری (قالب `tehran:6`). در این حالت `neighborhood_id` خالی می‌ماند و مقدار روی همهٔ محلات آن منطقه با برچسب «سطح منطقه» گسترده می‌شود |

قواعد: خانه‌های کمتر از `ARA_PRIVACY_MIN_CELL` (پیش‌فرض ۱۰) رد می‌شوند؛ ستون یا مقدار شبیه کد ملی/موبایل/نشانی رد می‌شود؛
هر دسته پس از بارگذاری `PENDING_REVIEW` است و فقط پس از `POST /ingestion/batches/:id/approve` (نقش operator) وارد تحلیل می‌شود.

بارگذاری: `curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/csv" --data-binary @tamin.csv "$API/api/decision-support/ingestion/upload?template=tamin"`

## دادهٔ سطح منطقه (`district.csv`)

برخی آمارهای رسمی آنلاین فقط برای ۲۲ منطقهٔ تهران منتشر می‌شوند (قیمت مسکن بانک مرکزی/مرکز آمار، آمار سامانهٔ ۱۳۷، عملکرد بودجهٔ مناطق).
در ستون `district` شمارهٔ منطقه را بنویسید (`tehran:6`). برنامه:
- مقدار را برای همهٔ محلات منطقه ثبت می‌کند، با `geographyLevel=district` و کیفیت روش ۰٫۷ (اعتماد مکانی ۰٫۶ به‌جای ۱)؛
- اگر برای همان دوره دادهٔ محله‌ای هم باشد، دادهٔ محله‌ای برنده است؛
- شکاف گروهی (`group_key`) را در این سطح نمی‌پذیرد؛
- متغیرهای شمارشی (`POP`، `POP_MALE`، `HOUSEHOLDS`، …) را در این سطح رد می‌کند (`DISTRICT_COUNT`)، چون جمعیت منطقه جمعیت هر محله نیست. جمعیت منطقه در مرجع رسمی (`data/official`) نگه داشته می‌شود و فقط برای کنترل سازگاری و وزن‌دهی جنسی جایگزین به کار می‌رود.

اگر مجموع جمعیت محلات یک منطقه در یک بارگذاری بیش از ۱۵٪ از جمعیت سرشماری ۱۳۹۵ منطقه باشد، هشدار `POP_EXCEEDS_DISTRICT` داده می‌شود.

پیشنهاد تعریف‌ها:
- **E4 استطاعت مسکن (٪، کمتر بهتر):** اجارهٔ سالانهٔ یک واحد ۷۵ متری در منطقه ÷ متوسط درآمد سالانهٔ خانوار شهری استان × ۱۰۰ (`numerator`=اجارهٔ سالانه، `denominator`=درآمد).
- **G2 پاسخگویی (٪):** درخواست‌های ۱۳۷ پاسخ‌داده‌شده در مهلت ÷ کل درخواست‌های منطقه.
- **G4 ظرفیت اجرا (٪):** پروژه‌های تکمیل‌شده ÷ پروژه‌های مصوب منطقه (سامانهٔ شفافیت).

ردیف‌های `district.csv` با مقدار ۰ فقط نمونهٔ قالب‌اند و باید با عدد واقعی منبع جایگزین شوند.

## بستهٔ رسمی جمعیت محلات تهران (۱۳۹۵)

فایل `data/official/tehran/pop_neighborhood_1395.csv` از دادهٔ باز شهرداری (data.tehran.ir) ساخته شده و ۲۹۶ محله را با شناسهٔ مرز رسمی دارد.
در داشبورد گردآوری، کارت «بسته‌های دادهٔ رسمی» → «ورود برای بازبینی» (نقش operator) آن را به‌صورت دستهٔ `PENDING_REVIEW` بارگذاری می‌کند؛ پس از تأیید مدیر، جمعیت محله در حجم نمونه و وزن‌دهی استفاده می‌شود.
نام‌های تطبیق‌نیافته در `data/official/tehran/match_report.csv` فهرست شده‌اند.

## دادهٔ بلوک‌های آماری

`scripts/official/block_info_to_contract.py <block_info.xls> --period-end YYYY-MM-DD` ردیف‌های بلوکی (`POP`، `POP_MALE`، `POP_FEMALE`، `POP_15_64`، `HOUSEHOLDS`) می‌سازد.
این ردیف‌ها فقط وقتی پذیرفته می‌شوند که بلوک در `data/gazetteer/block_map.csv` به محله نگاشت شده باشد (`UNMAPPED_BLOCK`).
برای ساخت نگاشت، لایهٔ مرز بلوک‌ها (shapefile/GeoJSON) لازم است: `npx tsx scripts/official/build_block_map.ts blocks.geojson`.
شمارهٔ محلهٔ درون فایل بلوک با کدهای مرز ۱۴۰۰ یکی نیست و برای نگاشت قابل استفاده نیست.
