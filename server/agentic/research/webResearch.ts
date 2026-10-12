/**
 * A2 — پژوهش وب شاخص‌محور (WEBRES-v1).
 * برای هر شاخصِ بی‌داده، پژوهش چندمرحله‌ای با خروجی ساخت‌یافته اجرا می‌شود؛ سپس هر عدد پیشنهادی
 * به‌طور قطعی راستی‌آزمایی می‌شود: ارجاع به منبع، وجود همان عدد در متن منبع، دامنهٔ مجاز، سطح مکانی و دوره.
 * هیچ عددی مستقیم وارد سنجه نمی‌شود: پس از تأیید کارشناس فقط یک دستهٔ قراردادیِ «در انتظار بازبینی» ساخته می‌شود.
 * شاخص‌های ادراکی/پیمایشی پژوهش نمی‌شوند (جانشین‌سازی پیمایش با وب ممنوع است).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../../paths';
import { ALGORITHM_INDICATORS } from '../../../src/algorithm/algorithmIndicators';
import { CONTRACT_COLUMNS, createBatch } from '../../ingestion/contractData';
import { citySlug, normalizeFa } from '../../neighborhood/text';
import { requireEntry, runAnalysis, ToolInputError } from '../state';
import { INDICATOR_LEXICON } from './columns';
import { registeredDomains, upsertCard, verifyUrl, type FetchFn } from './discovery';
import { lamAlefFold } from './documents';
import { indexItem } from './memory';
import { detectPeriod, latinDigits, parseNumberFa } from './numbers';
import { gapsFromCard } from './research';
import { SOURCE_CATALOG } from './sourceCatalog';
import { allOfficialDomains } from '../cities';
import { districtNumber, matchUnit } from './spatialMatch';
import { clampEffort, webConfig, youContents, youResearch, type Effort, type ResearchSource, type WebClientDeps } from './webClient';

export const WEBRESEARCH_VERSION = 'WEBRES-v1';
type Level = 'neighborhood' | 'district' | 'city' | 'province' | 'national' | 'unknown';
export interface RawCandidate { value: number | null; unit: string; period: string | null; spatialLevel: Level; areaName: string; sourceUrl: string; sourceTitle: string; quote: string; isOfficial: boolean }
export type Grounding = 'page' | 'snippet' | 'quote_only' | 'none';
export interface Candidate extends RawCandidate {
  idx: number;
  check: { cited: boolean; grounding: Grounding; plausible: boolean; spatial: 'match' | 'mismatch' | 'too_coarse' | 'unknown'; contractLevel: 'neighborhood' | 'district' | null; periodEnd: string | null; reasons: string[] };
  status: 'acceptable' | 'needs_review' | 'rejected';
  decision: null | { decision: 'approved' | 'rejected'; by: string; at: string; note: string | null; batchId: string | null };
}
export interface IndicatorFinding { code: string; name: string; definition: string; status: 'found' | 'not_found' | 'error'; notes: string; candidates: Candidate[]; sources: ResearchSource[]; sourceCards: string[]; effort: Effort; costUsd: number; cached: boolean; ms: number; error?: string }
export interface WebResearchRecord {
  schema: 'ara.web-research.v1'; id: string; version: string; createdAt: string; finishedAt: string | null; createdBy: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted'; neighborhoodId: string; nameFa: string; cityFa: string; district: number | null;
  effort: Effort; codes: string[]; skipped: { surveyOnly: string[]; notInContract: string[] }; findings: IndicatorFinding[];
  summary: { acceptable: number; needsReview: number; rejected: number; notFound: number; costUsd: number }; error: string | null;
}

const dir = () => { const d = path.join(serverDataDir(), 'agentic', 'webresearch', 'records'); fs.mkdirSync(d, { recursive: true }); return d; };
const safe = (id: string) => id.replace(/[^\w-]/g, '');
export function saveWebResearch(r: WebResearchRecord) { fs.writeFileSync(path.join(dir(), `${safe(r.id)}.json`), JSON.stringify(r, null, 1)); return r; }
export function getWebResearch(id: string): WebResearchRecord | null { try { return JSON.parse(fs.readFileSync(path.join(dir(), `${safe(id)}.json`), 'utf8')); } catch { return null; } }
export function listWebResearch(nb?: string, limit = 30): WebResearchRecord[] {
  return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) as WebResearchRecord; } catch { return null; } })
    .filter((r): r is WebResearchRecord => Boolean(r) && (!nb || r!.neighborhoodId === nb)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
/** کارهای نیمه‌تمام پس از راه‌اندازی دوبارهٔ سرور */
export function markInterrupted(): number { let n = 0; for (const r of listWebResearch(undefined, 500)) if (r.status === 'running') { r.status = 'interrupted'; r.error = 'سرور در میانهٔ کار راه‌اندازی دوباره شد'; saveWebResearch(r); n++; } return n; }

