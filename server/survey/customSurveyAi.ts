/**
 * هوش مصنوعی در پرسشنامهٔ سفارشی — فقط سه نقش کمکی:
 *  ۱) پیش‌نویس پرسشنامه از روی هدف کاربر (همیشه به‌صورت پیش‌نویس ذخیره می‌شود و کاربر باید بازبینی و منتشر کند)
 *  ۲) بازبینی روش‌شناختی گویه‌ها (ابهام، دوپهلویی، جهت‌دهی، نگاشت نادرست) با پیشنهاد بازنویسی
 *  ۳) تفسیر نتایج و پاسخ‌های باز (برچسب «تفسیر هوش مصنوعی»؛ هرگز وارد کارت تصمیم نمی‌شود)
 * همهٔ اعداد (امتیاز، CI، n، آلفا، شمار مضمون‌ها) را کد به‌صورت قطعی محاسبه می‌کند، نه مدل.
 */
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';
import { llmJson, type LlmConfig } from '../ai/llm';
import {
  CORE_CODES, CORE_NAME, KIND_LABELS, METHOD_LABELS, SURVEY_NATIVE, validateDefinition,
  type CustomItem, type CustomQuestionnaire, type DefinitionIssue,
} from '../../src/algorithm/customSurveyModel';
import { createQuestionnaire, sanitizeDefinition, SurveyError, type CustomSurveySummary } from './customSurvey';

type Deps = { fetch?: typeof fetch; config?: LlmConfig; retries?: number };
const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null);
const s = (x: unknown, max = 800) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

const SCHEMA_DOC = `ساختار هر گویه:
{"code":"Q1" (حرف لاتین + عدد/حرف/_ ، یکتا)، "text":"متن پرسش فارسی"، "kind": یکی از ${Object.keys(KIND_LABELS).join('|')}،
 "required": true|false، "section":"نام بخش"،
 "options":[{"value":1,"label":"...","score":0..100}] (فقط برای choice/multi؛ value عدد صحیح یکتا)،
 "min":عدد،"max":عدد،"unit":"..." (فقط number)،
 "showIf":{"item":"کد گویهٔ قبلی","op":"eq|neq|gte|lte|in","value":عدد یا آرایه} (اختیاری)،
 "mapping":{"code":"کد شاخص","role":"primary|check","method":"${Object.keys(METHOD_LABELS).join('|')}","reversed":bool,"op":...,"threshold":...,"best":عدد,"worst":عدد} (اختیاری؛ برای text هرگز)}
قواعد نگاشت: امتیاز ۱۰۰ همیشه یعنی وضعیت مطلوب؛ اگر موافقت با گویه وضعیت بد را نشان می‌دهد reversed=true.
scale_mean برای likert/binary (و choice با امتیاز همهٔ گزینه‌ها، number با best/worst)؛ share_top فقط likert/binary؛ share_condition با op و threshold؛ numeric_normative فقط number با best و worst؛ option_score فقط choice/multi با امتیاز همهٔ گزینه‌ها.
role=primary فقط برای شاخص‌های ادراکی/پیمایشی (${[...SURVEY_NATIVE].join('، ')})؛ برای شاخص‌های عینی دیگر role=check.
اگر سنجه به هیچ شاخص هسته نمی‌خورد، کد سفارشی با پیشوند X_ بساز (مثلاً X_TRUST).`;

const indicatorList = (codes?: string[]) => CORE_CODES.filter((c) => !codes?.length || codes.includes(c)).map((c) => `${c}: ${CORE_NAME[c]}${SURVEY_NATIVE.has(c) ? ' (پیمایشی)' : ' (عینی)'}`).join('\n');

