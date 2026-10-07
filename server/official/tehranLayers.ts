/**
 * لایه‌های محله‌ای تهران (data/official/tehran/neighborhood_layers_v1.json؛ ساخته‌شده با scripts/official/build_tehran_layers.py)
 *
 *   روشنایی معابر محلی v3 · استطاعت مسکن ساکنان · اشتغال پایدار · سطح تحصیلات
 *
 * سه مسیر استفاده، با مرز روشن:
 *  ۱) سنجه: H1، H3 و E4 به‌صورت «مقدار مستند» با ردهٔ open_model وارد ادغام شواهد می‌شوند (پیمایش/قرارداد محله بر آن‌ها مقدم‌اند).
 *     روشنایی شبانه «سنجهٔ تکمیلی» است و امتیاز هیچ‌یک از ۴۰ شاخص اصلی را نمی‌سازد (P3 ادراکی/ممیزی است).
 *  ۲) تشخیص: قواعد نسخه‌دار LR-v1 یافته‌های قابل‌آزمون می‌سازند و به فرضیه‌های علّی موتور (ناامنی، کیفیت، هزینه) «آزمون» می‌افزایند.
 *  ۳) تجویز: هر یافته به قلم کتابخانهٔ مداخلات نگاشت می‌شود، با هدف مکانی (معابر تاریک)، پیش‌نیاز راستی‌آزمایی و سنجهٔ پایش.
 * هیچ عددی ساخته نمی‌شود؛ نبود رکورد = نبود لایه.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../paths';
import type { DocumentedValue } from '../evidence/types';
import type { CapitalKey, ChainStage, FrictionType } from '../../src/algorithm/types';

export const LAYERS_FILE = path.join(PROJECT_ROOT, 'data', 'official', 'tehran', 'neighborhood_layers_v1.json');
export const LAYER_RULES_VERSION = 'LR-v1';

type Num = number | null;
type Grade = 'A' | 'B' | 'C' | 'D';
type Level = 'neighborhood' | 'district';
interface Common { level: Level; match: string; quality?: Grade | null; sourceNames?: string[]; containedIn?: string }
export interface LightingRec {
  street_light_index: Num; index_ci95_low: Num; index_ci95_high: Num; score_0_100: Num; lighting_class: string | null; index_no_commerce_term: Num;
  index_subunit_min: Num; index_subunit_max: Num; dark_pocket_share_pct: Num; index_y2023: Num; index_y2024: Num; index_y2025: Num; index_change_2023_2025_points: Num;
  index_leafoff: Num; index_leafon: Num; canopy_seasonal_loss_pct: Num; rad_obs_local_collector: Num; obs_score_0_100: Num; rad_obs_change_2023_2025_pct: Num;
  dark_share_obs_pct: Num; share_local_own_pct: Num; share_local_neighbors_spill_pct: Num; share_arterial_pct: Num; share_collector_pct: Num;
  share_commerce_retail_fuel_pct: Num; nights_valid: Num; ci_halfwidth_points: Num; year_sd_points: Num; sensor_diff_points: Num;
  quality_grade: 'A' | 'B' | 'C' | null; field_priority: string | null; boundary_note: string | null; road_km_local: Num; n_subunits: Num;
  darkStreets?: Array<{ name: string | null; osmClass: string | null; lengthKm: Num; subunitIndex: Num; radObs: Num; diffFromNeighborhoodPct: Num; darkScore: Num; lat: Num; lng: Num; mapUrl: string | null }>;
}
export interface HousingRec extends Common {
  population1395?: Num; households?: Num; incomeRatio?: Num; incomeAnnualMToman: Num; priceM2MToman: Num; unitPriceMToman?: Num; pirResidents: Num; pirAvgTehranHH: Num;
  yearsSavingResidents?: Num; rentMonthlyUnitMToman?: Num; rentShareResidentsPct: Num; rentShareAvgTehranPct?: Num; rentLevel?: string | null; shareTehranHHCanRentPct?: Num;
  shareTehranHHPir5Pct?: Num; loanCoveragePct?: Num; downPaymentMToman?: Num; yearsDownPayment?: Num; installmentShareResidentsPct?: Num; compositeIndex?: Num; rankInCity?: Num;
  nSaleAds?: Num; nRentAds?: Num; incomeRatioPerCapita?: Num;
}
export interface EmploymentRec extends Common {
  compositeIndex?: Num; band?: string | null; sustainableRatePct: Num; unemploymentPct: Num; employmentRatioPct: Num; participationPct: Num; vulnerableSharePct: Num;
  publicSectorSharePct?: Num; professionalSharePct: Num; elementarySharePct: Num; employed?: Num; unemployed?: Num; sustainablyEmployed?: Num; ciLow?: Num; ciHigh?: Num; rankInCity?: Num;
  unemploymentFemalePct?: Num; femaleLabourSharePct?: Num;
}
export interface EducationRec extends Common {
  universitySharePct: Num; ciLow?: Num; ciHigh?: Num; districtMeanPct?: Num; diffFromDistrictPts?: Num; graduates?: Num; menUniversityPct: Num; womenUniversityPct: Num;
  literacy30to59Pct: Num; literacy60plusPct: Num; internetUsePct: Num; rankInCity?: Num; band?: string | null; trustWeight?: Num; modelErrorPts?: Num;
}
interface LayerMeta<T> { title: string; observedAt: string; periodStart?: string; cadence: DocumentedValue['cadence']; source: string; unit?: string; definition?: string; limits: string[]; byId: Record<string, T>; distribution: Record<string, number[]>; coverage: Record<string, number>; validation?: Record<string, unknown> }
export interface LayersPack {
  version: string; builtFrom: string[]; officialPolygons: number; sharedCovariate: string;
  layers: { lighting: LayerMeta<LightingRec>; housing: LayerMeta<HousingRec>; employment: LayerMeta<EmploymentRec>; education: LayerMeta<EducationRec> };
}

let cache: LayersPack | null | undefined;
export function tehranLayers(): LayersPack | null {
  if (process.env.ARA_DISABLE_LOCAL_LAYERS === '1') return null;
  if (cache !== undefined) return cache;
  cache = fs.existsSync(LAYERS_FILE) ? JSON.parse(fs.readFileSync(LAYERS_FILE, 'utf8')) as LayersPack : null;
  return cache;
}
/** فقط برای آزمون */
export function _resetLayersCache() { cache = undefined; }