// ---------------- خروجی ساخت‌یافته (زیرمجموعهٔ پشتیبانی‌شدهٔ JSON Schema) ----------------
export const CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['candidates', 'notes'],
  properties: {
    notes: { type: 'string' },
    candidates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['value', 'unit', 'period', 'spatialLevel', 'areaName', 'sourceUrl', 'sourceTitle', 'quote', 'isOfficial'], properties: {
      value: { type: ['number', 'null'] }, unit: { type: 'string' }, period: { type: ['string', 'null'] },
      spatialLevel: { type: 'string', enum: ['neighborhood', 'district', 'city', 'province', 'national', 'unknown'] },
      areaName: { type: 'string' }, sourceUrl: { type: 'string' }, sourceTitle: { type: 'string' }, quote: { type: 'string' }, isOfficial: { type: 'boolean' },
    } } },
  },
} as const;

const OFFICIAL_DOMAINS = ['amar.org.ir', 'tehran.ir', 'shahr.ir', 'mporg.ir', 'mrud.ir', 'karaj.ir', 'irimo.ir', 'doe.ir', 'medu.ir', 'behdasht.gov.ir', 'cbi.ir'];
function boostDomains(): string[] {
  const s = new Set(OFFICIAL_DOMAINS);
  for (const c of SOURCE_CATALOG) { try { s.add(new URL(c.url).hostname.replace(/^www\./, '')); } catch { /* */ } }
  for (const d of registeredDomains()) s.add(d);
  for (const d of allOfficialDomains()) s.add(d);
  return [...s].slice(0, 200);
}

/** شاخص‌های ادراکی/نگرشی: فقط با پیمایش استاندارد سنجیده می‌شوند، نه با آمار منتشرشده */
export const PERCEPTUAL_ONLY = new Set(['S1', 'S2', 'S3', 'C3']);

/** تعریف شاخص: از فهرست الگوریتم، یا از واژه‌نامهٔ قرارداد (مثل POP/HOUSEHOLDS) */
export function indicatorDef(code: string): { name: string; definition: string; formula: string } | null {
  const ind = ALGORITHM_INDICATORS.find((i) => i.code === code);
  if (ind) return { name: ind.name, definition: ind.operationalDefinition, formula: ind.formula };
  const lex = INDICATOR_LEXICON[code];
  if (!lex) return null;
  return { name: lex.name, definition: lex.name, formula: 'as published' };
}

export function buildPrompt(code: string, e: { nameFa: string; cityFa: string; districtFa?: string; nameEn?: string }): string {
  const ind = indicatorDef(code) ?? { name: code, definition: code, formula: 'as published' };
  const lex = INDICATOR_LEXICON[code];
  return [
    'Task: find the most recent PUBLISHED statistic for one urban indicator, for evidence-based neighbourhood planning.',
    `Indicator ${code}: ${ind.name} — ${ind.definition}. Formula: ${ind.formula}. Unit: ${lex?.percent ? 'percent (0–100)' : lex?.count ? 'count' : 'as defined'}.`,
    `Area: محله ${e.nameFa}${e.nameEn ? ` (${e.nameEn})` : ''}، ${e.districtFa ?? ''}، شهر ${e.cityFa}، ایران.`,
    'Preference order for spatial level: this neighbourhood → its municipal district (منطقه) → the city. Report the level honestly in spatialLevel; if only a coarser level (district or city) is published, still report it with that level — it will be shown as context, not as a neighbourhood value.',
    'Prefer official statistics (Statistical Centre of Iran, municipality reports, census 1390/1395, ministries) and peer-reviewed studies with tables.',
    'Rules: report ONLY numbers that appear verbatim in a cited source; copy the exact sentence or table row containing the number into "quote"; never estimate, average, convert or infer.',
    'sourceUrl must be one of the sources you actually read. If no source states the value, return an empty candidates array and explain in notes what sources exist (e.g. a report that contains the table).',
    'Give at most 4 candidates. Write notes in Persian.',
  ].join('\n');
}

