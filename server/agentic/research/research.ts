/**
 * گراف پژوهش خودکار (RESEARCH-v1) — فاز ۳.
 * شناسایی محله → اجرای سنجه → شکاف‌های داده (شاخص بی‌امتیاز یا کم‌اعتبار) → کشف و راستی‌آزمایی منبع (A2)
 * → جست‌وجو در حافظهٔ اسناد → برگهٔ پژوهش برای هر شکاف با گام بعدی پیشنهادی.
 * هیچ عددی وارد سنجه نمی‌شود؛ خروجی فقط پیشنهاد منبع و پیش‌نویس است که تأیید انسانی می‌خواهد.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../../paths';
import { resolveNeighborhood } from '../../neighborhood/resolver';
import { analysisFor, requireEntry, type CardResult } from '../state';
import { INDICATOR_LEXICON } from './columns';
import { discoverSources, type DiscoverDeps, type SourceCard } from './discovery';
import { searchMemory } from './memory';

import { SURVEY_NATIVE } from '../../../src/algorithm/customSurveyModel';

export const RESEARCH_VERSION = 'RESEARCH-v1';
export const GAP_RELIABILITY = 0.6;

export interface DataGap { code: string; name: string; reason: 'no_score' | 'low_reliability'; reliability: number | null; source: string | null }
export interface GapBrief {
  code: string; name: string; reason: DataGap['reason'];
  candidates: Array<{ cardId: string; title: string; url: string; status: SourceCard['status']; trust: number; spatialLevel: string; domestic: boolean }>;
  documents: Array<{ refId: string; title: string; page: number; snippet: string }>;
  nextAction: string;
}
export interface ResearchStep { name: string; agent: string; status: 'done' | 'failed' | 'skipped'; summary: string; ms: number }
export interface ResearchRecord {
  schema: 'ara.research.v1'; researchId: string; jobId: string | null; createdAt: string; finishedAt: string | null;
  status: 'queued' | 'running' | 'done' | 'needs_user_choice' | 'failed' | 'cancelled';
  input: { neighborhoodId?: string; name?: string; city?: string; offline?: boolean; useLlm?: boolean; useSearch?: boolean; verify?: boolean };
  neighborhood: { id: string; nameFa: string; city: string } | null; candidates?: Array<{ id: string; nameFa: string }>;
  analysisId: string | null; level: string | null; steps: ResearchStep[]; gaps: DataGap[]; briefs: GapBrief[];
  summary: { gaps: number; covered: number; uncovered: number; verifiedSources: number; candidateSources: number } | null; error: string | null;
}

/** شکاف داده از کارت تحلیل: شاخص بدون امتیاز یا با اعتبار کمتر از آستانه */
export function gapsFromCard(r: CardResult, threshold = GAP_RELIABILITY): DataGap[] {
  const out: DataGap[] = [];
  for (const i of r.card.indicators as Array<{ code: string; name: string; score: number | null; reliability: number | null; source?: string }>) {
    if (!INDICATOR_LEXICON[i.code]) continue;
    if (i.score === null) out.push({ code: i.code, name: i.name, reason: 'no_score', reliability: i.reliability ?? null, source: i.source ?? null });
    else if ((i.reliability ?? 0) < threshold) out.push({ code: i.code, name: i.name, reason: 'low_reliability', reliability: i.reliability, source: i.source ?? null });
  }
  return out;
}

