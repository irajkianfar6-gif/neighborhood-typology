/**
 * پیمایش ادراکی استاندارد محله.
 *
 * - گویه‌ها: kernel/registries/questionnaire_15.json + دو گویهٔ هسته‌ای افزوده
 *   (S3X شبکهٔ همکاری — بله/خیر، C3X هویت محله‌ای — لیکرت) در questionnaire_core_extension.json
 * - کنترل کیفیت: زمان < ۹۰ ثانیه، پاسخ خطی یکسان، دستگاه تکراری → حذف
 * - وزن‌دهی پس‌طبقه‌ای (raking) بر جنس × گروه سنی بر اساس جمعیت محله (قرارداد مرکز آمار)
 * - شاخص‌ها: S1←E3، S2←E2، S3←S3X، C3←C3X با فرمول رجیستر (میانگین وزنی − ۱) ÷ ۴ × ۱۰۰
 * - پایایی: آلفای کرونباخ سازهٔ دلبستگی/سرمایهٔ اجتماعی (E2, E3, O1, O3, C3X)
 * - عدالت: مقادیر گروهی برای گروه‌های با n ≥ ۳۰
 * - ماژول خانوار (HH-v1): H2، H3، H4، S4، C4، C5 = سهم وزنی «بله» در جامعهٔ واجد شرایط هر شاخص × ۱۰۰؛
 *   برآورد فقط وقتی منتشر می‌شود که دست‌کم ۳۰ پاسخ واجد شرایط وجود داشته باشد.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';
import { BINARY_CODES, HOUSEHOLD_INDICATORS, ITEM_BY_CODE, INSTRUMENT_VERSION } from '../../src/algorithm/surveyInstrument';

export const LIKERT_ITEMS = ['C1', 'C2', 'C3', 'A1', 'A2', 'A3', 'U1', 'U2', 'U3', 'E1', 'E2', 'E3', 'O1', 'O2', 'O3', 'C3X'] as const;
export const REVERSED = new Set(['C3', 'O2']);
export const CONSTRUCT_ITEMS = ['E2', 'E3', 'O1', 'O3', 'C3X'];
export const SURVEY_INDICATORS: Record<string, { item: string; kind: 'likert' | 'binary'; label: string }> = {
  S1: { item: 'E3', kind: 'likert', label: 'اعتماد همسایگی' },
  S2: { item: 'E2', kind: 'likert', label: 'تعلق محله‌ای' },
  S3: { item: 'S3X', kind: 'binary', label: 'شبکهٔ همکاری' },
  C3: { item: 'C3X', kind: 'likert', label: 'هویت محله‌ای' },
};
export const GROUP_KEYS = ['sex', 'ageBand', 'tenure', 'disability'] as const;
export const AGE_BANDS = ['18-29', '30-44', '45-64', '65+'] as const;
const MIN_DURATION_SEC = Number(process.env.ARA_SURVEY_MIN_SECONDS || 90);
export const TARGET_N = 384;
export const MIN_ELIGIBLE = 30;
const WORKING_AGE = new Set(['18-29', '30-44', '45-64']);

export interface SurveyResponseInput {
  respondentId?: string;
  deviceId?: string;
  durationSec: number;
  answers: Record<string, number>;
  demographics: { sex?: 'male' | 'female'; ageBand?: typeof AGE_BANDS[number]; tenure?: 'owner' | 'renter' | 'other'; disability?: boolean };
  consent: boolean;
  collectedAt?: string;
  collectorId?: string;
  /** پاسخ متنی سؤال‌های تکمیلی (منطق پرش) — حداکثر ۳۰۰ نویسه برای هر گویه */
  followUps?: Record<string, string>;
  mode?: 'self' | 'interviewer' | 'paper';
  instrumentVersion?: string;
}
export interface StoredResponse extends SurveyResponseInput {
  responseId: string; neighborhoodId: string; receivedAt: string; deviceHash?: string;
  qc: { accepted: boolean; reasons: string[] };
}

