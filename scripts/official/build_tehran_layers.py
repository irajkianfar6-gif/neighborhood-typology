#!/usr/bin/env python3
"""
ساخت «لایه‌های محله‌ای تهران» (data/official/tehran/neighborhood_layers_v1.json) از فایل‌های خام data/official/raw/layers:

  ۱) روشنایی معابر محلی v3 (VIIRS DNB، ۶۴۵ شب ۲۰۲۳–۲۰۲۵، NPP + NOAA-20) — کلید: شناسهٔ رسمی ۳۹۱ محله
  ۲) استطاعت مسکن ساکنان (دیوار مهر ۱۴۰۵ + HEIS ۱۴۰۴) — ۳۴۹ محلهٔ فهرست ۱۳۹۵
  ۳) اشتغال پایدار (برآورد کوچک‌ناحیه‌ای؛ سرشماری ۱۳۹۵/۱۳۸۵ مناطق + قیمت مسکن) — ۳۴۹ محله
  ۴) سطح تحصیلات نسخهٔ ۲ (برآورد کوچک‌ناحیه‌ای؛ سرشماری ۱۳۹۰ مناطق + قیمت مسکن) — ۳۴۹ محله

اصل: هیچ عددی ساخته نمی‌شود. فقط (الف) تطبیق نام ۱۳۹۵ ↔ چندضلعی رسمی با همان گزارش تطبیق بستهٔ جمعیت
(match_report.csv) به‌اضافهٔ فهرست کوچک تطبیق دستی بازبینی‌شده، (ب) میانگین وزنی جمعیتی وقتی چند محلهٔ ۱۳۹۵
در یک چندضلعی ادغام شده‌اند، (ج) به‌ارث‌بردن مقدار محلهٔ مادر وقتی یک محلهٔ ۱۳۹۵ به چند چندضلعی تقسیم شده، و
(د) برای چندضلعی‌های بی‌جفت، مقدار رسمی منطقه با برچسب صریح «سطح منطقه».
اجرا:  python scripts/official/build_tehran_layers.py
"""
import csv, json, math, re, sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_tehran_pack import gazetteer, norm  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'data' / 'official' / 'raw' / 'layers'
OUT = ROOT / 'data' / 'official' / 'tehran'
FILES = {
    'housing': RAW / 'tehran_housing_affordability_1405-07.xlsx',
    'employment': RAW / 'tehran_sustainable_employment_sae.xlsx',
    'education': RAW / 'tehran_education_sae_v2.xlsx',
}

# تطبیق دستی بازبینی‌شده برای محلات ۱۳۹۵ که تطبیق خودکار نیافت (نام چندضلعی رسمی/OSM یکسان است یا محله تقسیم شده)
# (منطقه، نام ۱۳۹۵) → شناسه(ها)؛ همه باید چندضلعی آزادِ همان منطقه باشند (در ساخت بررسی می‌شود)
CURATED = {
    (1, 'فرمانيه'): ['tehran:m120'],          # «دیباجی - فرمانیه»
    (2, 'پرواز'): ['tehran:m202'],
    (6, 'کشاورز'): ['tehran:m613'],           # «کشاورز - پارک لاله»
    (7, 'خواجه نظام الملک'): ['tehran:m715'],
    (7, 'شاهد'): ['tehran:m710'],
    (8, 'نارمک'): ['tehran:m808'],            # «نارمک جنوبی»
    (11, 'حر'): ['tehran:m1107'],             # «میدان حر»
    (14, 'مينا'): ['tehran:m1413', 'tehran:m1422'],  # مینای شمالی/جنوبی (تقسیم)
    (21, 'شهرک فرهنگیان-آزادي'): ['tehran:m2108', 'tehran:m2109'],  # تقسیم به دو شهرک
    (22, 'زيبادشت'): ['tehran:m2205'],
    (22, 'گلستان'): ['tehran:m2206'],
    (22, 'قائم'): ['tehran:m2207'],           # «قائم چیتگر»
    (22, 'سرو آزاد'): ['tehran:m2208'],
    (22, 'آبشار'): ['tehran:m2203'],          # «آبشار تهران»
}

