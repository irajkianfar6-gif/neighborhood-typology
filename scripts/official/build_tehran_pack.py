#!/usr/bin/env python3
"""
ساخت «بستهٔ دادهٔ رسمی تهران» از فایل‌های خام data/official/raw → data/official/tehran

خروجی‌ها:
  pop_neighborhood_1395.csv   ردیف‌های قرارداد داده (POP) برای محلات تطبیق‌یافته با گزتیر رسمی
  district_reference.json     جمعیت مناطق، سری قیمت مسکن بانک مرکزی، اجاره/قیمت شهر، CPI استان تهران، ارقام کلان
  match_report.csv            گزارش تطبیق نام محلات (برای بازبینی انسانی)

اصل: هیچ عددی ساخته نمی‌شود؛ فقط پاک‌سازی، یکسان‌سازی واحد و تطبیق نام.
اجرا:  python scripts/official/build_tehran_pack.py
"""
import csv, difflib, json, re, sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'data' / 'official' / 'raw'
OUT = ROOT / 'data' / 'official' / 'tehran'
GAZ = ROOT / 'mahalat' / 'محلات رسمی شهرداری تهران (۳۹۱ محله).geojson'
FA = '۰۱۲۳۴۵۶۷۸۹'

# تاریخ مرجع سرشماری ۱۳۹۵ (۱ مهر ۱۳۹۵ = 2016-09-22) و آخر سال‌های شمسی به میلادی
CENSUS_1395 = '2016-09-22'
JALALI_YEAR_END = {1390: '2012-03-19', 1395: '2017-03-20', 1396: '2018-03-20', 1397: '2019-03-20', 1398: '2020-03-19', 1399: '2021-03-20'}


def norm(s: str) -> str:
    s = str(s).replace('ي', 'ی').replace('ك', 'ک').replace('ة', 'ه').replace('ۀ', 'ه')
    s = s.replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ئ', 'ی').replace('گ', 'ک').replace('\u200c', ' ')
    s = re.sub(r'^(محله|شهرک)\s+', '', s.strip())
    s = re.sub(r'(^|\s)(شهید|دکتر|سید|سیدحسین)(?=\s)', ' ', s)
    s = re.sub(r'(?<=\S)\s*بالا$', ' شمالی', s.strip())
    s = re.sub(r'(?<=\S)\s*پایین$', ' جنوبی', s.strip())
    for a, b in ALIASES.items():
        if re.sub(r'\s+', '', s) == a:
            s = b
    return re.sub(r'[\s\-–_()\.،,]+', '', s)


# هم‌نام‌های شناخته‌شده (نام رایج ↔ نام رسمی)
ALIASES = {'اباذر': 'ابوذر', 'قدس': 'غرب'}
DIRECTIONS = ('شمالی', 'جنوبی', 'شرقی', 'غربی', 'مرکزی')


def directions(name: str) -> set:
    n = str(name).replace('ي', 'ی')
    out = {d for d in DIRECTIONS if d in n}
    if re.search(r'بالا$', n.strip()):
        out.add('شمالی')
    if re.search(r'پایین$', n.strip()):
        out.add('جنوبی')
    return out


def to_int(v) -> int:
    return int(''.join(str(FA.index(c)) if c in FA else c for c in str(v)))


def _keys(names):
    out = set()
    for n in names:
        if not n:
            continue
        out.add(norm(n))
        if re.search(r'[-–_]', n):
            out |= {norm(x) for x in re.split(r'[-–_]', n) if x.strip()}
    return out


def gazetteer():
    g = json.loads(GAZ.read_text(encoding='utf-8-sig'))
    out = []
    for f in g['features']:
        p = f['properties']
        if p.get('feature_level') not in (None, 'mahalleh'):
            continue
        m = re.search(r'code=(\d+)', p.get('boundary_source') or '')
        if not m or f['geometry']['type'] not in ('Polygon', 'MultiPolygon'):
            continue  # فقط مرزهای رسمی شهرداری (شناسهٔ tehran:m<code>)
        # نام رسمی شهرداری مرجع است؛ نام OSM فقط وقتی نام شهرداری نیست (نام OSM گاهی به چندضلعی همسایه خورده است)
        municipal = p.get('within_municipal_mahalleh')
        out.append({'id': f'tehran:m{m.group(1)}', 'name': p.get('name_fa'), 'municipal': municipal, 'district': p.get('mantaqe'),
                    'mkeys': {norm(municipal)} if municipal else set(), 'keys': _keys([municipal] if municipal else [p.get('name_fa')]), 'areaKm2': p.get('area_km2')})
    return out