/** صدک (۰..۱۰۰) یک مقدار در توزیع مرتب؛ نیمی از مقادیر برابر شمرده می‌شود */
export function percentileIn(value: number, sorted: number[]): number | null {
  if (!sorted.length) return null;
  let below = 0, equal = 0;
  for (const x of sorted) { if (x < value) below++; else if (x === value) equal++; }
  return Math.round(((below + 0.5 * equal) / sorted.length) * 1000) / 10;
}

// ---------- ۱) سنجه: مقدار مستند برای H1 / H3 / E4 ----------
const ADEQ: Record<Grade, number> = { A: 1, B: 0.7, C: 0.4, D: 0.2 };
export const H1_LAYER_UNIT = '٪ دانش‌آموختهٔ دانشگاهی از کل جمعیت';

function levelNote(r: Common, what: string): string {
  if (r.match === 'district_fallback') return `این محله در فهرست ۳۴۹ محلهٔ ۱۳۹۵ جفت نداشت؛ مقدار رسمی منطقه به کار رفته (تفاوت درون‌منطقه‌ای دیده نمی‌شود)`;
  if (r.match === 'contained_inherited') return `مرز این محله درون/منطبق بر «${r.containedIn}» است؛ ${what} همان پهنه به کار رفته`;
  if (r.match === 'inherited_from_parent') return `محلهٔ ۱۳۹۵ «${r.sourceNames?.join('، ')}» به چند محلهٔ رسمی تقسیم شده؛ ${what} محلهٔ مادر به ارث رسیده`;
  if (r.match === 'merged_population_weighted') return `میانگین وزنی جمعیتی محلات ۱۳۹۵ «${r.sourceNames?.join('، ')}» که در این مرز ادغام شده‌اند`;
  if (r.quality === 'D') return 'درجهٔ کیفیت D: محله دادهٔ قیمت نداشت و مقدار منطقه گرفته است';
  return `تطبیق نام: ${r.match}`;
}
function geo(r: Common): DocumentedValue['geographyLevel'] { return r.level === 'district' || r.match === 'district_fallback' ? 'district' : 'neighborhood'; }
function adequacy(r: Common): number { return ADEQ[(r.quality ?? 'D') as Grade] ?? 0.2; }

export function layerValues(neighborhoodId: string, now = new Date()): DocumentedValue[] {
  const pack = tehranLayers();
  if (!pack) return [];
  const out: DocumentedValue[] = [];
  const fetchedAt = now.toISOString();
  const { housing, employment, education } = pack.layers;
  const h = housing.byId[neighborhoodId];
  if (h && h.rentShareResidentsPct !== null && h.rentShareResidentsPct !== undefined) {
    const g = geo(h);
    out.push({
      code: 'E4', raw: h.rentShareResidentsPct, unit: '%', source: `لایهٔ استطاعت مسکن تهران — ${housing.source}`, sourceIds: [`layer:${pack.version}:housing`],
      channel: 'open_auto', tier: 'open_model', geographyLevel: g, observedAt: housing.observedAt, fetchedAt, cadence: housing.cadence,
      method: `اجارهٔ ماهانهٔ معادل واحد ۷۵ مترمربعی (رهن کامل × ۳٪) ÷ درآمد ماهانهٔ برآوردی خانوار ساکن × ۱۰۰؛ ${levelNote(h, 'مقدار')}`,
      methodQuality: g === 'district' ? 0.5 : 0.7, sampleAdequacy: adequacy(h), lowerIsBetter: true,
      notes: [...housing.limits.slice(0, 2), pack.sharedCovariate],
      details: { layer: 'housing', quality: h.quality ?? 'D', match: h.match, pirResidents: h.pirResidents, pirAvgTehranHH: h.pirAvgTehranHH, shareTehranHHCanRentPct: h.shareTehranHHCanRentPct ?? null, compositeIndex: h.compositeIndex ?? null },
    });
  }
  const j = employment.byId[neighborhoodId];
  if (j && j.sustainableRatePct !== null && j.sustainableRatePct !== undefined) {
    const g = geo(j);
    out.push({
      code: 'H3', raw: j.sustainableRatePct, unit: '%', source: `لایهٔ اشتغال پایدار تهران — ${employment.source}`, sourceIds: [`layer:${pack.version}:employment`],
      channel: 'open_auto', tier: 'open_model', geographyLevel: g, observedAt: employment.observedAt, fetchedAt, cadence: employment.cadence,
      method: `${employment.definition}؛ برآورد کوچک‌ناحیه‌ای logit با قیمت مسکن (R²=۰٫۵۴، خطای حذف‌یک‌منطقه ≈ ۲ واحد درصد)${j.ciLow != null ? `؛ بازه [${j.ciLow}، ${j.ciHigh}]` : ''}؛ ${levelNote(j, 'مقدار')}`,
      methodQuality: g === 'district' ? 0.55 : 0.65, sampleAdequacy: adequacy(j),
      notes: [...employment.limits, pack.sharedCovariate],
      details: { layer: 'employment', quality: j.quality ?? 'D', match: j.match, vulnerableSharePct: j.vulnerableSharePct, unemploymentPct: j.unemploymentPct },
    });
  }
  const e = education.byId[neighborhoodId];
  if (e && e.universitySharePct !== null && e.universitySharePct !== undefined) {
    const g = geo(e);
    out.push({
      code: 'H1', raw: e.universitySharePct, unit: H1_LAYER_UNIT, source: `لایهٔ سطح تحصیلات تهران — ${education.source}`, sourceIds: [`layer:${pack.version}:education`],
      channel: 'open_auto', tier: 'open_model', geographyLevel: g, observedAt: education.observedAt, fetchedAt, cadence: education.cadence,
      method: `${education.definition}؛ logit با قیمت مسکن (R²=۰٫۸۱، خطای حذف‌یک‌منطقه ≈ ۳ واحد درصد)${e.ciLow != null ? `؛ بازه [${e.ciLow}، ${e.ciHigh}]` : ''}؛ ${levelNote(e, 'مقدار')}`,
      methodQuality: g === 'district' ? 0.55 : 0.7, sampleAdequacy: adequacy(e),
      notes: [...education.limits, pack.sharedCovariate],
      details: { layer: 'education', quality: e.quality ?? 'D', match: e.match, scoring: 'layer_percentile' },
    });
  }
  return out;
}