/** اصلاح خودکار خطاهای رایج خروجی مدل پیش از اعتبارسنجی */
export function repairDraftItems(items: CustomItem[]): CustomItem[] {
  const used = new Set<string>();
  return items.map((it, i) => {
    let code = (it.code || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24);
    if (!/^[A-Za-z]/.test(code)) code = `Q${i + 1}`;
    while (used.has(code)) code = `${code.slice(0, 20)}_${i + 1}`;
    used.add(code);
    const out: CustomItem = { ...it, code };
    if (out.mapping) {
      const m = { ...out.mapping, code: out.mapping.code.toUpperCase().replace(/^X_/, 'X_') };
      if (!CORE_CODES.includes(m.code) && !/^X_[A-Za-z0-9_]{1,20}$/.test(m.code)) m.code = `X_${m.code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 18) || 'CUSTOM'}`;
      if (CORE_CODES.includes(m.code) && !SURVEY_NATIVE.has(m.code)) m.role = 'check';
      out.mapping = out.kind === 'text' ? undefined : m;
    }
    return out;
  });
}

export async function aiDraft(input: { goal: string; neighborhoodId?: string; neighborhoodName?: string; indicators?: string[]; nItems?: number; audience?: string }, deps: Deps = {}): Promise<{ questionnaire: CustomQuestionnaire; issues: DefinitionIssue[]; model: string }> {
  const goal = s(input.goal, 2000);
  if (goal.length < 10) throw new SurveyError(400, 'INVALID_INPUT', 'هدف پرسشنامه را دست‌کم در یک جمله بنویسید');
  const n = Math.max(3, Math.min(40, Math.round(input.nItems ?? 12)));
  const system = 'تو روش‌شناس پیمایش اجتماعی و برنامه‌ریزی شهری هستی. پرسشنامه‌های کوتاه، بی‌طرف، تک‌مفهومی و قابل فهم برای عموم ساکنان محله به فارسی روان طراحی می‌کنی.';
  const prompt = `هدف پرسشنامه: ${goal}
${input.neighborhoodName ? `محلهٔ هدف: ${input.neighborhoodName}\n` : ''}${input.audience ? `پاسخگویان: ${s(input.audience, 300)}\n` : ''}تعداد گویه: حدود ${n}
شاخص‌های هستهٔ مجاز برای نگاشت:
${indicatorList(input.indicators)}

${SCHEMA_DOC}

اصول: هر گویه فقط یک مفهوم؛ بدون جهت‌دهی؛ گزینه‌ها جامع و مانعه‌الجمع؛ دست‌کم یک گویهٔ باز (text) در پایان؛ پرسش مشخصات (سن/جنس/مالکیت) را نساز چون سامانه خودش می‌پرسد.
خروجی: {"title":"...","description":"معرفی کوتاه برای پاسخگو","purpose":"هدف تحلیلی","items":[...]}`;
  const { data, model } = await llmJson({
    system, prompt, maxTokens: 8000,
    validate: (x) => {
      const o = obj(x);
      if (!o || !Array.isArray(o.items) || !o.items.length) throw new Error('آرایهٔ items لازم است');
      return o;
    },
  }, deps);
  const clean = sanitizeDefinition({ title: s(data.title, 200), description: s(data.description, 2000), purpose: s(data.purpose, 2000), items: data.items as CustomItem[] });
  clean.items = repairDraftItems(clean.items);
  const scope: CustomQuestionnaire['scope'] = input.neighborhoodId ? { kind: 'neighborhoods', neighborhoods: [input.neighborhoodId] } : { kind: 'all' };
  const res = createQuestionnaire({ ...clean, scope, ai: { drafted: { model, at: new Date().toISOString(), goal } } });
  return { ...res, model };
}