def match_neighborhoods(gaz):
    """تطبیق چندمرحله‌ای؛ هر مرحله فقط روی منابع و چندضلعی‌های هنوز آزاد:
    ۱) نام رسمی شهرداری  ۲) نام/نام‌های جایگزین  ۳) اجزای نام ترکیبی  ۴) شمول نام  ۵) شباهت ≥ ۰٫۸۵ با فاصلهٔ روشن از دومی.
    جهت جغرافیایی (شمالی/جنوبی/…) همیشه باید یکسان باشد."""
    df = pd.read_excel(RAW / 'tehran-mahalat-population.xlsx')
    df.columns = ['row', 'name', 'district', 'pop', 'year', 'source']
    src = [{'name': r['name'], 'district': to_int(r['district']), 'pop': int(r['pop']), 'key': norm(r['name']),
            'parts': {norm(x) for x in re.split(r'[-–،,]', str(r['name'])) if x.strip()}} for _, r in df.iterrows()]
    taken, result = {}, {}

    def pool(s):
        return [e for e in gaz if e['district'] == s['district'] and e['id'] not in taken and directions(e['name'] or '') | directions(e['municipal'] or '') == directions(s['name'])
                or (e['district'] == s['district'] and e['id'] not in taken and directions(e['municipal'] or '') == directions(s['name']) and e['municipal'])]

    def fuzzy(s, cands):
        scored = sorted(((max(difflib.SequenceMatcher(None, s['key'], k).ratio() for k in e['keys']), e) for e in cands), key=lambda t: -t[0])
        if scored and scored[0][0] >= 0.85 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.08):
            return [scored[0][1]], f'fuzzy:{scored[0][0]:.2f}'
        return [], ''

    stages = [
        ('municipal', lambda s, c: [e for e in c if s['key'] in e['mkeys']]),
        ('exact', lambda s, c: [e for e in c if s['key'] in e['keys']]),
        ('part', lambda s, c: [e for e in c if s['parts'] & e['keys']] if len(s['parts']) > 1 else []),
        ('contains', lambda s, c: [e for e in c if len(s['key']) >= 3 and any((s['key'] in k) or (len(k) >= 4 and k in s['key']) for k in e['keys'])]),
    ]
    for label, fn in stages + [('fuzzy', None)]:
        for i, s in enumerate(src):
            if i in result:
                continue
            cands = pool(s)
            if fn is None:
                hit, method = fuzzy(s, cands)
            else:
                hit, method = fn(s, cands), label
            if len(hit) == 1:
                taken[hit[0]['id']] = s['name']
                result[i] = (hit[0], method)
    # ادغام: چندضلعی ۱۴۰۰ با نام ترکیبی (مثل «حکمت _ دزاشیب») = اجتماع دو محلهٔ ۱۳۹۵ → جمعیت جزء بی‌جفت افزوده می‌شود
    merged = {}
    for i, s in enumerate(src):
        if i in result:
            continue
        hosts = [e for e in gaz if e['district'] == s['district'] and e['id'] in taken and e['municipal']
                 and re.search(r'[-–_]|\sو\s', e['municipal']) and s['key'] in {norm(x) for x in re.split(r'[-–_]|\sو\s', e['municipal']) if x.strip()}]
        if len(hosts) == 1:
            merged[i] = hosts[0]
    rows, report = [], []
    by_id = {}
    for i, s in enumerate(src):
        if i in result:
            e, method = result[i]
            by_id.setdefault(e['id'], {'id': e['id'], 'pop': 0, 'district': s['district'], 'src_name': []})
            by_id[e['id']]['pop'] += s['pop']; by_id[e['id']]['src_name'].append(s['name'])
            report.append([s['name'], s['district'], s['pop'], e['id'], e['municipal'] or e['name'], method])
        elif i in merged:
            e = merged[i]
            report.append([s['name'], s['district'], s['pop'], e['id'], e['municipal'], 'merged_into_compound'])
        else:
            report.append([s['name'], s['district'], s['pop'], '', '', 'unmatched'])
    for i, e in merged.items():
        by_id[e['id']]['pop'] += src[i]['pop']; by_id[e['id']]['src_name'].append(src[i]['name'])
    rows = list(by_id.values())
    return rows, report


def district_population():
    p = pd.read_excel(RAW / 'tehran-district-population.xls')
    p.columns = ['year', 'district', 'pop', 'male', 'female', 'households', 'area_ha', 'source']
    out, city = {}, {}
    for _, r in p.iterrows():
        rec = {'pop': round(float(r['pop'])), 'male': round(float(r['male'])), 'female': round(float(r['female'])),
               'households': round(float(r['households'])), 'areaHa': round(float(r['area_ha']), 1), 'source': r['source'],
               'kind': 'سرشماری' if 'مرکز آمار' in r['source'] else 'برآورد شهرداری'}
        m = re.search(r'(\d+)', str(r['district']))
        if 'شهر تهران' in str(r['district']):
            city[str(int(r['year']))] = rec
        elif m:
            out.setdefault(m.group(1), {})[str(int(r['year']))] = rec
    return out, city