/** توزیع مرجع لایه برای امتیاز صدکی (فقط H1 با تعریف «دانشگاهی از کل جمعیت») */
export function layerDistribution(code: string, unit: string): { values: number[]; ref: string } | null {
  const pack = tehranLayers();
  if (!pack) return null;
  if (code === 'H1' && unit === H1_LAYER_UNIT) return { values: pack.layers.education.distribution.universitySharePct ?? [], ref: `${pack.version}:education` };
  return null;
}

// ---------- ۲) تشخیص و ۳) تجویز ----------
export type LayerKey = 'lighting' | 'housing' | 'employment' | 'education';
export interface LayerFinding {
  id: string; layer: LayerKey; severity: 'high' | 'medium' | 'low' | 'info'; title: string; evidence: string[];
  capital: CapitalKey; indicator?: string; friction?: FrictionType[]; confidence: 'high' | 'medium' | 'low'; corroboration?: string[];
}
export interface LayerPrescription {
  libraryId: string; name: string; owner: string; costBnRial: number | null; months: number | null; capital: CapitalKey; transition: [ChainStage, ChainStage];
  findingIds: string[]; rationale: string; steps: string[]; prerequisite?: string; kpi: string; spatialTargets?: Array<{ name: string; lengthKm: Num; lat: Num; lng: Num; mapUrl: string | null }>;
  alignedWithBottleneck?: boolean; priority: number;
}
export interface LayerMeasure { key: LayerKey; title: string; value: Num; unit: string; percentileInTehran: Num; band: string | null; quality: string | null; level: Level; observedAt: string; note?: string; extra: Array<{ label: string; value: string }> }
export interface HypothesisTest { frictionType: FrictionType; test: string; result: 'supports' | 'contradicts' | 'neutral'; detail: string }
export interface NeighborhoodLayersAssessment {
  version: string; rules: string; neighborhoodId: string; measures: LayerMeasure[]; findings: LayerFinding[]; prescriptions: LayerPrescription[];
  hypothesisTests: HypothesisTest[]; caveats: string[];
}
export interface AssessInput {
  surveyItemScores?: Record<string, number>; surveyN?: number; fieldItemMeans?: Record<string, number>; fieldPoints?: number;
  scores?: Record<string, number | null>; bottleneck?: { capital: CapitalKey; transition: [ChainStage, ChainStage] } | null;
}

interface LibItem { id: string; capital: CapitalKey; transition: string; name: string; owner: string; costBnRial: number; months: number; targets: string[]; evidence: string }
let lib: LibItem[] | null = null;
function library(): LibItem[] {
  if (lib) return lib;
  try { lib = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'kernel', 'registries', 'intervention_library_v1.json'), 'utf8')).items as LibItem[]; } catch { lib = []; }
  return lib;
}

const fa = (n: Num | undefined, d = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('fa-IR', { maximumFractionDigits: d }));
const CONF_BY_GRADE: Record<string, LayerFinding['confidence']> = { A: 'high', B: 'medium', C: 'low', D: 'low' };
const downgrade = (c: LayerFinding['confidence']): LayerFinding['confidence'] => (c === 'high' ? 'medium' : 'low');
const upgrade = (c: LayerFinding['confidence']): LayerFinding['confidence'] => (c === 'low' ? 'medium' : 'high');