// ---------------- راستی‌آزمایی قطعی ----------------
const normUrl = (u: string) => { try { const x = new URL(u); x.hash = ''; return decodeURI(x.toString()).replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/, ''); } catch { return u.trim(); } };
const NUM_RE = /[-−]?[0-9۰-۹٠-٩][0-9۰-۹٠-٩,٬.٫]*\s*[%٪]?/g;
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of String(text ?? '').match(NUM_RE) ?? []) { const p = parseNumberFa(m.replace(/\s+/g, '').replace(/[.,٬٫]$/, '')); if (p) out.push(p.value); }
  return out;
}
export function containsValue(text: string, v: number, percent: boolean): boolean {
  const tol = (x: number) => Math.max(Math.abs(x) * 0.005, 0.051);
  return numbersIn(text).some((n) => Math.abs(n - v) <= tol(v) || (percent && Math.abs(n * 100 - v) <= tol(v)));
}
const nz = (s: string) => lamAlefFold(normalizeFa(s)).replace(/\s+/g, '');

/** منابع خودارجاع (مخزن/خروجی همین سامانه) هرگز شاهد مستقل نیستند */
const SELF_SOURCE_RE = /github\.com\/irajkianfar6-gif|neighborhood-typology|raw\.githubusercontent\.com\/irajkianfar6-gif/i;

export function checkCandidate(c: RawCandidate, ctx: { code: string; entry: { neighborhoodId: string; nameFa: string; nameAlt?: string[]; cityFa: string }; district: number | null; sources: ResearchSource[]; pageText: Map<string, string> }): Candidate['check'] & { status: Candidate['status'] } {
  const reasons: string[] = [];
  const lex = INDICATOR_LEXICON[ctx.code];
  const src = ctx.sources.find((s) => normUrl(s.url) === normUrl(c.sourceUrl));
  const cited = Boolean(src);
  if (!cited) reasons.push('نشانی منبع در فهرست منابع خوانده‌شده نیست');
  const selfRef = SELF_SOURCE_RE.test(c.sourceUrl);
  if (selfRef) reasons.push('منبع خودارجاع است (خروجی یا مخزن همین سامانه)؛ شاهد مستقل نیست');
  let grounding: Grounding = 'none';
  if (c.value !== null) {
    const page = ctx.pageText.get(normUrl(c.sourceUrl));
    if (page && containsValue(page, c.value, Boolean(lex?.percent))) grounding = 'page';
    else if (src && containsValue(src.snippets.join('\n'), c.value, Boolean(lex?.percent))) grounding = 'snippet';
    else if (containsValue(c.quote, c.value, Boolean(lex?.percent))) grounding = 'quote_only';
  }
  if (c.value === null) reasons.push('مقداری گزارش نشد');
  else if (grounding === 'quote_only') reasons.push('عدد فقط در نقل‌قول آمده و در متن منبع یافت نشد');
  else if (grounding === 'none') reasons.push('عدد در منبع یا نقل‌قول یافت نشد');
  const v = c.value;
  const plausible = v !== null && Number.isFinite(v) && (lex?.percent ? v >= 0 && v <= 100 : lex?.count ? v >= 1 : v >= 0);
  if (v !== null && !plausible) reasons.push('مقدار خارج از دامنهٔ مجاز شاخص است');
  let spatial: Candidate['check']['spatial'] = 'unknown'; let contractLevel: Candidate['check']['contractLevel'] = null;
  if (c.spatialLevel === 'neighborhood') {
    const names = [ctx.entry.nameFa, ...(ctx.entry.nameAlt ?? [])].map(nz);
    const m = matchUnit({ name: c.areaName, district: ctx.district }, ctx.entry.cityFa);
    if (m.targets.includes(ctx.entry.neighborhoodId) || names.some((n) => n && nz(c.areaName).includes(n))) { spatial = 'match'; contractLevel = 'neighborhood'; }
    else { spatial = 'mismatch'; reasons.push(`نام محدودهٔ منبع («${c.areaName}») با محله تطبیق نیافت`); }
  } else if (c.spatialLevel === 'district') {
    const d = districtNumber(c.areaName);
    if (ctx.district !== null && d === ctx.district) { spatial = 'match'; contractLevel = lex?.count ? null : 'district'; if (lex?.count) reasons.push('شاخص شمارشی در سطح منطقه به محله گسترده نمی‌شود'); }
    else { spatial = 'mismatch'; reasons.push(`منطقهٔ منبع (${c.areaName}) با منطقهٔ محله (${ctx.district ?? 'نامعلوم'}) یکی نیست`); }
  } else if (c.spatialLevel !== 'unknown') { spatial = 'too_coarse'; reasons.push('سطح مکانی درشت‌تر از منطقه است؛ فقط برای زمینه'); }
  else reasons.push('سطح مکانی نامعلوم است');
  const periodEnd = detectPeriod(`${c.period ?? ''} ${c.quote}`)?.periodEnd ?? null;
  if (!periodEnd) reasons.push('دورهٔ داده (سال) مشخص نیست');
  const grounded = grounding === 'page' || grounding === 'snippet';
  const status: Candidate['status'] = selfRef || !cited || !grounded || !plausible ? 'rejected'
    : spatial === 'match' && contractLevel && periodEnd && grounding === 'page' ? 'acceptable' : 'needs_review';
  return { cited, grounding, plausible, spatial, contractLevel, periodEnd, reasons, status };
}