def cbi_series():
    c = pd.read_csv(RAW / 'cbi_houseprice_tehran.csv').dropna(subset=['priceM2'])
    # واحد منبع: تا ۱۴۰۱/۰۴ تومان، از ۱۴۰۱/۰۵ هزار ریال → یکسان‌سازی به میلیون ریال برای هر مترمربع
    def to_mrial(row):
        toman = (row.y, row.m) <= (1401, 4)
        return row.priceM2 * 10 / 1e6 if toman else row.priceM2 / 1e3
    c['mrial'] = c.apply(to_mrial, axis=1)
    g = c.groupby(['region', 'y', 'm']).agg(mrial=('mrial', 'mean'), count=('count', 'max')).reset_index()
    series = {}
    for _, r in g.iterrows():
        k = 'city' if r.region == -1 else str(int(r.region))
        series.setdefault(k, []).append({'period': f'{int(r.y)}-{int(r.m):02d}', 'priceMRialPerM2': round(float(r.mrial), 2), 'transactions': int(r['count'])})
    for v in series.values():
        v.sort(key=lambda x: x['period'])
    return series


def cpi():
    out = {}
    with open(RAW / 'cpi_tehran_province_urban.csv', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['kind'] == 'monthly':
                out[r['period']] = float(r['cpi_1400_100'])
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    gaz = gazetteer()
    rows, report = match_neighborhoods(gaz)
    with open(OUT / 'match_report.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['source_name', 'district', 'pop', 'neighborhood_id', 'gazetteer_name', 'method'])
        w.writerows(report)
    cols = ['indicator_code', 'neighborhood_id', 'block_id', 'postal_prefix', 'numerator', 'denominator', 'value', 'unit', 'period_start', 'period_end',
            'group_key', 'group_value', 'source_org', 'dataset_id', 'extraction_date', 'contact', 'district']
    with open(OUT / 'pop_neighborhood_1395.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in sorted(rows, key=lambda x: x['id']):
            w.writerow(['POP', r['id'], '', '', '', '', r['pop'], 'نفر', '', CENSUS_1395, '', '', 'شهرداری تهران — data.tehran.ir (بر پایهٔ سرشماری ۱۳۹۵)', 'tehran-mahalat-population-1395', '', '', ''])

    dpop, cpop = district_population()
    series = cbi_series()
    pub = json.loads((RAW / 'publications_extract.json').read_text(encoding='utf-8'))
    mordad = pub['cbiDistrictMordad1403']
    districts = {}
    for d in [str(i) for i in range(1, 23)]:
        nb = [r for r in rows if str(r['district']) == d]
        districts[d] = {
            'population': dpop.get(d, {}),
            'housing': {
                'monthly': series.get(d, []),
                'latest': {'period': mordad['period'], 'priceMRialPerM2': mordad['rows'][d][0], 'transactions': mordad['rows'][d][1], 'source': mordad['source']},
            },
            'neighborhoodPop1395': {'matched': len(nb), 'sum': sum(r['pop'] for r in nb)},
        }
    ref = {
        'version': 'tehran-official-pack-1',
        'builtFrom': sorted(p.name for p in RAW.iterdir()),
        'periodsNote': 'قیمت‌ها به میلیون ریال برای هر مترمربع یکسان شده‌اند؛ CPI استان تهران (شهری) با پایهٔ ۱۴۰۰=۱۰۰',
        'districts': districts,
        'city': {
            'population': cpop,
            'housing': {'monthly': series.get('city', []), 'latest': {'period': mordad['period'], 'priceMRialPerM2': mordad['rows']['city'][0], 'transactions': mordad['rows']['city'][1], 'source': mordad['source']}},
            'housingAnnual': pub['tehranCityHousingAnnual'],
        },
        'cpiTehranUrban': {'base': '1400=100', 'source': 'مرکز آمار ایران — شاخص قیمت مصرف‌کنندهٔ خانوارهای شهری به تفکیک استان (جدول ۷، مرداد ۱۴۰۵)', 'monthly': cpi()},
        'macro': {i['key']: i for i in pub['items']},
        'sources': {
            'neighborhoodPop': 'data.tehran.ir — جمعیت محلات تهران (حدود سال ۱۳۹۵)',
            'districtPop': 'مرکز آمار ایران (۱۳۹۰، ۱۳۹۵) و سازمان فناوری اطلاعات و ارتباطات شهرداری تهران (۱۳۹۶–۱۳۹۹، برآورد)',
            'housingMonthly': 'بانک مرکزی — متوسط قیمت هر مترمربع و تعداد معاملات به تفکیک منطقه (۱۳۹۶/۰۷ تا ۱۴۰۱/۰۹)',
        },
    }
    (OUT / 'district_reference.json').write_text(json.dumps(ref, ensure_ascii=False, indent=1), encoding='utf-8')
    matched = sum(1 for r in report if r[5] not in ('unmatched',) and not r[5].startswith('duplicate'))
    print(json.dumps({'neighborhoodRows': len(rows), 'sourceRows': len(report), 'matched': matched,
                      'unmatched': sum(1 for r in report if r[5] == 'unmatched'), 'officialPolygons': len(gaz)}, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