export interface ReviewIssue { item: string | null; severity: 'high' | 'medium' | 'low'; problem: string; suggestion: string; rewrite?: string }
export async function aiReview(q: CustomQuestionnaire, deps: Deps = {}): Promise<{ overall: string; issues: ReviewIssue[]; model: string; ruleIssues: DefinitionIssue[] }> {
  const codes = new Set(q.items.map((i) => i.code));
  const prompt = `این پرسشنامه را از نظر روش‌شناسی بازبینی کن: ابهام، دوپهلویی (دو مفهوم در یک گویه)، جهت‌دهی، واژهٔ تخصصی، گزینه‌های ناقص یا هم‌پوشان، ترتیب، طول، و درستی نگاشت به شاخص (جهت reversed و روش).
شاخص‌ها: ${indicatorList()}
${SCHEMA_DOC}
پرسشنامه:
${JSON.stringify({ title: q.title, purpose: q.purpose, items: q.items }, null, 0)}
خروجی: {"overall":"جمع‌بندی کوتاه","issues":[{"item":"کد گویه یا null برای کل پرسشنامه","severity":"high|medium|low","problem":"...","suggestion":"...","rewrite":"متن پیشنهادی جایگزین گویه (اختیاری)"}]}`;
  const { data, model } = await llmJson({
    system: 'تو داور روش‌شناسی پیمایش هستی؛ دقیق، کوتاه و عملی به فارسی نقد می‌کنی و چیزی را که مشکل ندارد ایراد نمی‌گیری.', prompt, maxTokens: 6000,
    validate: (x) => {
      const o = obj(x);
      if (!o || !Array.isArray(o.issues)) throw new Error('آرایهٔ issues لازم است');
      return o;
    },
  }, deps);
  const issues: ReviewIssue[] = (data.issues as unknown[]).map(obj).filter((x): x is Record<string, unknown> => !!x).map((x) => ({
    item: typeof x.item === 'string' && codes.has(x.item) ? x.item : null,
    severity: (['high', 'medium', 'low'].includes(String(x.severity)) ? x.severity : 'medium') as ReviewIssue['severity'],
    problem: s(x.problem), suggestion: s(x.suggestion), rewrite: typeof x.item === 'string' && codes.has(x.item) && s(x.rewrite, 600) ? s(x.rewrite, 600) : undefined,
  })).filter((x) => x.problem).slice(0, 60);
  return { overall: s(data.overall, 1500), issues, model, ruleIssues: validateDefinition(q) };
}