function file(neighborhoodId: string): string {
  const safe = neighborhoodId.replace(/[^\w:.-]/g, '_').replace(/:/g, '__');
  const dir = path.join(serverDataDir(), 'survey');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safe}.jsonl`);
}

export function loadResponses(neighborhoodId: string): StoredResponse[] {
  const f = file(neighborhoodId);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as StoredResponse);
}

export function validateResponse(input: SurveyResponseInput, existing: StoredResponse[]): { accepted: boolean; reasons: string[]; deviceHash?: string } {
  const reasons: string[] = [];
  if (!input.consent) reasons.push('NO_CONSENT');
  if (!(input.durationSec >= MIN_DURATION_SEC)) reasons.push('TOO_FAST');
  const likert = LIKERT_ITEMS.map((k) => input.answers?.[k]).filter((v) => typeof v === 'number');
  if (likert.some((v) => !Number.isInteger(v) || v < 1 || v > 5)) reasons.push('INVALID_LIKERT');
  if (likert.length >= 10 && new Set(likert).size === 1) reasons.push('STRAIGHT_LINING');
  if (likert.length < 8) reasons.push('INCOMPLETE');
  if (BINARY_CODES.some((k) => { const v = input.answers?.[k]; return v !== undefined && v !== null && v !== 0 && v !== 1; })) reasons.push('INVALID_BINARY');
  const emp = input.answers?.EMP;
  if (emp !== undefined && emp !== null && ![1, 2, 3, 4].includes(emp)) reasons.push('INVALID_CHOICE');
  const deviceHash = input.deviceId ? crypto.createHash('sha256').update(input.deviceId).digest('hex').slice(0, 16) : undefined;
  if (deviceHash && existing.some((r) => r.deviceHash === deviceHash && r.qc.accepted)) reasons.push('DUPLICATE_DEVICE');
  return { accepted: reasons.length === 0, reasons, deviceHash };
}

export function addResponses(neighborhoodId: string, inputs: SurveyResponseInput[]): StoredResponse[] {
  const existing = loadResponses(neighborhoodId);
  const out: StoredResponse[] = [];
  for (const input of inputs) {
    const qc = validateResponse(input, [...existing, ...out]);
    const { deviceId: _omit, ...rest } = input; // شناسهٔ خام دستگاه ذخیره نمی‌شود
    const answers = Object.fromEntries(Object.entries(input.answers ?? {}).filter(([k, v]) => k in ITEM_BY_CODE && typeof v === 'number'));
    const followUps = input.followUps
      ? Object.fromEntries(Object.entries(input.followUps).filter(([k, v]) => k in ITEM_BY_CODE && typeof v === 'string' && v.trim()).slice(0, 15).map(([k, v]) => [k, v.trim().slice(0, 300)]))
      : undefined;
    out.push({ ...rest, answers, followUps, instrumentVersion: input.instrumentVersion ?? INSTRUMENT_VERSION, responseId: crypto.randomUUID(), neighborhoodId, receivedAt: new Date().toISOString(), deviceHash: qc.deviceHash, qc: { accepted: qc.accepted, reasons: qc.reasons } });
  }
  fs.appendFileSync(file(neighborhoodId), out.map((r) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
  return out;
}

/** هدف‌های جمعیتی برای raking: { sex: {male: n, female: n}, ageBand: {...} } */
export type RakingTargets = Partial<Record<'sex' | 'ageBand', Record<string, number>>>;

/** raking (iterative proportional fitting) روی جنس و گروه سنی */
export function rake(responses: StoredResponse[], targets: RakingTargets, iterations = 50): number[] {
  const w = responses.map(() => 1);
  const dims = (Object.keys(targets) as Array<'sex' | 'ageBand'>).filter((d) => targets[d] && Object.keys(targets[d]!).length);
  if (!dims.length) return w;
  for (let it = 0; it < iterations; it++) {
    let maxAdj = 0;
    for (const d of dims) {
      const tgt = targets[d]!;
      const tgtTotal = Object.values(tgt).reduce((a, b) => a + b, 0);
      const sums = new Map<string, number>();
      responses.forEach((r, i) => { const k = String(r.demographics?.[d] ?? ''); sums.set(k, (sums.get(k) ?? 0) + w[i]); });
      const total = w.reduce((a, b) => a + b, 0);
      responses.forEach((r, i) => {
        const k = String(r.demographics?.[d] ?? '');
        if (!(k in tgt) || !sums.get(k)) return;
        const factor = ((tgt[k] / tgtTotal) * total) / sums.get(k)!;
        maxAdj = Math.max(maxAdj, Math.abs(factor - 1));
        w[i] *= factor;
      });
    }
    if (maxAdj < 1e-4) break;
  }
  // تراشیدن وزن‌های افراطی (۰٫۲ تا ۵ برابر میانگین)
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  return w.map((x) => Math.min(5 * mean, Math.max(0.2 * mean, x)) / mean);
}

function cronbachAlpha(rows: number[][]): number | null {
  const k = rows[0]?.length ?? 0;
  if (k < 2 || rows.length < 10) return null;
  const variance = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1); };
  const itemVar = Array.from({ length: k }, (_, j) => variance(rows.map((r) => r[j]))).reduce((a, b) => a + b, 0);
  const totalVar = variance(rows.map((r) => r.reduce((a, b) => a + b, 0)));
  if (totalVar === 0) return null;
  return (k / (k - 1)) * (1 - itemVar / totalVar);
}

export interface SurveyIndicatorEstimate {
  code: string; label: string; score: number; ci95: [number, number]; n: number; nEffective: number; item: string;
  module: 'perceptual' | 'household'; unit: '0..100' | '%'; denominator?: string;
}
export interface PendingSurveyIndicator { code: string; label: string; eligibleN: number; required: number; denominator: string }
export interface SurveySummary {
  neighborhoodId: string; nReceived: number; nAccepted: number; rejectedByReason: Record<string, number>;
  weighting: 'raked' | 'unweighted'; weightingNote: string;
  alpha: number | null; alphaItems: string[];
  indicators: SurveyIndicatorEstimate[];
  groupValues: Record<string, Record<string, number>>;
  groupNs: Record<string, number>;
  quotas: Record<string, Record<string, number>>;
  marginOfError: number | null; adequacy: 'ADEQUATE' | 'MINIMUM' | 'INSUFFICIENT';
  latestResponseAt: string | null; earliestResponseAt: string | null;
  /** برآوردهای ماژول خانوار که هنوز به حداقل پاسخ واجد شرایط نرسیده‌اند */
  pending: PendingSurveyIndicator[];
  /** پروفایل ادراکی زنجیرهٔ C-A-U-E-O (۰..۱۰۰؛ گویه‌های معکوس برگردانده شده) */
  chainProfile: Record<string, { score: number; n: number } | null>;
  /** میانگین هر گویهٔ ادراکی در مقیاس ۰..۱۰۰ */
  itemScores: Record<string, number>;
  /** آخرین پاسخ‌های متنی سؤال‌های تکمیلی (برای خوانش کیفی) */
  followUpSamples: Array<{ code: string; text: string; at: string }>;
  byMode: Record<string, number>;
  byCollector: Record<string, number>;
  instrumentVersion: string;
}

export function summarizeSurvey(neighborhoodId: string, targets: RakingTargets = {}): SurveySummary {
  const all = loadResponses(neighborhoodId);
  const ok = all.filter((r) => r.qc.accepted);
  const rejectedByReason: Record<string, number> = {};
  for (const r of all) if (!r.qc.accepted) for (const reason of r.qc.reasons) rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
  const hasTargets = Object.values(targets).some((t) => t && Object.keys(t).length);
  const weights = hasTargets ? rake(ok, targets) : ok.map(() => 1);
  const nEff = (ws: number[]) => { const s = ws.reduce((a, b) => a + b, 0); const s2 = ws.reduce((a, b) => a + b * b, 0); return s2 ? (s * s) / s2 : 0; };

  const estimate = (subset: number[], item: string, kind: 'likert' | 'binary') => {
    const pairs = subset.map((i) => ({ v: ok[i].answers?.[item], w: weights[i] })).filter((p) => typeof p.v === 'number') as Array<{ v: number; w: number }>;
    if (!pairs.length) return null;
    const toScore = (v: number) => (kind === 'binary' ? v * 100 : ((v - 1) / 4) * 100);
    const W = pairs.reduce((a, p) => a + p.w, 0);
    const mean = pairs.reduce((a, p) => a + p.w * toScore(p.v), 0) / W;
    const varW = pairs.reduce((a, p) => a + p.w * (toScore(p.v) - mean) ** 2, 0) / W;
    const ne = nEff(pairs.map((p) => p.w));
    const se = ne > 1 ? Math.sqrt(varW / ne) : NaN;
    return { score: mean, ci: [mean - 1.96 * se, mean + 1.96 * se] as [number, number], n: pairs.length, ne };
  };
  const idx = ok.map((_, i) => i);
  const indicators: SurveyIndicatorEstimate[] = [];
  for (const [code, def] of Object.entries(SURVEY_INDICATORS)) {
    const e = estimate(idx, def.item, def.kind);
    if (!e) continue;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    indicators.push({ code, label: def.label, item: def.item, score: r1(e.score), ci95: [r1(Math.max(0, e.ci[0])), r1(Math.min(100, e.ci[1]))], n: e.n, nEffective: Math.round(e.ne), module: 'perceptual', unit: '0..100' });
  }
  // ماژول خانوار: سهم وزنی در جامعهٔ واجد شرایط
  const pending: PendingSurveyIndicator[] = [];
  const householdRule: Record<string, { eligible: (r: StoredResponse) => boolean; yes: (r: StoredResponse) => boolean }> = {
    H2: { eligible: (r) => WORKING_AGE.has(String(r.demographics?.ageBand)) && (r.answers?.H2X === 0 || r.answers?.H2X === 1), yes: (r) => r.answers?.H2X === 1 },
    H3: { eligible: (r) => [1, 2, 3].includes(r.answers?.EMP as number), yes: (r) => r.answers?.EMP === 1 },
    H4: { eligible: (r) => r.answers?.H2X === 1 && [1, 2].includes(r.answers?.EMP as number) && (r.answers?.H4X === 0 || r.answers?.H4X === 1), yes: (r) => r.answers?.H4X === 1 },
    S4: { eligible: (r) => r.answers?.S4X === 0 || r.answers?.S4X === 1, yes: (r) => r.answers?.S4X === 1 },
    C4: { eligible: (r) => r.answers?.C4X === 0 || r.answers?.C4X === 1, yes: (r) => r.answers?.C4X === 1 },
    C5: { eligible: (r) => r.demographics?.ageBand === '18-29' && (r.answers?.C5X === 0 || r.answers?.C5X === 1), yes: (r) => r.answers?.C5X === 1 },
  };
  const share = (subset: number[], code: string) => {
    const rule = householdRule[code];
    const el = subset.filter((i) => rule.eligible(ok[i]));
    if (!el.length) return { n: 0, ne: 0, score: NaN, se: NaN };
    const W = el.reduce((a, i) => a + weights[i], 0);
    const p = el.reduce((a, i) => a + weights[i] * (rule.yes(ok[i]) ? 1 : 0), 0) / W;
    const ne = nEff(el.map((i) => weights[i]));
    return { n: el.length, ne, score: p * 100, se: ne > 1 ? Math.sqrt((p * (1 - p)) / ne) * 100 : NaN };
  };
  for (const [code, def] of Object.entries(HOUSEHOLD_INDICATORS)) {
    const e = share(idx, code);
    if (e.n < MIN_ELIGIBLE) {
      if (ok.some((r) => r.answers?.[def.item] !== undefined) || e.n > 0) pending.push({ code, label: def.label, eligibleN: e.n, required: MIN_ELIGIBLE, denominator: def.denominator });
      continue;
    }
    const r1 = (x: number) => Math.round(x * 10) / 10;
    const lo = Number.isFinite(e.se) ? e.score - 1.96 * e.se : e.score;
    const hi = Number.isFinite(e.se) ? e.score + 1.96 * e.se : e.score;
    indicators.push({ code, label: def.label, item: def.item, score: r1(e.score), ci95: [r1(Math.max(0, lo)), r1(Math.min(100, hi))], n: e.n, nEffective: Math.round(e.ne), module: 'household', unit: '%', denominator: def.denominator });
  }

  // پروفایل ادراکی زنجیره و میانگین گویه‌ها
  const itemScores: Record<string, number> = {};
  const stageVals: Record<string, number[]> = { CAPACITY: [], ACCESS: [], USE: [], EXPERIENCE: [], OUTCOME: [] };
  for (const code of LIKERT_ITEMS) {
    const meta = ITEM_BY_CODE[code];
    const e = estimate(idx, code, 'likert');
    if (!e) continue;
    const sc = REVERSED.has(code) ? 100 - e.score : e.score;
    itemScores[code] = Math.round(sc * 10) / 10;
    if (meta?.stage) stageVals[meta.stage].push(sc);
  }
  const chainProfile = Object.fromEntries(Object.entries(stageVals).map(([k, v]) => [k, v.length ? { score: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, n: ok.length } : null]));
  const followUpSamples = ok.flatMap((r) => Object.entries(r.followUps ?? {}).map(([code, text]) => ({ code, text, at: r.collectedAt ?? r.receivedAt })))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  const countBy = (f: (r: StoredResponse) => string | undefined) => ok.reduce<Record<string, number>>((acc, r) => { const k = f(r); if (k) acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

  const alphaRows = ok.map((r) => CONSTRUCT_ITEMS.map((k) => r.answers?.[k])).filter((row) => row.every((v) => typeof v === 'number')) as number[][];
  const alpha = cronbachAlpha(alphaRows);

  const groupValues: Record<string, Record<string, number>> = {};
  const groupNs: Record<string, number> = {};
  const quotas: Record<string, Record<string, number>> = {};
  for (const gk of GROUP_KEYS) {
    const byGroup = new Map<string, number[]>();
    ok.forEach((r, i) => {
      const v = r.demographics?.[gk];
      if (v === undefined || v === null || String(v) === '') return;
      const label = `${gk}:${String(v)}`;
      byGroup.set(label, [...(byGroup.get(label) ?? []), i]);
    });
    quotas[gk] = Object.fromEntries([...byGroup].map(([k, v]) => [k.split(':')[1], v.length]));
    for (const [label, members] of byGroup) {
      groupNs[label] = members.length;
      if (members.length < 30) continue; // n<30 برای حکم گروهی کافی نیست
      for (const [code, def] of Object.entries(SURVEY_INDICATORS)) {
        const e = estimate(members, def.item, def.kind);
        if (!e) continue;
        (groupValues[code] ??= {})[label] = Math.round(e.score * 10) / 10;
      }
      for (const code of Object.keys(HOUSEHOLD_INDICATORS)) {
        if (!indicators.some((x) => x.code === code)) continue;
        const e = share(members, code);
        if (e.n >= MIN_ELIGIBLE) (groupValues[code] ??= {})[label] = Math.round(e.score * 10) / 10;
      }
    }
  }
  const n = ok.length;
  const moe = n > 0 ? Math.round((1.96 * Math.sqrt(0.25 / Math.max(1, nEff(weights)))) * 1000) / 10 : null;
  const times = ok.map((r) => r.collectedAt ?? r.receivedAt).sort();
  return {
    neighborhoodId, nReceived: all.length, nAccepted: n, rejectedByReason,
    weighting: hasTargets ? 'raked' : 'unweighted',
    weightingNote: hasTargets ? 'وزن‌دهی پس‌طبقه‌ای بر جنس/سن از جمعیت قراردادی محله' : 'هدف جمعیتی (POP_MALE/POP_FEMALE/POP_AGE_*) در دادهٔ قراردادی نیست؛ برآورد بدون وزن',
    alpha: alpha === null ? null : Math.round(alpha * 1000) / 1000, alphaItems: CONSTRUCT_ITEMS,
    indicators, groupValues, groupNs, quotas,
    marginOfError: moe,
    adequacy: n >= TARGET_N ? 'ADEQUATE' : n >= 150 ? 'MINIMUM' : 'INSUFFICIENT',
    latestResponseAt: times[times.length - 1] ?? null, earliestResponseAt: times[0] ?? null,
    pending, chainProfile, itemScores, followUpSamples,
    byMode: countBy((r) => r.mode ?? 'unspecified'), byCollector: countBy((r) => r.collectorId),
    instrumentVersion: INSTRUMENT_VERSION,
  };
}