QUALITY_ADEQ = {'A': 1.0, 'B': 0.7, 'C': 0.4, 'D': 0.2}


def num(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) else round(x, 3)


def txt(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).strip()
    return s or None


FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'


def district_num(s):
    m = re.search(r'منطقه\s*([0-9۰-۹]+)', str(s))
    return int(''.join(str(FA_DIGITS.index(ch)) if ch in FA_DIGITS else ch for ch in m.group(1))) if m else None


def app_gazetteer():
    """همهٔ ۳۹۱ محلهٔ تهران در گزتیر برنامه (۳۳۹ چندضلعی رسمی شهرداری + مرزهای تکمیلی OSM/ترکیبی)؛
    فهرست از خروجی روشنایی v3 گرفته می‌شود که روی همان گزتیر ساخته شده است."""
    L = pd.read_csv(RAW / 'tehran_street_lighting_v3.csv')
    return [{'id': r.neighborhood_id, 'name': r.name_fa, 'district': district_num(r.district), 'note': txt(r.boundary_note)} for r in L.itertuples()]


def nkey(s):
    s = re.sub(r'^\s*میدان\s+', '', str(s).replace('ي', 'ی'))
    return norm(re.sub(r'\s+و\s+', ' ', s))


def crosswalk(gaz, app):
    """(منطقه، نام نرمال) → [(شناسه، روش)]"""
    ids = {e['id'] for e in gaz}
    dist_of = {e['id']: e['district'] for e in gaz}
    cw, taken = {}, set()
    with open(OUT / 'match_report.csv', encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            if r['neighborhood_id']:
                cw[(int(r['district']), norm(r['source_name']))] = [(r['neighborhood_id'], r['method'])]
                taken.add(r['neighborhood_id'])
    for (d, name), targets in CURATED.items():
        key = (d, norm(name))
        assert key not in cw, f'curated overrides automatic match: {name}'
        for t in targets:
            assert t in ids and t not in taken, f'curated target not free: {t}'
            assert int(dist_of[t]) == d, f'curated target in another district: {t}'
        cw[key] = [(t, 'curated' if len(targets) == 1 else 'curated_split') for t in targets]
        taken |= set(targets)
    # مرحلهٔ مرزهای تکمیلی (غیر رسمی) گزتیر: نام یکسان در همان منطقه، یا تقسیم شمالی/جنوبی/شرقی/غربی
    extras = [e for e in app if e['id'] not in ids]
    sources = pd.read_excel(FILES['housing'], sheet_name='محلات')
    for _, r in sources.iterrows():
        d, name = int(r['منطقه']), str(r['محله'])
        if (d, norm(name)) in cw:
            continue
        free = [e for e in extras if e['district'] == d and e['id'] not in taken]
        hit = [e for e in free if nkey(e['name']) == nkey(name)]
        method = 'extra_boundary_name'
        if not hit and not re.search(r'(شمالی|جنوبی|شرقی|غربی)$', name.replace('ي', 'ی')):
            hit = [e for e in free if re.sub(r'(شمالی|جنوبی|شرقی|غربی)$', '', nkey(e['name'])) == nkey(name) and nkey(e['name']) != nkey(name)]
            method = 'extra_boundary_split' if len(hit) > 1 else method
        if hit and (len(hit) == 1 or method == 'extra_boundary_split'):
            cw[(d, norm(name))] = [(e['id'], method) for e in hit]
            taken |= {e['id'] for e in hit}
    return cw


def assign(df, cw, fields, pop_col, layer):
    """هر ردیف محلهٔ ۱۳۹۵ → چندضلعی(ها)؛ ادغام چندتایی با میانگین وزنی جمعیت"""
    acc, report = {}, []
    for _, r in df.iterrows():
        d = int(r['منطقه'])
        key = (d, norm(r['محله']))
        hits = cw.get(key, [])
        report.append({'layer': layer, 'district': d, 'source_name': r['محله'], 'targets': ';'.join(h[0] for h in hits), 'method': ';'.join(sorted({h[1] for h in hits})) or 'unmatched'})
        for tid, method in hits:
            acc.setdefault(tid, []).append((r, method, len(hits) > 1))
    out = {}
    for tid, rows in acc.items():
        w = [max(1.0, float(num(r[pop_col]) or 0)) for r, _, _ in rows]
        rec = {}
        for key, (col, kind) in fields.items():
            vals = [(r[col], wi) for (r, _, _), wi in zip(rows, w)]
            if kind == 'mean':
                xs = [(num(v), wi) for v, wi in vals if num(v) is not None]
                rec[key] = round(sum(x * wi for x, wi in xs) / sum(wi for _, wi in xs), 3) if xs else None
            elif kind == 'sum':
                xs = [num(v) for v, _ in vals if num(v) is not None]
                rec[key] = round(sum(xs)) if xs and not rows[0][2] else (round(xs[0]) if xs else None)
            elif kind == 'worst_grade':
                gs = [txt(v) for v, _ in vals if txt(v)]
                rec[key] = max(gs) if gs else None
            else:  # first
                rec[key] = txt(vals[0][0]) if isinstance(vals[0][0], str) else num(vals[0][0])
        rec['sourceNames'] = [str(r['محله']) for r, _, _ in rows]
        rec['match'] = 'inherited_from_parent' if rows[0][2] else ('merged_population_weighted' if len(rows) > 1 else rows[0][1])
        rec['level'] = 'district' if rec.get('quality') == 'D' else 'neighborhood'
        out[tid] = rec
    return out, report


def district_table(xlsx, fields):
    d = pd.read_excel(xlsx, sheet_name='مناطق')
    out = {}
    for _, r in d.iterrows():
        try:
            k = str(int(r['منطقه']))
        except (TypeError, ValueError):
            continue
        out[k] = {key: num(r[col]) for key, col in fields.items()}
    return out


def pct_rank(values):
    s = sorted(v for v in values if v is not None)
    return s


def main():
    gaz = gazetteer()
    app = app_gazetteer()
    gaz_ids = sorted(e['id'] for e in app)
    dist_of = {e['id']: str(e['district']) for e in app}
    cw = crosswalk(gaz, app)
    report = []

    # ---------- استطاعت مسکن ----------
    hdf = pd.read_excel(FILES['housing'], sheet_name='محلات')
    c = list(hdf.columns)
    hf = {
        'population1395': (c[3], 'sum'), 'households': (c[4], 'sum'), 'incomeRatio': (c[5], 'mean'), 'incomeAnnualMToman': (c[6], 'mean'),
        'priceM2MToman': (c[7], 'mean'), 'unitPriceMToman': (c[8], 'mean'), 'medianSaleAreaM2': (c[9], 'mean'),
        'pirResidents': (c[10], 'mean'), 'pirAvgTehranHH': (c[11], 'mean'), 'yearsSavingResidents': (c[12], 'mean'),
        'fullDepositM2MToman': (c[13], 'mean'), 'rentMonthlyUnitMToman': (c[14], 'mean'), 'rentShareResidentsPct': (c[15], 'mean'),
        'rentShareAvgTehranPct': (c[16], 'mean'), 'rentLevel': (c[17], 'first'), 'shareTehranHHCanRentPct': (c[18], 'mean'),
        'shareTehranHHPir5Pct': (c[19], 'mean'), 'loanCoveragePct': (c[20], 'mean'), 'downPaymentMToman': (c[21], 'mean'),
        'yearsDownPayment': (c[22], 'mean'), 'installmentShareResidentsPct': (c[23], 'mean'), 'compositeIndex': (c[24], 'mean'),
        'rankInCity': (c[25], 'first'), 'nSaleAds': (c[26], 'sum'), 'nRentAds': (c[27], 'sum'), 'rentSource': (c[28], 'first'), 'quality': (c[31], 'worst_grade'),
    }
    housing, rep = assign(hdf, cw, hf, c[3], 'housing'); report += rep
    hd = pd.read_excel(FILES['housing'], sheet_name='مناطق'); dc = list(hd.columns)
    housing_d = district_table(FILES['housing'], {'priceM2MToman': dc[7], 'incomeAnnualMToman': dc[8], 'pirResidents': dc[9], 'rentShareResidentsPct': dc[10], 'pirAvgTehranHH': dc[11], 'priceCoveragePct': dc[14], 'incomeRatioPerCapita': dc[4]})

    # ---------- اشتغال پایدار ----------
    jdf = pd.read_excel(FILES['employment'], sheet_name='محلات'); c = list(jdf.columns)
    jf = {
        'population1395': (c[3], 'sum'), 'population10plus': (c[4], 'sum'), 'compositeIndex': (c[5], 'mean'), 'band': (c[6], 'first'),
        'sustainableRatePct': (c[7], 'mean'), 'unemploymentPct': (c[8], 'mean'), 'employmentRatioPct': (c[9], 'mean'), 'participationPct': (c[10], 'mean'),
        'vulnerableSharePct': (c[11], 'mean'), 'publicSectorSharePct': (c[12], 'mean'), 'professionalSharePct': (c[13], 'mean'), 'elementarySharePct': (c[14], 'mean'),
        'employed': (c[15], 'sum'), 'unemployed': (c[16], 'sum'), 'sustainablyEmployed': (c[17], 'sum'), 'ciLow': (c[19], 'mean'), 'ciHigh': (c[20], 'mean'),
        'rankInCity': (c[21], 'first'), 'quality': (c[26], 'worst_grade'),
    }
    employment, rep = assign(jdf, cw, jf, c[3], 'employment'); report += rep
    jd = pd.read_excel(FILES['employment'], sheet_name='مناطق'); dc = list(jd.columns)
    employment_d = district_table(FILES['employment'], {'sustainableRatePct': dc[27], 'unemploymentPct': dc[12], 'unemploymentFemalePct': dc[14], 'participationPct': dc[15], 'employmentRatioPct': dc[16], 'femaleLabourSharePct': dc[17], 'vulnerableSharePct': dc[24], 'professionalSharePct': dc[25], 'elementarySharePct': dc[26]})

    # ---------- تحصیلات ----------
    ddf = pd.read_excel(FILES['education'], sheet_name='محلات'); c = list(ddf.columns)
    df_ = {
        'population1395': (c[3], 'sum'), 'universitySharePct': (c[4], 'mean'), 'ciLow': (c[5], 'mean'), 'ciHigh': (c[6], 'mean'), 'districtMeanPct': (c[7], 'mean'),
        'diffFromDistrictPts': (c[8], 'mean'), 'graduates': (c[9], 'sum'), 'menUniversityPct': (c[10], 'mean'), 'womenUniversityPct': (c[11], 'mean'),
        'literacy30to59Pct': (c[12], 'mean'), 'literacy60plusPct': (c[13], 'mean'), 'internetUsePct': (c[14], 'mean'), 'rankInCity': (c[15], 'first'),
        'band': (c[16], 'first'), 'trustWeight': (c[22], 'mean'), 'quality': (c[23], 'worst_grade'),
    }
    education, rep = assign(ddf, cw, df_, c[3], 'education'); report += rep
    ed = pd.read_excel(FILES['education'], sheet_name='مناطق'); dc = list(ed.columns)
    education_d = district_table(FILES['education'], {'universitySharePct': dc[3], 'menUniversityPct': dc[8], 'womenUniversityPct': dc[9], 'literacy30to59Pct': dc[10], 'literacy60plusPct': dc[11], 'internetUsePct': dc[12], 'modelErrorPts': dc[17]})

    # ---------- روشنایی v3 ----------
    L = pd.read_csv(RAW / 'tehran_street_lighting_v3.csv')
    lf = ['street_light_index', 'index_ci95_low', 'index_ci95_high', 'score_0_100', 'lighting_class', 'index_no_commerce_term', 'index_subunit_min', 'index_subunit_max',
          'dark_pocket_share_pct', 'index_y2023', 'index_y2024', 'index_y2025', 'index_change_2023_2025_points', 'index_leafoff', 'index_leafon', 'canopy_seasonal_loss_pct',
          'rad_obs_local_collector', 'obs_score_0_100', 'rad_obs_change_2023_2025_pct', 'dark_share_obs_pct', 'share_local_own_pct', 'share_local_neighbors_spill_pct',
          'share_arterial_pct', 'share_collector_pct', 'share_commerce_retail_fuel_pct', 'nights_valid', 'ci_halfwidth_points', 'year_sd_points', 'sensor_diff_points',
          'quality_grade', 'field_priority', 'boundary_note', 'road_km_local', 'n_subunits']
    lighting = {}
    for _, r in L.iterrows():
        lighting[r['neighborhood_id']] = {k: (txt(r[k]) if isinstance(r[k], str) else num(r[k])) for k in lf}
    ds = pd.read_csv(RAW / 'tehran_street_lighting_v3_dark_streets.csv')
    dark = {}
    for _, r in ds.sort_values('امتیاز ترکیبی (کم=تاریک‌تر)').iterrows():
        dark.setdefault(r['شناسهٔ محله'], []).append({
            'name': txt(r['نام معبر']), 'osmClass': txt(r['ردهٔ OSM']), 'lengthKm': num(r['طول (km)']), 'subunitIndex': num(r['شاخص مدل زیرواحد']),
            'radObs': num(r['تابش مشاهده‌ای']), 'diffFromNeighborhoodPct': num(r['اختلاف با میانهٔ محله (٪)']), 'darkScore': num(r['امتیاز ترکیبی (کم=تاریک‌تر)']),
            'lat': num(r['عرض']), 'lng': num(r['طول']), 'mapUrl': txt(r['پیوند نقشه'])})
    for k, v in dark.items():
        lighting.setdefault(k, {})['darkStreets'] = v
    val = pd.read_csv(RAW / 'tehran_street_lighting_v3_validation.csv')
    lighting_val = {str(r.iloc[0]): (num(r.iloc[1]) if num(r.iloc[1]) is not None else txt(r.iloc[1])) for _, r in val.iterrows()}

    # ---------- پوشش + مقدار منطقه برای چندضلعی‌های بی‌جفت ----------
    by_name = {}
    for e in app:
        by_name.setdefault((e['district'], nkey(e['name'])), []).append(e['id'])

    def fill(byid, dist_tab, key_fields):
        cov = {'neighborhood': 0, 'contained_inherited': 0, 'district_fallback': 0, 'missing': 0, 'quality_D_district_value': 0}
        # مرز تکمیلی که «تقریباً بر چندضلعی رسمی X منطبق/درون آن است» → مقدار X (همان پهنهٔ برآورد)
        for e in app:
            if e['id'] in byid or not e['note']:
                continue
            m = re.search(r'«([^»]+)»', e['note'])
            host = [h for h in by_name.get((e['district'], nkey(m.group(1))), []) if h in byid and byid[h].get('match') not in ('contained_inherited',)] if m else []
            if len(host) == 1:
                byid[e['id']] = {**byid[host[0]], 'match': 'contained_inherited', 'containedIn': host[0]}
                cov['contained_inherited'] += 1
        for gid in gaz_ids:
            rec = byid.get(gid)
            if rec:
                if rec.get('match') != 'contained_inherited':
                    cov['neighborhood' if rec['level'] == 'neighborhood' else 'quality_D_district_value'] += 1
                continue
            dv = dist_tab.get(dist_of[gid])
            if dv and any(dv.get(k) is not None for k in key_fields):
                byid[gid] = {**dv, 'level': 'district', 'match': 'district_fallback', 'quality': 'D', 'sourceNames': []}
                cov['district_fallback'] += 1
            else:
                cov['missing'] += 1
        return cov

    cov_h = fill(housing, housing_d, ['rentShareResidentsPct'])
    cov_j = fill(employment, employment_d, ['sustainableRatePct'])
    cov_e = fill(education, education_d, ['universitySharePct'])

    def dist(byid, key):
        return sorted(v[key] for v in byid.values() if v.get(key) is not None and v.get('level') == 'neighborhood')

    layers = {
        'version': 'tehran-layers-v1',
        'builtFrom': sorted(p.name for p in RAW.iterdir()),
        'officialPolygons': len(gaz_ids),
        'layers': {
            'lighting': {
                'title': 'روشنایی معابر محلی در شب (نسخهٔ ۳)', 'observedAt': '2025-12-31', 'periodStart': '2023-01-01', 'cadence': 'annual',
                'source': 'VIIRS DNB شبانه (Suomi-NPP + NOAA-20)، ۶۴۵ شب ۲۰۲۳–۲۰۲۵؛ مدل ریزمقیاس معابر OSM با اجماع ۶ مدل',
                'unit': 'شاخص (میانهٔ تهران = ۱۰۰)', 'validation': lighting_val,
                'limits': ['تفکیک ماهواره حدود ۵۰۰ تا ۷۵۰ متر است؛ تفاوت دو کوچهٔ مجاور دیده نمی‌شود.', 'تابش ماهواره‌ای (nW/cm²/sr) شدت روشنایی زمینی (لوکس) نیست؛ نیاز به ممیزی میدانی با لوکس‌متر.',
                           'در هسته‌های تجاری (بازار، مراکز خرید) سهم نور تجاری ممکن است شاخص را بالا ببرد؛ شاخص «بدون جملهٔ تجاری» کنار آن آمده است.', 'شاخص نزدیک صفر یعنی «از زمینه قابل تفکیک نیست»، نه لزوماً خاموشی کامل.'],
                'byId': lighting, 'distribution': {'street_light_index': sorted(v['street_light_index'] for v in lighting.values() if v.get('street_light_index') is not None)},
                'coverage': {'neighborhood': sum(1 for g in gaz_ids if g in lighting), 'missing': sum(1 for g in gaz_ids if g not in lighting)},
            },
            'housing': {
                'title': 'استطاعت مسکن ساکنان (مهر ۱۴۰۵)', 'observedAt': '2026-10-07', 'cadence': 'annual',
                'source': 'آگهی‌های فروش و اجارهٔ دیوار مهر ۱۴۰۵ (۳۱۱ محله) + درآمد خانوار شهری استان تهران (HEIS ۱۴۰۴، مرکز آمار) با ضریب درآمد نسبی مدل‌شده',
                'limits': ['قیمت‌ها درخواستی‌اند نه معامله‌شده.', 'درآمد ساکنان برآوردی است: ضریب درآمد ≈ قیمت^۱٫۰۳۵ × بُعد خانوار؛ بنابراین سهم اجاره از درآمد ساکنان بین محلات تفاوت کمی دارد و تفاوت اصلی در «استطاعت برای خانوار متوسط تهران» است.',
                           'محلات درجهٔ D دادهٔ قیمت ندارند و مقدار منطقه گرفته‌اند.'],
                'byId': housing, 'districts': housing_d, 'coverage': cov_h,
                'distribution': {'rentShareResidentsPct': dist(housing, 'rentShareResidentsPct'), 'shareTehranHHCanRentPct': dist(housing, 'shareTehranHHCanRentPct'), 'compositeIndex': dist(housing, 'compositeIndex')},
            },
            'employment': {
                'title': 'اشتغال پایدار ساکنان (برآورد کوچک‌ناحیه‌ای)', 'observedAt': '2016-09-22', 'cadence': 'census',
                'source': 'سرشماری ۱۳۹۵ (شاخص‌های نیروی کار ۲۲ منطقه) و ۱۳۸۵ (وضع و گروه شغلی) + قیمت مسکن دیوار مهر ۱۴۰۵ به‌عنوان متغیر کمکی؛ کالیبره با رقم رسمی هر منطقه',
                'definition': 'اشتغال پایدار = مزد و حقوق‌بگیران + کارفرمایان (تعریف ILO از اشتغال غیرآسیب‌پذیر)؛ نرخ = درصد نیروی کار با شغل غیرآسیب‌پذیر',
                'limits': ['ارقام محله برآوردی‌اند نه شمارش سرشماری.', 'بیکاری، مشارکت و سهم بخش عمومی درون هر منطقه یکسان فرض شده‌اند.', 'مزد و حقوق‌بگیر خصوصی لزوماً بیمه‌شده نیست.'],
                'byId': employment, 'districts': employment_d, 'coverage': cov_j,
                'distribution': {'sustainableRatePct': dist(employment, 'sustainableRatePct'), 'vulnerableSharePct': dist(employment, 'vulnerableSharePct'), 'compositeIndex': dist(employment, 'compositeIndex')},
            },
            'education': {
                'title': 'سطح تحصیلات ساکنان (نسخهٔ ۲؛ برآورد کوچک‌ناحیه‌ای)', 'observedAt': '2011-09-23', 'cadence': 'census',
                'source': 'سرشماری ۱۳۹۰ (۲۲ منطقه؛ صادقی و زنجری ۱۳۹۶) + قیمت مسکن دیوار مهر ۱۴۰۵ با انقباض بیزی تجربی؛ کالیبره با رقم رسمی هر منطقه',
                'definition': 'سهم دانش‌آموختگان دانشگاهی از کل جمعیت (٪) — با تعریف H1 (دیپلم+ از جمعیت ۲۵+) یکسان نیست؛ امتیاز آن نسبی (صدک بین محلات تهران) است',
                'limits': ['پایهٔ سرشماری ۱۳۹۰ است و سطح تحصیلات از آن زمان بالا رفته؛ برای مقایسهٔ نسبی محلات مناسب‌تر است.', 'شیب مدل از تفاوت میان مناطق برآورد شده (خطر خطای بوم‌شناختی).'],
                'byId': education, 'districts': education_d, 'coverage': cov_e,
                'distribution': {'universitySharePct': dist(education, 'universitySharePct'), 'literacy60plusPct': dist(education, 'literacy60plusPct')},
            },
        },
        'sharedCovariate': 'هر سه لایهٔ اقتصادی-اجتماعی تفاوت درون‌منطقه‌ای را از قیمت مسکن دیوار گرفته‌اند؛ هم‌جهتی آن‌ها شاهد مستقل به شمار نمی‌آید.',
    }
    (OUT / 'neighborhood_layers_v1.json').write_text(json.dumps(layers, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    with open(OUT / 'layers_match_report.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=['layer', 'district', 'source_name', 'targets', 'method'])
        w.writeheader(); w.writerows(report)
    print(json.dumps({'polygons': len(gaz_ids), 'housing': cov_h, 'employment': cov_j, 'education': cov_e, 'lighting': layers['layers']['lighting']['coverage'],
                      'unmatchedSource': sum(1 for r in report if r['method'] == 'unmatched') // 3}, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
