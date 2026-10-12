/**
 * آزمون خطای تزریقی نقاد (A12) — CRT-SUITE-v1 و نقاد مشورتی مدل زبانی.
 * روی نسخهٔ کپی یک کارت واقعی، خطاهای شناخته‌شده تزریق می‌شود و بررسی می‌شود نقاد قطعی هر کدام را می‌گیرد یا نه.
 * معیار پذیرش فاز ۴: کشف ≥ ۹۰٪. کارت اصلی هرگز تغییر نمی‌کند.
 */
import { extractJson, llmConfig, llmText } from '../ai/llm';
import { verifyAnalysis, CRITIC_VERSION, type CriticReport } from './critic';
import { renderReport } from './report';
import { ungroundedNumbers } from './grounding';
import type { CardResult } from './state';

export const CRITIC_SUITE_VERSION = 'CRT-SUITE-v1';
type Mut = { id: string; title: string; expect: string; apply: (r: CardResult) => void };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** موتور ساختگی سازگار برای جهش‌هایی که به خروجی موتور نیاز دارند (فقط روی کپی) */
function withEngine(r: CardResult): void {
  const cap = r.card.capitals.find((c) => c.score !== null)?.capital ?? r.card.capitals[0].capital;
  r.card.engine = {
    runId: 'suite', qualityVerdict: 'X' as never, diagnosticType: null,
    bottleneck: { capital: cap, transition: ['ACCESS', 'USE'], location: '—', group: '—', time: '—' },
    interventions: [{ id: 'iv-suite', name: 'مداخلهٔ آزمون', targetCapital: cap, targetTransition: ['ACCESS', 'USE'] } as never],
    hypotheses: [], causalLevel: 'initial', finalStatement: 'اقدام اولویت‌دار (هم‌راستا با گلوگاه): **مداخلهٔ آزمون**', equityDataStatus: 'missing',
  };
  // سطح سازگار تا خطای «موتور روی کارت ناکافی» خودبه‌خود ایجاد نشود
  if (r.card.publication.level === 'INSUFFICIENT') { r.card.publication.level = 'PROVISIONAL'; (r.gate as { level: string }).level = 'PROVISIONAL'; }
}
const scored = (r: CardResult) => r.card.indicators.find((i) => i.score !== null) ?? (() => { const i = r.card.indicators[0]; i.score = 50; i.source = 'منبع'; i.tier = 'open_model'; return i; })();

export const MUTATIONS: Mut[] = [
  { id: 'M1', title: 'حذف منشأ یک عدد امتیازدار', expect: 'C1', apply: (r) => { const i = scored(r); i.source = '—'; i.tier = 'none'; } },
  { id: 'M2', title: 'شاهد بدون منشأ در بستهٔ شاهد', expect: 'C2', apply: (r) => { const v = r.evidence[0] as unknown as { raw: number | null; source: string; sourceIds: string[] }; v.raw = 42; v.source = ''; v.sourceIds = []; } },
  { id: 'M3', title: 'حکم «عادلانه» بدون دادهٔ گروهی', expect: 'C3', apply: (r) => { withEngine(r); (r.gate.sections.equity as { allowed: boolean }).allowed = false; r.card.engine!.finalStatement += ' — توسعهٔ عادلانه'; } },
  { id: 'M4', title: 'اجرای موتور روی کارت ناکافی', expect: 'C4', apply: (r) => { withEngine(r); r.card.publication.level = 'INSUFFICIENT'; (r.gate as { level: string }).level = 'INSUFFICIENT'; } },
  { id: 'M5', title: 'جملهٔ نهایی مداخلهٔ دیگری را اعلام می‌کند', expect: 'C5', apply: (r) => { withEngine(r); r.card.engine!.finalStatement = 'اقدام اولویت‌دار: **ساخت پارک**'; } },
  { id: 'M6', title: 'مداخلهٔ اول ناهم‌راستا با گلوگاه', expect: 'C6', apply: (r) => { withEngine(r); (r.card.engine!.interventions[0] as { targetTransition: string[] }).targetTransition = ['USE', 'EXPERIENCE']; } },
  { id: 'M7', title: 'حذف نسخهٔ قواعد از کلید بازتولید', expect: 'C8', apply: (r) => { delete r.card.reproducibilityKey.thresholds; } },
  { id: 'M8', title: 'امتیاز خارج از بازه (۱۴۰)', expect: 'C12', apply: (r) => { scored(r).score = 140; } },
  { id: 'M9', title: 'اعتبار خارج از بازه (۱٫۷)', expect: 'C12', apply: (r) => { r.card.indicators[0].reliability = 1.7; } },
  { id: 'M10', title: 'سطح کارت بالاتر از حکم دروازه', expect: 'C13', apply: (r) => { r.card.publication.level = r.gate.level === 'PUBLISHABLE' ? 'INSUFFICIENT' : 'PUBLISHABLE'; } },
  { id: 'M11', title: 'پوشش «قابل‌استفاده» بیش از واقع', expect: 'C13', apply: (r) => { r.card.coverage.usable += 5; } },
  { id: 'M12', title: 'امتیاز سرمایه بدون شاخص سنجیده', expect: 'C14', apply: (r) => { const c = r.card.capitals.find((x) => x.score === null) ?? r.card.capitals[0]; c.score = 63; c.indicatorsUsed = []; } },
  { id: 'M13', title: 'عدد ساختگی در جملهٔ نهایی', expect: 'C15', apply: (r) => { withEngine(r); r.card.engine!.finalStatement += ' ۷۳٫۴ درصد ساکنان ناراضی‌اند و ۹۱۲۸ خانوار آسیب دیده‌اند.'; } },
  { id: 'M14', title: 'گلوگاه روی سرمایهٔ بی‌داده', expect: 'C16', apply: (r) => { withEngine(r); const c = r.card.capitals.find((x) => x.score === null); if (c) r.card.engine!.bottleneck.capital = c.capital; else { r.card.capitals[0].score = null; r.card.engine!.bottleneck.capital = r.card.capitals[0].capital; } } },
];

