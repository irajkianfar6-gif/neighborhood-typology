/**
 * ابزارهای فاز ۴ — A11 شبیه‌سازی سناریو و حساسیت، A12 آزمون تزریق خطا و نقاد مشورتی مدل زبانی،
 * A8 وضعیت دادهٔ پیمایشی و پیش‌نویس پرسشنامهٔ شکاف‌ها، A14 داشبورد عامل‌ها.
 * سناریو و حساسیت فقط کاوشی‌اند (publishable=false) و هرگز کارت یا سنجه را تغییر نمی‌دهند.
 */
import type { ToolDef } from './tools';
import type { JsonSchema } from './schema';
import { analysisFor, contextFor, requireEntry, ToolInputError } from './state';
import { SCENARIO_VERSION, sensitivityAnalysis, simulateScenario } from './scenario';
import { llmReview, runCriticSuite } from './criticSuite';
import { agentDashboard } from './dashboard';
import { gapsFromCard } from './research/research';
import { rakingTargetsFrom, surveyOptionsFor } from '../neighborhood/channels';
import { summarizeSurvey } from '../survey/perceptualSurvey';
import { questionnairesWithData, summarizeCustom, listQuestionnaires } from '../survey/customSurvey';
import { summarizeAudits } from '../survey/fieldAudit';
import { summarizeRegister } from '../survey/localRegister';
import { buildCollectionPlan } from '../survey/collectionPlan';
import { aiDraft } from '../survey/customSurveyAi';
import { llmConfig } from '../ai/llm';
import { inScope, SURVEY_NATIVE } from '../../src/algorithm/customSurveyModel';

const OBJ = (required: string[], properties: Record<string, JsonSchema> = {}): JsonSchema => ({ type: 'object', required, properties });
const NB_ID: JsonSchema = { type: 'string', minLength: 3, maxLength: 80, pattern: '^[a-z0-9_-]+:[A-Za-z0-9_.-]+$' };
const AN_PROPS: Record<string, JsonSchema> = { analysisId: { type: 'string', minLength: 8, maxLength: 64 }, neighborhoodId: NB_ID, offline: { type: 'boolean', default: false } };
const SCORES: JsonSchema = { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 100 }, description: 'نگاشت کد شاخص → امتیاز ۰..۱۰۰ (فرضی)' };
const an = (i: Record<string, unknown>) => analysisFor({ analysisId: i.analysisId as string | undefined, neighborhoodId: i.neighborhoodId as string | undefined, offline: Boolean(i.offline) });
const asScores = (x: unknown): Record<string, number> => Object.fromEntries(Object.entries((x ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)) as Array<[string, number]>);

/** وضعیت همهٔ کانال‌های پیمایشی یک محله + شاخص‌های شکافی که با پرسشنامه قابل پرشدن‌اند */
export async function surveyStatus(neighborhoodId: string, offline = true) {
  const e = requireEntry(neighborhoodId);
  const ctx = await contextFor(e, { useKernel: false, offline });
  const targets = rakingTargetsFrom(ctx);
  const perceptual = summarizeSurvey(e.neighborhoodId, targets, surveyOptionsFor(e.neighborhoodId));
  const custom = questionnairesWithData(e.neighborhoodId).map((q) => {
    const s = summarizeCustom(q, e.neighborhoodId, targets);
    return { questionnaireId: q.id, title: q.title, status: q.status, version: q.version, nAccepted: s.nAccepted, nReceived: s.nReceived, indicators: s.indicators.filter((x) => x.score !== null).map((x) => ({ code: x.code, score: x.score, n: x.n, publishable: x.publishable })) };
  });
  const drafts = listQuestionnaires().filter((q) => q.status === 'draft').filter((q) => inScope(q, e.neighborhoodId)).map((q) => ({ questionnaireId: q.id, title: q.title, items: q.items.length }));
  let cardIndicators: Array<{ code: string; score: number | null; channel: string; tier: string }> = [];
  let gaps: string[] = [];
  try { const r = await analysisFor({ neighborhoodId: e.neighborhoodId, offline: true }); cardIndicators = r.card.indicators; gaps = gapsFromCard(r).map((g) => g.code); } catch { /* بدون کارت */ }
  const audit = summarizeAudits(e.neighborhoodId); const register = summarizeRegister(e.neighborhoodId);
  const plan = buildCollectionPlan({ survey: perceptual, audit, register, population: ctx.population.value, cardIndicators }) as unknown as { overall: number; recommendedN: number };
  return {
    neighborhoodId: e.neighborhoodId, name: `${e.nameFa}، ${e.cityFa}`,
    perceptual: { nAccepted: perceptual.nAccepted, nReceived: perceptual.nReceived, adequacy: perceptual.adequacy, marginOfError: perceptual.marginOfError, alpha: perceptual.alpha, indicators: perceptual.indicators.map((x) => ({ code: x.code, score: x.score, n: x.n })), latestResponseAt: perceptual.latestResponseAt },
    custom, drafts, audits: { points: (audit as unknown as { points: number }).points }, register: { records: register.records.length },
    plan: { overall: plan.overall, recommendedN: plan.recommendedN },
    surveyFillableGaps: gaps.filter((c) => SURVEY_NATIVE.has(c)), otherGaps: gaps.filter((c) => !SURVEY_NATIVE.has(c)),
  };
}

