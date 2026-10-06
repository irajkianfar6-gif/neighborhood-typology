/**
 * پرسشنامهٔ سفارشی: مدل مشترک کلاینت و سرور.
 * تعریف گویه‌ها، منطق نمایش، اعتبارسنجی تعریف و پاسخ، و تبدیل قطعی پاسخ به امتیاز ۰..۱۰۰ شاخص.
 * هیچ بخشی از محاسبه به مدل هوش مصنوعی سپرده نمی‌شود؛ هوش مصنوعی فقط پیش‌نویس، بازبینی و تفسیر می‌دهد.
 */
import { ALGORITHM_INDICATORS } from './algorithmIndicators';

export type CustomKind = 'likert5' | 'likert7' | 'binary' | 'choice' | 'multi' | 'number' | 'text';
export type CompareOp = 'eq' | 'neq' | 'gte' | 'lte' | 'in';
export type MappingMethod = 'scale_mean' | 'share_top' | 'share_condition' | 'numeric_normative' | 'option_score';
export type AnswerValue = number | number[] | string;
export type CustomAnswers = Record<string, AnswerValue | undefined>;

export interface CustomOption { value: number; label: string; /** امتیاز ۰..۱۰۰ این گزینه برای روش option_score */ score?: number }
export interface ShowIf { item: string; op: CompareOp; value: number | number[] }
export interface IndicatorMapping {
  /** کد شاخص هسته (H1…R5) یا کد شاخص سفارشی با پیشوند X_ */
  code: string;
  /** primary = مقدار شاخص در کارت؛ check = فقط سنجهٔ کنترلی کنار منبع اصلی */
  role: 'primary' | 'check';
  method: MappingMethod;
  reversed?: boolean;
  op?: CompareOp; threshold?: number | number[];
  best?: number; worst?: number;
  /** جامعهٔ واجد شرایط علاوه بر شرط نمایش (مثلاً فقط مستأجران) */
  population?: ShowIf;
}
export interface CustomItem {
  code: string; text: string; help?: string; kind: CustomKind; required?: boolean; section?: string;
  options?: CustomOption[]; min?: number; max?: number; step?: number; unit?: string; maxLength?: number;
  showIf?: ShowIf; mapping?: IndicatorMapping;
}
export type QuestionnaireStatus = 'draft' | 'published' | 'archived';
export interface CustomQuestionnaire {
  id: string; title: string; description?: string; purpose?: string;
  scope: { kind: 'all' } | { kind: 'cities'; cities: string[] } | { kind: 'neighborhoods'; neighborhoods: string[] };
  status: QuestionnaireStatus; version: number; parentId?: string;
  items: CustomItem[];
  collectDemographics: boolean; minDurationSec: number; minEligible: number;
  createdAt: string; updatedAt: string; publishedAt?: string;
  ai?: { drafted?: { model: string; at: string; goal: string }; reviewedAt?: string };
}
export interface DefinitionIssue { item?: string; field?: string; severity: 'error' | 'warning'; message: string }
export interface Demographics { sex?: 'male' | 'female'; ageBand?: '18-29' | '30-44' | '45-64' | '65+'; tenure?: 'owner' | 'renter' | 'other'; disability?: boolean }