export function assessLayers(neighborhoodId: string, input: AssessInput = {}): NeighborhoodLayersAssessment | null {
  const pack = tehranLayers();
  if (!pack) return null;
  const L = pack.layers.lighting.byId[neighborhoodId];
  const H = pack.layers.housing.byId[neighborhoodId];
  const J = pack.layers.employment.byId[neighborhoodId];
  const E = pack.layers.education.byId[neighborhoodId];
  if (!L && !H && !J && !E) return null;
  const measures: LayerMeasure[] = [];
  const findings: LayerFinding[] = [];
  const tests: HypothesisTest[] = [];
  const caveats: string[] = [];
  const dist = (k: LayerKey, f: string) => pack.layers[k].distribution[f] ?? [];

  // ── روشنایی ──
  if (L && L.street_light_index !== null) {
    measures.push({
      key: 'lighting', title: 'روشنایی شبانهٔ معابر محلی', value: L.street_light_index, unit: 'شاخص (میانهٔ تهران=۱۰۰)', percentileInTehran: L.score_0_100, band: L.lighting_class,
      quality: L.quality_grade, level: 'neighborhood', observedAt: pack.layers.lighting.observedAt,
      note: L.boundary_note ?? undefined,
      extra: [
        { label: 'بازهٔ عدم قطعیت ۹۵٪', value: `${fa(L.index_ci95_low, 0)} تا ${fa(L.index_ci95_high, 0)}` },
        { label: 'سهم معابر محلی در پهنه‌های تاریک', value: `${fa(L.dark_pocket_share_pct, 0)}٪` },
        { label: 'تغییر ۲۰۲۳ → ۲۰۲۵', value: `${fa(L.index_change_2023_2025_points, 0)} واحد` },
        { label: 'شاخص بدون نور تجاری', value: fa(L.index_no_commerce_term, 0) },
        { label: 'سهم نور تجاری/سوخت', value: `${fa(L.share_commerce_retail_fuel_pct, 0)}٪` },
        { label: 'افت فصل برگ (تاج درختان)', value: `${fa(L.canopy_seasonal_loss_pct, 0)}٪` },
        { label: 'تابش مشاهده‌ای معابر محلی/جمع‌کننده', value: `${fa(L.rad_obs_local_collector, 1)} nW/cm²/sr` },
        ...(L.field_priority ? [{ label: 'اولویت بازدید میدانی', value: L.field_priority }] : []),
      ],
    });
    let conf: LayerFinding['confidence'] = CONF_BY_GRADE[L.quality_grade ?? 'C'];
    const corr: string[] = [];
    const u2 = input.surveyItemScores?.U2;
    const nOk = (input.surveyN ?? 0) >= 30;
    const fl = input.fieldItemMeans?.lighting;
    const fieldOk = (input.fieldPoints ?? 0) >= 5;
    const lowSat = (L.score_0_100 ?? 50) <= 40;
    if (u2 !== undefined && nOk) {
      if (u2 <= 40 && lowSat) { conf = upgrade(conf); corr.push(`پیمایش: گویهٔ U2 «روشنایی معابر کافی است» = ${fa(u2, 0)} از ۱۰۰ (همسو)`); }
      else if (u2 >= 60 && lowSat) { conf = downgrade(conf); corr.push(`پیمایش: U2 = ${fa(u2, 0)} از ۱۰۰ (ناهمسو؛ ساکنان روشنایی را کافی می‌دانند)`); }
      else if (u2 <= 40 && !lowSat) corr.push(`پیمایش: U2 = ${fa(u2, 0)} از ۱۰۰ با وجود روشنایی ماهواره‌ای متوسط/بالا — احتمال کم‌نوری در مقیاس کوچه یا مسئلهٔ نگهداری`);
    }
    if (fl !== undefined && fieldOk) {
      if (fl <= 0.8 && lowSat) { conf = upgrade(conf); corr.push(`ممیزی میدانی: میانگین بند روشنایی ${fa(fl, 2)} از ۲ (همسو)`); }
      else if (fl >= 1.4 && lowSat) { conf = downgrade(conf); corr.push(`ممیزی میدانی: بند روشنایی ${fa(fl, 2)} از ۲ (ناهمسو)`); }
    }
    const sig = L.index_ci95_high !== null && L.index_ci95_high < 100;
    if ((L.score_0_100 ?? 100) <= 40) {
      findings.push({
        id: 'LGT-LOW', layer: 'lighting', severity: (L.score_0_100 ?? 100) <= 20 ? 'high' : 'medium', capital: 'P', friction: ['insecurity', 'quality'], confidence: sig ? conf : downgrade(conf), corroboration: corr,
        title: `کم‌نوری نسبی معابر محلی (${L.lighting_class}؛ صدک ${fa(L.score_0_100, 0)} در تهران)`,
        evidence: [`شاخص ${fa(L.street_light_index, 0)} (میانهٔ تهران ۱۰۰)، بازه ${fa(L.index_ci95_low, 0)}–${fa(L.index_ci95_high, 0)}${sig ? '؛ کل بازه زیر میانهٔ شهر است' : '؛ بازه میانهٔ شهر را دربر می‌گیرد (قطعیت کمتر)'}`, `درجهٔ کیفیت برآورد: ${L.quality_grade}`],
      });
    }
    if ((L.dark_pocket_share_pct ?? 0) >= 25) {
      findings.push({
        id: 'LGT-POCKET', layer: 'lighting', severity: (L.dark_pocket_share_pct ?? 0) >= 50 ? 'high' : 'medium', capital: 'P', friction: ['insecurity'], confidence: conf, corroboration: corr,
        title: `پهنه‌های تاریک درون محله (${fa(L.dark_pocket_share_pct, 0)}٪ معابر محلی)`,
        evidence: [`کم‌نورترین زیرواحد ${fa(L.index_subunit_min, 0)} و پرنورترین ${fa(L.index_subunit_max, 0)}`, `${fa(L.darkStreets?.length ?? 0, 0)} معبر کم‌نورتر از میانهٔ محله شناسایی شده`],
      });
    }
    const dropModel = L.index_change_2023_2025_points ?? 0;
    const dropObs = L.rad_obs_change_2023_2025_pct ?? 0;
    if (dropModel <= -20 && dropObs <= -15) {
      findings.push({
        id: 'LGT-DECLINE', layer: 'lighting', severity: 'medium', capital: 'P', friction: ['quality'], confidence: (L.year_sd_points ?? 99) < Math.abs(dropModel) ? conf : downgrade(conf),
        title: 'افت روشنایی از ۲۰۲۳ تا ۲۰۲۵', evidence: [`مدل: ${fa(dropModel, 0)} واحد؛ مشاهده: ${fa(dropObs, 0)}٪ (هر دو هم‌جهت)`, `انحراف معیار سال‌به‌سال ${fa(L.year_sd_points, 0)} واحد`],
      });
    }
    if ((L.canopy_seasonal_loss_pct ?? 0) >= 10) {
      findings.push({ id: 'LGT-CANOPY', layer: 'lighting', severity: 'low', capital: 'P', friction: ['quality'], confidence: 'medium', title: 'کم‌نوری فصلی زیر تاج درختان', evidence: [`افت ${fa(L.canopy_seasonal_loss_pct, 0)}٪ در فصل برگ نسبت به فصل بی‌برگ`] });
    }
    if ((L.share_commerce_retail_fuel_pct ?? 0) >= 30 && L.index_no_commerce_term !== null && L.street_light_index - L.index_no_commerce_term >= 25) {
      findings.push({ id: 'LGT-COMMERCE', layer: 'lighting', severity: 'info', capital: 'P', friction: ['insecurity', 'time'], confidence: 'medium', title: 'روشنایی محله وابسته به نور تجاری است', evidence: [`${fa(L.share_commerce_retail_fuel_pct, 0)}٪ تابش از کاربری تجاری/سوخت؛ بدون آن شاخص ${fa(L.index_no_commerce_term, 0)} است — پس از تعطیلی مغازه‌ها احتمال تاریکی`] });
    }
    // آزمون فرضیه‌ها
    const fs_ = findings.filter((f) => f.layer === 'lighting' && ['LGT-LOW', 'LGT-POCKET'].includes(f.id));
    if (fs_.length) tests.push({ frictionType: 'insecurity', test: 'روشنایی معابر', result: 'supports', detail: fs_.map((f) => f.title).join('؛ ') });
    else if ((L.score_0_100 ?? 0) >= 60 && (L.dark_pocket_share_pct ?? 100) < 10) tests.push({ frictionType: 'insecurity', test: 'روشنایی معابر', result: 'contradicts', detail: `روشنایی بالاتر از میانهٔ شهر (صدک ${fa(L.score_0_100, 0)}) و بدون پهنهٔ تاریک معنادار؛ اگر ناامنی گزارش شده، علت دیگری دارد` });
    else tests.push({ frictionType: 'insecurity', test: 'روشنایی معابر', result: 'neutral', detail: `روشنایی در حد میانه (صدک ${fa(L.score_0_100, 0)})` });
    if (findings.some((f) => f.id === 'LGT-DECLINE' || f.id === 'LGT-CANOPY')) tests.push({ frictionType: 'quality', test: 'نگهداری روشنایی', result: 'supports', detail: findings.filter((f) => f.id === 'LGT-DECLINE' || f.id === 'LGT-CANOPY').map((f) => f.title).join('؛ ') });
    if (L.quality_grade === 'C') caveats.push('برآورد روشنایی این محله درجهٔ C دارد؛ پیش از هر هزینه‌کرد، ممیزی میدانی لازم است.');
  }

  // ── استطاعت مسکن ──
  if (H && H.rentShareResidentsPct !== null) {
    const pctAff = percentileIn(H.rentShareResidentsPct, dist('housing', 'rentShareResidentsPct'));
    measures.push({
      key: 'housing', title: 'سهم اجاره از درآمد ساکنان (E4)', value: H.rentShareResidentsPct, unit: '٪', percentileInTehran: pctAff === null ? null : Math.round((100 - pctAff) * 10) / 10,
      band: H.rentLevel ?? null, quality: H.quality ?? 'D', level: geo(H) === 'district' ? 'district' : 'neighborhood', observedAt: pack.layers.housing.observedAt, note: levelNote(H, 'مقدار'),
      extra: [
        { label: 'نسبت قیمت به درآمد (PIR) ساکنان', value: fa(H.pirResidents, 1) },
        { label: 'PIR برای خانوار متوسط تهران', value: fa(H.pirAvgTehranHH, 1) },
        ...(H.shareTehranHHCanRentPct != null ? [{ label: 'سهم خانوارهای تهران قادر به اجاره (≤۳۰٪ درآمد)', value: `${fa(H.shareTehranHHCanRentPct, 1)}٪` }] : []),
        { label: 'قیمت میانهٔ هر مترمربع', value: `${fa(H.priceM2MToman, 0)} میلیون تومان` },
        { label: 'درآمد سالانهٔ برآوردی خانوار ساکن', value: `${fa(H.incomeAnnualMToman, 0)} میلیون تومان` },
        ...(H.yearsDownPayment != null ? [{ label: 'سال‌های پس‌انداز پیش‌پرداخت (پس از وام)', value: fa(H.yearsDownPayment, 1) }] : []),
        ...(H.compositeIndex != null ? [{ label: 'شاخص ترکیبی استطاعت (۰–۱۰۰)', value: fa(H.compositeIndex, 1) }] : []),
      ],
    });
    const conf = geo(H) === 'district' ? 'low' : CONF_BY_GRADE[H.quality ?? 'D'];
    if (H.rentShareResidentsPct >= 50 || (H.pirResidents ?? 0) >= 9) {
      // تقریباً همهٔ محلات تهران بالای آستانه‌اند؛ شدت «بالا» فقط وقتی بار از میانهٔ شهر هم بیشتر است
      findings.push({
        id: 'HSG-BURDEN', layer: 'housing', severity: H.rentShareResidentsPct >= 50 && (pctAff ?? 0) >= 50 ? 'high' : 'medium', capital: 'E', indicator: 'E4', friction: ['cost'], confidence: conf,
        title: `فشار شدید هزینهٔ مسکن بر ساکنان (اجاره ≈ ${fa(H.rentShareResidentsPct, 0)}٪ درآمد)`,
        evidence: [`آستانهٔ استطاعت ۳۰٪ درآمد است`, `PIR ساکنان ${fa(H.pirResidents, 1)} (بیش از ۹ = «بسیار شدید» در معیار Demographia)`, 'تقریباً همهٔ محلات تهران در این وضعیت‌اند؛ تمایز محله در ستون‌های بعدی است'],
      });
      tests.push({ frictionType: 'cost', test: 'استطاعت مسکن', result: 'supports', detail: `اجاره ≈ ${fa(H.rentShareResidentsPct, 0)}٪ درآمد ساکنان` });
    } else {
      tests.push({ frictionType: 'cost', test: 'استطاعت مسکن', result: H.rentShareResidentsPct <= 30 ? 'contradicts' : 'neutral', detail: `اجاره ≈ ${fa(H.rentShareResidentsPct, 0)}٪ درآمد ساکنان` });
    }
    if (H.shareTehranHHCanRentPct != null && H.shareTehranHHCanRentPct < 10) {
      findings.push({ id: 'HSG-EXCLUSION', layer: 'housing', severity: 'medium', capital: 'E', indicator: 'E4', friction: ['cost'], confidence: conf, title: 'بازار مسکن طردکننده برای خانوار متوسط تهران',
        evidence: [`فقط ${fa(H.shareTehranHHCanRentPct, 1)}٪ خانوارهای تهران توان اجارهٔ واحد ۷۵ متری این محله را با ≤۳۰٪ درآمد دارند`, `PIR خانوار متوسط تهران ${fa(H.pirAvgTehranHH, 1)}`] });
    }
    if ((H.incomeRatio ?? 1) < 0.8 && H.rentShareResidentsPct >= 50) {
      findings.push({ id: 'HSG-LOWINCOME', layer: 'housing', severity: 'high', capital: 'E', indicator: 'E4', friction: ['cost'], confidence: conf, title: 'ساکنان کم‌درآمد زیر فشار اجاره (خطر جابه‌جایی اجباری)',
        evidence: [`ضریب درآمد برآوردی ${fa(H.incomeRatio, 2)} میانگین شهر`, `اجاره ≈ ${fa(H.rentShareResidentsPct, 0)}٪ درآمد`] });
    }
  }

  // ── اشتغال پایدار ──
  if (J && J.sustainableRatePct !== null) {
    const p = percentileIn(J.sustainableRatePct, dist('employment', 'sustainableRatePct'));
    measures.push({
      key: 'employment', title: 'نرخ اشتغال پایدار (H3)', value: J.sustainableRatePct, unit: '٪ نیروی کار', percentileInTehran: p, band: J.band ?? null,
      quality: J.quality ?? 'D', level: geo(J) === 'district' ? 'district' : 'neighborhood', observedAt: pack.layers.employment.observedAt, note: levelNote(J, 'مقدار'),
      extra: [
        ...(J.ciLow != null ? [{ label: 'بازهٔ برآورد', value: `${fa(J.ciLow, 1)} تا ${fa(J.ciHigh, 1)}٪` }] : []),
        { label: 'نرخ بیکاری (سطح منطقه)', value: `${fa(J.unemploymentPct, 1)}٪` },
        { label: 'سهم اشتغال آسیب‌پذیر', value: `${fa(J.vulnerableSharePct, 1)}٪` },
        { label: 'سهم مشاغل تخصصی', value: `${fa(J.professionalSharePct, 1)}٪` },
        { label: 'سهم کارگران ساده', value: `${fa(J.elementarySharePct, 1)}٪` },
        { label: 'نسبت اشتغال به جمعیت ۱۰+', value: `${fa(J.employmentRatioPct, 1)}٪` },
      ],
    });
    const conf = geo(J) === 'district' ? 'low' : CONF_BY_GRADE[J.quality ?? 'D'];
    if (p !== null && p <= 40) {
      findings.push({ id: 'EMP-LOW', layer: 'employment', severity: p <= 20 ? 'high' : 'medium', capital: 'H', indicator: 'H3', confidence: conf,
        title: `اشتغال پایدار پایین‌تر از بیشتر محلات تهران (صدک ${fa(p, 0)})`, evidence: [`${fa(J.sustainableRatePct, 1)}٪ نیروی کار شغل غیرآسیب‌پذیر دارد`, `سهم کارگران ساده ${fa(J.elementarySharePct, 1)}٪`] });
    }
    const pv = J.vulnerableSharePct === null ? null : percentileIn(J.vulnerableSharePct, dist('employment', 'vulnerableSharePct'));
    if (pv !== null && pv >= 80 && geo(J) === 'neighborhood') {
      findings.push({ id: 'EMP-VULNERABLE', layer: 'employment', severity: 'medium', capital: 'E', indicator: 'H3', confidence: conf, title: 'سهم بالای اشتغال آسیب‌پذیر (خویش‌فرما/فامیلی بدون مزد)', evidence: [`${fa(J.vulnerableSharePct, 1)}٪ شاغلان؛ صدک ${fa(pv, 0)} در تهران`] });
    }
  }

  // ── تحصیلات ──
  if (E && E.universitySharePct !== null) {
    const p = percentileIn(E.universitySharePct, dist('education', 'universitySharePct'));
    // آستانه‌های سطح همان فایل منبع: ≥۳۰ بسیار بالا، ۲۰–۳۰ بالا، ۱۳–۲۰ متوسط، ۸–۱۳ پایین، <۸ بسیار پایین
    const band = E.band ?? (E.universitySharePct >= 30 ? 'بسیار بالا' : E.universitySharePct >= 20 ? 'بالا' : E.universitySharePct >= 13 ? 'متوسط' : E.universitySharePct >= 8 ? 'پایین' : 'بسیار پایین');
    measures.push({
      key: 'education', title: 'سهم دانش‌آموختگان دانشگاهی (H1، تعریف لایه)', value: E.universitySharePct, unit: '٪ کل جمعیت', percentileInTehran: p, band,
      quality: E.quality ?? 'D', level: geo(E) === 'district' ? 'district' : 'neighborhood', observedAt: pack.layers.education.observedAt, note: levelNote(E, 'مقدار'),
      extra: [
        ...(E.ciLow != null ? [{ label: 'بازهٔ برآورد', value: `${fa(E.ciLow, 1)} تا ${fa(E.ciHigh, 1)}٪` }] : []),
        { label: 'مردان / زنان دانشگاهی', value: `${fa(E.menUniversityPct, 1)}٪ / ${fa(E.womenUniversityPct, 1)}٪` },
        { label: 'باسوادی ۳۰–۵۹ سال', value: `${fa(E.literacy30to59Pct, 1)}٪` },
        { label: 'باسوادی ۶۰ سال و بالاتر', value: `${fa(E.literacy60plusPct, 1)}٪` },
        { label: 'استفاده از اینترنت', value: `${fa(E.internetUsePct, 1)}٪` },
      ],
    });
    const conf = geo(E) === 'district' ? 'low' : CONF_BY_GRADE[E.quality ?? 'D'];
    if (E.universitySharePct < 13) {
      findings.push({ id: 'EDU-LOW', layer: 'education', severity: E.universitySharePct < 8 ? 'high' : 'medium', capital: 'H', indicator: 'H1', friction: ['information'], confidence: conf,
        title: `سطح تحصیلات پایین (${band}؛ ${fa(E.universitySharePct, 1)}٪ دانشگاهی)`, evidence: [`صدک ${fa(p, 0)} در تهران`, 'پایهٔ سرشماری ۱۳۹۰؛ برای مقایسهٔ نسبی'] });
    }
    const pe = E.literacy60plusPct === null ? null : percentileIn(E.literacy60plusPct, dist('education', 'literacy60plusPct'));
    if (pe !== null && pe <= 20 && geo(E) === 'neighborhood') {
      findings.push({ id: 'EDU-ELDER', layer: 'education', severity: 'medium', capital: 'H', indicator: 'H5', friction: ['information'], confidence: conf, title: 'کم‌سوادی سالمندان', evidence: [`باسوادی ۶۰+ ساله ${fa(E.literacy60plusPct, 1)}٪؛ صدک ${fa(pe, 0)} در تهران`] });
    }
    if ((E.menUniversityPct ?? 0) - (E.womenUniversityPct ?? 0) >= 8) {
      findings.push({ id: 'EDU-GENDER', layer: 'education', severity: 'low', capital: 'H', indicator: 'H1', friction: ['norm'], confidence: 'low', title: 'شکاف جنسیتی تحصیلات دانشگاهی', evidence: [`مردان ${fa(E.menUniversityPct, 1)}٪ در برابر زنان ${fa(E.womenUniversityPct, 1)}٪`] });
    }
  }
  if (findings.some((f) => f.id === 'EDU-LOW') && findings.some((f) => f.id === 'EMP-LOW')) {
    findings.push({ id: 'HX-SKILLTRAP', layer: 'employment', severity: 'high', capital: 'H', indicator: 'H3', confidence: 'low', title: 'هم‌رخدادی تحصیلات پایین و اشتغال ناپایدار (تلهٔ مهارت–اشتغال)',
      evidence: ['هر دو لایه تفاوت درون‌منطقه را از قیمت مسکن گرفته‌اند؛ این هم‌رخدادی شاهد مستقل دوم نیست و باید با پیمایش خانوار (H2/H3/H4) آزموده شود'] });
  }
  if (H || J || E) caveats.push(pack.sharedCovariate);
  caveats.push('برآوردهای لایه ردهٔ «مدل باز» دارند؛ هر دادهٔ پیمایش یا قرارداد محله برای همان شاخص بر آن‌ها مقدم است.');

  const prescriptions = prescribe(findings, L, input.bottleneck ?? null);
  return { version: pack.version, rules: LAYER_RULES_VERSION, neighborhoodId, measures, findings, prescriptions, hypothesisTests: tests, caveats };
}