export interface SuiteResult {
  version: string; critic: string; analysisId: string; total: number; detected: number; detectionRate: number; passed: boolean;
  baselineVerdict: string; cases: Array<{ id: string; title: string; expect: string; status: string; detected: boolean; verdict: string; detail: string }>;
}

export function runCriticSuite(base: CardResult, threshold = 0.9): SuiteResult {
  const baseline = verifyAnalysis(base);
  const cases = MUTATIONS.map((m) => {
    const r = clone(base); m.apply(r);
    let rep: CriticReport;
    try { rep = verifyAnalysis(r); } catch (e) { return { id: m.id, title: m.title, expect: m.expect, status: 'error', detected: true, verdict: 'fail', detail: `نقاد خطا داد: ${e instanceof Error ? e.message : e}` }; }
    const c = rep.checks.find((x) => x.id === m.expect);
    return { id: m.id, title: m.title, expect: m.expect, status: c?.status ?? 'missing', detected: Boolean(c && c.status !== 'pass'), verdict: rep.verdict, detail: c?.detail ?? 'بررسی اجرا نشد' };
  });
  const detected = cases.filter((c) => c.detected).length;
  const rate = Math.round((detected / cases.length) * 1000) / 1000;
  return { version: CRITIC_SUITE_VERSION, critic: CRITIC_VERSION, analysisId: base.card.fingerprint, total: cases.length, detected, detectionRate: rate, passed: rate >= threshold, baselineVerdict: baseline.verdict, cases };
}

// ---------------- نقاد مشورتی مدل زبانی ----------------
export interface LlmReview { used: boolean; model: string | null; issues: Array<{ severity: 'high' | 'medium' | 'low'; indicator: string | null; problem: string }>; rejected: number; error: string | null }
type Llm = (system: string, prompt: string) => Promise<{ text: string; model?: string }>;

/** بازبینی مشورتی: فقط مسئله گزارش می‌کند، عدد نمی‌سازد و حق توقف ندارد؛ ادعاهای بی‌ربط یا با عدد بی‌پشتوانه رد می‌شوند */
export async function llmReview(r: CardResult, deps: { llm?: Llm } = {}): Promise<LlmReview> {
  const llm = deps.llm ?? (llmConfig().configured ? ((s: string, p: string) => llmText({ system: s, prompt: p, maxTokens: 1500, temperature: 0 })) : undefined);
  if (!llm) return { used: false, model: null, issues: [], rejected: 0, error: 'مدل زبانی پیکربندی نشده است' };
  const rep = renderReport(r, null, 'analytical').markdown.slice(0, 12_000);
  const codes = new Set(r.card.indicators.map((i) => i.code));
  const prompt = `گزارش تحلیلی محله:\n${rep}\n\nجملهٔ نهایی موتور: ${r.card.engine?.finalStatement ?? '—'}\n\nمسائل روش‌شناختی، تناقض متن و عدد، ادعای علّی بی‌پشتوانه یا تفسیر نادرست را فهرست کن. عدد تازه نساز.\nفقط JSON: {"issues":[{"severity":"high|medium|low","indicator":"کد شاخص یا null","problem":"…"}]}`;
  try {
    const out = await llm('تو نقاد روش‌شناس و تیم قرمز گزارش‌های برنامه‌ریزی شهری هستی.', prompt);
    const j = extractJson(out.text) as { issues?: Array<{ severity?: string; indicator?: string | null; problem?: string }> } | null;
    let rejected = 0;
    const issues = (j?.issues ?? []).slice(0, 20).flatMap((x) => {
      const problem = String(x.problem ?? '').slice(0, 600); const ind = x.indicator && codes.has(String(x.indicator)) ? String(x.indicator) : null;
      if (problem.length < 5 || (x.indicator && !ind) || ungroundedNumbers(problem, [r.card]).ungrounded.length) { rejected++; return []; }
      return [{ severity: (['high', 'medium', 'low'].includes(String(x.severity)) ? x.severity : 'low') as 'high' | 'medium' | 'low', indicator: ind, problem }];
    });
    return { used: true, model: out.model ?? null, issues, rejected, error: null };
  } catch (e) { return { used: true, model: null, issues: [], rejected: 0, error: e instanceof Error ? e.message : String(e) }; }
}