export const KIND_LABELS: Record<CustomKind, string> = {
  likert5: 'طیف ۵ گزینه‌ای', likert7: 'طیف ۷ گزینه‌ای', binary: 'بله / خیر', choice: 'تک‌گزینه‌ای', multi: 'چندگزینه‌ای', number: 'عددی', text: 'متن آزاد',
};
export const METHOD_LABELS: Record<MappingMethod, string> = {
  scale_mean: 'میانگین مقیاس (۰..۱۰۰)', share_top: 'سهم موافق/بله (٪)', share_condition: 'سهم پاسخ‌های دارای شرط (٪)',
  numeric_normative: 'عدد ← امتیاز بین بدترین و بهترین', option_score: 'امتیاز تعریف‌شدهٔ گزینه‌ها',
};
export const LIKERT5_LABELS = ['کاملاً مخالفم', 'مخالفم', 'نظری ندارم', 'موافقم', 'کاملاً موافقم'];
export const LIKERT7_LABELS = ['کاملاً مخالف', 'مخالف', 'تا حدی مخالف', 'بی‌نظر', 'تا حدی موافق', 'موافق', 'کاملاً موافق'];
export const QC_FA: Record<string, string> = {
  NO_CONSENT: 'رضایت ثبت نشده', TOO_FAST: 'زمان تکمیل کمتر از حد مجاز', STRAIGHT_LINING: 'پاسخ یکسان به همهٔ گویه‌های طیفی',
  REQUIRED_MISSING: 'گویهٔ الزامی بی‌پاسخ', INVALID_VALUE: 'مقدار نامعتبر', UNKNOWN_ITEM: 'گویهٔ ناشناخته', DUPLICATE_DEVICE: 'دستگاه تکراری',
  NOT_PUBLISHED: 'پرسشنامه منتشر نشده', OUT_OF_SCOPE: 'پرسشنامه برای این محله تعریف نشده',
};

export const CORE_CODES = ALGORITHM_INDICATORS.map((i) => i.code);
export const CORE_NAME: Record<string, string> = Object.fromEntries(ALGORITHM_INDICATORS.map((i) => [i.code, i.name]));
/** شاخص‌هایی که پیمایش ساکنان منبع معتبر اصلی آن‌هاست؛ برای بقیه، پیمایش فقط سنجهٔ کنترلی است */
export const SURVEY_NATIVE = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'S1', 'S2', 'S3', 'S4', 'C3', 'C4', 'C5', 'E1', 'E4', 'P3', 'G1', 'G2']);

const CODE_RE = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const RESERVED = new Set(['consent', 'sex', 'age_band', 'ageBand', 'tenure', 'disability', 'duration_sec']);

export function isLikert(k: CustomKind) { return k === 'likert5' || k === 'likert7'; }
export function scaleMax(k: CustomKind) { return k === 'likert7' ? 7 : 5; }

export function compare(v: AnswerValue | undefined, op: CompareOp, target: number | number[]): boolean {
  if (v === undefined || typeof v === 'string') return false;
  const vals = Array.isArray(v) ? v : [v];
  const t = Array.isArray(target) ? target : [target];
  switch (op) {
    case 'eq': return vals.some((x) => x === t[0]);
    case 'neq': return vals.every((x) => x !== t[0]);
    case 'gte': return vals.some((x) => x >= t[0]);
    case 'lte': return vals.some((x) => x <= t[0]);
    case 'in': return vals.some((x) => t.includes(x));
  }
}

/** شرط نمایش؛ مرجع ویژهٔ «tenure/sex/ageBand» به مشخصات پاسخگو اشاره دارد */
export function conditionHolds(c: ShowIf | undefined, a: CustomAnswers, demo?: Demographics): boolean {
  if (!c) return true;
  if (c.item === 'tenure' || c.item === 'sex' || c.item === 'ageBand') {
    const map: Record<string, Record<string, number>> = { tenure: { owner: 1, renter: 2, other: 3 }, sex: { female: 1, male: 2 }, ageBand: { '18-29': 1, '30-44': 2, '45-64': 3, '65+': 4 } };
    const raw = demo?.[c.item as 'tenure'];
    return compare(raw ? map[c.item][raw] : undefined, c.op, c.value);
  }
  return compare(a[c.item], c.op, c.value);
}
export const DEMO_CODES: Record<string, Array<{ value: number; label: string }>> = {
  tenure: [{ value: 1, label: 'مالک' }, { value: 2, label: 'مستأجر' }, { value: 3, label: 'سایر' }],
  sex: [{ value: 1, label: 'زن' }, { value: 2, label: 'مرد' }],
  ageBand: [{ value: 1, label: '۱۸–۲۹' }, { value: 2, label: '۳۰–۴۴' }, { value: 3, label: '۴۵–۶۴' }, { value: 4, label: '۶۵+' }],
};

export function visibleCustomItems(q: Pick<CustomQuestionnaire, 'items'>, a: CustomAnswers, demo?: Demographics): CustomItem[] {
  return q.items.filter((i) => conditionHolds(i.showIf, a, demo));
}

