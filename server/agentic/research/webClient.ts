/**
 * کلاینت سرویس پژوهش وب (You.com): جست‌وجو (/v1/search)، محتوای صفحه (/v1/contents) و
 * پژوهش چندمرحله‌ای با ارجاع (/v1/research، همگام یا پس‌زمینه). کلید فقط سمت سرور (YDC_API_KEY).
 * سقف روزانه، سقف سطح تلاش، نهان‌گاه دیسکی و برآورد هزینه در همین لایه اعمال می‌شود.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../../paths';
import { alert } from '../../ops/ops';

export const WEB_CLIENT_VERSION = 'WEBCLIENT-v1';
export const EFFORTS = ['lite', 'standard', 'deep', 'exhaustive', 'frontier'] as const;
export type Effort = typeof EFFORTS[number];
/** دلار به ازای هر درخواست (قیمت هر ۱۰۰۰ درخواست ÷ ۱۰۰۰) */
export const EFFORT_PRICE: Record<Effort, number> = { lite: 0.012, standard: 0.05, deep: 0.1, exhaustive: 0.45, frontier: 1.2 };
const EFFORT_TIMEOUT: Record<Effort, number> = { lite: 40_000, standard: 90_000, deep: 200_000, exhaustive: 420_000, frontier: 1_800_000 };
const SEARCH_PRICE = 0.005; const CONTENTS_PRICE = 0.001;

export type HttpFetch = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
export interface WebClientDeps { fetch?: HttpFetch; sleep?: (ms: number) => Promise<void>; now?: () => Date }

export class WebServiceError extends Error { constructor(public code: 'WEB_NOT_CONFIGURED' | 'WEB_BUDGET' | 'WEB_UPSTREAM' | 'WEB_TIMEOUT' | 'WEB_INPUT', message: string, public detail?: unknown) { super(message); } }

export function webConfig() {
  const max = (process.env.ARA_WEBRESEARCH_MAX_EFFORT || 'deep') as Effort;
  return {
    configured: Boolean(process.env.YDC_API_KEY),
    maxEffort: EFFORTS.includes(max) ? max : 'deep',
    dailyResearch: Number(process.env.ARA_WEBRESEARCH_DAILY_LIMIT || 40),
    dailySearch: Number(process.env.ARA_WEBSEARCH_DAILY_LIMIT || 300),
    dailyBudgetUsd: Number(process.env.ARA_WEBRESEARCH_DAILY_USD || 5),
    cacheDays: Number(process.env.ARA_WEBRESEARCH_CACHE_DAYS || 7),
  };
}
const key = () => { const k = process.env.YDC_API_KEY; if (!k) throw new WebServiceError('WEB_NOT_CONFIGURED', 'سرویس پژوهش وب پیکربندی نشده است'); return k; };
const dir = (...p: string[]) => { const d = path.join(serverDataDir(), 'agentic', 'webresearch', ...p); fs.mkdirSync(d, { recursive: true }); return d; };

// ---------------- سقف مصرف روزانه ----------------
interface DayUsage { research: number; search: number; contents: number; costUsd: number; cacheHits: number }
function usageFile() { return path.join(dir(), 'usage.json'); }
function loadUsage(): Record<string, DayUsage> { try { return JSON.parse(fs.readFileSync(usageFile(), 'utf8')); } catch { return {}; } }
const today = (d: WebClientDeps) => (d.now?.() ?? new Date()).toISOString().slice(0, 10);
export function usageToday(deps: WebClientDeps = {}): DayUsage & { day: string; limits: ReturnType<typeof webConfig> } {
  const u = loadUsage()[today(deps)] ?? { research: 0, search: 0, contents: 0, costUsd: 0, cacheHits: 0 };
  return { day: today(deps), ...u, limits: webConfig() };
}
function charge(kind: 'research' | 'search' | 'contents' | 'cacheHits', cost: number, deps: WebClientDeps) {
  const all = loadUsage(); const d = today(deps);
  const u = all[d] ?? { research: 0, search: 0, contents: 0, costUsd: 0, cacheHits: 0 };
  u[kind]++; u.costUsd = Math.round((u.costUsd + cost) * 1000) / 1000; all[d] = u;
  fs.writeFileSync(usageFile(), JSON.stringify(all, null, 1));
}
function guard(kind: 'research' | 'search', cost: number, deps: WebClientDeps) {
  try { guardInner(kind, cost, deps); } catch (e) { if (e instanceof WebServiceError) void alert('web_budget', 'سقف روزانهٔ پژوهش وب', e.message); throw e; }
}
function guardInner(kind: 'research' | 'search', cost: number, deps: WebClientDeps) {
  const c = webConfig(); const u = usageToday(deps);
  if (kind === 'research' && u.research >= c.dailyResearch) throw new WebServiceError('WEB_BUDGET', `سقف روزانهٔ پژوهش وب (${c.dailyResearch}) پر شده است`);
  if (kind === 'search' && u.search >= c.dailySearch) throw new WebServiceError('WEB_BUDGET', `سقف روزانهٔ جست‌وجوی وب (${c.dailySearch}) پر شده است`);
  if (u.costUsd + cost > c.dailyBudgetUsd) throw new WebServiceError('WEB_BUDGET', `سقف هزینهٔ روزانهٔ پژوهش وب (${c.dailyBudgetUsd} دلار) پر می‌شود`);
}

