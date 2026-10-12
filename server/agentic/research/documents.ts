/**
 * A4 — استخراج قطعی جدول و عدد از اسناد (CSV/TSV، XLSX، HTML، PDF) با ارجاع سلولی.
 * مدل زبانی در این مرحله نقشی ندارد. برای PDF دو روش مستقل (جعبهٔ واژه‌ها با pdftotext -tsv و
 * متن چیدمانی pdftotext -layout) اجرا و عددهای هر ردیف با هم مقایسه می‌شوند (راستی‌آزمایی دوروشی).
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serverDataDir } from '../../paths';
import { detectPeriod, latinDigits, parseNumberFa } from './numbers';
import { readZip } from './zip';

export const EXTRACTOR_VERSION = 'DOCX-v1';
export type DocKind = 'csv' | 'tsv' | 'xlsx' | 'html' | 'pdf' | 'txt';
export interface Cell { text: string; num: number | null; percent: boolean; ref: string }
export interface ExtractedTable { tableId: string; origin: string; header: string[]; rows: Cell[][]; rtl: boolean }
export interface DocVerification { method: string; numericCells: number; agreed: number; agreement: number | null; note: string }
export interface DocRecord {
  schema: 'ara.document.v1'; docId: string; filename: string; kind: DocKind; sha256: string; bytes: number; createdAt: string;
  uploadedBy: string; sourceUrl: string | null; sourceCardId: string | null; title: string; period: ReturnType<typeof detectPeriod>;
  extractor: string; tables: Array<{ tableId: string; origin: string; columns: number; rows: number; header: string[] }>; pages: number;
  verification: DocVerification; warnings: string[];
}
export interface DocContent { tables: ExtractedTable[]; pages: Array<{ page: number; text: string }> }

const MAX_BYTES = Number(process.env.ARA_DOC_MAX_BYTES || 25 * 1024 * 1024);
function root(): string { const d = path.join(serverDataDir(), 'agentic', 'docs'); fs.mkdirSync(d, { recursive: true }); return d; }
const safeId = (id: string) => { if (!/^doc_[a-z0-9_]+$/.test(id)) throw new Error('شناسهٔ سند نامعتبر است'); return id; };
const docDir = (id: string) => path.join(root(), safeId(id));

/** متن PDF: حذف نویسه‌های کنترل جهت و یکسان‌سازی ترکیب «لا» که pdftotext گاه وارونه می‌کند */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export const stripBidi = (s: string) => s.replace(BIDI, '');
export const lamAlefFold = (s: string) => s.replace(/لا/g, 'ال');
const ARABIC_LETTER = /[\u0621-\u064A\u0671-\u06D3\u06FA-\u06FF]/;

export function detectKind(filename: string, buf: Buffer): DocKind {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'xlsx';
  const ext = path.extname(filename).toLowerCase();
  const head = buf.subarray(0, 4000).toString('utf8').toLowerCase();
  if (ext === '.html' || ext === '.htm' || /<table|<html/.test(head)) return 'html';
  if (ext === '.tsv' || (head.split('\n')[0] ?? '').includes('\t')) return 'tsv';
  if (ext === '.csv' || /[,;]/.test(head.split('\n')[0] ?? '')) return 'csv';
  return 'txt';
}

const cell = (text: string, ref: string): Cell => { const t = text.replace(/\s+/g, ' ').trim(); const n = parseNumberFa(t); return { text: t, num: n ? n.value : null, percent: n?.percent ?? false, ref }; };

