/**
 * بستهٔ دادهٔ رسمی تهران (data/official/tehran) — ساخته‌شده با scripts/official/build_tehran_pack.py
 *
 * دو نوع استفاده، با مرز روشن:
 *  ۱) «بستهٔ قراردادی» (pop_neighborhood_1395.csv): از همان چرخهٔ ورود داده عبور می‌کند
 *     (stage → PENDING_REVIEW → تأیید admin) و پس از تأیید جمعیت رسمی محله می‌شود.
 *  ۲) «بافت مرجع» (district_reference.json): جمعیت مناطق، قیمت مسکن بانک مرکزی، اجاره/قیمت شهر، CPI استان و
 *     ارقام کلان. این‌ها مستقیم امتیاز هیچ شاخصی نمی‌شوند؛ برای وزن‌دهی جایگزین، معیار درآمد/استطاعت، کنترل
 *     کیفیت پاسخ‌ها و نمایش بافت منطقه به کار می‌روند و همیشه با برچسب «سطح منطقه/استان» نشان داده می‌شوند.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../paths';
import { getNeighborhood } from '../neighborhood/gazetteer';
import { jalaliMonth } from './jalali';

export const OFFICIAL_DIR = path.join(PROJECT_ROOT, 'data', 'official', 'tehran');
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

interface PopRec { pop: number; male: number; female: number; households: number; areaHa: number; source: string; kind: string }
interface MonthPrice { period: string; priceMRialPerM2: number; transactions: number }
interface MacroItem { key: string; value: number; unit: string; period: string; geo: string; source: string; file: string }
export interface TehranReference {
  version: string;
  districts: Record<string, { population: Record<string, PopRec>; housing: { monthly: MonthPrice[]; latest: MonthPrice & { source: string } }; neighborhoodPop1395: { matched: number; sum: number } }>;
  city: {
    population: Record<string, PopRec>;
    housing: { monthly: MonthPrice[]; latest: MonthPrice & { source: string } };
    housingAnnual: { source: string; rows: Array<{ period: string; priceKRialPerM2: number; rentRialPerM2Month: number }> };
  };
  cpiTehranUrban: { base: string; source: string; monthly: Record<string, number> };
  macro: Record<string, MacroItem>;
  sources: Record<string, string>;
}

let cache: TehranReference | null | undefined;
export function tehranReference(): TehranReference | null {
  if (cache !== undefined) return cache;
  const f = path.join(OFFICIAL_DIR, 'district_reference.json');
  cache = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) as TehranReference : null;
  return cache;
}

/** شمارهٔ منطقهٔ شهرداری تهران برای یک محله (از districtFa گزتیر) */
export function tehranDistrictOf(neighborhoodId: string): number | null {
  const e = getNeighborhood(neighborhoodId);
  if (!e || e.citySlug !== 'tehran') return null;
  const m = /منطقه\s*([0-9۰-۹]{1,2})/.exec(e.districtFa ?? '');
  if (!m) return null;
  return Number(m[1].replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))));
}

// ---------- شاخص قیمت مصرف‌کننده (CPI) استان تهران ----------
export function cpiAt(month: string): { value: number; month: string; extrapolated: boolean } | null {
  const ref = tehranReference();
  if (!ref) return null;
  const m = ref.cpiTehranUrban.monthly;
  if (m[month] !== undefined) return { value: m[month], month, extrapolated: false };
  const keys = Object.keys(m).sort();
  if (!keys.length) return null;
  const last = keys[keys.length - 1];
  const first = keys[0];
  const use = month > last ? last : month < first ? first : keys.filter((k) => k <= month).pop()!;
  return { value: m[use], month: use, extrapolated: true };
}
export function cpiYearAverage(jy: number): number | null {
  const ref = tehranReference();
  if (!ref) return null;
  const vals = Object.entries(ref.cpiTehranUrban.monthly).filter(([k]) => k.startsWith(`${jy}-`)).map(([, v]) => v);
  return vals.length === 12 ? vals.reduce((a, b) => a + b, 0) / 12 : null;
}

/**
 * معیار درآمد: متوسط درآمد ماهانهٔ خانوار شهری استان تهران (HEIS ۱۴۰۴، مرکز آمار) به میلیون تومان،
 * تعدیل‌شده با CPI استان از سطح متوسط ۱۴۰۴ به ماه هدف. میانگین است، نه میانه.
 */
export function incomeBenchmark(atIso: string | Date = new Date()): { monthlyMToman: number; month: string; cpiMonth: string; extrapolated: boolean; basis: string } | null {
  const ref = tehranReference();
  const item = ref?.macro.heis_1404_urban_income_tehran_province;
  const avg1404 = cpiYearAverage(1404);
  if (!ref || !item || !avg1404) return null;
  const month = jalaliMonth(atIso);
  const cpi = cpiAt(month);
  if (!cpi) return null;
  const monthlyKRial = item.value / 12;
  const monthlyMToman = (monthlyKRial / 10_000) * (cpi.value / avg1404); // ۱ میلیون تومان = ۱۰٬۰۰۰ هزار ریال
  return {
    monthlyMToman: Math.round(monthlyMToman * 10) / 10, month, cpiMonth: cpi.month, extrapolated: cpi.extrapolated,
    basis: `${item.source}؛ متوسط ${item.geo} (${Math.round(item.value).toLocaleString('fa-IR')} هزار ریال در سال)، تعدیل با CPI استان تهران تا ${cpi.month}${cpi.extrapolated ? ' (آخرین ماه موجود)' : ''}`,
  };
}