const SEV_W: Record<LayerFinding['severity'], number> = { high: 3, medium: 2, low: 1, info: 0 };
const CONF_W: Record<LayerFinding['confidence'], number> = { high: 1, medium: 0.75, low: 0.5 };

function prescribe(findings: LayerFinding[], L: LightingRec | undefined, bottleneck: AssessInput['bottleneck']): LayerPrescription[] {
  const items = library();
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: LayerPrescription[] = [];
  const has = (...ids: string[]) => findings.filter((f) => ids.includes(f.id));
  const add = (libraryId: string, fs_: LayerFinding[], rationale: string, steps: string[], kpi: string, extra: Partial<LayerPrescription> = {}) => {
    const it = byId.get(libraryId);
    if (!it || !fs_.length) return;
    const [a, b] = it.transition.split('>') as [ChainStage, ChainStage];
    const priority = Math.round(fs_.reduce((s, f) => s + SEV_W[f.severity] * CONF_W[f.confidence], 0) * 100) / 100;
    out.push({ libraryId, name: it.name, owner: it.owner, costBnRial: it.costBnRial ?? null, months: it.months ?? null, capital: it.capital, transition: [a, b], findingIds: fs_.map((f) => f.id), rationale, steps, kpi, priority,
      alignedWithBottleneck: bottleneck ? bottleneck.capital === it.capital && bottleneck.transition[0] === a && bottleneck.transition[1] === b : undefined, ...extra });
  };
  const lightF = has('LGT-LOW', 'LGT-POCKET', 'LGT-DECLINE', 'LGT-CANOPY', 'LGT-COMMERCE');
  if (lightF.length) {
    const streets = (L?.darkStreets ?? []).slice(0, 6).map((s) => ({ name: s.name ?? 'معبر بی‌نام', lengthKm: s.lengthKm, lat: s.lat, lng: s.lng, mapUrl: s.mapUrl }));
    const steps = [
      `ممیزی شبانهٔ میدانی با لوکس‌متر روی ${streets.length ? `${streets.length.toLocaleString('fa-IR')} معبر فهرست‌شده` : 'معابر محلی'} (فرم ممیزی، بند «روشنایی»)؛ هدف: ≥ ۵ لوکس متوسط در معابر محلی`,
      'تفکیک علت: چراغ خاموش/خراب (نگهداری) ← تعمیر فوری با شرکت توزیع برق؛ فاصلهٔ زیاد تیرها (کمبود) ← طراحی تکمیلی؛ سایهٔ تاج درخت ← هرس یا چراغ زیرتاج',
      ...(findings.some((f) => f.id === 'LGT-COMMERCE') ? ['هماهنگی با اصناف برای روشنایی ویترین پس از تعطیلی یا روشنایی عمومی جایگزین'] : []),
      'پس از اجرا: پایش با ترکیب ماهانهٔ VIIRS (سری شهر/محله) و تکرار گویهٔ U2 پیمایش',
    ];
    add('P-UE-2', lightF, 'شاخص ماهواره‌ای و پهنه‌های تاریک، کم‌نوری نسبی را نشان می‌دهند؛ چون تابش ماهواره لوکس نیست، اجرا مشروط به راستی‌آزمایی میدانی است.', steps,
      'شاخص روشنایی معابر محلی (هدف: رسیدن به میانهٔ تهران = ۱۰۰ یا +۲۰ واحد) و گویهٔ U2 ≥ ۶۰', { spatialTargets: streets, prerequisite: L?.quality_grade === 'C' ? 'درجهٔ برآورد C — ممیزی میدانی الزامی است' : 'ممیزی میدانی پیش از تخصیص بودجه' });
    if (has('LGT-LOW', 'LGT-POCKET').length) add('P-UE-1', has('LGT-LOW', 'LGT-POCKET'), 'روشنایی بخشی از کیفیت تجربهٔ فضای عمومی است (CPTED)؛ با نیمکت و سایه در فضاهای عمومی کم‌نور همراه شود.',
      ['انتخاب فضاهای عمومی و مسیرهای پیادهٔ واقع در پهنه‌های تاریک', 'طراحی با مشارکت ساکنان (به‌ویژه زنان و سالمندان) برای مسیرهای شبانه'], 'گویه‌های U2 و S1 پیمایش؛ حضور شبانه در ممیزی');
  }
  const hs = has('HSG-BURDEN', 'HSG-EXCLUSION', 'HSG-LOWINCOME');
  if (hs.length) {
    const low = findings.some((f) => f.id === 'HSG-LOWINCOME');
    const excl = findings.some((f) => f.id === 'HSG-EXCLUSION');
    add('E-EO-1', hs, low ? 'ساکنان کم‌درآمد زیر فشار اجاره‌اند؛ اولویت با ماندگاری ساکنان فعلی است.' : excl ? 'بازار محله برای خانوار متوسط تهران طردکننده است؛ اولویت با سهمیهٔ مسکن استطاعت‌پذیر در نوسازی‌هاست.' : 'هزینهٔ مسکن از آستانهٔ استطاعت بالاتر است.',
      low ? ['شناسایی مستأجران کم‌درآمد با پیمایش خانوار (ماژول مسکن و درآمد، E4)', 'کمک‌ودیعه/کمک‌اجارهٔ هدفمند و مشاوره حقوقی تمدید قرارداد', 'نوسازی بافت با حق ماندگاری ساکنان']
        : excl ? ['سهمیهٔ اجبار/تشویق مسکن استطاعت‌پذیر در پروانه‌های نوسازی محله', 'مسکن اجاره‌ای بلندمدت برای کارکنان خدمات محلی'] : ['پایش E4 با پیمایش خانوار و حمایت هدفمند'],
      'E4 پیمایش خانوار (سهم هزینهٔ مسکن از درآمد) — هدف کاهش به زیر ۵۰٪ و سپس ۳۰٪', { prerequisite: 'سنجش مستقیم E4 با پیمایش خانوار محله پیش از تخصیص منابع' });
    if (low) add('E-AU-1', has('HSG-LOWINCOME'), 'افزایش تاب‌آوری مالی خانوارهای کم‌درآمد', ['صندوق خرد محله برای ودیعه و هزینه‌های اضطراری'], 'E1 پیمایش خانوار');
  }
  const emp = has('EMP-LOW', 'HX-SKILLTRAP');
  if (emp.length) add('H-AU-1', emp, 'اشتغال پایدار پایین است؛ تطبیق مهارت–شغل و اتصال به مشاغل مزدبگیری رسمی.', ['میز کاریابی در سرای محله با پیوند به سامانهٔ کاریابی و تأمین اجتماعی', 'اولویت جوانان و زنان سرپرست خانوار'], 'H3 (پیمایش خانوار: شاغلان دارای بیمه ÷ جمعیت فعال)');
  const vul = has('EMP-VULNERABLE');
  if (vul.length) add('E-CA-1', vul, 'سهم بالای کار خویش‌فرما/فامیلی؛ رسمی‌سازی و بیمه کسب‌وکارهای خرد.', ['تسهیل پروانهٔ کسب خرد و بیمهٔ خویش‌فرمایان', 'فضای کار اشتراکی محله'], 'سهم شاغلان بیمه‌دار و ماندگاری کسب‌وکار (E3)');
  const edu = has('EDU-LOW', 'EDU-ELDER', 'EDU-GENDER', 'HX-SKILLTRAP');
  if (edu.length) {
    add('H-CA-2', edu, 'سطح تحصیلات/سواد پایین‌تر از بیشتر محلات تهران.', [
      ...(findings.some((f) => f.id === 'EDU-ELDER') ? ['کلاس سوادآموزی و سواد دیجیتال سالمندان در سرای محله'] : []),
      'کلاس جبرانی و مشاورهٔ تحصیلی نوجوانان (پیشگیری از ترک تحصیل)',
      ...(findings.some((f) => f.id === 'EDU-GENDER') ? ['برنامهٔ ویژهٔ زنان (آموزش از راه دور، مهدکودک همزمان)'] : []),
    ], 'H1 و H5 پیمایش خانوار؛ نرخ ماندگاری تحصیلی');
    if (has('EDU-LOW', 'HX-SKILLTRAP').length) add('H-CA-1', has('EDU-LOW', 'HX-SKILLTRAP'), 'پیوند آموزش مهارتی کوتاه‌مدت با بازار کار محلی.', ['دوره‌های فنی‌وحرفه‌ای با گواهی معتبر نزدیک محله'], 'H2 (مهارت قابل عرضه) و H3');
  }
  return out.sort((a, b) => Number(b.alignedWithBottleneck ?? false) - Number(a.alignedWithBottleneck ?? false) || b.priority - a.priority);
}