// ---------------- نهان‌گاه ----------------
const hash = (x: unknown) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 32);
function cacheGet<T>(k: string, deps: WebClientDeps): T | null {
  const f = path.join(dir('cache'), `${k}.json`);
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { at: string; v: T };
    if ((deps.now?.() ?? new Date()).getTime() - Date.parse(j.at) > webConfig().cacheDays * 86_400_000) return null;
    return j.v;
  } catch { return null; }
}
function cachePut(k: string, v: unknown, deps: WebClientDeps) { fs.writeFileSync(path.join(dir('cache'), `${k}.json`), JSON.stringify({ at: (deps.now?.() ?? new Date()).toISOString(), v })); }

async function http(url: string, init: { method?: string; body?: unknown }, timeoutMs: number, deps: WebClientDeps): Promise<unknown> {
  const f = deps.fetch ?? (fetch as unknown as HttpFetch);
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await f(url, { method: init.method ?? 'POST', headers: { 'X-API-Key': key(), 'Content-Type': 'application/json', Accept: 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(timeoutMs) });
      const text = await r.text();
      if (r.ok) { try { return JSON.parse(text); } catch { throw new WebServiceError('WEB_UPSTREAM', 'پاسخ سرویس پژوهش وب قابل خواندن نبود'); } }
      last = { status: r.status, body: text.slice(0, 500) };
      if (r.status === 401 || r.status === 403) throw new WebServiceError('WEB_UPSTREAM', 'کلید سرویس پژوهش وب پذیرفته نشد', last);
      if (r.status === 400 || r.status === 422) throw new WebServiceError('WEB_INPUT', 'درخواست پژوهش وب نامعتبر بود', last);
      if (r.status === 402) throw new WebServiceError('WEB_BUDGET', 'اعتبار حساب سرویس پژوهش وب کافی نیست', last);
    } catch (e) {
      if (e instanceof WebServiceError) throw e;
      last = String((e as Error)?.message ?? e);
      if ((e as Error)?.name === 'TimeoutError') throw new WebServiceError('WEB_TIMEOUT', 'پاسخ سرویس پژوهش وب به‌موقع نرسید');
    }
    await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(800 * 2 ** attempt);
  }
  throw new WebServiceError('WEB_UPSTREAM', 'سرویس پژوهش وب در دسترس نبود؛ کمی بعد دوباره تلاش کنید', last);
}

// ---------------- جست‌وجو ----------------
export interface SearchHit { url: string; title: string; snippet: string; snippets: string[] }
export interface SearchOptions { count?: number; country?: string; language?: string; freshness?: string; includeDomains?: string[]; excludeDomains?: string[] }
export async function youSearch(query: string, o: SearchOptions = {}, deps: WebClientDeps = {}): Promise<SearchHit[]> {
  const body: Record<string, unknown> = { query: query.slice(0, 400), count: Math.min(20, o.count ?? 8) };
  if (o.country) body.country = o.country; if (o.language) body.language = o.language; if (o.freshness) body.freshness = o.freshness;
  if (o.includeDomains?.length) body.include_domains = o.includeDomains; else if (o.excludeDomains?.length) body.exclude_domains = o.excludeDomains;
  const k = `s_${hash(body)}`; const c = cacheGet<SearchHit[]>(k, deps); if (c) { charge('cacheHits', 0, deps); return c; }
  guard('search', SEARCH_PRICE, deps);
  const j = await http('https://ydc-index.io/v1/search', { body }, 30_000, deps) as { results?: { web?: Array<{ url: string; title?: string; description?: string; snippets?: string[] }>; news?: Array<{ url: string; title?: string; description?: string }> } };
  charge('search', SEARCH_PRICE, deps);
  const hits = [...(j.results?.web ?? []), ...(j.results?.news ?? [])].filter((x) => x?.url).map((x) => ({ url: x.url, title: String(x.title ?? x.url), snippet: String(x.description ?? (x as { snippets?: string[] }).snippets?.[0] ?? ''), snippets: ((x as { snippets?: string[] }).snippets ?? []).map(String).slice(0, 5) }));
  cachePut(k, hits, deps);
  return hits;
}