// ---------- بافت منطقه ----------
export interface DistrictProfile {
  district: number; level: 'district';
  population: { census1395: PopRec | null; latestEstimate: (PopRec & { year: string }) | null; densityPerKm2: number | null; maleShare: number | null; householdSize: number | null };
  housing: {
    latest: { period: string; priceMRialPerM2: number; transactions: number; rank: number; ofDistricts: number; ratioToCity: number; source: string } | null;
    trend: { from: string; to: string; changePct: number } | null;
    monthlyTail: MonthPrice[];
    priceToIncomeYears: { value: number; unitM2: number; basis: string } | null;
    marketRentBurdenRef: { value: number; unitM2: number; period: string; basis: string } | null;
  };
  neighborhoodPopCoverage: { matched: number; sum: number; shareOfDistrict1395: number | null };
  macro: MacroItem[];
  notes: string[];
}

const UNIT_M2 = 75;

export function districtProfile(district: number): DistrictProfile | null {
  const ref = tehranReference();
  const d = ref?.districts[String(district)];
  if (!ref || !d) return null;
  const census = d.population['1395'] ?? null;
  const estYears = Object.keys(d.population).filter((y) => d.population[y].kind !== 'سرشماری').sort();
  const ly = estYears[estYears.length - 1];
  const latestEstimate = ly ? { ...d.population[ly], year: ly } : null;
  const basePop = latestEstimate ?? census;
  const all = Object.entries(ref.districts).map(([k, v]) => ({ k, p: v.housing.latest.priceMRialPerM2 })).sort((a, b) => b.p - a.p);
  const rank = all.findIndex((x) => x.k === String(district)) + 1;
  const cityLatest = ref.city.housing.latest;
  const latest = d.housing.latest ? { period: d.housing.latest.period, priceMRialPerM2: d.housing.latest.priceMRialPerM2, transactions: d.housing.latest.transactions, rank, ofDistricts: all.length, ratioToCity: Math.round((d.housing.latest.priceMRialPerM2 / cityLatest.priceMRialPerM2) * 100) / 100, source: d.housing.latest.source } : null;
  const monthly = d.housing.monthly;
  const tail = monthly.slice(-12);
  const trend = tail.length >= 2 ? { from: tail[0].period, to: tail[tail.length - 1].period, changePct: Math.round(((tail[tail.length - 1].priceMRialPerM2 / tail[0].priceMRialPerM2) - 1) * 1000) / 10 } : null;

  // سال‌های درآمد برای خرید ۷۵ مترمربع: قیمت مرداد ۱۴۰۳ ÷ درآمد سالانهٔ استان (۱۴۰۴) تعدیل‌شده به همان ماه با CPI
  let priceToIncomeYears: DistrictProfile['housing']['priceToIncomeYears'] = null;
  const inc = ref.macro.heis_1404_urban_income_tehran_province;
  const avg1404 = cpiYearAverage(1404);
  if (latest && inc && avg1404) {
    const cpi = cpiAt(latest.period);
    if (cpi) {
      const annualMRial = (inc.value / 1000) * (cpi.value / avg1404);
      priceToIncomeYears = {
        value: Math.round(((latest.priceMRialPerM2 * UNIT_M2) / annualMRial) * 10) / 10, unitM2: UNIT_M2,
        basis: `قیمت هر مترمربع منطقه (${latest.period}، بانک مرکزی) × ${UNIT_M2} ÷ متوسط درآمد سالانهٔ خانوار شهری استان تهران (HEIS ۱۴۰۴) تعدیل‌شده با CPI به ${cpi.month}`,
      };
    }
  }
  // برآورد مرجع بار اجاره (مدل‌شده؛ فقط برای مقایسه با E4 پیمایش، نه امتیاز):
  // اجارهٔ هر مترمربع شهر ۱۴۰۰ (مرکز آمار، اجاره + ۳٪ ودیعه) × نسبت قیمت منطقه به شهر در ۱۴۰۰ (بانک مرکزی) × ۷۵ × ۱۲
  // ÷ درآمد سالانهٔ استان (HEIS ۱۴۰۴) برگردانده‌شده به سطح قیمت ۱۴۰۰ با CPI
  let marketRentBurdenRef: DistrictProfile['housing']['marketRentBurdenRef'] = null;
  const rent1400 = ref.city.housingAnnual.rows.find((r) => r.period === '1400');
  const avg1400 = cpiYearAverage(1400);
  const d1400 = monthly.filter((m) => m.period.startsWith('1400-'));
  const c1400 = ref.city.housing.monthly.filter((m) => m.period.startsWith('1400-'));
  if (rent1400 && inc && avg1404 && avg1400 && d1400.length >= 6 && c1400.length >= 6) {
    const rel = (d1400.reduce((a, m) => a + m.priceMRialPerM2, 0) / d1400.length) / (c1400.reduce((a, m) => a + m.priceMRialPerM2, 0) / c1400.length);
    const annualRentRial = rent1400.rentRialPerM2Month * rel * UNIT_M2 * 12;
    const income1400Rial = inc.value * 1000 * (avg1400 / avg1404);
    marketRentBurdenRef = {
      value: Math.round((annualRentRial / income1400Rial) * 1000) / 10, unitM2: UNIT_M2, period: '1400',
      basis: `برآورد مدل‌شده: اجارهٔ هر مترمربع شهر تهران ۱۴۰۰ (${rent1400.rentRialPerM2Month.toLocaleString('fa-IR')} ریال، اجاره + ۳٪ ودیعه) × نسبت قیمت منطقه به شهر در ۱۴۰۰ (${rel.toFixed(2)}) × ${UNIT_M2} مترمربع ÷ درآمد خانوار شهری استان؛ فقط برای مقایسه`,
    };
  }
  const cov = d.neighborhoodPop1395;
  const notes = [
    'همهٔ ارقام این بخش در سطح منطقهٔ شهرداری یا استان‌اند و تفاوت درون‌منطقه‌ای را نشان نمی‌دهند.',
    'این ارقام مستقیماً امتیاز شاخص نمی‌شوند؛ برای وزن‌دهی جایگزین، معیار درآمد و کنترل کیفیت پاسخ‌ها به کار می‌روند.',
  ];
  return {
    district, level: 'district',
    population: {
      census1395: census, latestEstimate,
      densityPerKm2: basePop && basePop.areaHa > 0 ? Math.round(basePop.pop / (basePop.areaHa / 100)) : null,
      maleShare: census ? Math.round((census.male / census.pop) * 1000) / 10 : null,
      householdSize: census && census.households > 0 ? Math.round((census.pop / census.households) * 100) / 100 : null,
    },
    housing: { latest, trend, monthlyTail: tail, priceToIncomeYears, marketRentBurdenRef },
    neighborhoodPopCoverage: { matched: cov.matched, sum: cov.sum, shareOfDistrict1395: census ? Math.round((cov.sum / census.pop) * 1000) / 10 : null },
    macro: ['heis_1404_urban_income_tehran_province', 'housing_cost_share_tehran_province_1403', 'unemployment_tehran_province_1404', 'rent_index_yoy_tehran_1403_05', 'private_construction_cost_m2_tehran_province_1404', 'construction_input_index_tehran_spring_1405']
      .map((k) => ref.macro[k]).filter(Boolean),
    notes,
  };
}