/** اعتبار یک مقدار برای یک گویه */
export function validAnswer(item: CustomItem, v: AnswerValue | undefined): boolean {
  if (v === undefined) return true;
  switch (item.kind) {
    case 'likert5': case 'likert7': return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= scaleMax(item.kind);
    case 'binary': return v === 0 || v === 1;
    case 'choice': return typeof v === 'number' && Boolean(item.options?.some((o) => o.value === v));
    case 'multi': return Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every((x) => item.options?.some((o) => o.value === x));
    case 'number': return typeof v === 'number' && Number.isFinite(v) && (item.min === undefined || v >= item.min) && (item.max === undefined || v <= item.max);
    case 'text': return typeof v === 'string' && v.trim().length > 0 && v.length <= (item.maxLength ?? 500);
  }
}

/** اعتبارسنجی تعریف؛ خطاها مانع انتشار و هشدارها راهنمای طراح‌اند */
export function validateDefinition(q: Pick<CustomQuestionnaire, 'title' | 'items' | 'minEligible' | 'minDurationSec' | 'collectDemographics'>): DefinitionIssue[] {
  const out: DefinitionIssue[] = [];
  const err = (message: string, item?: string, field?: string) => out.push({ severity: 'error', message, item, field });
  const warn = (message: string, item?: string, field?: string) => out.push({ severity: 'warning', message, item, field });
  if (!q.title?.trim()) err('عنوان پرسشنامه لازم است', undefined, 'title');
  if (!q.items?.length) err('دست‌کم یک گویه لازم است');
  if ((q.items?.length ?? 0) > 120) err('حداکثر ۱۲۰ گویه مجاز است');
  if (!(q.minEligible >= 10)) err('حداقل پاسخ واجد شرایط برای انتشار برآورد باید ≥ ۱۰ باشد', undefined, 'minEligible');
  if (!(q.minDurationSec >= 0)) err('حداقل زمان تکمیل نامعتبر است', undefined, 'minDurationSec');
  const seen = new Map<string, number>();
  (q.items ?? []).forEach((it, idx) => {
    const c = it.code;
    if (!CODE_RE.test(c ?? '')) err('کد گویه باید با حرف لاتین شروع شود و فقط حرف، عدد و _ داشته باشد (حداکثر ۲۴)', c, 'code');
    if (RESERVED.has(c)) err(`کد «${c}» رزرو شده است`, c, 'code');
    if (seen.has(c)) err(`کد تکراری ${c}`, c, 'code');
    seen.set(c, idx);
    if (!it.text?.trim()) err('متن گویه خالی است', c, 'text');
    if (it.text && it.text.length > 400) warn('متن گویه بلند است؛ پاسخگو خسته می‌شود', c, 'text');
    if (!(it.kind in KIND_LABELS)) err('نوع گویه نامعتبر است', c, 'kind');
    if (it.kind === 'choice' || it.kind === 'multi') {
      const opts = it.options ?? [];
      if (opts.length < 2) err('گویهٔ گزینه‌ای دست‌کم دو گزینه می‌خواهد', c, 'options');
      if (new Set(opts.map((o) => o.value)).size !== opts.length) err('مقدار گزینه‌ها باید یکتا باشد', c, 'options');
      if (opts.some((o) => !o.label?.trim() || !Number.isInteger(o.value))) err('هر گزینه برچسب و مقدار عدد صحیح می‌خواهد', c, 'options');
      if (opts.some((o) => o.score !== undefined && (o.score < 0 || o.score > 100))) err('امتیاز گزینه باید بین ۰ و ۱۰۰ باشد', c, 'options');
    }
    if (it.kind === 'number') {
      if (it.min !== undefined && it.max !== undefined && it.min >= it.max) err('حداقل باید کمتر از حداکثر باشد', c, 'min');
      if (it.min === undefined || it.max === undefined) warn('برای گویهٔ عددی محدودهٔ مجاز (حداقل و حداکثر) تعیین کنید تا پاسخ‌های پرت رد شوند', c, 'min');
    }
    if (it.showIf) {
      const special = ['tenure', 'sex', 'ageBand'].includes(it.showIf.item);
      if (special && !q.collectDemographics) err('شرط بر اساس مشخصات پاسخگو نیازمند فعال بودن پرسش مشخصات است', c, 'showIf');
      if (!special) {
        const j = seen.get(it.showIf.item);
        if (j === undefined || it.showIf.item === c) err(`شرط نمایش باید به گویهٔ پیشین ارجاع دهد (${it.showIf.item})`, c, 'showIf');
        else if (q.items[j].kind === 'text') err('شرط نمایش روی گویهٔ متنی ممکن نیست', c, 'showIf');
      }
    }
    const m = it.mapping;
    if (m) {
      if (!(CORE_CODES.includes(m.code) || /^X_[A-Za-z0-9_]{1,20}$/.test(m.code))) err('کد شاخص باید یکی از ۴۰ شاخص هسته یا با پیشوند X_ (شاخص سفارشی) باشد', c, 'mapping');
      if (it.kind === 'text') err('گویهٔ متنی به شاخص عددی نگاشت نمی‌شود؛ تفسیر متن با هوش مصنوعی انجام می‌شود', c, 'mapping');
      if (m.method === 'scale_mean' && it.kind === 'number' && (m.best === undefined || m.worst === undefined)) err('برای عدد، بهترین و بدترین مقدار را تعیین کنید', c, 'mapping');
      if (m.method === 'scale_mean' && (it.kind === 'choice' || it.kind === 'multi') && !(it.options ?? []).every((o) => o.score !== undefined)) err('برای میانگین روی گزینه‌ها، امتیاز همهٔ گزینه‌ها لازم است', c, 'mapping');
      if (m.method === 'share_top' && !(isLikert(it.kind) || it.kind === 'binary')) err('«سهم موافق/بله» فقط برای طیف یا بله/خیر است', c, 'mapping');
      if (m.method === 'share_condition' && (m.op === undefined || m.threshold === undefined)) err('شرط و مقدار مرز لازم است', c, 'mapping');
      if (m.method === 'numeric_normative' && (it.kind !== 'number' || m.best === undefined || m.worst === undefined || m.best === m.worst)) err('روش عددی فقط برای گویهٔ عددی با بهترین ≠ بدترین است', c, 'mapping');
      if (m.method === 'option_score' && (!(it.kind === 'choice' || it.kind === 'multi') || !(it.options ?? []).every((o) => o.score !== undefined))) err('روش امتیاز گزینه نیازمند امتیاز همهٔ گزینه‌هاست', c, 'mapping');
      if (m.role === 'primary' && CORE_CODES.includes(m.code) && !SURVEY_NATIVE.has(m.code)) warn(`${m.code} شاخص عینی است؛ پیمایش بهتر است فقط «سنجهٔ کنترلی» آن باشد`, c, 'mapping');
      if (m.population && !['tenure', 'sex', 'ageBand'].includes(m.population.item) && !seen.has(m.population.item)) err('جامعهٔ هدف باید به گویهٔ پیشین ارجاع دهد', c, 'mapping');
    }
  });
  // شاخص‌های چندگویه‌ای باید روش هم‌جهت داشته باشند
  const byCode = new Map<string, CustomItem[]>();
  for (const it of q.items ?? []) if (it.mapping) byCode.set(it.mapping.code, [...(byCode.get(it.mapping.code) ?? []), it]);
  for (const [code, list] of byCode) {
    if (new Set(list.map((i) => i.mapping!.role)).size > 1) err(`گویه‌های شاخص ${code} باید نقش یکسان داشته باشند`, list[0].code, 'mapping');
  }
  if ((q.items ?? []).length && !(q.items ?? []).some((i) => i.mapping)) warn('هیچ گویه‌ای به شاخص نگاشت نشده؛ نتایج فقط توصیفی خواهند بود و به کارت تصمیم نمی‌رسند');
  return out;
}

