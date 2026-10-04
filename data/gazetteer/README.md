# گزتیر محلات اضافه

فایل‌های GeoJSON این پوشه (و پوشه‌های `ARA_GAZETTEER_DIRS`) هنگام راه‌اندازی به گزتیر افزوده می‌شوند.
هر Feature باید `properties` زیر را داشته باشد: `name` یا `name_fa` (نام فارسی)، `city` (نام شهر)، در صورت امکان `id` رسمی، `district`/`region` و `province`.
هندسهٔ Polygon/MultiPolygon مرز رسمی حساب می‌شود (`tier=official` اگر `source` رسمی باشد، وگرنه `osm_admin`)؛ Point به مرز تقریبی
(بافر/ورونوی، `isProxy=true`) تبدیل می‌شود و سطح انتشار را محدود می‌کند.
