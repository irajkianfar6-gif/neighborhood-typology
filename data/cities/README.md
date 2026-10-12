# نمایهٔ شهرها (CITY-v1)

هر فایل `<slug>.json` نمایهٔ یک شهر است: `cityFa`، `provinceFa`، `aliases`، `officialDomains` (دامنه‌های رسمی شهرداری/استانداری برای اولویت جست‌وجو)،
`sources` (منابع بومی: `title`، `url`، `publisher`، `indicators`، `spatialLevel`) و `notes`. تهران و کرج نمایهٔ داخلی دارند.
ساخت خودکار همراه با لایهٔ محلات: `npx tsx scripts/onboard-city.ts --city "یزد" --province "یزد" --from mahalat.geojson --official --domains yazd.ir`.