// ---------------- CSV / TSV ----------------
export function parseDelimited(text: string, delim?: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const first = src.split(/\r?\n/)[0] ?? '';
  const d = delim ?? (first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ','));
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f === '') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** از شبکهٔ خانه‌ها جدول بساز: سطر سرستون = نخستین سطر با ≥۲ متن که پس از آن سطر عددی می‌آید */
function gridToTables(grid: string[][], refOf: (r: number, c: number) => string, origin: string, idPrefix: string): { tables: ExtractedTable[]; titleLines: string[] } {
  const tables: ExtractedTable[] = []; const titleLines: string[] = [];
  const hasNum = (r: string[]) => r.some((x) => parseNumberFa(x) !== null);
  let i = 0;
  while (i < grid.length) {
    const r = grid[i];
    const filled = r.filter((x) => String(x ?? '').trim()).length;
    if (filled >= 2 && i + 1 < grid.length && hasNum(grid[i + 1]) && !hasNum(r.filter((x, k) => k > 0 || !parseNumberFa(x)))) {
      const width = Math.max(...grid.slice(i, i + 50).map((x) => x.length));
      const header = Array.from({ length: width }, (_, c) => String(r[c] ?? '').replace(/\s+/g, ' ').trim());
      const rows: Cell[][] = [];
      let j = i + 1;
      for (; j < grid.length; j++) {
        const g = grid[j];
        if (!g.some((x) => String(x ?? '').trim())) break;
        if (!hasNum(g) && g.filter((x) => String(x ?? '').trim()).length >= 2 && j + 1 < grid.length && hasNum(grid[j + 1]) && rows.length > 0) break; // جدول تازه
        rows.push(Array.from({ length: width }, (_, c) => cell(String(g[c] ?? ''), refOf(j, c))));
      }
      tables.push({ tableId: `${idPrefix}${tables.length + 1}`, origin, header, rows, rtl: header.some((h) => ARABIC_LETTER.test(h)) });
      i = j;
    } else { if (filled && tables.length === 0) titleLines.push(r.filter(Boolean).join(' ')); i += 1; }
  }
  return { tables, titleLines };
}

// ---------------- XLSX ----------------
const xmlDecode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const colIndex = (letters: string) => letters.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colLetters = (i: number) => { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export function readXlsx(buf: Buffer): Array<{ name: string; grid: string[][] }> {
  const z = readZip(buf);
  const get = (n: string) => z.get(n)?.toString('utf8') ?? '';
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlDecode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rels = new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [/Id="([^"]+)"/.exec(m[1])?.[1] ?? '', /Target="([^"]+)"/.exec(m[1])?.[1] ?? '']));
  const sheets = [...get('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({ name: xmlDecode(/name="([^"]*)"/.exec(m[1])?.[1] ?? 'Sheet'), rid: /r:id="([^"]+)"/.exec(m[1])?.[1] ?? '' }));
  return sheets.map(({ name, rid }) => {
    let target = rels.get(rid) ?? '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = get(target);
    const grid: string[][] = [];
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+)(\d+)"/.exec(m[1]); if (!ref) continue;
      const t = /t="([^"]+)"/.exec(m[1])?.[1];
      const body = m[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (t === 's') text = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') text = xmlDecode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (v !== undefined) text = xmlDecode(v);
      const r = Number(ref[2]) - 1, c = colIndex(ref[1]);
      while (grid.length <= r) grid.push([]);
      grid[r][c] = text;
    }
    return { name, grid: grid.map((r) => Array.from({ length: r.length }, (_, k) => r[k] ?? '')) };
  });
}

