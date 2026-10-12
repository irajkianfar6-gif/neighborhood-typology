/**
 * حافظهٔ اسناد (MEM-HYB-v1): بازیابی ترکیبی روی پاره‌های متن اسناد، کارت‌های منبع و پژوهش وب (با شمارهٔ صفحه برای ارجاع):
 * BM25 واژگانی + شباهت برداری n-گرمی (EMB-HASH-v1)، ادغام با RRF. با PostgreSQL+pgvector بُعد برداری در پایگاه داده
 * اجرا می‌شود (searchMemoryAsync). نتیجه فقط «ارجاع» است، نه عدد.
 */
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../../paths';
import { normalizeFa } from '../../neighborhood/text';
import { pgDb, pgVectorAvailable } from '../../db/pgSync';
import { lamAlefFold } from './documents';
import { cosine, embed, EMBED_VERSION, toPgVector } from './embedding';

export const MEMORY_VERSION = 'MEM-HYB-v1';
export interface Chunk { chunkId: string; kind: 'document' | 'source_card' | 'web_research'; refId: string; page: number; title: string; text: string }
interface Index { version: string; chunks: Array<Chunk & { tf: Record<string, number>; len: number }>; df: Record<string, number>; avgLen: number }

const STOP = new Set('و در به از که این آن با را برای تا یا هم نیز است شد شده می ها های بر هر ای یک the of and in to for a is on by with سال جدول'.split(' '));
export function tokenize(s: string): string[] {
  return lamAlefFold(normalizeFa(s)).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !STOP.has(t))
    .map((t) => (t.length > 5 ? t.replace(/(های|ها|ترین|تر)$/, '') : t));
}
function file(): string { const d = path.join(serverDataDir(), 'agentic', 'memory'); fs.mkdirSync(d, { recursive: true }); return path.join(d, 'index.json'); }
let mem: Index | null = null;
function load(): Index { if (mem) return mem; try { mem = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { mem = null; } return (mem ??= { version: MEMORY_VERSION, chunks: [], df: {}, avgLen: 0 }); }
function save(ix: Index) { ix.avgLen = ix.chunks.length ? ix.chunks.reduce((a, c) => a + c.len, 0) / ix.chunks.length : 0; fs.writeFileSync(file(), JSON.stringify(ix)); }

/** پاره‌بندی ~۹۰۰ نویسه با هم‌پوشانی کم */
export function chunkText(text: string, size = 900): string[] {
  const clean = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size - 100) out.push(clean.slice(i, i + size));
  return out.filter((c) => c.trim().length > 20);
}

export function indexItem(kind: Chunk['kind'], refId: string, title: string, pages: Array<{ page: number; text: string }>): number {
  const ix = load();
  removeItem(refId, ix);
  let n = 0;
  for (const p of pages) for (const [k, text] of chunkText(`${p.page === 1 ? `${title}\n` : ''}${p.text}`).entries()) {
    const toks = tokenize(text); const tf: Record<string, number> = {};
    for (const t of toks) tf[t] = (tf[t] ?? 0) + 1;
    for (const t of Object.keys(tf)) ix.df[t] = (ix.df[t] ?? 0) + 1;
    ix.chunks.push({ chunkId: `${refId}#p${p.page}c${k + 1}`, kind, refId, page: p.page, title, text, tf, len: toks.length });
    n++;
  }
  save(ix);
  void mirrorChunks(refId);
  return n;
}

// ---------------- بردارها ----------------
const vecCache = new Map<string, Float32Array>();
function vecOf(c: Chunk): Float32Array { let v = vecCache.get(c.chunkId); if (!v) { v = embed(`${c.title}\n${c.text}`); vecCache.set(c.chunkId, v); } return v; }

