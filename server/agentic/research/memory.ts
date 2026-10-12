/**
 * حافظهٔ اسناد: بازیابی واژگانی BM25 روی پاره‌های متن اسناد و کارت‌های منبع (با شمارهٔ صفحه برای ارجاع).
 * بدون مدل تعبیه؛ در فاز پایگاه داده با pgvector جایگزین/ترکیب می‌شود. نتیجه فقط «ارجاع» است، نه عدد.
 */
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../../paths';
import { normalizeFa } from '../../neighborhood/text';
import { lamAlefFold } from './documents';

export const MEMORY_VERSION = 'MEM-BM25-v1';
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
  return n;
}
function removeItem(refId: string, ix = load()) {
  const keep = ix.chunks.filter((c) => c.refId !== refId);
  if (keep.length === ix.chunks.length) return;
  for (const c of ix.chunks) if (c.refId === refId) for (const t of Object.keys(c.tf)) { ix.df[t] -= 1; if (ix.df[t] <= 0) delete ix.df[t]; }
  ix.chunks = keep;
}

export function searchMemory(query: string, opts: { limit?: number; kind?: Chunk['kind']; mustMatchAny?: string[] } = {}): Array<{ chunkId: string; kind: string; refId: string; page: number; title: string; score: number; snippet: string }> {
  const ix = load(); const q = [...new Set(tokenize(query))];
  if (!q.length || !ix.chunks.length) return [];
  const N = ix.chunks.length, k1 = 1.2, b = 0.75;
  const must = (opts.mustMatchAny ?? []).map((w) => lamAlefFold(normalizeFa(w))).filter(Boolean);
  const res = ix.chunks.filter((c) => (!opts.kind || c.kind === opts.kind) && (!must.length || must.some((w) => lamAlefFold(normalizeFa(c.text)).includes(w)))).map((c) => {
    let s = 0;
    for (const t of q) { const f = c.tf[t]; if (!f) continue; const idf = Math.log(1 + (N - (ix.df[t] ?? 0) + 0.5) / ((ix.df[t] ?? 0) + 0.5)); s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.len) / (ix.avgLen || 1)))); }
    return { c, s };
  }).filter((x) => x.s > 0).sort((a, b2) => b2.s - a.s).slice(0, opts.limit ?? 8);
  return res.map(({ c, s }) => {
    const norm = lamAlefFold(normalizeFa(c.text)); const hit = q.map((t) => norm.indexOf(t)).filter((i) => i >= 0).sort((a, b2) => a - b2)[0] ?? 0;
    const start = Math.max(0, Math.round((hit / Math.max(1, norm.length)) * c.text.length) - 120);
    return { chunkId: c.chunkId, kind: c.kind, refId: c.refId, page: c.page, title: c.title, score: Math.round(s * 1000) / 1000, snippet: c.text.slice(start, start + 320).replace(/\s+/g, ' ').trim() };
  });
}
export function memoryStats() { const ix = load(); return { version: MEMORY_VERSION, chunks: ix.chunks.length, items: new Set(ix.chunks.map((c) => c.refId)).size, terms: Object.keys(ix.df).length }; }
export function _resetMemory(): void { mem = null; }
