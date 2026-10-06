/**
 * ادغام مقادیر مستند از همهٔ کانال‌ها با قاعدهٔ اولویت:
 *   قرارداد/رسمی > پیمایش (فقط شاخص ادراکی) / ممیزی > open_measured > open_model > proxy
 * بقیه در alternatives؛ اختلاف > ۱۵ امتیاز = تعارض و کاهش اعتماد.
 * شاخص‌های ادراکی (S1, S2, S3, C3, P3) فقط از پیمایش/ممیزی/قرارداد پذیرفته می‌شوند.
 */
import { computeReliability, convergence } from './reliability';
import { scoreValue } from './normalize';
import type { DocumentedValue, EvidenceTier, ScoredValue } from './types';

export const PERCEPTUAL_CODES = new Set(['S1', 'S2', 'S3', 'C3', 'P3']);
const TIER_RANK: Record<EvidenceTier, number> = { contract: 0, official: 0, survey: 1, field: 1, expert: 2, open_measured: 3, open_model: 4, proxy: 5 };

export function mergeDocumentedValues(all: DocumentedValue[], citySlug: string, now = Date.now()): Map<string, ScoredValue> {
  const byCode = new Map<string, DocumentedValue[]>();
  for (const v of all) {
    if (PERCEPTUAL_CODES.has(v.code) && !['survey', 'field', 'contract'].includes(v.channel)) continue;
    if (v.geographyLevel === 'province' || v.geographyLevel === 'national') continue; // بنچمارک، نه امتیاز
    byCode.set(v.code, [...(byCode.get(v.code) ?? []), v]);
  }
  const out = new Map<string, ScoredValue>();
  for (const [code, list] of byCode) {
    const scored = list.map((v) => ({ v, s: scoreValue(v, citySlug) }));
    // سنجهٔ «کنترلی» (مثلاً گویهٔ پرسشنامهٔ سفارشی برای شاخص عینی) هرگز مقدار اصلی نمی‌شود؛ فقط در مقایسه/همگرایی
    const isCheck = (v: DocumentedValue) => (v.details as { role?: string } | undefined)?.role === 'check';
    if (scored.every((x) => isCheck(x.v))) continue;
    const withValue = scored.filter((x) => x.v.raw !== null && x.s.score !== null);
    const eligible = withValue.filter((x) => !isCheck(x.v));
    const pool = eligible.length ? eligible : scored.filter((x) => !isCheck(x.v));
    pool.sort((a, b) => TIER_RANK[a.v.tier] - TIER_RANK[b.v.tier] || (b.v.methodQuality - a.v.methodQuality));
    const primary = pool[0];
    const { C, conflict } = convergence(withValue.map((x) => x.s.score));
    const rel = computeReliability(primary.v, C, now);
    const scoreless = primary.s.score === null && primary.v.raw !== null;
    out.set(code, {
      ...primary.v,
      missingReason: primary.v.missingReason ?? (scoreless ? `مقدار خام موجود است ولی امتیاز ممکن نیست: ${primary.s.reason}` : undefined),
      nextAction: primary.v.nextAction ?? (scoreless && primary.s.reason === 'NO_REFERENCE_DISTRIBUTION' ? 'ساخت توزیع مرجع شهر: npx tsx scripts/build_reference_distribution.ts <city>' : undefined),
      score: primary.s.score,
      scoringMethod: primary.s.method,
      scoringRef: primary.s.ref,
      percentile: primary.s.percentile,
      reliability: primary.s.score === null ? 0 : Math.round(rel.reliability * (conflict ? 0.8 : 1) * 1000) / 1000,
      reliabilityParts: rel.parts,
      alternatives: scored.filter((x) => x !== primary).map((x) => ({ source: x.v.source, tier: x.v.tier, raw: x.v.raw, score: x.s.score })),
      conflict,
    });
  }
  return out;
}