export interface AiInterpretation {
  questionnaireId: string; neighborhoodId: string; model: string; generatedAt: string; basedOn: { nAccepted: number; textAnswers: number; latestResponseAt: string | null };
  summary: string; keyFindings: Array<{ text: string; basis: string[] }>; cautions: string[];
  themes: Array<{ label: string; description: string; answerIds: string[]; count: number; share: number; examples: string[] }>;
  actions: Array<{ text: string; linkedIndicators: string[] }>;
  disclaimer: string;
}
const aiFile = (qid: string, nb: string) => { const d = path.join(serverDataDir(), 'custom-surveys', 'ai'); fs.mkdirSync(d, { recursive: true }); return path.join(d, `${qid}__${nb.replace(/[^\w.-]/g, '_')}.json`); };
export function loadInterpretation(qid: string, nb: string): AiInterpretation | null {
  const f = aiFile(qid, nb);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

export async function aiInterpret(q: CustomQuestionnaire, summary: CustomSurveySummary, deps: Deps = {}): Promise<AiInterpretation> {
  if (!summary.nAccepted) throw new SurveyError(422, 'NO_DATA', 'هنوز پاسخ پذیرفته‌شده‌ای برای تفسیر وجود ندارد');
  const texts = summary.items.flatMap((i) => (i.textSamples ?? []).map((t) => ({ id: `${i.code}:${t.id}`, item: i.code, text: t.text.slice(0, 400) }))).slice(-150);
  const textById = new Map(texts.map((t) => [t.id, t]));
  const facts = {
    nAccepted: summary.nAccepted, weighting: summary.weighting,
    indicators: summary.indicators.map((e) => ({ code: e.code, name: e.name, score: e.score, ci95: e.ci95, n: e.n, alpha: e.alpha, publishable: e.publishable, groups: e.groups })),
    items: summary.items.filter((i) => i.kind !== 'text').map((i) => ({ code: i.code, text: i.text, n: i.n, mean: i.mean, median: i.median, score: i.score, distribution: i.distribution?.map((d) => `${d.label}:${d.share}%`) })),
  };
  const validBasis = new Set([...summary.indicators.map((e) => e.code), ...summary.items.map((i) => i.code)]);
  const prompt = `پرسشنامه: «${q.title}» — هدف: ${q.purpose ?? '-'}
آمار قطعی محاسبه‌شده (فقط به همین اعداد استناد کن، عدد جدید نساز):
${JSON.stringify(facts)}
پاسخ‌های باز (شناسه: متن) — اگر پاسخ باز هست، آن‌ها را در ۲ تا ۶ مضمون دسته‌بندی کن و برای هر مضمون همهٔ شناسه‌های مربوط را بیاور:
${texts.map((t) => `${t.id}: ${t.text}`).join('\n') || '(ندارد)'}

خروجی: {"summary":"جمع‌بندی ۳ تا ۵ جمله‌ای","keyFindings":[{"text":"...","basis":["کد گویه یا شاخص"]}],"cautions":["محدودیت‌ها مثل n کم، CI پهن، آلفای پایین"],"themes":[{"label":"مضمون","description":"...","answerIds":["شناسهٔ دقیق پاسخ‌های باز همین مضمون، مثل ${texts[0]?.id ?? 'NOTE:ab12cd34'}"]}],"actions":[{"text":"اقدام پیشنهادی","linkedIndicators":["کد"]}]}`;
  const { data, model } = await llmJson({
    system: 'تو تحلیلگر پیمایش شهری هستی. فقط بر اساس آمار داده‌شده و متن پاسخ‌ها تفسیر می‌کنی؛ عدد نمی‌سازی، تعمیم ناروا نمی‌دهی و عدم قطعیت را صریح می‌گویی. به فارسی.',
    prompt, maxTokens: 6000,
    validate: (x) => { const o = obj(x); if (!o || typeof o.summary !== 'string') throw new Error('summary لازم است'); return o; },
  }, deps);
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const textTotal = texts.length || 1;
  const themes = arr(data.themes).map(obj).filter((x): x is Record<string, unknown> => !!x).map((t) => {
    const resolve = (raw: string) => { const id = raw.trim().replace(/^["'«]|["'»]$/g, ''); return textById.has(id) ? id : texts.find((x) => x.id.endsWith(`:${id}`))?.id; };
    const ids = [...new Set(arr(t.answerIds).map((x) => resolve(String(x))).filter((id): id is string => Boolean(id)))];
    return { label: s(t.label, 120), description: s(t.description, 500), answerIds: ids, count: ids.length, share: Math.round((ids.length / textTotal) * 1000) / 10, examples: ids.slice(0, 3).map((id) => textById.get(id)!.text) };
  }).filter((t) => t.label && t.count > 0).sort((a, b) => b.count - a.count);
  const out: AiInterpretation = {
    questionnaireId: q.id, neighborhoodId: summary.neighborhoodId, model, generatedAt: new Date().toISOString(),
    basedOn: { nAccepted: summary.nAccepted, textAnswers: texts.length, latestResponseAt: summary.latestResponseAt },
    summary: s(data.summary, 3000),
    keyFindings: arr(data.keyFindings).map(obj).filter((x): x is Record<string, unknown> => !!x).map((k) => ({ text: s(k.text, 600), basis: arr(k.basis).map(String).filter((b) => validBasis.has(b)) })).filter((k) => k.text).slice(0, 12),
    cautions: arr(data.cautions).map((c) => s(c, 400)).filter(Boolean).slice(0, 8),
    themes,
    actions: arr(data.actions).map(obj).filter((x): x is Record<string, unknown> => !!x).map((a) => ({ text: s(a.text, 500), linkedIndicators: arr(a.linkedIndicators).map(String).filter((c) => validBasis.has(c) || CORE_CODES.includes(c)) })).filter((a) => a.text).slice(0, 10),
    disclaimer: 'تفسیر هوش مصنوعی است و فقط برای کمک به خواندن نتایج؛ اعداد و شمار مضمون‌ها را سامانه محاسبه کرده و این متن وارد کارت تصمیم نمی‌شود.',
  };
  fs.writeFileSync(aiFile(q.id, summary.neighborhoodId), JSON.stringify(out, null, 1));
  return out;
}