async function pageTexts(urls: string[], deps: WebResearchDeps): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const list = [...new Set(urls)].slice(0, 8);
  if (!list.length) return m;
  try { for (const p of await youContents(list, { formats: ['markdown'] }, deps)) if (p.markdown) m.set(normUrl(p.url), p.markdown); } catch { /* اختیاری */ }
  // نشانی‌هایی که سرویس محتوا برنگرداند: دریافت مستقیم (HTML به متن)
  const f = deps.pageFetch ?? (fetch as unknown as FetchFn);
  await Promise.all(list.filter((u) => !m.has(normUrl(u))).map(async (u) => {
    try { const r = await f(u, { signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'ara-sourcediscovery/1.0' } }); if (r.ok) m.set(normUrl(u), (await r.text()).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').slice(0, 2_000_000)); } catch { /* دسترس‌ناپذیر */ }
  }));
  return m;
}

export interface WebResearchInput { neighborhoodId: string; codes?: string[]; effort?: Effort; maxIndicators?: number; offline?: boolean; verifySources?: boolean; createdBy?: string }
export interface WebResearchDeps extends WebClientDeps { pageFetch?: FetchFn }

export function planCodes(input: { codes?: string[]; gaps: string[]; max: number }) {
  const requested = (input.codes?.length ? input.codes : input.gaps).map((c) => c.toUpperCase());
  const surveyOnly = requested.filter((c) => PERCEPTUAL_ONLY.has(c));
  const notInContract = requested.filter((c) => !PERCEPTUAL_ONLY.has(c) && !INDICATOR_LEXICON[c]);
  const codes = [...new Set(requested.filter((c) => !surveyOnly.includes(c) && !notInContract.includes(c)))].slice(0, input.max);
  return { codes, surveyOnly, notInContract };
}

