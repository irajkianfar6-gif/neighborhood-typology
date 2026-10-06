/**
 * پرسشنامهٔ سفارشی: ذخیره، نسخه‌بندی، ثبت پاسخ با کنترل کیفیت، و برآورد قطعی شاخص‌ها.
 *
 * - هر پرسشنامه یک تعریف JSON دارد (پیش‌نویس ← منتشرشده ← بایگانی). تعریف منتشرشده قفل است؛ تغییر = نسخهٔ جدید.
 * - امتیاز هر پاسخ برای هر گویهٔ نگاشت‌شده از customSurveyModel.itemScore (۰..۱۰۰) به دست می‌آید.
 * - شاخص = میانگین وزنی (raking جنس × سن) میانگینِ امتیاز گویه‌های همان شاخص برای هر پاسخگوی واجد شرایط.
 * - CI95 = میانگین ± ۱٫۹۶ × انحراف معیار وزنی ÷ √n مؤثر؛ آلفای کرونباخ برای شاخص‌های چندگویه‌ای.
 * - فقط وقتی n واجد شرایط ≥ minEligible باشد برآورد «قابل انتشار» است و به کارت تصمیم می‌رود.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';
import {
  CORE_CODES, CORE_NAME, checkResponse, eligibleFor, inScope, isLikert, itemScore, validateDefinition, visibleCustomItems,
  type CustomAnswers, type CustomItem, type MappingMethod, type CustomQuestionnaire, type DefinitionIssue, type Demographics,
} from '../../src/algorithm/customSurveyModel';
import { cronbachAlpha, rake, type RakingTargets } from './perceptualSurvey';

export interface CustomResponseInput {
  answers: CustomAnswers; demographics?: Demographics; consent: boolean; durationSec: number;
  collectedAt?: string; collectorId?: string; deviceId?: string; mode?: 'self' | 'interviewer' | 'paper' | 'import'; respondentId?: string;
}
export interface StoredCustomResponse extends CustomResponseInput {
  responseId: string; questionnaireId: string; version: number; neighborhoodId: string; receivedAt: string; deviceHash?: string;
  qc: { accepted: boolean; reasons: string[] };
}

const root = () => path.join(serverDataDir(), 'custom-surveys');
const defDir = () => { const d = path.join(root(), 'defs'); fs.mkdirSync(d, { recursive: true }); return d; };
const safe = (s: string) => s.replace(/[^\w.-]/g, '_');
const respFile = (qid: string, nb: string) => { const d = path.join(root(), 'responses', safe(qid)); fs.mkdirSync(d, { recursive: true }); return path.join(d, `${safe(nb.replace(/:/g, '__'))}.jsonl`); };
const ID_RE = /^cq-[a-z0-9-]{4,40}$/;

export class SurveyError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }

export function listQuestionnaires(): CustomQuestionnaire[] {
  return fs.readdirSync(defDir()).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(defDir(), f), 'utf8')) as CustomQuestionnaire)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function getQuestionnaire(id: string): CustomQuestionnaire | null {
  if (!ID_RE.test(id)) return null;
  const f = path.join(defDir(), `${id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) as CustomQuestionnaire : null;
}
function save(q: CustomQuestionnaire) { fs.writeFileSync(path.join(defDir(), `${q.id}.json`), JSON.stringify(q, null, 1)); return q; }

/** پاک‌سازی ورودی کاربر به ساختار مجاز (فیلدهای ناشناخته حذف می‌شوند) */
export function sanitizeDefinition(input: Partial<CustomQuestionnaire>): Omit<CustomQuestionnaire, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'version'> {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const cond = (c: unknown) => {
    const x = c as { item?: unknown; op?: unknown; value?: unknown } | undefined;
    if (!x || typeof x.item !== 'string' || !['eq', 'neq', 'gte', 'lte', 'in'].includes(String(x.op))) return undefined;
    const value = Array.isArray(x.value) ? x.value.filter((n) => typeof n === 'number') : num(x.value);
    return value === undefined ? undefined : { item: x.item, op: x.op as 'eq', value };
  };
  const items: CustomItem[] = (Array.isArray(input.items) ? input.items : []).slice(0, 150).map((raw) => {
    const it = raw as unknown as Record<string, unknown>;
    const m = it.mapping as Record<string, unknown> | undefined;
    return {
      code: str(it.code, 24)?.trim() ?? '', text: str(it.text, 600)?.trim() ?? '', help: str(it.help, 300) || undefined,
      kind: String(it.kind) as CustomItem['kind'], required: Boolean(it.required), section: str(it.section, 80) || undefined,
      options: Array.isArray(it.options) ? (it.options as Array<Record<string, unknown>>).slice(0, 30).map((o) => ({ value: Number(o.value), label: str(o.label, 160) ?? '', score: num(o.score) })) : undefined,
      min: num(it.min), max: num(it.max), step: num(it.step), unit: str(it.unit, 40) || undefined, maxLength: num(it.maxLength),
      showIf: cond(it.showIf),
      mapping: m && typeof m.code === 'string' && m.code ? {
        code: m.code.trim(), role: m.role === 'check' ? 'check' : 'primary', method: String(m.method) as MappingMethod,
        reversed: Boolean(m.reversed) || undefined, op: ['eq', 'neq', 'gte', 'lte', 'in'].includes(String(m.op)) ? m.op as 'eq' : undefined,
        threshold: Array.isArray(m.threshold) ? (m.threshold as unknown[]).filter((n) => typeof n === 'number') as number[] : num(m.threshold),
        best: num(m.best), worst: num(m.worst), population: cond(m.population),
      } : undefined,
    };
  });
  const sc = input.scope as CustomQuestionnaire['scope'] | undefined;
  const scope: CustomQuestionnaire['scope'] = sc?.kind === 'cities' && Array.isArray(sc.cities) ? { kind: 'cities', cities: sc.cities.map(String).slice(0, 50) }
    : sc?.kind === 'neighborhoods' && Array.isArray(sc.neighborhoods) ? { kind: 'neighborhoods', neighborhoods: sc.neighborhoods.map(String).slice(0, 500) } : { kind: 'all' };
  return {
    title: str(input.title, 200)?.trim() ?? '', description: str(input.description, 2000), purpose: str(input.purpose, 2000), scope, items,
    collectDemographics: input.collectDemographics !== false, minDurationSec: Math.max(0, Math.min(3600, num(input.minDurationSec) ?? 60)),
    minEligible: Math.max(10, Math.min(1000, Math.round(num(input.minEligible) ?? 30))), parentId: undefined, publishedAt: undefined,
    ai: input.ai,
  };
}

