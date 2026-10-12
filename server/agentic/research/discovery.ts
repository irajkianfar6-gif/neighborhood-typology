/**
 * A2 — کاشف منابع: برای شاخص‌های بی‌داده، منبع نامزد پیدا و «کارت منبع» می‌سازد.
 * سه سرچشمه: کاتالوگ بذر، موتور جست‌وجو (اختیاری با کلید) و پیشنهاد هوش مصنوعی (اختیاری).
 * هر نامزد با درخواست واقعی (با رعایت robots.txt و نرخ مؤدبانه) راستی‌آزمایی می‌شود؛ نشانی ساختگی رد می‌شود.
 * A2 فقط پیشنهاد می‌دهد: افزودن منبع دائمی همیشه تأیید انسانی می‌خواهد.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../../paths';
import { listManifests } from '../../sources/manifests';
import { extractJson, llmConfig, llmText } from '../../ai/llm';
import { CATALOG_VERSION, SOURCE_CATALOG, type CatalogSource } from './sourceCatalog';
import { INDICATOR_LEXICON } from './columns';
import { indexItem } from './memory';

export const DISCOVERY_VERSION = 'DISC-v1';
const UA = process.env.ARA_CRAWLER_UA || 'ARA-SourceDiscovery/1.0 (+neighborhood decision support; polite crawler)';
export type CardStatus = 'proposed' | 'verified' | 'unreachable' | 'blocked_by_robots' | 'approved' | 'rejected';
export interface SourceCard {
  schema: 'ara.source-card.v1'; cardId: string; url: string; domain: string; title: string; publisher: string | null; description: string;
  indicators: string[]; role: CatalogSource['role'] | 'unknown'; spatialLevel: string; resolution: string | null; license: string | null; commercial: boolean | null;
  access: string; cadence: string | null; domestic: boolean; origin: 'catalog' | 'search' | 'llm'; originDetail: string;
  verification: { checkedAt: string | null; reachable: boolean | null; httpStatus: number | null; finalUrl: string | null; contentType: string | null; robotsAllowed: boolean | null; pageTitle: string | null; error: string | null };
  trust: { score: number; components: Record<string, number> };
  status: CardStatus; review: { by: string; at: string; decision: 'approved' | 'rejected'; note?: string } | null;
  createdAt: string; updatedAt: string; foundFor: string[];
}
export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal; redirect?: 'follow' }) => Promise<{ ok: boolean; status: number; url: string; headers: { get(n: string): string | null }; text(): Promise<string> }>;

function file(): string { const d = path.join(serverDataDir(), 'agentic', 'sources'); fs.mkdirSync(d, { recursive: true }); return path.join(d, 'cards.json'); }
function loadAll(): Record<string, SourceCard> { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } }
function saveAll(m: Record<string, SourceCard>) { fs.writeFileSync(file(), JSON.stringify(m, null, 1)); }
export function listCards(filter: { status?: CardStatus; indicator?: string } = {}): SourceCard[] {
  return Object.values(loadAll()).filter((c) => (!filter.status || c.status === filter.status) && (!filter.indicator || c.indicators.includes(filter.indicator))).sort((a, b) => b.trust.score - a.trust.score);
}
export function getCard(id: string): SourceCard | null { return loadAll()[id] ?? null; }
export const cardIdFor = (url: string) => `src_${crypto.createHash('sha256').update(normUrl(url)).digest('hex').slice(0, 12)}`;
function normUrl(u: string): string { try { const x = new URL(u); x.hash = ''; return x.toString().replace(/\/$/, ''); } catch { return u.trim(); } }
const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** دامنه‌هایی که از پیش در منیفست‌های پلتفرم هستند (تکراری پیشنهاد نمی‌شوند) */
export function registeredDomains(): Set<string> {
  const out = new Set<string>();
  for (const m of listManifests() as unknown as Array<Record<string, unknown>>) {
    const s = JSON.stringify(m);
    for (const u of s.match(/https?:\/\/[^"'\s)]+/g) ?? []) { const d = domainOf(u); if (d) out.add(d); }
  }
  return out;
}

// ---------------- robots.txt ----------------
export function robotsAllows(robots: string, pathname: string, agent = 'ara-sourcediscovery'): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let cur: (typeof groups)[number] | null = null; let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...rest] = line.split(':'); const key = k.trim().toLowerCase(); const val = rest.join(':').trim();
    if (key === 'user-agent') { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'disallow' && val) cur.rules.push({ allow: false, path: val });
    if (key === 'allow' && val) cur.rules.push({ allow: true, path: val });
  }
  const g = groups.find((x) => x.agents.some((a) => a !== '*' && agent.includes(a))) ?? groups.find((x) => x.agents.includes('*'));
  if (!g) return true;
  const match = (rule: string) => { const re = new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`); return re.test(pathname); };
  const hits = g.rules.filter((r) => match(r.path)).sort((a, b) => b.path.length - a.path.length);
  return hits.length ? hits[0].allow : true;
}

const robotsCache = new Map<string, string | null>();
const lastHit = new Map<string, number>();
async function polite(domain: string) { const gap = Number(process.env.ARA_CRAWL_GAP_MS ?? 1000); const t = lastHit.get(domain) ?? 0; const wait = t + gap - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); lastHit.set(domain, Date.now()); }

export async function verifyUrl(url: string, fetchFn: FetchFn = fetch as unknown as FetchFn, timeoutMs = 12_000): Promise<SourceCard['verification']> {
  const v: SourceCard['verification'] = { checkedAt: new Date().toISOString(), reachable: false, httpStatus: null, finalUrl: null, contentType: null, robotsAllowed: null, pageTitle: null, error: null };
  let u: URL;
  try { u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw new Error('فقط http/https'); } catch (e) { v.error = `نشانی نامعتبر: ${e instanceof Error ? e.message : e}`; return v; }
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith('.local')) { v.error = 'نشانی داخلی مجاز نیست'; return v; }
  const origin = `${u.protocol}//${u.host}`;
  try {
    if (!robotsCache.has(origin)) {
      await polite(u.host);
      try { const r = await fetchFn(`${origin}/robots.txt`, { headers: { 'User-Agent': UA, 'Accept-Language': 'fa,en;q=0.8' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' }); robotsCache.set(origin, r.ok ? (await r.text()).slice(0, 200_000) : null); } catch { robotsCache.set(origin, null); }
    }
    const robots = robotsCache.get(origin);
    v.robotsAllowed = robots ? robotsAllows(robots, u.pathname || '/') : true;
    if (!v.robotsAllowed) return v;
    await polite(u.host);
    const r = await fetchFn(u.toString(), { method: 'GET', headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.5', 'Accept-Language': 'fa,en;q=0.8' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    v.httpStatus = r.status; v.finalUrl = r.url || u.toString(); v.contentType = r.headers.get('content-type');
    v.reachable = r.status >= 200 && r.status < 400;
    if ([401, 403, 406, 429].includes(r.status)) v.error = `سرور درخواست خودکار را نپذیرفت (HTTP ${r.status})؛ با مرورگر بررسی کنید`;
    if (v.reachable && /html/.test(v.contentType ?? '')) { const html = (await r.text()).slice(0, 300_000); v.pageTitle = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null; }
  } catch (e) { v.error = e instanceof Error ? (e.name === 'TimeoutError' ? 'مهلت درخواست تمام شد' : e.message) : String(e); v.reachable = false; }
  return v;
}

/** امتیاز اعتماد قطعی و شفاف (۰..۱) */
export function trustOf(c: Pick<SourceCard, 'origin' | 'verification' | 'license' | 'url' | 'domain' | 'spatialLevel' | 'role' | 'domestic'>): SourceCard['trust'] {
  const comp: Record<string, number> = {};
  comp.origin = c.origin === 'catalog' ? 0.35 : c.origin === 'search' ? 0.2 : 0.1;
  comp.reachable = c.verification.reachable ? 0.2 : c.domestic && c.verification.reachable === false ? 0.05 : 0;
  comp.license = c.license && !/نامعلوم|unknown/i.test(c.license) ? 0.1 : 0;
  comp.https = c.url.startsWith('https://') ? 0.05 : 0;
  comp.official = /(\.gov|\.gov\.ir|\.ac\.ir|amar\.org\.ir|tehran\.ir|cbi\.ir|europa\.eu|un\.org|humdata\.org|worldbank\.org)$/.test(c.domain) ? 0.1 : 0;
  comp.spatial = ['neighborhood', 'block'].includes(c.spatialLevel) ? 0.15 : ['grid', 'point', 'station'].includes(c.spatialLevel) ? 0.1 : c.spatialLevel === 'district' ? 0.05 : 0;
  comp.role = c.role === 'direct' ? 0.05 : 0;
  const score = Math.min(1, Object.values(comp).reduce((a, b) => a + b, 0));
  return { score: Math.round(score * 100) / 100, components: comp };
}

function statusOf(v: SourceCard['verification']): CardStatus { return v.robotsAllowed === false ? 'blocked_by_robots' : v.reachable ? 'verified' : v.checkedAt ? 'unreachable' : 'proposed'; }

function upsert(seed: Omit<SourceCard, 'schema' | 'cardId' | 'domain' | 'trust' | 'status' | 'review' | 'createdAt' | 'updatedAt' | 'verification'> & { verification?: SourceCard['verification'] }): SourceCard {
  const all = loadAll(); const id = cardIdFor(seed.url); const prev = all[id]; const now = new Date().toISOString();
  const verification = seed.verification ?? prev?.verification ?? { checkedAt: null, reachable: null, httpStatus: null, finalUrl: null, contentType: null, robotsAllowed: null, pageTitle: null, error: null };
  const base = { ...seed, domain: domainOf(seed.url), verification };
  const card: SourceCard = {
    schema: 'ara.source-card.v1', cardId: id, ...base, foundFor: [...new Set([...(prev?.foundFor ?? []), ...seed.foundFor])], indicators: [...new Set([...(prev?.indicators ?? []), ...seed.indicators])],
    trust: trustOf(base), status: prev && ['approved', 'rejected'].includes(prev.status) ? prev.status : statusOf(verification), review: prev?.review ?? null,
    origin: prev?.origin === 'catalog' ? 'catalog' : seed.origin, createdAt: prev?.createdAt ?? now, updatedAt: now,
  };
  all[id] = card; saveAll(all);
  try { indexItem('source_card', id, card.title, [{ page: 1, text: `${card.title}\n${card.publisher ?? ''}\n${card.description}\n${card.indicators.map((c) => `${c} ${INDICATOR_LEXICON[c]?.name ?? ''}`).join('، ')}\n${card.url}` }]); } catch { /* حافظه اختیاری است */ }
  return card;
}

export function decideCard(id: string, decision: 'approved' | 'rejected', by: string, note?: string): SourceCard | null {
  const all = loadAll(); const c = all[id]; if (!c) return null;
  c.status = decision; c.review = { by, at: new Date().toISOString(), decision, note }; c.updatedAt = c.review.at;
  saveAll(all); return c;
}

// ---------------- جست‌وجو (اختیاری) ----------------
export function searchProvider(): { name: string; configured: boolean } {
  const p = (process.env.ARA_SEARCH_PROVIDER || '').toLowerCase();
  if (p === 'brave') return { name: 'brave', configured: Boolean(process.env.ARA_BRAVE_API_KEY) };
  if (p === 'tavily') return { name: 'tavily', configured: Boolean(process.env.ARA_TAVILY_API_KEY) };
  if (p === 'searxng') return { name: 'searxng', configured: Boolean(process.env.ARA_SEARXNG_URL) };
  return { name: 'none', configured: false };
}
export async function webSearch(q: string, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const p = searchProvider(); if (!p.configured) return [];
  const sig = AbortSignal.timeout(15_000);
  if (p.name === 'brave') {
    const r = await fetchFn(`https://api.search.brave.com/res/v1/web/search?count=8&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json', 'X-Subscription-Token': String(process.env.ARA_BRAVE_API_KEY) }, signal: sig });
    const j = JSON.parse(await r.text()) as { web?: { results?: Array<{ url: string; title: string; description?: string }> } };
    return (j.web?.results ?? []).map((x) => ({ url: x.url, title: x.title, snippet: x.description ?? '' }));
  }
  if (p.name === 'tavily') {
    const r = await (fetch as unknown as (u: string, i: RequestInit) => Promise<Response>)('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ARA_TAVILY_API_KEY}` }, body: JSON.stringify({ query: q, max_results: 8 }), signal: sig });
    const j = await r.json() as { results?: Array<{ url: string; title: string; content?: string }> };
    return (j.results ?? []).map((x) => ({ url: x.url, title: x.title, snippet: x.content ?? '' }));
  }
  const r = await fetchFn(`${String(process.env.ARA_SEARXNG_URL).replace(/\/$/, '')}/search?format=json&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' }, signal: sig });
  const j = JSON.parse(await r.text()) as { results?: Array<{ url: string; title: string; content?: string }> };
  return (j.results ?? []).slice(0, 8).map((x) => ({ url: x.url, title: x.title, snippet: x.content ?? '' }));
}

export interface DiscoverInput { indicators: string[]; city?: string; neighborhoodName?: string; verify?: boolean; useSearch?: boolean; useLlm?: boolean; maxPerIndicator?: number }
export interface DiscoverDeps { fetch?: FetchFn; llm?: (system: string, prompt: string) => Promise<{ text: string }> }
export interface DiscoverResult {
  version: string; catalog: string; indicators: string[]; searched: { provider: string; queries: number; results: number }; llm: { used: boolean; proposed: number; rejected: number };
  cards: SourceCard[]; byIndicator: Record<string, string[]>; uncovered: string[]; skippedRegistered: string[];
}

export async function discoverSources(input: DiscoverInput, deps: DiscoverDeps = {}): Promise<DiscoverResult> {
  const codes = [...new Set(input.indicators.map((c) => c.toUpperCase()).filter((c) => INDICATOR_LEXICON[c]))];
  const reg = registeredDomains(); const skippedRegistered: string[] = [];
  const verify = input.verify !== false; const fetchFn = deps.fetch ?? (fetch as unknown as FetchFn);
  const seeds: Array<Parameters<typeof upsert>[0]> = [];
  // ۱) کاتالوگ
  for (const s of SOURCE_CATALOG) {
    const hit = s.indicators.filter((c) => codes.includes(c));
    if (!hit.length) continue;
    if (reg.has(domainOf(s.url))) { skippedRegistered.push(s.id); continue; }
    seeds.push({ url: s.url, title: s.title, publisher: s.publisher, description: s.description, indicators: s.indicators, role: s.role, spatialLevel: s.spatialLevel, resolution: s.resolution ?? null, license: s.license, commercial: s.commercial, access: s.access, cadence: s.cadence, domestic: Boolean(s.domestic), origin: 'catalog', originDetail: `${CATALOG_VERSION}:${s.id}`, foundFor: hit });
  }
  // ۲) جست‌وجوی وب (اختیاری)
  let queries = 0, results = 0;
  if (input.useSearch && searchProvider().configured) {
    for (const c of codes.slice(0, 8)) {
      const q = `${INDICATOR_LEXICON[c].name} ${input.city ?? 'تهران'} محله آمار داده`;
      queries++;
      try {
        for (const r of (await webSearch(q, fetchFn)).slice(0, input.maxPerIndicator ?? 3)) {
          if (reg.has(domainOf(r.url))) continue;
          results++;
          seeds.push({ url: r.url, title: r.title.slice(0, 200), publisher: domainOf(r.url), description: r.snippet.slice(0, 400), indicators: [c], role: 'unknown', spatialLevel: 'unknown', resolution: null, license: null, commercial: null, access: 'portal', cadence: null, domestic: /\.ir$/.test(domainOf(r.url)), origin: 'search', originDetail: `${searchProvider().name}: ${q}`, foundFor: [c] });
        }
      } catch { /* جست‌وجو اختیاری است */ }
    }
  }
  // ۳) پیشنهاد هوش مصنوعی (اختیاری؛ همیشه راستی‌آزمایی می‌شود)
  let llmUsed = false, proposed = 0;
  const llm = deps.llm ?? (input.useLlm && llmConfig().configured ? (s: string, p: string) => llmText({ system: s, prompt: p, maxTokens: 1500, temperature: 0.2 }) : undefined);
  if (input.useLlm && llm) {
    llmUsed = true;
    const prompt = `شاخص‌های بی‌داده برای محلهٔ ${input.neighborhoodName ?? ''} در ${input.city ?? 'تهران'}:\n${codes.map((c) => `${c}: ${INDICATOR_LEXICON[c].name}`).join('\n')}\n\nحداکثر ۸ منبع دادهٔ عمومی واقعی پیشنهاد کن که این شاخص‌ها را (ترجیحاً در سطح محله یا منطقه) پوشش دهند. فقط نشانی‌هایی را بده که از وجودشان مطمئنی؛ همه بررسی می‌شوند و نشانی ناموجود ثبت و رد می‌شود.\nفقط JSON: {"sources":[{"url":"https://…","title":"…","publisher":"…","indicators":["E1"],"spatialLevel":"district|neighborhood|grid|city","why":"…"}]}`;
    try {
      const r = await llm('تو پژوهشگر منابع دادهٔ شهری هستی. هیچ عددی گزارش نکن؛ فقط منبع پیشنهاد کن.', prompt);
      const j = extractJson(r.text) as { sources?: Array<{ url?: string; title?: string; publisher?: string; indicators?: string[]; spatialLevel?: string; why?: string }> };
      for (const s of (j?.sources ?? []).slice(0, 8)) {
        if (!s.url || !/^https?:\/\//.test(s.url)) continue;
        const inds = (s.indicators ?? []).map((x) => String(x).toUpperCase()).filter((x) => codes.includes(x));
        if (!inds.length || reg.has(domainOf(s.url))) continue;
        proposed++;
        seeds.push({ url: s.url, title: String(s.title ?? s.url).slice(0, 200), publisher: s.publisher ? String(s.publisher).slice(0, 120) : null, description: String(s.why ?? '').slice(0, 400), indicators: inds, role: 'unknown', spatialLevel: String(s.spatialLevel ?? 'unknown'), resolution: null, license: null, commercial: null, access: 'portal', cadence: null, domestic: /\.ir$/.test(domainOf(s.url)), origin: 'llm', originDetail: 'پیشنهاد هوش مصنوعی (راستی‌آزمایی‌شده)', foundFor: inds });
      }
    } catch { /* اختیاری */ }
  }
  // راستی‌آزمایی (موازی بین دامنه‌ها، ترتیبی درون دامنه)
  const uniq = [...new Map(seeds.map((s) => [cardIdFor(s.url), s])).values()];
  if (verify) {
    const byDomain = new Map<string, typeof uniq>();
    for (const s of uniq) { const d = domainOf(s.url); byDomain.set(d, [...(byDomain.get(d) ?? []), s]); }
    await Promise.all([...byDomain.values()].map(async (list) => { for (const s of list) s.verification = await verifyUrl(s.url, fetchFn); }));
  }
  const cards = uniq.map((s) => upsert(s));
  const byIndicator: Record<string, string[]> = {};
  for (const c of codes) byIndicator[c] = cards.filter((k) => k.indicators.includes(c) && !['unreachable', 'blocked_by_robots', 'rejected'].includes(k.status) || (k.indicators.includes(c) && k.domestic && k.status === 'unreachable')).map((k) => k.cardId);
  const rejected = cards.filter((c) => c.origin === 'llm' && c.status === 'unreachable').length;
  return { version: DISCOVERY_VERSION, catalog: CATALOG_VERSION, indicators: codes, searched: { provider: searchProvider().name, queries, results }, llm: { used: llmUsed, proposed, rejected }, cards, byIndicator, uncovered: codes.filter((c) => !byIndicator[c]?.length), skippedRegistered };
}
export function _resetDiscoveryCaches(): void { robotsCache.clear(); lastHit.clear(); }