/** آینهٔ پاره‌های یک سند در ara.research_chunks (فقط با pgvector) */
async function mirrorChunks(refId: string): Promise<void> {
  const db = pgDb(); if (!db || !pgVectorAvailable()) return;
  try {
    await db.query('DELETE FROM ara.research_chunks WHERE ref_id = $1', [refId]);
    for (const c of load().chunks.filter((x) => x.refId === refId)) {
      await db.query('INSERT INTO ara.research_chunks (chunk_id, kind, ref_id, page, title, body, embedding, embed_version) VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8) ON CONFLICT (chunk_id) DO NOTHING',
        [c.chunkId, c.kind, c.refId, c.page, c.title, c.text, toPgVector(vecOf(c)), EMBED_VERSION]);
    }
  } catch { /* آینه اختیاری است؛ همگام‌سازی بعدی جبران می‌کند */ }
}
/** هم‌ترازی کامل جدول پاره‌ها با نمایهٔ محلی (پس از راه‌اندازی) */
export async function syncChunksToPg(): Promise<{ synced: number }> {
  const db = pgDb(); if (!db || !pgVectorAvailable()) return { synced: 0 };
  const local = load().chunks; const ids = new Set(local.map((c) => c.chunkId));
  const { rows } = await db.query('SELECT chunk_id, embed_version FROM ara.research_chunks');
  const remote = new Map(rows.map((r) => [String(r.chunk_id), String(r.embed_version)]));
  for (const id of remote.keys()) if (!ids.has(id)) await db.query('DELETE FROM ara.research_chunks WHERE chunk_id = $1', [id]);
  const refs = new Set(local.filter((c) => remote.get(c.chunkId) !== EMBED_VERSION).map((c) => c.refId));
  for (const r of refs) await mirrorChunks(r);
  return { synced: refs.size };
}
function removeItem(refId: string, ix = load()) {
  for (const c of ix.chunks) if (c.refId === refId) vecCache.delete(c.chunkId);
  const keep = ix.chunks.filter((c) => c.refId !== refId);
  if (keep.length === ix.chunks.length) return;
  for (const c of ix.chunks) if (c.refId === refId) for (const t of Object.keys(c.tf)) { ix.df[t] -= 1; if (ix.df[t] <= 0) delete ix.df[t]; }
  ix.chunks = keep;
}

export interface MemoryHit { chunkId: string; kind: string; refId: string; page: number; title: string; score: number; snippet: string; bm25: number | null; similarity: number | null }
type SearchOpts = { limit?: number; kind?: Chunk['kind']; mustMatchAny?: string[]; mode?: 'hybrid' | 'bm25' };
const SIM_MIN = 0.2; const RRF_K = 60;

function candidates(opts: SearchOpts) {
  const must = (opts.mustMatchAny ?? []).map((w) => lamAlefFold(normalizeFa(w))).filter(Boolean);
  return load().chunks.filter((c) => (!opts.kind || c.kind === opts.kind) && (!must.length || must.some((w) => lamAlefFold(normalizeFa(c.text)).includes(w))));
}
function fuse(query: string, bm: Array<{ c: Chunk; s: number }>, sem: Array<{ c: Chunk; sim: number }>, limit: number): MemoryHit[] {
  const m = new Map<string, { c: Chunk; f: number; bm25: number | null; sim: number | null }>();
  bm.forEach((x, i) => m.set(x.c.chunkId, { c: x.c, f: 1 / (RRF_K + i + 1), bm25: x.s, sim: null }));
  sem.forEach((x, i) => { const e = m.get(x.c.chunkId); if (e) { e.f += 1 / (RRF_K + i + 1); e.sim = x.sim; } else m.set(x.c.chunkId, { c: x.c, f: 1 / (RRF_K + i + 1), bm25: null, sim: x.sim }); });
  return [...m.values()].sort((a, b) => b.f - a.f).slice(0, limit).map((e) => ({ ...hitOf(e.c, query, Math.round(e.f * 100000) / 1000), bm25: e.bm25 === null ? null : Math.round(e.bm25 * 1000) / 1000, similarity: e.sim === null ? null : Math.round(e.sim * 1000) / 1000 }));
}
function hitOf(c: Chunk, query: string, score: number) {
  const q = [...new Set(tokenize(query))];
  const norm = lamAlefFold(normalizeFa(c.text)); const hit = q.map((t) => norm.indexOf(t)).filter((i) => i >= 0).sort((a, b2) => a - b2)[0] ?? 0;
  const start = Math.max(0, Math.round((hit / Math.max(1, norm.length)) * c.text.length) - 120);
  return { chunkId: c.chunkId, kind: c.kind, refId: c.refId, page: c.page, title: c.title, score, snippet: c.text.slice(start, start + 320).replace(/\s+/g, ' ').trim() };
}

