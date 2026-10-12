# گزتیر محلات اضافه

فایل‌های GeoJSON این پوشه (و پوشه‌های `ARA_GAZETTEER_DIRS`) هنگام راه‌اندازی به گزتیر افزوده می‌شوند.
هر Feature باید `properties` زیر را داشته باشد: `name` یا `name_fa` (نام فارسی)، `city` (نام شهر)، در صورت امکان `id` رسمی، `district`/`region` و `province`.
هندسهٔ Polygon/MultiPolygon مرز رسمی حساب می‌شود (`tier=official` اگر `source` رسمی باشد، وگرنه `osm_admin`)؛ Point به مرز تقریبی
(بافر/ورونوی، `isProxy=true`) تبدیل می‌شود و سطح انتشار را محدود می‌کند.

طرح دقیق ویژگی‌ها پس از یکسان‌سازی: `name_fa`، `city_fa`، `province_fa`، `mantaqe_name_fa`، `feature_level=mahalleh`، `source`، `boundary_source`، `extraction_date`.
برای ورود شهر تازه از `scripts/onboard-city.ts` استفاده کنید؛ این اسکریپت نام‌های رایج ویژگی (`name`، `name:fa`، `NAME_FA`، `district`، `region` …) را یکسان می‌کند
و نمایهٔ شهر را در `data/cities/` می‌سازد. آمادگی هر شهر در زبانهٔ «عملیات و هزینه» و `GET /api/agentic/cities` دیده می‌شود.
