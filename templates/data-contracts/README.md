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

قواعد: خانه‌های کمتر از `ARA_PRIVACY_MIN_CELL` (پیش‌فرض ۱۰) رد می‌شوند؛ ستون یا مقدار شبیه کد ملی/موبایل/نشانی رد می‌شود؛
هر دسته پس از بارگذاری `PENDING_REVIEW` است و فقط پس از `POST /ingestion/batches/:id/approve` (نقش operator) وارد تحلیل می‌شود.

بارگذاری: `curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/csv" --data-binary @tamin.csv "$API/api/decision-support/ingestion/upload?template=tamin"`