export const PHASE4_TOOLS: ToolDef[] = [
  {
    name: 'simulate_scenario', title: 'شبیه‌سازی سناریو', category: 'diagnosis', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: `آزمون «اگر…» (${SCENARIO_VERSION}): امتیاز برخی شاخص‌ها را فرضی تغییر می‌دهد و سرمایه‌ها، کیفیت، نوع تشخیصی و گلوگاه را با پایهٔ سنجیده مقایسه می‌کند. خروجی کاوشی است و قابل انتشار نیست.`,
    inputSchema: { type: 'object', additionalProperties: false, required: ['overrides'], properties: { ...AN_PROPS, overrides: SCORES } },
    outputSchema: OBJ(['label', 'base', 'scenario', 'changes']),
    handler: async (i) => simulateScenario(await an(i), asScores(i.overrides)) as unknown as Record<string, unknown>,
    summarize: (o) => { const c = o.changes as { bottleneckChanged: boolean | null }; return c.bottleneckChanged === null ? 'سناریو بدون پوشش کامل' : c.bottleneckChanged ? 'گلوگاه تغییر کرد' : 'گلوگاه ثابت ماند'; },
  },
  {
    name: 'sensitivity_analysis', title: 'تحلیل حساسیت', category: 'diagnosis', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'آیا گلوگاه و نوع تشخیصی با خطای ±p٪ در شاخص‌های کم‌اعتبار عوض می‌شود؟ امتیازهای فرضی برای سرمایه‌های بی‌داده را می‌توان در scores داد.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...AN_PROPS, perturbation: { type: 'number', minimum: 0.01, maximum: 0.9, default: 0.2 }, reliabilityBelow: { type: 'number', minimum: 0, maximum: 1, default: 0.8 }, scores: SCORES } },
    outputSchema: OBJ(['verdict', 'tested']),
    handler: async (i) => sensitivityAnalysis(await an(i), { perturbation: i.perturbation as number, reliabilityBelow: i.reliabilityBelow as number, scores: asScores(i.scores) }) as unknown as Record<string, unknown>,
    summarize: (o) => `حساسیت: ${o.verdict}${o.stability !== null ? ` (پایداری ${o.stability})` : ''}`,
  },
  {
    name: 'critic_self_test', title: 'آزمون تزریق خطا به نقاد', category: 'governance', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'روی کپی کارت، ۱۴ خطای شناخته‌شده تزریق می‌کند و نرخ کشف نقاد قطعی را می‌سنجد (معیار ≥ ۹۰٪). کارت اصلی تغییر نمی‌کند.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...AN_PROPS, threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.9 } } },
    outputSchema: OBJ(['detectionRate', 'passed', 'cases']),
    handler: async (i) => runCriticSuite(await an(i), (i.threshold as number) ?? 0.9) as unknown as Record<string, unknown>,
    summarize: (o) => `کشف ${o.detected}/${o.total} (${Math.round(Number(o.detectionRate) * 100)}٪)`,
  },
  {
    name: 'llm_review', title: 'نقاد مشورتی مدل زبانی', category: 'governance', readOnly: true, idempotent: false, openWorld: true, timeoutMs: 180_000,
    description: 'بازبینی روش‌شناختی گزارش با مدل زبانی؛ فقط مشورتی، حق توقف ندارد؛ ایراد با کد شاخص ناموجود یا عدد بی‌پشتوانه رد می‌شود.',
    inputSchema: { type: 'object', additionalProperties: false, properties: AN_PROPS },
    outputSchema: OBJ(['used', 'issues']),
    handler: async (i) => llmReview(await an(i)) as unknown as Record<string, unknown>,
    summarize: (o) => (o.used ? `${(o.issues as unknown[]).length} ایراد، ${o.rejected} رد شد` : 'مدل زبانی در دسترس نیست'),
  },
  {
    name: 'get_survey_status', title: 'وضعیت دادهٔ پیمایشی', category: 'survey', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 120_000,
    description: 'پاسخ‌های پیمایش ادراکی، پرسشنامه‌های سفارشی دارای داده و پیش‌نویس، ممیزی و ثبت محلی، پیشرفت برنامهٔ گردآوری و شکاف‌هایی که با پرسشنامه پر می‌شوند.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['neighborhoodId'], properties: { neighborhoodId: NB_ID } },
    outputSchema: OBJ(['perceptual', 'custom', 'surveyFillableGaps']),
    handler: async (i) => surveyStatus(String(i.neighborhoodId)) as unknown as Promise<Record<string, unknown>>,
    summarize: (o) => `${(o.perceptual as { nAccepted: number }).nAccepted} پاسخ ادراکی، ${(o.custom as unknown[]).length} پرسشنامهٔ دارای داده، ${(o.surveyFillableGaps as unknown[]).length} شکاف پیمایشی`,
  },
  {
    name: 'draft_gap_questionnaire', title: 'پیش‌نویس پرسشنامهٔ شکاف‌ها', category: 'survey', readOnly: false, idempotent: false, openWorld: true, timeoutMs: 180_000,
    description: 'برای شاخص‌های شکاف که ذاتاً پیمایشی‌اند، با مدل زبانی یک پرسشنامهٔ «پیش‌نویس» می‌سازد. انتشار و اجرای میدانی با کارشناس است.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['neighborhoodId'], properties: { neighborhoodId: NB_ID, nItems: { type: 'integer', minimum: 3, maximum: 40, default: 12 }, goal: { type: 'string', maxLength: 2000 } } },
    outputSchema: OBJ(['questionnaireId', 'status', 'indicators']),
    handler: async (i) => {
      const e = requireEntry(String(i.neighborhoodId));
      if (!llmConfig().configured) throw new ToolInputError('LLM_UNAVAILABLE', 'مدل زبانی پیکربندی نشده؛ پرسشنامه را دستی در زبانهٔ «دادهٔ پیمایشی» بسازید');
      const r = await analysisFor({ neighborhoodId: e.neighborhoodId, offline: true });
      const gaps = gapsFromCard(r).filter((g) => SURVEY_NATIVE.has(g.code));
      if (!gaps.length) throw new ToolInputError('NO_SURVEY_GAPS', 'شکاف پیمایشی‌ای برای این محله نیست');
      const goal = (typeof i.goal === 'string' && i.goal.trim().length >= 10) ? i.goal : `سنجش ادراک ساکنان محلهٔ ${e.nameFa} برای پر کردن شاخص‌های بدون داده: ${gaps.map((g) => `${g.code} (${g.name})`).join('، ')}`;
      const out = await aiDraft({ goal, neighborhoodId: e.neighborhoodId, neighborhoodName: `${e.nameFa}، ${e.cityFa}`, indicators: gaps.map((g) => g.code), nItems: (i.nItems as number) ?? 12 });
      return { questionnaireId: out.questionnaire.id, title: out.questionnaire.title, status: out.questionnaire.status, items: out.questionnaire.items.length, indicators: gaps.map((g) => g.code), issues: out.issues, model: out.model, next: 'پیش‌نویس را در زبانهٔ «دادهٔ پیمایشی (پرسشنامه)» بازبینی و منتشر کنید' };
    },
    summarize: (o) => `پیش‌نویس ${o.questionnaireId} با ${o.items} گویه`,
  },
  {
    name: 'get_agent_dashboard', title: 'داشبورد عامل‌ها', category: 'governance', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'معیارهای هر عامل و ابزار (فراخوانی، خطا، میانگین و صدک ۹۵ زمان، آخرین فراخوانی)، صف کار و دارایی‌های پژوهشی.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 500 } } },
    outputSchema: OBJ(['agents', 'tools', 'totals']),
    handler: async (i) => agentDashboard({ limit: i.limit as number }) as unknown as Record<string, unknown>,
    summarize: (o) => `${(o.totals as { calls: number }).calls} فراخوانی در پنجره`,
  },
];