/** جست‌وجوی ترکیبی (پیش‌فرض) یا فقط BM25؛ همگام و درون‌برنامه‌ای */
export function searchMemory(query: string, opts: SearchOpts = {}): MemoryHit[] {
  const limit = opts.limit ?? 8;
  const bm = bm25(query, opts, limit * 3);
  if (opts.mode === 'bm25') return bm.slice(0, limit).map((x) => ({ ...hitOf(x.c, query, Math.round(x.s * 1000) / 1000), bm25: Math.round(x.s * 1000) / 1000, similarity: null }));
  const qv = embed(query);
  const sem = candidates(opts).map((c) => ({ c, sim: cosine(qv, vecOf(c)) })).filter((x) => x.sim >= SIM_MIN).sort((a, b) => b.sim - a.sim).slice(0, limit * 3);
  return fuse(query, bm, sem, limit);
}

/** همان جست‌وجوی ترکیبی؛ با pgvector بُعد برداری در پایگاه داده اجرا می‌شود (پیکرهٔ بزرگ) */
export async function searchMemoryAsync(query: string, opts: SearchOpts = {}): Promise<{ engine: 'pgvector' | 'local'; hits: MemoryHit[] }> {
  const db = pgDb();
  if (!db || !pgVectorAvailable() || opts.mode === 'bm25' || opts.mustMatchAny?.length) return { engine: 'local', hits: searchMemory(query, opts) };
  try {
    const limit = opts.limit ?? 8;
    const { rows } = await db.query(`SELECT chunk_id, 1 - (embedding <=> $1::vector) AS sim FROM ara.research_chunks WHERE ($2::text IS NULL OR kind = $2) ORDER BY embedding <=> $1::vector LIMIT $3`, [toPgVector(embed(query)), opts.kind ?? null, limit * 3]);
    const byId = new Map(load().chunks.map((c) => [c.chunkId, c]));
    const sem = rows.map((r) => ({ c: byId.get(String(r.chunk_id)), sim: Number(r.sim) })).filter((x) => Boolean(x.c) && x.sim >= SIM_MIN) as Array<{ c: Chunk; sim: number }>;
    return { engine: 'pgvector', hits: fuse(query, bm25(query, opts, limit * 3), sem, limit) };
  } catch { return { engine: 'local', hits: searchMemory(query, opts) }; }
}

function bm25(query: string, opts: SearchOpts, limit: number): Array<{ c: Chunk & { tf: Record<string, number>; len: number }; s: number }> {
  const ix = load(); const q = [...new Set(tokenize(query))];
  if (!q.length || !ix.chunks.length) return [];
  const N = ix.chunks.length, k1 = 1.2, b = 0.75;
  const must = (opts.mustMatchAny ?? []).map((w) => lamAlefFold(normalizeFa(w))).filter(Boolean);
  const res = ix.chunks.filter((c) => (!opts.kind || c.kind === opts.kind) && (!must.length || must.some((w) => lamAlefFold(normalizeFa(c.text)).includes(w)))).map((c) => {
    let s = 0;
    for (const t of q) { const f = c.tf[t]; if (!f) continue; const idf = Math.log(1 + (N - (ix.df[t] ?? 0) + 0.5) / ((ix.df[t] ?? 0) + 0.5)); s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.len) / (ix.avgLen || 1)))); }
    return { c, s };
  }).filter((x) => x.s > 0).sort((a, b2) => b2.s - a.s).slice(0, limit);
  return res;
}
export function memoryStats() { const ix = load(); return { version: MEMORY_VERSION, embedding: EMBED_VERSION, vectorStore: pgVectorAvailable() ? 'pgvector' : 'local', chunks: ix.chunks.length, items: new Set(ix.chunks.map((c) => c.refId)).size, terms: Object.keys(ix.df).length }; }
export function _resetMemory(): void { mem = null; vecCache.clear(); }
