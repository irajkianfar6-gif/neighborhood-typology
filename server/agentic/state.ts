/**
 * حافظهٔ کاری کوتاه‌مدت عامل‌ها: نتیجهٔ گردآوری و تحلیل هر محله برای استفادهٔ ابزارهای بعدی
 * (بدون محاسبهٔ دوباره). کلید = محله + گزینه‌های اجرا؛ شناسهٔ تحلیل = اثرانگشت قطعی کارت.
 */
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';
import { getNeighborhood, type GazetteerEntry } from '../neighborhood/gazetteer';
import { buildNeighborhoodContext, type NeighborhoodContext } from '../neighborhood/context';
import { analyzeByName, gatherEvidence, type AnalyzeResult, type GatheredEvidence } from '../neighborhood/orchestrator';
import { persistRun } from '../db/store';

export interface RunOptions { offline?: boolean; useKernel?: boolean; asOf?: string; purpose?: 'baseline' | 'monitoring' | 'intervention_priority' }
export type CardResult = Extract<AnalyzeResult, { card: unknown }>;

const TTL_MS = Number(process.env.ARA_AGENTIC_CACHE_TTL_MS || 15 * 60_000);
const MAX = 64;
interface Slot<T> { at: number; value: T }
const ctxCache = new Map<string, Slot<NeighborhoodContext>>();
const evCache = new Map<string, Slot<GatheredEvidence>>();
const anCache = new Map<string, Slot<CardResult>>();
const anById = new Map<string, string>();

const keyOf = (id: string, o: RunOptions) => [id, o.offline ? 1 : 0, o.useKernel === false ? 0 : 1, o.asOf ?? '', o.purpose ?? 'baseline'].join('|');
function get<T>(m: Map<string, Slot<T>>, k: string): T | undefined {
  const s = m.get(k);
  if (!s) return undefined;
  if (Date.now() - s.at > TTL_MS) { m.delete(k); return undefined; }
  return s.value;
}
function put<T>(m: Map<string, Slot<T>>, k: string, v: T): void {
  m.set(k, { at: Date.now(), value: v });
  while (m.size > MAX) m.delete(m.keys().next().value as string);
}

export class ToolInputError extends Error { constructor(public code: string, message: string) { super(message); } }

export function requireEntry(neighborhoodId: string): GazetteerEntry {
  const e = getNeighborhood(neighborhoodId);
  if (!e) throw new ToolInputError('NOT_FOUND', `محلهٔ «${neighborhoodId}» در گزتیر نیست؛ ابتدا resolve_neighborhood را اجرا کنید`);
  return e;
}

export async function contextFor(entry: GazetteerEntry, o: RunOptions): Promise<NeighborhoodContext> {
  const k = keyOf(entry.neighborhoodId, o);
  const hit = get(ctxCache, k);
  if (hit) return hit;
  const ctx = await buildNeighborhoodContext(entry, { useKernel: o.useKernel, asOf: o.asOf });
  put(ctxCache, k, ctx);
  return ctx;
}

export async function evidenceFor(entry: GazetteerEntry, o: RunOptions): Promise<{ ctx: NeighborhoodContext; gathered: GatheredEvidence }> {
  const ctx = await contextFor(entry, o);
  const k = keyOf(entry.neighborhoodId, o);
  const hit = get(evCache, k);
  if (hit) return { ctx, gathered: hit };
  const gathered = await gatherEvidence(entry, ctx, o);
  put(evCache, k, gathered);
  return { ctx, gathered };
}

function cardFile(id: string): string {
  const dir = path.join(serverDataDir(), 'neighborhood-cards');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id.replace(/[^\w.-]/g, '_')}.json`);
}

/** اجرای موتور قطعی (همان مسیر /neighborhoods/analyze) و ذخیرهٔ کارت برای نمایش در برنامه */
export async function runAnalysis(entry: GazetteerEntry, o: RunOptions & { persist?: boolean; force?: boolean }): Promise<CardResult> {
  const k = keyOf(entry.neighborhoodId, o);
  if (!o.force) { const hit = get(anCache, k); if (hit) return hit; }
  const r = await analyzeByName({ neighborhoodId: entry.neighborhoodId, offline: o.offline, useKernel: o.useKernel, asOf: o.asOf, purpose: o.purpose });
  if (!('card' in r)) throw new ToolInputError('NOT_FOUND', 'محله برای تحلیل یافت نشد');
  put(anCache, k, r);
  anById.set(r.card.fingerprint, k);
  if (o.persist !== false) {
    try { fs.writeFileSync(cardFile(entry.neighborhoodId), JSON.stringify(r)); } catch { /* ذخیره اختیاری */ }
    void persistRun(`${entry.neighborhoodId}@${r.card.generatedAt}`, entry, r.card, r.evidence, 'agentic');
  }
  return r;
}

/** دسترسی به تحلیل با شناسهٔ تحلیل (اثرانگشت) یا شناسهٔ محله (در صورت نبود، اجرا می‌شود) */
export async function analysisFor(input: { analysisId?: string; neighborhoodId?: string } & RunOptions): Promise<CardResult> {
  if (input.analysisId) {
    const k = anById.get(input.analysisId);
    const hit = k ? get(anCache, k) : undefined;
    if (hit) return hit;
    if (!input.neighborhoodId) throw new ToolInputError('ANALYSIS_EXPIRED', 'تحلیل با این شناسه در حافظهٔ کاری نیست؛ run_analysis را دوباره اجرا کنید یا neighborhoodId بدهید');
  }
  if (!input.neighborhoodId) throw new ToolInputError('INVALID_INPUT', 'analysisId یا neighborhoodId لازم است');
  return runAnalysis(requireEntry(input.neighborhoodId), input);
}

export function _resetAgenticState(): void { ctxCache.clear(); evCache.clear(); anCache.clear(); anById.clear(); }

/** باطل‌کردن حافظهٔ کاری یک محله (مثلاً پس از ورود دادهٔ پیمایشی تازه) — تعداد مدخل‌های حذف‌شده */
export function invalidateNeighborhood(neighborhoodId: string): number {
  let n = 0;
  for (const m of [ctxCache, evCache, anCache] as Array<Map<string, unknown>>) {
    for (const k of [...m.keys()]) if (k.split('|')[0] === neighborhoodId) { m.delete(k); n++; }
  }
  for (const [id, k] of [...anById]) if (k.split('|')[0] === neighborhoodId) anById.delete(id);
  return n;
}
