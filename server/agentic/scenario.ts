/**
 * عامل شبیه‌سازی سناریو (A11) — SCN-v1.
 * همان زنجیرهٔ قطعی موتور (امتیاز سرمایه‌ها، زنجیرهٔ C-A-U-E-O، Q/T/R، تیپ و گلوگاه) روی مجموعهٔ امتیاز «فرضی».
 * خروجی همیشه برچسب «سناریو» دارد، در تاریخچه یا کارت ذخیره نمی‌شود و قابل انتشار نیست.
 * - simulate: «اگر امتیاز این شاخص‌ها چنین شود…» → مقایسهٔ پایه و سناریو
 * - sensitivity: برای هر شاخص کم‌اعتبار، تغییر ±p٪ و بررسی ثبات گلوگاه و تیپ
 */
import { ALGORITHM_INDICATORS } from '../../src/algorithm/algorithmIndicators';
import { computeAllCapitalScores } from '../../src/algorithm/capitalScoring';
import { averageChainStage, computeAllChainScores } from '../../src/algorithm/chainScoring';
import { computeQualityTriad } from '../../src/algorithm/qualityMetrics';
import { diagnoseType } from '../../src/algorithm/statusBands';
import { locateBottleneck } from '../../src/algorithm/bottleneckLocator';
import { CAPITALS, type CapitalKey } from '../../src/algorithm/types';
import type { CardResult } from './state';

export const SCENARIO_VERSION = 'SCN-v1';
const IND = new Map(ALGORITHM_INDICATORS.map((i) => [i.code, i]));
const r1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number) => Math.max(0, Math.min(100, x));

export interface Evaluation {
  covered: boolean; missingCapitals: CapitalKey[];
  capitals: Record<string, number> | null; Q: number | null; T: number | null; R: number | null;
  diagnosticType: string | null; bottleneck: { capital: CapitalKey; transition: [string, string] } | null;
}

/** امتیازهای «بالاتر = بهتر» (۰..۱۰۰) → خروجی موتور؛ بدون پوشش هر هشت سرمایه ارزیابی نمی‌شود */
export function evaluateScores(scores: Record<string, number>): Evaluation {
  const vals = Object.entries(scores).filter(([c, v]) => IND.has(c) && Number.isFinite(v)).map(([c, v]) => {
    const ind = IND.get(c)!;
    return { code: c, capitalKey: ind.capitalKey, chainStage: ind.chainStage, normalized: clamp(v), reliability: ind.reliability };
  });
  const have = new Set(vals.map((v) => v.capitalKey));
  const missingCapitals = CAPITALS.filter((k) => !have.has(k));
  if (missingCapitals.length) return { covered: false, missingCapitals, capitals: null, Q: null, T: null, R: null, diagnosticType: null, bottleneck: null };
  const caps = computeAllCapitalScores(vals);
  const capMap = Object.fromEntries(caps.map((c) => [c.capitalKey, c.score])) as Record<CapitalKey, number>;
  const chains = computeAllChainScores(vals);
  const avg = { CAPACITY: averageChainStage(chains, 'CAPACITY'), ACCESS: averageChainStage(chains, 'ACCESS'), USE: averageChainStage(chains, 'USE'), EXPERIENCE: averageChainStage(chains, 'EXPERIENCE'), OUTCOME: averageChainStage(chains, 'OUTCOME') };
  const triad = computeQualityTriad(capMap, avg);
  const avgK = caps.reduce((s, c) => s + c.score, 0) / caps.length;
  const type = diagnoseType(triad.Q, triad.T, triad.R, avgK);
  const raw = Object.fromEntries(vals.map((v) => [v.code, IND.get(v.code)!.direction === 'desc' ? 100 - v.normalized : v.normalized]));
  const { bottleneck } = locateBottleneck({ allChainScores: chains, equityData: [], currentPeriodScores: raw });
  return {
    covered: true, missingCapitals: [], capitals: Object.fromEntries(Object.entries(capMap).map(([k, v]) => [k, r1(v)])),
    Q: r1(triad.Q), T: r1(triad.T), R: r1(triad.R), diagnosticType: type, bottleneck: { capital: bottleneck.capital, transition: [bottleneck.transition[0], bottleneck.transition[1]] },
  };
}

/** امتیازهای سنجیده‌شدهٔ کارت (فقط شاخص‌های امتیازدار) */
export function baseScores(r: CardResult): { scores: Record<string, number>; reliability: Record<string, number> } {
  const scores: Record<string, number> = {}; const reliability: Record<string, number> = {};
  for (const i of r.card.indicators) if (i.score !== null) { scores[i.code] = i.score; reliability[i.code] = i.reliability; }
  return { scores, reliability };
}

const sameB = (a: Evaluation['bottleneck'], b: Evaluation['bottleneck']) => Boolean(a && b && a.capital === b.capital && a.transition[0] === b.transition[0] && a.transition[1] === b.transition[1]);

