# استقرار رابط کاربری روی Cloudflare Pages

## علت خطای نصب

محیط ساخت با Bun 1.2.15، فایل `bun.lock` با `lockfileVersion: 2` را نمی‌خواند؛ سپس `--frozen-lockfile` مانع نصب می‌شود. این فایل علاوه بر ناسازگاری قالب، با وابستگی‌های فعلی پروژه نیز همگام نبود. پروژه و CI از npm استفاده می‌کنند؛ بنابراین `package-lock.json` تنها مرجع نصب است و `bun.lock` حذف شده است. مقدار نسخهٔ lockfile را دستی تغییر ندهید و کنترل lockfile را غیرفعال نکنید.

## تنظیمات پروژهٔ Pages

این تنظیمات برای **Pages با ساخت از GitHub** است، نه استقرار مستقیم برنامهٔ Express روی Workers.

- شاخهٔ Production: شاخه‌ای که اصلاح را در آن ادغام کرده‌اید (معمولاً `main`).
- Root directory: ریشهٔ مخزن (خالی یا `/`).
- Build command: `npm ci --no-audit --no-fund && npm run build`
- Build output directory: `dist`
- Build system: v3.

متغیرهای ساخت را برای Production و Preview تنظیم کنید:

| متغیر | مقدار | کاربرد |
| --- | --- | --- |
| `SKIP_DEPENDENCY_INSTALL` | `1` | نصب خودکار را رد می‌کند؛ نصب کنترل‌شده با `npm ci` در Build command انجام می‌شود |
| `NODE_VERSION` | `24.18.0` | هم‌نسخه با محیط گزارش‌شده؛ فایل `.node-version` نیز همین مقدار را دارد |
| `VITE_API_BASE_URL` | نشانی HTTPS واقعی API، بدون `/api` انتهایی | فقط اگر API روی مبدأ جداگانه است |

`packageManager` در `package.json` نسخهٔ npm مورد استفاده برای آزمون نصب را ثبت می‌کند؛ برای Cloudflare صرفاً به این فیلد برای انتخاب ابزار اتکا نکنید. Node را با فایل یا متغیر بالا انتخاب کنید.

پس از ادغام اصلاح، یک بار کش ساخت را پاک و ساخت مجدد را شروع کنید. مرحلهٔ نصب نباید دیگر `bun install --frozen-lockfile` باشد. اگر همچنان Bun اجرا شد، شاخه/commit، Root directory و وجود lockfile قدیمی در آن شاخه را بررسی کنید. صرفاً گذاشتن `npm ci` در Build command، بدون `SKIP_DEPENDENCY_INSTALL=1`، خطای مرحلهٔ نصب خودکار قبلی را دور نمی‌زند.

## API و موتور پایتون

`npm run build` فقط رابط Vite را در `dist` می‌سازد. API این پروژه Express است و بخشی از محاسبات و پردازش‌ها به Python و ذخیره‌سازی پایدار وابسته‌اند. رفع نصب به معنی انتقال این سرویس‌ها به Pages یا Workers نیست.

برای استقرار فعلی، API و سرویس پایتون را روی سرور یا کانتینر سازگار اجرا کنید؛ `VITE_API_BASE_URL` را **پیش از ساخت** رابط تنظیم کنید. روی API، `ARA_ALLOWED_ORIGINS` باید نشانی واقعی رابط Pages یا دامنهٔ سفارشی را شامل شود؛ از `*` در محیط واقعی استفاده نکنید. کلیدهای هوش مصنوعی، اتصال پایگاه داده و سایر اسرار فقط سمت API باقی بمانند و نباید با پیشوند `VITE_` وارد باندل شوند.

پراکسی `server.proxy` در `vite.config.ts` مخصوص توسعه است و با انتشار پوشهٔ `dist` فعال نمی‌شود. اگر UI و API با reverse proxy روی یک مبدأ قرار دارند، `VITE_API_BASE_URL` می‌تواند خالی باشد.

## کنترل پیش از انتشار

```sh
npm ci --no-audit --no-fund
npm run lint
npm run build
```

در Pages وجود `dist/index.html` و بارگذاری فایل‌های JS/CSS را بررسی کنید؛ سپس درخواست‌های `/api/*` را جداگانه آزمون کنید. صفحهٔ HTML به‌جای JSON یا خطای CORS معمولاً نشانهٔ تنظیم نشدن نشانی API/مبدأ مجاز است، نه خطای lockfile.

مرجع تنظیم نسخه‌ها و رد کردن نصب خودکار: https://developers.cloudflare.com/pages/configuration/build-image/