export function createQuestionnaire(input: Partial<CustomQuestionnaire>): { questionnaire: CustomQuestionnaire; issues: DefinitionIssue[] } {
  const now = new Date().toISOString();
  const q: CustomQuestionnaire = { ...sanitizeDefinition(input), id: `cq-${now.slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`, status: 'draft', version: 1, createdAt: now, updatedAt: now };
  return { questionnaire: save(q), issues: validateDefinition(q) };
}

export function updateQuestionnaire(id: string, input: Partial<CustomQuestionnaire>): { questionnaire: CustomQuestionnaire; issues: DefinitionIssue[] } {
  const cur = getQuestionnaire(id);
  if (!cur) throw new SurveyError(404, 'NOT_FOUND', 'پرسشنامه یافت نشد');
  if (cur.status !== 'draft') throw new SurveyError(409, 'LOCKED', 'پرسشنامهٔ منتشرشده قفل است؛ برای تغییر «نسخهٔ جدید» بسازید');
  const q: CustomQuestionnaire = { ...cur, ...sanitizeDefinition(input), parentId: cur.parentId, ai: input.ai ?? cur.ai, updatedAt: new Date().toISOString() };
  return { questionnaire: save(q), issues: validateDefinition(q) };
}

export function publishQuestionnaire(id: string): CustomQuestionnaire {
  const q = getQuestionnaire(id);
  if (!q) throw new SurveyError(404, 'NOT_FOUND', 'پرسشنامه یافت نشد');
  if (q.status !== 'draft') throw new SurveyError(409, 'NOT_DRAFT', 'فقط پیش‌نویس منتشر می‌شود');
  const errors = validateDefinition(q).filter((i) => i.severity === 'error');
  if (errors.length) throw new SurveyError(422, 'INVALID_DEFINITION', 'تعریف پرسشنامه خطا دارد', errors);
  // نسخهٔ منتشرشدهٔ قبلی همین خانواده بایگانی می‌شود (پاسخ‌هایش محفوظ می‌ماند)
  if (q.parentId) for (const other of listQuestionnaires()) if (other.status === 'published' && familyOf(other) === familyOf(q) && other.id !== q.id) save({ ...other, status: 'archived', updatedAt: new Date().toISOString() });
  return save({ ...q, status: 'published', publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}
function familyOf(q: CustomQuestionnaire): string { return q.parentId ? (getQuestionnaire(q.parentId) ? familyOf(getQuestionnaire(q.parentId)!) : q.parentId) : q.id; }

export function newVersion(id: string): CustomQuestionnaire {
  const q = getQuestionnaire(id);
  if (!q) throw new SurveyError(404, 'NOT_FOUND', 'پرسشنامه یافت نشد');
  const now = new Date().toISOString();
  return save({ ...q, id: `cq-${now.slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`, status: 'draft', version: q.version + 1, parentId: q.id, createdAt: now, updatedAt: now, publishedAt: undefined });
}
export function archiveQuestionnaire(id: string): CustomQuestionnaire {
  const q = getQuestionnaire(id);
  if (!q) throw new SurveyError(404, 'NOT_FOUND', 'پرسشنامه یافت نشد');
  return save({ ...q, status: 'archived', updatedAt: new Date().toISOString() });
}
export function deleteQuestionnaire(id: string): void {
  const q = getQuestionnaire(id);
  if (!q) throw new SurveyError(404, 'NOT_FOUND', 'پرسشنامه یافت نشد');
  if (q.status !== 'draft') throw new SurveyError(409, 'LOCKED', 'فقط پیش‌نویس حذف می‌شود؛ پرسشنامهٔ منتشرشده را بایگانی کنید');
  fs.rmSync(path.join(defDir(), `${id}.json`));
}

export function loadCustomResponses(qid: string, nb: string): StoredCustomResponse[] {
  const f = respFile(qid, nb);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as StoredCustomResponse);
}
export function responseCounts(qid: string): Record<string, { total: number; accepted: number }> {
  const d = path.join(root(), 'responses', safe(qid));
  if (!fs.existsSync(d)) return {};
  const out: Record<string, { total: number; accepted: number }> = {};
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.jsonl'))) {
    const rows = fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as StoredCustomResponse);
    if (rows.length) out[rows[0].neighborhoodId] = { total: rows.length, accepted: rows.filter((r) => r.qc.accepted).length };
  }
  return out;
}