/** سهم جنسیتی منطقه (سرشماری ۱۳۹۵) برای وزن‌دهی جایگزین وقتی جمعیت جنسی محله در دست نیست */
export function districtSexTargets(neighborhoodId: string): { male: number; female: number; source: string } | null {
  const n = tehranDistrictOf(neighborhoodId);
  const rec = n ? tehranReference()?.districts[String(n)]?.population['1395'] : null;
  return rec ? { male: rec.male, female: rec.female, source: `سرشماری ۱۳۹۵ منطقهٔ ${n.toLocaleString('fa-IR')} (مرکز آمار ایران)` } : null;
}

/** جمعیت منطقه برای کنترل هم‌خوانی جمعیت محلات (مجموع محلات نباید از منطقه بسیار بیشتر شود) */
export function districtPopulation(district: number, year = '1395'): number | null {
  return tehranReference()?.districts[String(district)]?.population[year]?.pop ?? null;
}

// ---------- بسته‌های قراردادی آماده ----------
export interface OfficialPack { id: string; file: string; title: string; indicator: string; rows: number; period: string; source: string; level: 'neighborhood' }
export const OFFICIAL_PACKS: Array<Omit<OfficialPack, 'rows'>> = [
  { id: 'tehran-pop-1395', file: 'pop_neighborhood_1395.csv', title: 'جمعیت محلات تهران (حدود سرشماری ۱۳۹۵)', indicator: 'POP', period: '2016-09-22', source: 'شهرداری تهران — data.tehran.ir', level: 'neighborhood' },
];
export function listOfficialPacks(): Array<OfficialPack & { sha256: string }> {
  return OFFICIAL_PACKS.flatMap((p) => {
    const f = path.join(OFFICIAL_DIR, p.file);
    if (!fs.existsSync(f)) return [];
    const text = fs.readFileSync(f, 'utf8');
    return [{ ...p, rows: Math.max(0, text.trim().split(/\r?\n/).length - 1), sha256: sha(text) }];
  });
}
export function readOfficialPack(id: string): { pack: Omit<OfficialPack, 'rows'>; text: string } | null {
  const pack = OFFICIAL_PACKS.find((p) => p.id === id);
  if (!pack) return null;
  const f = path.join(OFFICIAL_DIR, pack.file);
  return fs.existsSync(f) ? { pack, text: fs.readFileSync(f, 'utf8') } : null;
}
function sha(text: string) { return crypto.createHash('sha256').update(text).digest('hex'); }