export interface ScenarioResult {
  version: string; label: 'scenario'; publishable: false; neighborhoodId: string; analysisId: string;
  overrides: Record<string, number>; hypotheticalCodes: string[]; measuredCodes: string[]; baseScores: Record<string, number>;
  base: Evaluation; scenario: Evaluation;
  changes: { bottleneckChanged: boolean | null; typeChanged: boolean | null; capitalDelta: Record<string, number> | null };
  note: string;
}

export function simulateScenario(r: CardResult, overrides: Record<string, number>): ScenarioResult {
  const { scores } = baseScores(r);
  const clean: Record<string, number> = {};
  for (const [c, v] of Object.entries(overrides)) if (IND.has(c) && Number.isFinite(v)) clean[c] = clamp(v);
  const merged = { ...scores, ...clean };
  const base = evaluateScores(scores); const scen = evaluateScores(merged);
  const hypothetical = Object.keys(clean).filter((c) => !(c in scores));
  const delta = base.capitals && scen.capitals ? Object.fromEntries(Object.keys(scen.capitals).map((k) => [k, r1(scen.capitals![k] - base.capitals![k])])) : null;
  const note = !scen.covered
    ? `سناریو ارزیابی نشد: برای سرمایه‌های ${scen.missingCapitals.join('، ')} هیچ امتیازی نیست؛ برای هر سرمایه دست‌کم یک مقدار (فرضی) بدهید.`
    : !base.covered
      ? `پایهٔ سنجیده کامل نیست (سرمایه‌های بی‌داده: ${base.missingCapitals.join('، ')})؛ نتیجه تماماً فرضی است و جای سنجش واقعی را نمی‌گیرد.`
      : 'مقایسهٔ پایهٔ سنجیده با سناریو؛ فقط برای کاوش، نه انتشار.';
  return {
    version: SCENARIO_VERSION, label: 'scenario', publishable: false, neighborhoodId: r.card.neighborhood.neighborhoodId, analysisId: r.card.fingerprint,
    overrides: clean, hypotheticalCodes: hypothetical, measuredCodes: Object.keys(scores), baseScores: scores, base, scenario: scen,
    changes: { bottleneckChanged: base.covered && scen.covered ? !sameB(base.bottleneck, scen.bottleneck) : null, typeChanged: base.covered && scen.covered ? base.diagnosticType !== scen.diagnosticType : null, capitalDelta: delta },
    note,
  };
}

export interface SensitivityResult {
  version: string; label: 'sensitivity'; neighborhoodId: string; perturbation: number; reliabilityBelow: number;
  evaluated: boolean; reason: string | null; base: Evaluation | null;
  tested: Array<{ code: string; reliability: number; down: { bottleneckSame: boolean; typeSame: boolean }; up: { bottleneckSame: boolean; typeSame: boolean } }>;
  stability: number | null; fragileCodes: string[]; verdict: 'stable' | 'fragile' | 'not_evaluated';
}

/** آیا تشخیص به خطای ±p در شاخص‌های کم‌اعتبار حساس است؟ */
export function sensitivityAnalysis(r: CardResult, opts: { perturbation?: number; reliabilityBelow?: number; scores?: Record<string, number> } = {}): SensitivityResult {
  const p = Math.max(0.01, Math.min(0.9, opts.perturbation ?? 0.2)); const th = opts.reliabilityBelow ?? 0.8;
  const b = baseScores(r); const scores = { ...b.scores, ...(opts.scores ?? {}) };
  const base = evaluateScores(scores);
  const out: SensitivityResult = { version: SCENARIO_VERSION, label: 'sensitivity', neighborhoodId: r.card.neighborhood.neighborhoodId, perturbation: p, reliabilityBelow: th, evaluated: false, reason: null, base, tested: [], stability: null, fragileCodes: [], verdict: 'not_evaluated' };
  if (!base.covered) { out.reason = `پوشش سرمایه‌ها کامل نیست (${base.missingCapitals.join('، ')})؛ تحلیل حساسیت ممکن نیست`; return out; }
  const targets = Object.keys(scores).filter((c) => (b.reliability[c] ?? 0) < th);
  if (!targets.length) { out.evaluated = true; out.stability = 1; out.verdict = 'stable'; out.reason = 'شاخص کم‌اعتباری نیست'; return out; }
  let same = 0, n = 0;
  for (const c of targets) {
    const run = (f: number) => { const e = evaluateScores({ ...scores, [c]: clamp(scores[c] * f) }); return { bottleneckSame: sameB(e.bottleneck, base.bottleneck), typeSame: e.diagnosticType === base.diagnosticType }; };
    const down = run(1 - p), up = run(1 + p);
    for (const x of [down, up]) { n++; if (x.bottleneckSame && x.typeSame) same++; }
    out.tested.push({ code: c, reliability: b.reliability[c] ?? 0, down, up });
    if (!(down.bottleneckSame && down.typeSame && up.bottleneckSame && up.typeSame)) out.fragileCodes.push(c);
  }
  out.evaluated = true; out.stability = Math.round((same / n) * 1000) / 1000;
  out.verdict = out.fragileCodes.length ? 'fragile' : 'stable';
  return out;
}
