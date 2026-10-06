# دادهٔ رسمی تهران

| فایل | محتوا | منبع |
|---|---|---|
| `raw/tehran-mahalat-population.xlsx` | جمعیت ۳۴۹ محله (حدود ۱۳۹۵) | data.tehran.ir |
| `raw/tehran-district-population.xls` | جمعیت، جنس، خانوار و مساحت ۲۲ منطقه (۱۳۹۰، ۱۳۹۵ و برآورد ۱۳۹۶–۱۳۹۹) | مرکز آمار / شهرداری |
| `raw/cbi_houseprice_tehran.csv` | قیمت و تعداد معاملات مسکن مناطق، ماهانه ۱۳۹۶/۰۷ تا ۱۴۰۱/۰۹ | بانک مرکزی |
| `raw/cpi_tehran_province_urban.csv` | شاخص قیمت مصرف‌کننده، شهری استان تهران (۱۴۰۰=۱۰۰) | مرکز آمار |
| `raw/publications_extract.json` | ارقام برگرفته از گزارش‌های PDF (هزینه‌ودرآمد خانوار ۱۴۰۴، قیمت مسکن مرداد ۱۴۰۳، شاخص‌های کلان) با ارجاع | مرکز آمار، بانک مرکزی |

خروجی‌ها با `python3 scripts/official/build_tehran_pack.py` بازسازی می‌شوند:
`tehran/pop_neighborhood_1395.csv` (بستهٔ قراردادی جمعیت محله)، `tehran/district_reference.json` (مرجع منطقه) و `tehran/match_report.csv` (گزارش تطبیق نام‌ها).
قیمت‌ها پیش از ۱۴۰۱/۰۵ به تومان و پس از آن به هزار ریال منتشر شده‌اند و همه به میلیون ریال یکسان شده‌اند.