// ---------------- محتوای صفحه ----------------
export interface PageContent { url: string; title: string | null; markdown: string | null; html: string | null }
export async function youContents(urls: string[], o: { formats?: Array<'markdown' | 'html'>; timeoutSec?: number } = {}, deps: WebClientDeps = {}): Promise<PageContent[]> {
  const list = [...new Set(urls.filter((u) => /^https?:\/\//.test(u)))].slice(0, 10);
  if (!list.length) return [];
  const formats = o.formats ?? ['markdown'];
  const k = `c_${hash({ list, formats })}`; const c = cacheGet<PageContent[]>(k, deps); if (c) { charge('cacheHits', 0, deps); return c; }
  guard('search', CONTENTS_PRICE * list.length, deps);
  const j = await http('https://ydc-index.io/v1/contents', { body: { urls: list, formats: [...formats, 'metadata'], crawl_timeout: Math.min(60, o.timeoutSec ?? 25) } }, 90_000, deps) as Array<{ url: string; markdown?: string; html?: string; metadata?: { title?: string } ; title?: string }>;
  charge('contents', CONTENTS_PRICE * list.length, deps);
  const out = (Array.isArray(j) ? j : []).map((x) => ({ url: x.url, title: x.metadata?.title ?? x.title ?? null, markdown: x.markdown ?? null, html: x.html ?? null }));
  if (out.length) cachePut(k, out, deps);
  return out;
}

// ---------------- پژوهش چندمرحله‌ای ----------------
export interface ResearchSource { url: string; title: string; snippets: string[] }
export interface ResearchOutput { content: unknown; contentType: 'text' | 'object'; sources: ResearchSource[]; effort: Effort; costUsd: number; cached: boolean; ms: number; taskId: string | null }
export interface ResearchRequest { input: string; effort?: Effort; sourceControl?: { include_domains?: string[]; exclude_domains?: string[]; boost_domains?: string[]; freshness?: string; country?: string }; outputSchema?: Record<string, unknown> }
export function clampEffort(e: Effort | undefined, schema: boolean): Effort {
  const max = webConfig().maxEffort; let x: Effort = e && EFFORTS.includes(e) ? e : 'standard';
  if (EFFORTS.indexOf(x) > EFFORTS.indexOf(max)) x = max;
  if (schema && x === 'lite') x = 'standard'; // خروجی ساخت‌یافته با lite پشتیبانی نمی‌شود
  return x;
}
type RawOut = { output?: { content?: unknown; content_type?: string; sources?: Array<{ url: string; title?: string; snippets?: string[] }> } };
export async function youResearch(req: ResearchRequest, deps: WebClientDeps = {}): Promise<ResearchOutput> {
  if (!req.input?.trim() || req.input.length > 40_000) throw new WebServiceError('WEB_INPUT', 'پرسش پژوهش خالی یا بیش از حد بلند است');
  const effort = clampEffort(req.effort, Boolean(req.outputSchema));
  const body: Record<string, unknown> = { input: req.input, research_effort: effort };
  if (req.sourceControl && Object.keys(req.sourceControl).length) body.source_control = req.sourceControl;
  if (req.outputSchema) body.output_schema = req.outputSchema;
  const k = `r_${hash(body)}`; const t0 = Date.now();
  const c = cacheGet<ResearchOutput>(k, deps); if (c) { charge('cacheHits', 0, deps); return { ...c, cached: true, costUsd: 0, ms: 0 }; }
  guard('research', EFFORT_PRICE[effort], deps);
  let raw: RawOut; let taskId: string | null = null;
  if (effort === 'lite' || effort === 'standard') {
    raw = await http('https://api.you.com/v1/research', { body }, EFFORT_TIMEOUT[effort], deps) as RawOut;
  } else {
    // سطح‌های عمیق: درخواست پس‌زمینه و پرسش دوره‌ای وضعیت
    const task = await http('https://api.you.com/v1/research', { body: { ...body, background: true } }, 60_000, deps) as { task_id?: string; status?: string };
    if (!task.task_id) throw new WebServiceError('WEB_UPSTREAM', 'سرویس پژوهش وب شناسهٔ کار برنگرداند', task);
    taskId = task.task_id;
    const deadline = Date.now() + EFFORT_TIMEOUT[effort]; const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    for (;;) {
      await sleep(5_000);
      const s = await http(`https://api.you.com/v1/research/${encodeURIComponent(taskId)}`, { method: 'GET' }, 30_000, deps) as { status?: string; result?: RawOut | null; error?: unknown };
      if (s.status === 'completed') { raw = (s.result ?? {}) as RawOut; break; }
      if (s.status === 'failed' || s.status === 'cancelled') { charge('research', EFFORT_PRICE[effort], deps); throw new WebServiceError('WEB_UPSTREAM', 'پژوهش وب ناموفق ماند', s.error); }
      if (Date.now() > deadline) throw new WebServiceError('WEB_TIMEOUT', 'پژوهش وب در زمان مجاز تمام نشد');
    }
  }
  charge('research', EFFORT_PRICE[effort], deps);
  const o = raw.output ?? {};
  const out: ResearchOutput = { content: o.content ?? null, contentType: o.content_type === 'object' ? 'object' : 'text', sources: (o.sources ?? []).filter((s) => s?.url).map((s) => ({ url: s.url, title: String(s.title ?? s.url), snippets: (s.snippets ?? []).map(String).slice(0, 6) })), effort, costUsd: EFFORT_PRICE[effort], cached: false, ms: Date.now() - t0, taskId };
  cachePut(k, out, deps);
  return out;
}