/** امتیاز ۰..۱۰۰ یک پاسخ برای نگاشت گویه؛ null یعنی ناواجد شرایط یا بی‌پاسخ */
export function itemScore(item: CustomItem, v: AnswerValue | undefined): number | null {
  const m = item.mapping;
  if (!m || v === undefined || typeof v === 'string' || !validAnswer(item, v)) return null;
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const flip = (x: number) => (m.reversed ? 100 - x : x);
  const optScore = (x: number) => item.options?.find((o) => o.value === x)?.score;
  switch (m.method) {
    case 'scale_mean': {
      if (isLikert(item.kind)) return flip(((v as number) - 1) / (scaleMax(item.kind) - 1) * 100);
      if (item.kind === 'binary') return flip((v as number) * 100);
      if (item.kind === 'number') return m.best === undefined || m.worst === undefined ? null : flip(clamp(((v as number) - m.worst) / (m.best - m.worst) * 100));
      const vals = (Array.isArray(v) ? v : [v]).map(optScore).filter((x): x is number => x !== undefined);
      return vals.length ? flip(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    }
    case 'share_top': {
      if (item.kind === 'binary') return flip((v as number) * 100);
      const top = item.kind === 'likert7' ? 6 : 4;
      const pos = m.reversed ? (v as number) <= scaleMax(item.kind) + 1 - top : (v as number) >= top;
      return pos ? 100 : 0;
    }
    case 'share_condition': return compare(v, m.op ?? 'eq', m.threshold ?? 0) !== Boolean(m.reversed) ? 100 : 0;
    case 'numeric_normative': return m.best === undefined || m.worst === undefined ? null : clamp(((v as number) - m.worst) / (m.best - m.worst) * 100);
    case 'option_score': {
      const vals = (Array.isArray(v) ? v : [v]).map(optScore).filter((x): x is number => x !== undefined);
      return vals.length ? flip(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    }
  }
}

/** آیا پاسخگو در جامعهٔ هدف نگاشت است (شرط نمایش + جامعهٔ هدف) */
export function eligibleFor(item: CustomItem, a: CustomAnswers, demo?: Demographics): boolean {
  return conditionHolds(item.showIf, a, demo) && conditionHolds(item.mapping?.population, a, demo);
}

/** کنترل کیفیت پاسخ */
export function checkResponse(q: CustomQuestionnaire, r: { answers: CustomAnswers; consent: boolean; durationSec: number; demographics?: Demographics }): string[] {
  const reasons: string[] = [];
  if (!r.consent) reasons.push('NO_CONSENT');
  if (!(r.durationSec >= q.minDurationSec)) reasons.push('TOO_FAST');
  const codes = new Set(q.items.map((i) => i.code));
  if (Object.keys(r.answers ?? {}).some((k) => !codes.has(k))) reasons.push('UNKNOWN_ITEM');
  const vis = visibleCustomItems(q, r.answers ?? {}, r.demographics);
  if (q.items.some((i) => !validAnswer(i, r.answers?.[i.code]))) reasons.push('INVALID_VALUE');
  if (vis.some((i) => i.required && r.answers?.[i.code] === undefined)) reasons.push('REQUIRED_MISSING');
  const lik = vis.filter((i) => isLikert(i.kind)).map((i) => r.answers?.[i.code]).filter((v) => typeof v === 'number');
  if (lik.length >= 8 && new Set(lik).size === 1) reasons.push('STRAIGHT_LINING');
  return reasons;
}

export function inScope(q: Pick<CustomQuestionnaire, 'scope'>, neighborhoodId: string): boolean {
  if (q.scope.kind === 'all') return true;
  if (q.scope.kind === 'cities') return q.scope.cities.includes(neighborhoodId.split(':')[0]);
  return q.scope.neighborhoods.includes(neighborhoodId);
}

export function blankQuestionnaire(neighborhoodId?: string): Omit<CustomQuestionnaire, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    title: '', description: '', purpose: '', status: 'draft', version: 1,
    scope: neighborhoodId ? { kind: 'neighborhoods', neighborhoods: [neighborhoodId] } : { kind: 'all' },
    items: [], collectDemographics: true, minDurationSec: 60, minEligible: 30,
  };
}