function dir(): string { const d = path.join(serverDataDir(), 'agentic', 'research'); fs.mkdirSync(d, { recursive: true }); return d; }
const file = (id: string) => path.join(dir(), `${id.replace(/[^\w-]/g, '_')}.json`);
export function saveResearch(r: ResearchRecord): void { fs.writeFileSync(file(r.researchId), JSON.stringify(r)); }
export function loadResearch(id: string): ResearchRecord | null { const f = file(id); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; }
export function listResearch(limit = 20) {
  return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) as ResearchRecord; } catch { return null; } })
    .filter((r): r is ResearchRecord => Boolean(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
    .map((r) => ({ researchId: r.researchId, status: r.status, neighborhood: r.neighborhood, createdAt: r.createdAt, summary: r.summary }));
}
export function createResearch(input: ResearchRecord['input'], jobId: string | null): ResearchRecord {
  const r: ResearchRecord = { schema: 'ara.research.v1', researchId: `res_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, jobId, createdAt: new Date().toISOString(), finishedAt: null, status: 'queued', input, neighborhood: null, analysisId: null, level: null, steps: [], gaps: [], briefs: [], summary: null, error: null };
  saveResearch(r);
  return r;
}

const NEXT: Record<string, string> = {
  approved: 'دریافت فایل از منبع تأییدشده و بارگذاری در «استخراج از اسناد» (A4)',
  verified: 'بازبینی کارت منبع و تأیید یا رد آن توسط کارشناس',
  unreachable: 'منبع داخلی از این سرور در دسترس نبود؛ از داخل ایران بررسی و فایل را بارگذاری کنید',
};

export async function runResearch(id: string, opts: { isCancelled?: () => boolean; deps?: DiscoverDeps } = {}): Promise<ResearchRecord> {
  const r = loadResearch(id); if (!r) throw new Error('پژوهش یافت نشد');
  r.status = 'running'; saveResearch(r);
  const step = async <T>(name: string, agent: string, fn: () => Promise<{ value: T; summary: string }>): Promise<T | null> => {
    if (opts.isCancelled?.()) throw new Error('CANCELLED');
    const t = Date.now();
    try { const o = await fn(); r.steps.push({ name, agent, status: 'done', summary: o.summary, ms: Date.now() - t }); saveResearch(r); return o.value; }
    catch (e) { r.steps.push({ name, agent, status: 'failed', summary: e instanceof Error ? e.message : String(e), ms: Date.now() - t }); saveResearch(r); throw e; }
  };
  try {
    // ۱) شناسایی
    const nbId = await step('resolve', 'A1', async () => {
      if (r.input.neighborhoodId) { const e = requireEntry(r.input.neighborhoodId); r.neighborhood = { id: e.neighborhoodId, nameFa: e.nameFa, city: e.cityFa }; return { value: e.neighborhoodId, summary: `${e.nameFa} (${e.neighborhoodId})` }; }
      const res = resolveNeighborhood(String(r.input.name ?? ''), r.input.city);
      if (!res.best || res.requiresUserChoice) { r.candidates = res.candidates.slice(0, 8).map((c) => ({ id: c.entry.neighborhoodId, nameFa: c.entry.nameFa })); return { value: null, summary: res.best ? 'نام مبهم؛ انتخاب کاربر لازم است' : 'محله یافت نشد' }; }
      const e = res.best.entry; r.neighborhood = { id: e.neighborhoodId, nameFa: e.nameFa, city: e.cityFa };
      return { value: e.neighborhoodId, summary: `${e.nameFa} (${e.neighborhoodId})، اطمینان ${Math.round(res.best.confidence * 100)}٪` };
    });
    if (!nbId) { r.status = 'needs_user_choice'; r.finishedAt = new Date().toISOString(); saveResearch(r); return r; }
    // ۲) سنجه
    const card = await step('run_analysis', 'A7', async () => {
      const c = await analysisFor({ neighborhoodId: nbId, offline: Boolean(r.input.offline) });
      r.analysisId = c.card.fingerprint; r.level = c.card.publication.level;
      return { value: c, summary: `سطح کارت ${c.card.publication.level}` };
    });
    // ۳) شکاف‌ها
    const gaps = await step('find_data_gaps', 'A6', async () => {
      const g = gapsFromCard(card!); r.gaps = g;
      return { value: g, summary: `${g.length} شکاف (${g.filter((x) => x.reason === 'no_score').length} بی‌امتیاز، ${g.filter((x) => x.reason === 'low_reliability').length} کم‌اعتبار)` };
    });
    // ۴) کشف منبع
    const disc = await step('discover_sources', 'A2', async () => {
      if (!gaps!.length) return { value: null, summary: 'شکافی نیست' };
      const d = await discoverSources({ indicators: gaps!.map((g) => g.code), city: r.neighborhood!.city, neighborhoodName: r.neighborhood!.nameFa, verify: r.input.verify ?? !r.input.offline, useSearch: Boolean(r.input.useSearch), useLlm: Boolean(r.input.useLlm) }, opts.deps);
      const verified = d.cards.filter((c) => c.status === 'verified' || c.status === 'approved').length;
      return { value: d, summary: `${d.cards.length} منبع نامزد، ${verified} راستی‌آزمایی‌شده؛ ${d.uncovered.length} شاخص بی‌منبع` };
    });
    // ۵) حافظهٔ اسناد و برگه‌ها
    await step('search_documents', 'A4', async () => {
      let hits = 0;
      r.briefs = gaps!.map((g) => {
        const cards = (disc?.cards ?? []).filter((c) => c.indicators.includes(g.code)).sort((a, b) => b.trust.score - a.trust.score);
        const docs = searchMemory(`${INDICATOR_LEXICON[g.code].words.join(' ')} ${r.neighborhood!.nameFa}`, { limit: 3, kind: 'document', mustMatchAny: INDICATOR_LEXICON[g.code].words }).map((h) => ({ refId: h.refId, title: h.title, page: h.page, snippet: h.snippet }));
        hits += docs.length;
        const best = cards.find((c) => c.status === 'approved') ?? cards.find((c) => c.status === 'verified') ?? cards.find((c) => c.status === 'unreachable' && c.domestic);
        const nextAction = docs.length ? 'سند مرتبط در حافظه هست؛ جدول آن را استخراج و دستهٔ قراردادی بسازید' : best ? NEXT[best.status] ?? NEXT.verified : (SURVEY_NATIVE.has(g.code) ? 'منبعی یافت نشد؛ این شاخص ذاتاً پیمایشی است — در زبانهٔ «دادهٔ پیمایشی (پرسشنامه)» پرسشنامه بسازید یا پاسخ وارد کنید (A8)' : 'منبعی یافت نشد؛ پیمایش میدانی یا درخواست رسمی داده (A8)');
        return { code: g.code, name: g.name, reason: g.reason, candidates: cards.slice(0, 5).map((c) => ({ cardId: c.cardId, title: c.title, url: c.url, status: c.status, trust: c.trust.score, spatialLevel: c.spatialLevel, domestic: c.domestic })), documents: docs, nextAction };
      });
      return { value: null, summary: `${hits} اصابت در حافظهٔ اسناد` };
    });
    const ids = new Set(r.briefs.flatMap((b) => b.candidates.map((c) => c.cardId)));
    const all = (disc?.cards ?? []).filter((c) => ids.has(c.cardId));
    r.summary = { gaps: r.gaps.length, covered: r.briefs.filter((b) => b.candidates.length || b.documents.length).length, uncovered: r.briefs.filter((b) => !b.candidates.length && !b.documents.length).length, verifiedSources: all.filter((c) => c.status === 'verified' || c.status === 'approved').length, candidateSources: all.length };
    r.status = 'done';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r.status = msg === 'CANCELLED' ? 'cancelled' : 'failed'; r.error = msg === 'CANCELLED' ? null : msg;
  }
  r.finishedAt = new Date().toISOString(); saveResearch(r);
  return r;
}