// ---------------- HTML ----------------
const stripTags = (s: string) => xmlDecode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')).replace(/\s+/g, ' ').trim();
export function readHtmlTables(html: string): Array<{ grid: string[][] }> {
  return [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((t) => ({
    grid: [...t[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((tr) => {
      const out: string[] = [];
      for (const td of tr[0].matchAll(/<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) { const span = Number(/colspan="?(\d+)/i.exec(td[2])?.[1] ?? 1); out.push(stripTags(td[3])); for (let k = 1; k < Math.min(span, 20); k++) out.push(''); }
      return out;
    }),
  }));
}
const htmlTitle = (html: string) => stripTags(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html)?.[1] ?? '');

// ---------------- PDF ----------------
export function pdftotextAvailable(): boolean { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } }
interface Word { page: number; x0: number; x1: number; y: number; h: number; text: string }
function pdfWords(file: string): Word[] {
  const tsv = execFileSync('pdftotext', ['-tsv', '-enc', 'UTF-8', file, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  const out: Word[] = [];
  for (const line of tsv.split('\n').slice(1)) {
    const f = line.split('\t');
    if (f[0] !== '5' || f.length < 12) continue;
    let text = stripBidi(f.slice(11).join('\t')).trim();
    if (!text) continue;
    // pdftotext -tsv واژه‌های راست‌به‌چپ را به ترتیب دیداری می‌دهد؛ واژه‌های حرفی برگردانده می‌شوند (عددها نه)
    if (ARABIC_LETTER.test(text)) text = [...text].reverse().join('');
    const x0 = Number(f[6]), w = Number(f[8]), top = Number(f[7]), h = Number(f[9]);
    out.push({ page: Number(f[1]), x0, x1: x0 + w, y: top + h / 2, h, text });
  }
  return out;
}

function pdfTablesFromWords(words: Word[]): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const pages = [...new Set(words.map((w) => w.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const ws = words.filter((w) => w.page === page).sort((a, b) => a.y - b.y);
    const lines: Word[][] = [];
    for (const w of ws) { const last = lines[lines.length - 1]; if (last && Math.abs(last[0].y - w.y) <= Math.max(3, w.h * 0.35)) last.push(w); else lines.push([w]); }
    const segs = (l: Word[]) => { const s = [...l].sort((a, b) => a.x0 - b.x0); let n = 1; for (let k = 1; k < s.length; k++) if (s[k].x0 - s[k - 1].x1 > GAP(s[k])) n++; return n; };
    const GAP = (w: Word) => Math.max(6, w.h * 0.45);
    const isData = (l: Word[]) => l.some((w) => parseNumberFa(w.text) !== null) && segs(l) >= 2;
    let k = 0;
    while (k < lines.length) {
      if (!isData(lines[k])) { k++; continue; }
      let e = k; while (e + 1 < lines.length && isData(lines[e + 1])) e++;
      if (e - k + 1 < 2) { k = e + 1; continue; }
      const data = lines.slice(k, e + 1);
      const headerLine = k > 0 && segs(lines[k - 1]) >= 2 && !isData(lines[k - 1]) ? lines[k - 1] : null;
      // ستون‌ها از تصویر بازه‌های واژه‌های سطرهای داده
      const iv = data.flat().map((w) => [w.x0, w.x1, GAP(w)] as [number, number, number]).sort((a, b) => a[0] - b[0]);
      const cols: Array<[number, number]> = [];
      for (const [a, b, g] of iv) { const last = cols[cols.length - 1]; if (last && a - last[1] <= g) last[1] = Math.max(last[1], b); else cols.push([a, b]); }
      const rtl = data.flat().concat(headerLine ?? []).filter((w) => ARABIC_LETTER.test(w.text)).length > 0;
      const ordered = rtl ? [...cols].reverse() : cols;
      const colOf = (w: Word) => { const c = (w.x0 + w.x1) / 2; let best = 0, bd = Infinity; ordered.forEach(([a, b], idx) => { const d = c < a ? a - c : c > b ? c - b : 0; if (d < bd) { bd = d; best = idx; } }); return best; };
      const join = (arr: Word[]) => arr.sort((a, b) => (rtl ? b.x0 - a.x0 : a.x0 - b.x0)).map((w) => w.text).join(' ');
      const tId = `p${page}t${tables.filter((t) => t.origin.startsWith(`page ${page}`)).length + 1}`;
      // سرستون: نخست واژه‌ها به پاره‌های پیوسته تقسیم می‌شوند؛ پاره‌ای که فقط با یک ستون هم‌پوشانی دارد یک‌جا به آن ستون می‌رود
      const headerWords: Word[][] = ordered.map(() => []);
      if (headerLine) {
        const s = [...headerLine].sort((a, b) => a.x0 - b.x0);
        const parts: Word[][] = [];
        for (const w of s) { const last = parts[parts.length - 1]; if (last && w.x0 - last[last.length - 1].x1 <= GAP(w)) last.push(w); else parts.push([w]); }
        const assign = (part: Word[]) => {
          const a = part[0].x0, b = Math.max(...part.map((w) => w.x1)), c = (a + b) / 2;
          const near = ordered.reduce((best, [ca, cb], j) => (Math.abs((ca + cb) / 2 - c) < Math.abs((ordered[best][0] + ordered[best][1]) / 2 - c) ? j : best), 0);
          const hit = ordered.findIndex(([ca, cb]) => Math.min(b, cb) > Math.max(a, ca));
          headerWords[hit >= 0 ? hit : near].push(...part);
        };
        for (const part of parts) {
          const a = part[0].x0, b = Math.max(...part.map((w) => w.x1));
          const hits = ordered.filter(([ca, cb]) => Math.min(b, cb) > Math.max(a, ca)).length;
          if (hits <= 1 || part.length < 2) { assign(part); continue; }
          // پاره‌ای که چند ستون را می‌پوشاند در بزرگ‌ترین فاصله‌های درونی شکسته می‌شود
          const gaps = part.slice(1).map((w, k) => ({ k: k + 1, g: w.x0 - part[k].x1 })).sort((x, y) => y.g - x.g).slice(0, hits - 1).map((x) => x.k).sort((x, y) => x - y);
          let from = 0; for (const k of [...gaps, part.length]) { assign(part.slice(from, k)); from = k; }
        }
      }
      const header = headerWords.map((ws2) => join(ws2));
      const rows = data.map((l, ri) => ordered.map((_, ci) => cell(join(l.filter((w) => colOf(w) === ci)), `${tId}:r${ri + 1}:c${ci + 1}`)));
      tables.push({ tableId: tId, origin: `page ${page}`, header, rows, rtl });
      k = e + 1;
    }
  }
  return tables;
}

function pdfLayoutPages(file: string): string[] {
  return stripBidi(execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8')).split('\f').filter((p, i, a) => p.trim() || i < a.length - 1);
}

/** راستی‌آزمایی دوروشی: چندمجموعهٔ عددهای هر ردیف (روش جعبهٔ واژه) باید در یک خط متن چیدمانی یافت شود */
export function crossCheckPdf(tables: ExtractedTable[], layoutPages: string[]): DocVerification {
  let numeric = 0, agreed = 0;
  for (const t of tables) {
    const page = Number(/^page (\d+)/.exec(t.origin)?.[1] ?? 1);
    const lines = (layoutPages[page - 1] ?? '').split('\n').map((l) => l.split(/\s+/).map((tok) => parseNumberFa(tok)?.value).filter((v): v is number => v !== undefined));
    const used = new Set<number>();
    for (const r of t.rows) {
      const nums = r.map((c) => c.num).filter((v): v is number => v !== null);
      numeric += nums.length;
      let bestIdx = -1, bestHit = 0;
      lines.forEach((ln, idx) => {
        if (used.has(idx) || !ln.length) return;
        const pool = [...ln]; let hit = 0;
        for (const v of nums) { const p = pool.findIndex((x) => Math.abs(x - v) < 1e-9); if (p >= 0) { hit++; pool.splice(p, 1); } }
        if (hit > bestHit) { bestHit = hit; bestIdx = idx; }
      });
      if (bestIdx >= 0) used.add(bestIdx);
      agreed += bestHit;
    }
  }
  return { method: 'pdftotext-tsv × pdftotext-layout', numericCells: numeric, agreed, agreement: numeric ? Math.round((agreed / numeric) * 1000) / 1000 : null, note: 'عددهای هر ردیف با روش دوم مستقل مقایسه شد' };
}

// ---------------- رابط اصلی ----------------
export function extractBuffer(filename: string, buf: Buffer): { kind: DocKind; content: DocContent; title: string; verification: DocVerification; warnings: string[] } {
  const kind = detectKind(filename, buf);
  const warnings: string[] = [];
  const single = (n: number): DocVerification => ({ method: 'تجزیهٔ قطعی ساخت‌یافته (یک‌روشی)', numericCells: n, agreed: n, agreement: n ? 1 : null, note: 'قالب ساخت‌یافته؛ مقدار هر خانه همان مقدار ذخیره‌شده در فایل است' });
  const countNum = (ts: ExtractedTable[]) => ts.reduce((a, t) => a + t.rows.flat().filter((c) => c.num !== null).length, 0);
  if (kind === 'csv' || kind === 'tsv' || kind === 'txt') {
    const text = buf.toString('utf8');
    const grid = parseDelimited(text, kind === 'tsv' ? '\t' : undefined);
    const { tables, titleLines } = gridToTables(grid, (r, c) => `R${r + 1}C${c + 1}`, 'csv', 't');
    return { kind, content: { tables, pages: [{ page: 1, text }] }, title: titleLines.join(' ') || path.basename(filename), verification: single(countNum(tables)), warnings };
  }
  if (kind === 'xlsx') {
    const sheets = readXlsx(buf);
    const tables: ExtractedTable[] = []; const titles: string[] = []; const pages: DocContent['pages'] = [];
    sheets.forEach((s, si) => {
      const r = gridToTables(s.grid, (ri, ci) => `${s.name}!${colLetters(ci)}${ri + 1}`, `sheet ${s.name}`, `s${si + 1}t`);
      tables.push(...r.tables); titles.push(...r.titleLines);
      pages.push({ page: si + 1, text: [s.name, ...s.grid.map((g) => g.filter(Boolean).join(' | '))].join('\n') });
    });
    return { kind, content: { tables, pages }, title: titles[0] || path.basename(filename), verification: single(countNum(tables)), warnings };
  }
  if (kind === 'html') {
    const html = buf.toString('utf8');
    const tables: ExtractedTable[] = [];
    readHtmlTables(html).forEach((t, ti) => { const r = gridToTables(t.grid, (ri, ci) => `table${ti + 1}:r${ri + 1}:c${ci + 1}`, `table ${ti + 1}`, `h${ti + 1}t`); tables.push(...r.tables); });
    return { kind, content: { tables, pages: [{ page: 1, text: stripTags(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')) }] }, title: htmlTitle(html) || path.basename(filename), verification: single(countNum(tables)), warnings };
  }
  // PDF
  if (!pdftotextAvailable()) throw new Error('برای PDF ابزار pdftotext (Poppler) روی سرور لازم است');
  const tmp = path.join(os.tmpdir(), `ara-doc-${crypto.randomBytes(6).toString('hex')}.pdf`);
  fs.writeFileSync(tmp, buf);
  try {
    const tables = pdfTablesFromWords(pdfWords(tmp));
    const layout = pdfLayoutPages(tmp);
    const verification = crossCheckPdf(tables, layout);
    if (!tables.length) warnings.push('جدولی در PDF یافت نشد؛ اگر سند اسکن‌شده است، OCR لازم است');
    if (layout.every((p) => !p.trim())) warnings.push('PDF متن قابل استخراج ندارد (احتمالاً تصویر اسکن‌شده)');
    if (verification.agreement !== null && verification.agreement < 0.95) warnings.push(`هم‌خوانی دو روش ${Math.round(verification.agreement * 100)}٪ است؛ بازبینی انسانی لازم است`);
    const firstLines = (layout[0] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    return { kind, content: { tables, pages: layout.map((t, i) => ({ page: i + 1, text: t })) }, title: firstLines[0]?.replace(/\s+/g, ' ') || path.basename(filename), verification, warnings };
  } finally { fs.rmSync(tmp, { force: true }); }
}

export function ingestDocument(input: { filename: string; content: Buffer; uploadedBy?: string; sourceUrl?: string | null; sourceCardId?: string | null }): DocRecord {
  if (input.content.length > MAX_BYTES) throw new Error(`حجم سند بیش از ${Math.round(MAX_BYTES / 1048576)} مگابایت است`);
  if (!input.content.length) throw new Error('سند خالی است');
  const sha256 = crypto.createHash('sha256').update(input.content).digest('hex');
  const existing = listDocuments(500).find((d) => d.sha256 === sha256);
  if (existing) return existing;
  const ex = extractBuffer(input.filename, input.content);
  const docId = `doc_${Date.now().toString(36)}_${sha256.slice(0, 8)}`;
  const dir = docDir(docId); fs.mkdirSync(dir, { recursive: true });
  const filename = path.basename(input.filename).replace(/[^\w.\-\u0600-\u06FF ]/g, '_').slice(0, 120) || `document.${ex.kind}`;
  fs.writeFileSync(path.join(dir, `original.${ex.kind}`), input.content);
  fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(ex.content));
  const rec: DocRecord = {
    schema: 'ara.document.v1', docId, filename, kind: ex.kind, sha256, bytes: input.content.length, createdAt: new Date().toISOString(),
    uploadedBy: input.uploadedBy ?? 'operator', sourceUrl: input.sourceUrl ?? null, sourceCardId: input.sourceCardId ?? null,
    title: ex.title.slice(0, 300), period: detectPeriod(`${ex.title} ${filename}`) ?? detectPeriod(ex.content.pages[0]?.text.slice(0, 2000) ?? ''),
    extractor: EXTRACTOR_VERSION, tables: ex.content.tables.map((t) => ({ tableId: t.tableId, origin: t.origin, columns: t.header.length, rows: t.rows.length, header: t.header })),
    pages: ex.content.pages.length, verification: ex.verification, warnings: ex.warnings,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(rec, null, 1));
  return rec;
}

export function loadDocument(docId: string): DocRecord | null { try { const f = path.join(docDir(docId), 'meta.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch { return null; } }
export function loadContent(docId: string): DocContent | null { try { const f = path.join(docDir(docId), 'content.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch { return null; } }
export function listDocuments(limit = 50): DocRecord[] {
  return fs.readdirSync(root()).filter((d) => d.startsWith('doc_')).map((d) => loadDocument(d)).filter((d): d is DocRecord => Boolean(d)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
export function getTable(docId: string, tableId: string): ExtractedTable | null { return loadContent(docId)?.tables.find((t) => t.tableId === tableId) ?? null; }
export { latinDigits };
