#!/usr/bin/env python3
"""
تبدیل اطلاعات بلوک‌های شهری تهران (block_info*.xls؛ راهنمای ستون‌ها: rahnama.doc) به ردیف‌های قرارداد داده در سطح بلوک.

ردیف‌ها با block_id ساخته می‌شوند و برنامه آن‌ها را با data/gazetteer/block_map.csv (block_id,neighborhood_id)
روی محله جمع می‌زند (صورت/مخرج جمع می‌شود، نه میانگین درصدها). بدون block_map ردیف‌ها با UNMAPPED_BLOCK رد می‌شوند.
block_map را از لایهٔ نقشهٔ بلوک‌ها (blockshp) بسازید:  npx tsx scripts/official/build_block_map.ts blocks.geojson

نکته‌ها:
 - شمارهٔ محلهٔ این فایل (MAHALEH_NO) با کد محلات رسمی ۱۴۰۰ یکی نیست؛ پس فقط پیوند مکانی BLOCK_NO معتبر است.
 - سال آمار در فایل درج نشده؛ --period-end را از منبع بگیرید (مثلاً 2006-10-28 برای سرشماری ۱۳۸۵).
 - فقط متغیرهای شمارشی بافت و نسبت‌هایی با تعریف قراردادی ساخته می‌شود؛ هیچ مقداری برآورد نمی‌شود.

اجرا:
  python scripts/official/block_info_to_contract.py block_info_tehran.xls --period-end 2006-10-28 --out block_contract.csv
"""
import argparse, csv
import pandas as pd

COLS = ['indicator_code', 'neighborhood_id', 'block_id', 'postal_prefix', 'numerator', 'denominator', 'value', 'unit', 'period_start', 'period_end',
        'group_key', 'group_value', 'source_org', 'dataset_id', 'extraction_date', 'contact', 'district']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xls')
    ap.add_argument('--period-end', required=True, help='تاریخ مرجع آمار به میلادی YYYY-MM-DD')
    ap.add_argument('--source', default='شهرداری تهران — اطلاعات بلوک‌های شهری (بانک املاک/سرشماری)')
    ap.add_argument('--dataset', default='tehran-block-info')
    ap.add_argument('--out', default='block_contract.csv')
    a = ap.parse_args()
    b = pd.read_excel(a.xls)
    # ستون‌ها طبق راهنما: ZAN/MARD = زن/مرد، JAMIAT = جمعیت، SAKEN = خانوار ساکن، *_15TA64 = ۱۵ تا ۶۴ ساله
    need = ['BLOCK_NO', 'JAMIAT', 'ZAN', 'MARD', 'SAKEN']
    missing = [c for c in need if c not in b.columns]
    if missing:
        raise SystemExit(f'ستون‌های لازم یافت نشد: {missing}')
    pop1564 = None
    if 'BEYNE_15TA' in b.columns:
        pop1564 = 'BEYNE_15TA'
    n = 0
    with open(a.out, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(COLS)
        for _, r in b.iterrows():
            if not r['JAMIAT'] or r['JAMIAT'] <= 0:
                continue
            base = dict.fromkeys(COLS, '')
            base.update({'block_id': int(r['BLOCK_NO']), 'period_end': a.period_end, 'source_org': a.source, 'dataset_id': a.dataset,
                         'postal_prefix': int(r['POSTCODE']) if 'POSTCODE' in b.columns and r['POSTCODE'] else ''})
            # شمارشی‌ها با numerator=مقدار و denominator=1 تا تجمیع بلوکی (جمع صورت/مخرج) درست کار کند
            for code, col in [('POP', 'JAMIAT'), ('POP_FEMALE', 'ZAN'), ('POP_MALE', 'MARD'), ('HOUSEHOLDS', 'SAKEN')] + ([('POP_15_64', pop1564)] if pop1564 else []):
                v = int(r[col]) if pd.notna(r[col]) else 0
                row = dict(base, indicator_code=code, numerator=v, denominator=1, value=v, unit='نفر' if code != 'HOUSEHOLDS' else 'خانوار')
                w.writerow([row[c] for c in COLS]); n += 1
    print(f'{n} ردیف در {a.out}')


if __name__ == '__main__':
    main()
