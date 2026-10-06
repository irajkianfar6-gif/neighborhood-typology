/** تبدیل کانال‌های غیرخودکار (قرارداد، پیمایش، ممیزی) به مقدار مستند */
import { approvedValuesFor, type ApprovedValue } from '../ingestion/contractData';
import { summarizeSurvey, type RakingTargets, type SurveyOptions, type SurveySummary, TARGET_N } from '../survey/perceptualSurvey';
import { districtSexTargets, incomeBenchmark, tehranDistrictOf } from '../official/tehranReference';
import { ECONOMIC_INDICATORS } from '../../src/algorithm/surveyInstrument';
import { summarizeAudits, type FieldAuditSummary } from '../survey/fieldAudit';
import { summarizeRegister, type RegisterSummary } from '../survey/localRegister';
import type { DocumentedValue } from '../evidence/types';
import type { NeighborhoodContext } from './context';

const CENSUS_CODES = new Set(['H1', 'H5', 'E1', 'E4', 'P1']);
const LOWER_BETTER = new Set(['E4', 'N4', 'R1', 'R3']); // R2/R5/N5 بالاتر بهتر

export function contractValues(neighborhoodId: string, asOf?: string): { values: DocumentedValue[]; groupValues: Record<string, Record<string, number>>; groupNs: Record<string, number>; raw: ApprovedValue[] } {
  const raw = approvedValuesFor(neighborhoodId, asOf);
  const values: DocumentedValue[] = [];
  const groupValues: Record<string, Record<string, number>> = {};
  const groupNs: Record<string, number> = {};
  for (const r of raw) {
    if (r.indicator_code.startsWith('POP') || r.indicator_code === 'HOUSEHOLDS') continue;
    if (r.group_key) {
      const label = `${r.group_key}:${r.group_value}`;
      (groupValues[r.indicator_code] ??= {})[label] = r.value;
      if (r.denominator) groupNs[label] = Math.max(groupNs[label] ?? 0, r.denominator);
      continue;
    }
    values.push({
      code: r.indicator_code, raw: r.value, unit: r.unit ?? '%', numerator: r.numerator, denominator: r.denominator,
      source: `${r.source_org}${r.dataset_id ? ` / ${r.dataset_id}` : ''}`, sourceIds: [`contract:${r.batchId}`],
      channel: 'contract', tier: 'official', geographyLevel: r.geography_level === 'district' ? 'district' : 'neighborhood',
      observedAt: r.period_end.length === 7 ? `${r.period_end}-28` : r.period_end, fetchedAt: r.approvedAt,
      method: r.geography_level === 'district'
        ? `دادهٔ رسمی تأییدشده در سطح منطقهٔ ${r.district} (یک عدد برای همهٔ محلات منطقه؛ تفاوت درون‌منطقه‌ای دیده نمی‌شود)`
        : 'دادهٔ قراردادی تأییدشده (صورت/مخرج تجمیع‌شده روی مرز محله)',
      methodQuality: r.geography_level === 'district' ? 0.7 : 1, sampleAdequacy: 1,
      cadence: CENSUS_CODES.has(r.indicator_code) ? 'census' : 'annual', lowerIsBetter: LOWER_BETTER.has(r.indicator_code),
      details: { batchId: r.batchId, ...(r.district ? { district: r.district } : {}) },
    });
  }
  return { values, groupValues, groupNs, raw };
}

export function rakingTargetsFrom(ctx: NeighborhoodContext): RakingTargets {
  const t: RakingTargets = {};
  if (ctx.structure.male && ctx.structure.female) t.sex = { male: ctx.structure.male, female: ctx.structure.female };
  if (ctx.structure.ageBands) t.ageBand = ctx.structure.ageBands;
  // جایگزین: ترکیب جنسی منطقهٔ شهرداری از سرشماری ۱۳۹۵ (فقط نسبت به کار می‌رود، نه شمار)
  if (!t.sex) {
    const d = districtSexTargets(ctx.neighborhoodId);
    if (d) {
      t.sex = { male: d.male, female: d.female };
      t.note = t.ageBand ? `وزن‌دهی سن از جمعیت قراردادی محله و جنس از ${d.source} (سطح منطقه)` : `وزن‌دهی جنسیتی با ترکیب ${d.source} (سطح منطقه؛ ترکیب سنی محله در دسترس نیست)`;
    }
  }
  return t;
}

/** گزینه‌های برآورد پیمایش: معیار درآمد استان (فقط برای محلات تهران که بستهٔ رسمی دارند) */
export function surveyOptionsFor(neighborhoodId: string): SurveyOptions {
  return tehranDistrictOf(neighborhoodId) ? { incomeBenchmark: (at) => incomeBenchmark(at) } : {};
}