export async function startWebResearch(input: WebResearchInput): Promise<WebResearchRecord> {
  if (!webConfig().configured) throw new ToolInputError('WEB_NOT_CONFIGURED', 'سرویس پژوهش وب پیکربندی نشده است (کلید در تنظیمات سرور)');
  const e = requireEntry(input.neighborhoodId);
  let gaps: string[] = [];
  if (!input.codes?.length) gaps = gapsFromCard(await runAnalysis(e, { offline: input.offline !== false, persist: false })).map((g) => g.code);
  const plan = planCodes({ codes: input.codes, gaps, max: Math.min(10, input.maxIndicators ?? 5) });
  if (!plan.codes.length) throw new ToolInputError('NO_WEB_GAPS', 'شاخص قابل پژوهش وب نیست (شاخص‌های ادراکی فقط با پیمایش سنجیده می‌شوند)');
  const effort = clampEffort(input.effort, true);
  const rec: WebResearchRecord = {
    schema: 'ara.web-research.v1', id: `wr_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, version: WEBRESEARCH_VERSION, createdAt: new Date().toISOString(), finishedAt: null, createdBy: input.createdBy ?? 'operator',
    status: 'running', neighborhoodId: e.neighborhoodId, nameFa: e.nameFa, cityFa: e.cityFa, district: districtNumber(e.districtFa), effort, codes: plan.codes,
    skipped: { surveyOnly: plan.surveyOnly, notInContract: plan.notInContract }, findings: [], summary: { acceptable: 0, needsReview: 0, rejected: 0, notFound: 0, costUsd: 0 }, error: null,
  };
  return saveWebResearch(rec);
}

function summarize(r: WebResearchRecord) {
  const all = r.findings.flatMap((f) => f.candidates);
  r.summary = { acceptable: all.filter((c) => c.status === 'acceptable').length, needsReview: all.filter((c) => c.status === 'needs_review').length, rejected: all.filter((c) => c.status === 'rejected').length, notFound: r.findings.filter((f) => f.status === 'not_found').length, costUsd: Math.round(r.findings.reduce((a, f) => a + f.costUsd, 0) * 1000) / 1000 };
}

/** اجرای پژوهش برای همهٔ شاخص‌های برنامه (ترتیبی؛ هر شاخص مستقل شکست می‌خورد) */
export async function runWebResearch(id: string, opts: { verifySources?: boolean; deps?: WebResearchDeps; isCancelled?: () => boolean } = {}): Promise<WebResearchRecord> {
  const r = getWebResearch(id); if (!r) throw new ToolInputError('NOT_FOUND', 'پژوهش وب یافت نشد');
  const e = requireEntry(r.neighborhoodId); const deps = opts.deps ?? {};
  const boost = boostDomains();
  try {
    for (const code of r.codes) {
      if (opts.isCancelled?.()) break;
      if (r.findings.some((f) => f.code === code)) continue;
      const ind = indicatorDef(code) ?? { name: code, definition: code, formula: '' };
      const t0 = Date.now();
      const base = { code, name: ind.name, definition: ind.definition, effort: r.effort };
      try {
        const out = await youResearch({ input: buildPrompt(code, e), effort: r.effort, outputSchema: CANDIDATE_SCHEMA as unknown as Record<string, unknown>, sourceControl: { boost_domains: boost } }, deps);
        const content = (out.content && typeof out.content === 'object' ? out.content : {}) as { candidates?: RawCandidate[]; notes?: string };
        const raw = (content.candidates ?? []).slice(0, 4);
        const texts = await pageTexts(raw.filter((c) => c.value !== null).map((c) => c.sourceUrl), deps);
        const candidates: Candidate[] = raw.map((c, idx) => { const k = checkCandidate(c, { code, entry: e, district: r.district, sources: out.sources, pageText: texts }); const { status, ...check } = k; return { ...c, idx, check, status, decision: null }; });
        // منابع خوانده‌شده → کارت منبع (پیشنهاد؛ تأیید با کارشناس)
        const cards: string[] = [];
        for (const s of out.sources.slice(0, 8)) {
          let verification;
          if (opts.verifySources) { try { verification = await verifyUrl(s.url); } catch { /* */ } }
          const host = (() => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
          const card = upsertCard({ url: s.url, title: s.title.slice(0, 200), publisher: host, description: (s.snippets[0] ?? '').slice(0, 400), indicators: [code], role: 'unknown', spatialLevel: 'unknown', resolution: null, license: null, commercial: null, access: 'portal', cadence: null, domestic: /\.ir$/.test(host), origin: 'research', originDetail: `پژوهش وب ${r.id}`, foundFor: [r.neighborhoodId], verification });
          cards.push(card.cardId);
        }
        r.findings.push({ ...base, status: candidates.some((c) => c.value !== null) ? 'found' : 'not_found', notes: String(content.notes ?? (typeof out.content === 'string' ? out.content : '')).slice(0, 3000), candidates, sources: out.sources, sourceCards: cards, costUsd: out.costUsd, cached: out.cached, ms: Date.now() - t0 });
        try { indexItem('web_research', `${r.id}:${code}`, `پژوهش وب ${code} — ${e.nameFa}`, [{ page: 1, text: `${ind.name}\n${content.notes ?? ''}\n${candidates.map((c) => `${c.value} ${c.unit} ${c.areaName} ${c.period ?? ''} ${c.quote} ${c.sourceUrl}`).join('\n')}` }]); } catch { /* */ }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        r.findings.push({ ...base, status: 'error', notes: '', candidates: [], sources: [], sourceCards: [], costUsd: 0, cached: false, ms: Date.now() - t0, error: msg });
        if ((err as { code?: string }).code === 'WEB_BUDGET' || (err as { code?: string }).code === 'WEB_NOT_CONFIGURED') { summarize(r); r.status = 'failed'; r.error = msg; r.finishedAt = new Date().toISOString(); return saveWebResearch(r); }
      }
      summarize(r); saveWebResearch(r);
    }
    r.status = 'completed';
  } catch (err) { r.status = 'failed'; r.error = err instanceof Error ? err.message : String(err); }
  summarize(r); r.finishedAt = new Date().toISOString();
  return saveWebResearch(r);
}

/** تصمیم کارشناس روی یک نامزد: تأیید → دستهٔ قراردادی «در انتظار بازبینی» (ورود به سنجه فقط پس از بازبینی دسته) */
export function decideCandidate(id: string, code: string, idx: number, decision: 'approved' | 'rejected', by: string, o: { note?: string; periodEnd?: string } = {}) {
  const r = getWebResearch(id); if (!r) throw new ToolInputError('NOT_FOUND', 'پژوهش وب یافت نشد');
  const f = r.findings.find((x) => x.code === code); const c = f?.candidates.find((x) => x.idx === idx);
  if (!f || !c) throw new ToolInputError('NOT_FOUND', 'نامزد یافت نشد');
  if (c.decision) throw new ToolInputError('INVALID_STATE', 'برای این نامزد پیش‌تر تصمیم گرفته شده است');
  let batchId: string | null = null;
  if (decision === 'approved') {
    if (c.status === 'rejected') throw new ToolInputError('INVALID_STATE', `نامزد ردشده قابل تأیید نیست: ${c.check.reasons.join('؛ ')}`);
    const periodEnd = o.periodEnd && /^\d{4}-\d{2}$/.test(o.periodEnd) ? o.periodEnd : c.check.periodEnd;
    if (!c.check.contractLevel) throw new ToolInputError('INVALID_STATE', 'سطح مکانی نامزد برای ورود به سنجه کافی نیست (فقط محله یا منطقهٔ همان محله)');
    if (!periodEnd) throw new ToolInputError('INVALID_STATE', 'دورهٔ داده نامعلوم است؛ periodEnd (YYYY-MM) را وارد کنید');
    const lex = INDICATOR_LEXICON[code];
    const row: Record<string, string> = { indicator_code: code, value: String(c.value), unit: lex.percent ? 'percent' : '', period_end: periodEnd, source_org: (() => { try { return new URL(c.sourceUrl).hostname; } catch { return 'web'; } })(), dataset_id: `web:${r.id}:${code}:${idx}`, extraction_date: new Date().toISOString().slice(0, 10) };
    if (c.check.contractLevel === 'district') row.district = `${citySlug(r.cityFa)}:${r.district}`; else row.neighborhood_id = r.neighborhoodId;
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = `${CONTRACT_COLUMNS.join(',')}\n${CONTRACT_COLUMNS.map((k) => esc(row[k] ?? '')).join(',')}\n`;
    const b = createBatch(csv, 'agentic-webresearch', by);
    batchId = b.batchId;
    const pd = path.join(serverDataDir(), 'agentic', 'doc-provenance'); fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, `${b.batchId}.json`), JSON.stringify({ batchId: b.batchId, webResearchId: r.id, code, candidate: c, version: WEBRESEARCH_VERSION, approvedBy: by }, null, 1));
  }
  c.decision = { decision, by, at: new Date().toISOString(), note: o.note ?? null, batchId };
  saveWebResearch(r);
  return { researchId: r.id, code, idx, decision: c.decision, candidate: c };
}

export { latinDigits };