const AGE = new Set(['18-29', '30-44', '45-64', '65+']);
function cleanDemo(d: unknown): Demographics | undefined {
  const x = (d ?? {}) as Record<string, unknown>;
  const out: Demographics = {};
  if (x.sex === 'male' || x.sex === 'female') out.sex = x.sex;
  if (typeof x.ageBand === 'string' && AGE.has(x.ageBand)) out.ageBand = x.ageBand as Demographics['ageBand'];
  if (x.tenure === 'owner' || x.tenure === 'renter' || x.tenure === 'other') out.tenure = x.tenure;
  if (typeof x.disability === 'boolean') out.disability = x.disability;
  return Object.keys(out).length ? out : undefined;
}

export function addCustomResponses(qid: string, nb: string, inputs: CustomResponseInput[]): StoredCustomResponse[] {
  const q = getQuestionnaire(qid);
  if (!q) throw new SurveyError(404, 'NOT_FOUND', 'پرسشنامه یافت نشد');
  if (q.status !== 'published') throw new SurveyError(409, 'NOT_PUBLISHED', 'فقط پرسشنامهٔ منتشرشده پاسخ می‌پذیرد');
  if (!inScope(q, nb)) throw new SurveyError(422, 'OUT_OF_SCOPE', 'این پرسشنامه برای این محله تعریف نشده است');
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 2000) throw new SurveyError(400, 'INVALID_INPUT', 'آرایهٔ responses (۱ تا ۲۰۰۰) لازم است');
  const existing = loadCustomResponses(qid, nb);
  const out: StoredCustomResponse[] = [];
  for (const raw of inputs) {
    const answers: CustomAnswers = {};
    for (const [k, v] of Object.entries(raw?.answers ?? {})) {
      if (typeof v === 'string') { const t = v.replace(/[\u0000-\u001f]/g, ' ').trim(); if (t) answers[k] = t.slice(0, 2000); }
      else if (typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number'))) answers[k] = v;
    }
    const demographics = q.collectDemographics ? cleanDemo(raw?.demographics) : undefined;
    const input: CustomResponseInput = { answers, demographics, consent: raw?.consent === true, durationSec: Number(raw?.durationSec) || 0,
      collectedAt: typeof raw?.collectedAt === 'string' ? raw.collectedAt : undefined, collectorId: typeof raw?.collectorId === 'string' ? raw.collectorId.slice(0, 60) : undefined,
      mode: ['self', 'interviewer', 'paper', 'import'].includes(String(raw?.mode)) ? raw.mode : undefined, respondentId: typeof raw?.respondentId === 'string' ? raw.respondentId.slice(0, 60) : undefined };
    const reasons = checkResponse(q, input);
    const deviceHash = typeof raw?.deviceId === 'string' && raw.deviceId ? crypto.createHash('sha256').update(raw.deviceId).digest('hex').slice(0, 16) : undefined;
    if (deviceHash && [...existing, ...out].some((r) => r.deviceHash === deviceHash && r.qc.accepted)) reasons.push('DUPLICATE_DEVICE');
    out.push({ ...input, responseId: crypto.randomUUID(), questionnaireId: qid, version: q.version, neighborhoodId: nb, receivedAt: new Date().toISOString(), deviceHash, qc: { accepted: reasons.length === 0, reasons } });
  }
  fs.appendFileSync(respFile(qid, nb), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return out;
}

// ------------------------------------------------------------------ برآورد
export interface CustomIndicatorEstimate {
  code: string; name: string; role: 'primary' | 'check'; items: string[]; methods: string[];
  score: number | null; ci95: [number, number] | null; n: number; nEffective: number; alpha: number | null;
  publishable: boolean; core: boolean; groups: Record<string, Record<string, { score: number; n: number }>>;
}
export interface CustomItemStat {
  code: string; text: string; kind: CustomItem['kind']; n: number; eligible: number;
  distribution?: Array<{ value: number; label: string; count: number; share: number }>;
  mean?: number | null; median?: number | null; sd?: number | null; min?: number | null; max?: number | null;
  textSamples?: Array<{ id: string; text: string }>; score?: number | null;
}
export interface CustomSurveySummary {
  questionnaireId: string; version: number; neighborhoodId: string; nReceived: number; nAccepted: number;
  rejectedByReason: Record<string, number>; weighting: 'raked' | 'none'; weightingNote?: string;
  indicators: CustomIndicatorEstimate[]; items: CustomItemStat[]; latestResponseAt: string | null; textAnswers: number;
}

function wStats(pairs: Array<{ v: number; w: number }>) {
  const W = pairs.reduce((a, p) => a + p.w, 0);
  const mean = pairs.reduce((a, p) => a + p.v * p.w, 0) / W;
  const varW = pairs.reduce((a, p) => a + p.w * (p.v - mean) ** 2, 0) / W;
  const s2 = pairs.reduce((a, p) => a + p.w * p.w, 0);
  const nEff = (W * W) / s2;
  const se = Math.sqrt(varW * (pairs.length / Math.max(1, pairs.length - 1)) / Math.max(1, nEff));
  return { mean, sd: Math.sqrt(varW), nEff, se };
}
const r1 = (x: number) => Math.round(x * 10) / 10;

export function summarizeCustom(q: CustomQuestionnaire, nb: string, targets: RakingTargets = {}): CustomSurveySummary {
  const all = loadCustomResponses(q.id, nb);
  const ok = all.filter((r) => r.qc.accepted);
  const rejectedByReason: Record<string, number> = {};
  for (const r of all) if (!r.qc.accepted) for (const x of r.qc.reasons) rejectedByReason[x] = (rejectedByReason[x] ?? 0) + 1;
  const useRake = q.collectDemographics && (['sex', 'ageBand'] as const).some((d) => targets[d] && Object.keys(targets[d]!).length);
  const w = useRake ? rake(ok, targets) : ok.map(() => 1);

  const items: CustomItemStat[] = q.items.map((it) => {
    const elig = ok.map((r, i) => ({ r, w: w[i] })).filter((x) => conditionVisible(it, x.r));
    const ans = elig.filter((x) => x.r.answers[it.code] !== undefined);
    const st: CustomItemStat = { code: it.code, text: it.text, kind: it.kind, n: ans.length, eligible: elig.length };
    if (it.kind === 'text') {
      st.textSamples = ans.slice(-200).map((x) => ({ id: x.r.responseId.slice(0, 8), text: String(x.r.answers[it.code]) }));
      return st;
    }
    if (it.kind === 'number') {
      const vals = ans.map((x) => ({ v: x.r.answers[it.code] as number, w: x.w })).sort((a, b) => a.v - b.v);
      if (vals.length) {
        const s = wStats(vals);
        let acc = 0; const half = vals.reduce((a, p) => a + p.w, 0) / 2;
        const med = vals.find((p) => (acc += p.w) >= half)?.v ?? null;
        Object.assign(st, { mean: r1(s.mean), sd: r1(s.sd), median: med, min: vals[0].v, max: vals[vals.length - 1].v });
      }
    } else {
      const opts = isLikert(it.kind) ? Array.from({ length: it.kind === 'likert7' ? 7 : 5 }, (_, k) => ({ value: k + 1, label: String(k + 1) }))
        : it.kind === 'binary' ? [{ value: 1, label: 'بله' }, { value: 0, label: 'خیر' }] : (it.options ?? []).map((o) => ({ value: o.value, label: o.label }));
      const W = ans.reduce((a, x) => a + x.w, 0) || 1;
      st.distribution = opts.map((o) => {
        const hit = ans.filter((x) => { const v = x.r.answers[it.code]; return Array.isArray(v) ? v.includes(o.value) : v === o.value; });
        return { ...o, count: hit.length, share: r1((hit.reduce((a, x) => a + x.w, 0) / W) * 100) };
      });
      if (isLikert(it.kind) && ans.length) st.mean = Math.round(wStats(ans.map((x) => ({ v: x.r.answers[it.code] as number, w: x.w }))).mean * 100) / 100;
    }
    if (it.mapping) {
      const sc = ans.map((x) => ({ v: itemScore(it, x.r.answers[it.code]), w: x.w })).filter((p): p is { v: number; w: number } => p.v !== null);
      st.score = sc.length ? r1(wStats(sc).mean) : null;
    }
    return st;
  });

  // شاخص‌ها
  const groupsOf = new Map<string, CustomItem[]>();
  for (const it of q.items) if (it.mapping) groupsOf.set(it.mapping.code, [...(groupsOf.get(it.mapping.code) ?? []), it]);
  const indicators: CustomIndicatorEstimate[] = [];
  for (const [code, its] of groupsOf) {
    const per = ok.map((r, i) => {
      const scores = its.filter((it) => eligibleFor(it, r.answers, r.demographics)).map((it) => itemScore(it, r.answers[it.code])).filter((x): x is number => x !== null);
      return scores.length ? { v: scores.reduce((a, b) => a + b, 0) / scores.length, w: w[i], r } : null;
    }).filter((x): x is { v: number; w: number; r: StoredCustomResponse } => x !== null);
    let alpha: number | null = null;
    if (its.length >= 2) {
      const rows = ok.map((r) => its.map((it) => itemScore(it, r.answers[it.code]))).filter((row) => row.every((x) => x !== null)) as number[][];
      const a = cronbachAlpha(rows);
      alpha = a === null ? null : Math.round(a * 100) / 100;
    }
    const s = per.length ? wStats(per) : null;
    const groups: CustomIndicatorEstimate['groups'] = {};
    if (q.collectDemographics) for (const g of ['sex', 'ageBand', 'tenure'] as const) {
      const byV = new Map<string, Array<{ v: number; w: number }>>();
      for (const p of per) { const k = p.r.demographics?.[g]; if (k) byV.set(k, [...(byV.get(k) ?? []), p]); }
      const ge = Object.fromEntries([...byV].filter(([, xs]) => xs.length >= Math.min(30, q.minEligible)).map(([k, xs]) => [k, { score: r1(wStats(xs).mean), n: xs.length }]));
      if (Object.keys(ge).length >= 2) groups[g] = ge;
    }
    indicators.push({
      code, name: CORE_NAME[code] ?? code, role: its[0].mapping!.role, items: its.map((i) => i.code), methods: [...new Set(its.map((i) => i.mapping!.method))],
      score: s ? r1(s.mean) : null, ci95: s ? [r1(Math.max(0, s.mean - 1.96 * s.se)), r1(Math.min(100, s.mean + 1.96 * s.se))] : null,
      n: per.length, nEffective: s ? Math.round(s.nEff) : 0, alpha, publishable: per.length >= q.minEligible, core: CORE_CODES.includes(code), groups,
    });
  }
  return {
    questionnaireId: q.id, version: q.version, neighborhoodId: nb, nReceived: all.length, nAccepted: ok.length, rejectedByReason,
    weighting: useRake ? 'raked' : 'none', weightingNote: useRake ? targets.note : undefined, indicators, items,
    latestResponseAt: ok.map((r) => r.collectedAt ?? r.receivedAt).sort().pop() ?? null,
    textAnswers: items.reduce((a, i) => a + (i.kind === 'text' ? i.n : 0), 0),
  };
}
function conditionVisible(it: CustomItem, r: StoredCustomResponse): boolean {
  return visibleCustomItems({ items: [it] }, r.answers, r.demographics).length === 1;
}

/** پرسشنامه‌های فعال برای یک محله (منتشرشده یا بایگانی‌شده با پاسخ) */
export function questionnairesWithData(nb: string): CustomQuestionnaire[] {
  return listQuestionnaires().filter((q) => q.status !== 'draft' && inScope(q, nb) && loadCustomResponses(q.id, nb).length > 0);
}

/** CSV پاسخ‌های پذیرفته (برای تحلیل بیرونی) */
export function exportCsv(q: CustomQuestionnaire, nb: string): string {
  const rows = loadCustomResponses(q.id, nb);
  const head = ['response_id', 'accepted', 'qc_reasons', 'collected_at', 'mode', 'sex', 'age_band', 'tenure', 'duration_sec', ...q.items.map((i) => i.code)];
  const esc = (v: unknown) => { const s = v === undefined || v === null ? '' : Array.isArray(v) ? v.join('|') : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '\uFEFF' + [head.join(','), ...rows.map((r) => [r.responseId, r.qc.accepted ? 1 : 0, r.qc.reasons.join('|'), r.collectedAt ?? r.receivedAt, r.mode ?? '', r.demographics?.sex ?? '', r.demographics?.ageBand ?? '', r.demographics?.tenure ?? '', r.durationSec, ...q.items.map((i) => r.answers[i.code])].map(esc).join(','))].join('\n');
}