export function surveyValues(neighborhoodId: string, ctx: NeighborhoodContext): { values: DocumentedValue[]; summary: SurveySummary } {
  const summary = summarizeSurvey(neighborhoodId, rakingTargetsFrom(ctx), surveyOptionsFor(neighborhoodId));
  const values: DocumentedValue[] = summary.indicators.map((e) => ({
    code: e.code, raw: e.score, unit: e.unit ?? '0..100',
    source: `${e.module === 'household' ? 'پیمایش محله — ماژول خانوار' : e.module === 'economic' ? 'پیمایش محله — ماژول مسکن و درآمد' : 'پیمایش ادراکی محله'} (n=${e.n}، ${summary.weighting === 'raked' ? 'وزن‌دار' : 'بدون وزن'})`,
    sourceIds: [e.module === 'perceptual' ? 'survey:perceptual' : `survey:${e.module}`], channel: 'survey', tier: 'survey', geographyLevel: 'neighborhood',
    lowerIsBetter: LOWER_BETTER.has(e.code),
    observedAt: summary.latestResponseAt, fetchedAt: new Date().toISOString(),
    numerator: null, denominator: e.n,
    method: e.module === 'economic'
      ? `${ECONOMIC_INDICATORS[e.code]?.method ?? ''}؛ جامعه: ${e.denominator}؛ CI95=[${e.ci95.join('، ')}]${e.benchmark ? `؛ معیار: ${e.benchmark}` : ''}`
      : e.module === 'household'
      ? `سهم وزنی پاسخ «بله» گویهٔ ${e.item} در جامعهٔ واجد شرایط (${e.denominator}) × ۱۰۰؛ CI95=[${e.ci95.join('، ')}]`
      : `(میانگین وزنی لیکرت − ۱) ÷ ۴ × ۱۰۰ روی گویهٔ ${e.item}؛ CI95=[${e.ci95.join('، ')}]`,
    methodQuality: summary.alpha !== null && summary.alpha >= 0.7 ? 1 : 0.6,
    sampleAdequacy: Math.min(1, e.nEffective / TARGET_N), cadence: 'annual',
    details: { ci95: e.ci95, n: e.n, nEffective: e.nEffective, alpha: summary.alpha },
  }));
  return { values, summary };
}

export function fieldValues(neighborhoodId: string): { values: DocumentedValue[]; summary: FieldAuditSummary } {
  const summary = summarizeAudits(neighborhoodId);
  if (summary.p3 === null) return { values: [], summary };
  return {
    summary,
    values: [{
      code: 'P3', raw: summary.p3, unit: '0..100', source: `ممیزی میدانی (${summary.points} نقطه، ${summary.auditors} ممیز)`, sourceIds: ['field:p3'],
      channel: 'field', tier: 'field', geographyLevel: 'neighborhood', observedAt: summary.latestAuditAt, fetchedAt: new Date().toISOString(),
      method: 'میانگین چک‌لیست ۸ گویه‌ای ۰..۲ تبدیل به ۰..۱۰۰', methodQuality: summary.kappa !== null && summary.kappa >= 0.6 ? 1 : 0.6,
      sampleAdequacy: Math.min(1, summary.points / 5), cadence: 'annual', details: { kappa: summary.kappa, itemMeans: summary.itemMeans },
    }],
  };
}

export function registerValues(neighborhoodId: string): { values: DocumentedValue[]; summary: RegisterSummary } {
  const summary = summarizeRegister(neighborhoodId);
  const values: DocumentedValue[] = summary.indicators.map((r) => ({
    code: r.code, raw: r.value, unit: '%', numerator: r.flagged, denominator: r.n,
    source: r.code === 'G3' ? `ارزیابی شبکهٔ نهادی محله (${r.n} نهاد)` : `ثبت محلی پرونده‌ها (${r.n} پرونده، ${Math.round(r.evidenceShare * 100)}٪ با سند)`,
    sourceIds: [r.code === 'G3' ? 'register:network' : 'register:cases'],
    channel: r.code === 'G3' ? 'expert' : 'field', tier: r.code === 'G3' ? 'expert' : 'field', geographyLevel: 'neighborhood',
    observedAt: r.latest, fetchedAt: new Date().toISOString(),
    method: r.code === 'G3' ? 'چگالی شبکه = پیوندهای همکاری فعال ÷ پیوندهای ممکن × ۱۰۰' : `${r.flagged} از ${r.n} (${r.denominator}، سه سال اخیر) × ۱۰۰`,
    methodQuality: r.methodQuality, sampleAdequacy: Math.min(1, r.n / (r.code === 'G3' ? 8 : 20)), cadence: 'annual',
    details: { evidenceShare: r.evidenceShare },
  }));
  return { values, summary };
}
