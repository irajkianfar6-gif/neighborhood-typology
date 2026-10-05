/** تبدیل کانال‌های غیرخودکار (قرارداد، پیمایش، ممیزی) به مقدار مستند */
import { approvedValuesFor, type ApprovedValue } from '../ingestion/contractData';
import { summarizeSurvey, type RakingTargets, type SurveySummary, TARGET_N } from '../survey/perceptualSurvey';
import { summarizeAudits, type FieldAuditSummary } from '../survey/fieldAudit';
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
      channel: 'contract', tier: 'official', geographyLevel: 'neighborhood',
      observedAt: r.period_end.length === 7 ? `${r.period_end}-28` : r.period_end, fetchedAt: r.approvedAt,
      method: 'دادهٔ قراردادی تأییدشده (صورت/مخرج تجمیع‌شده روی مرز محله)', methodQuality: 1, sampleAdequacy: 1,
      cadence: CENSUS_CODES.has(r.indicator_code) ? 'census' : 'annual', lowerIsBetter: LOWER_BETTER.has(r.indicator_code),
      details: { batchId: r.batchId },
    });
  }
  return { values, groupValues, groupNs, raw };
}

export function rakingTargetsFrom(ctx: NeighborhoodContext): RakingTargets {
  const t: RakingTargets = {};
  if (ctx.structure.male && ctx.structure.female) t.sex = { male: ctx.structure.male, female: ctx.structure.female };
  if (ctx.structure.ageBands) t.ageBand = ctx.structure.ageBands;
  return t;
}

export function surveyValues(neighborhoodId: string, ctx: NeighborhoodContext): { values: DocumentedValue[]; summary: SurveySummary } {
  const summary = summarizeSurvey(neighborhoodId, rakingTargetsFrom(ctx));
  const values: DocumentedValue[] = summary.indicators.map((e) => ({
    code: e.code, raw: e.score, unit: '0..100', source: `پیمایش ادراکی محله (n=${e.n}، ${summary.weighting === 'raked' ? 'وزن‌دار' : 'بدون وزن'})`,
    sourceIds: ['survey:perceptual'], channel: 'survey', tier: 'survey', geographyLevel: 'neighborhood',
    observedAt: summary.latestResponseAt, fetchedAt: new Date().toISOString(),
    method: `(میانگین وزنی لیکرت − ۱) ÷ ۴ × ۱۰۰ روی گویهٔ ${e.item}؛ CI95=[${e.ci95.join('، ')}]`,
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
