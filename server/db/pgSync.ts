/**
 * همگام‌سازی پایدار دادهٔ سمت‌سرور با PostgreSQL (PGSYNC-v1)
 *
 * هدف: PostgreSQL «منبع حقیقت» پایدار برای همهٔ دادهٔ عملیاتی (اجراهای عامل‌ها، کارزارها، پژوهش‌ها، دسته‌های قراردادی،
 * پیمایش‌ها، اسناد، کارت‌های منبع و …) تا استقرار دوباره، از دست رفتن دیسک یا انتقال سرور داده‌ای را از بین نبرد،
 * و گزارش‌گیری SQL روی همهٔ محله‌ها ممکن شود. فایل‌های محلی «حافظهٔ کاری» می‌مانند (API همگام کد بی‌تغییر).
 *
 *  - راه‌اندازی: مهاجرت جدول‌ها → بازیابی (hydrate): فایل‌های نبودِ محلی یا قدیمی‌تر از PG نوشته می‌شوند
 *    → پس‌پر کردن (backfill): فایل‌های محلی تازه‌تر/جدید به PG فرستاده می‌شوند.
 *  - در حین کار: پایش پوشه (fs.watch بازگشتی) + پویش دوره‌ای پشتیبان؛ فقط فایل‌های تغییرکرده (اندازه/زمان/هش) فرستاده می‌شوند.
 *  - حذف محلی → سنگ‌قبر (deleted_at) در PG؛ بازیابی فایل حذف‌شده را برنمی‌گرداند.
 *  - خطای پایگاه داده → صف تلاش مجدد (داده در فایل محلی امن است)؛ وضعیت در /api/agentic/system/storage.
 *  - فرض: یک نمونهٔ نویسنده برای هر پوشهٔ داده (چند نمونهٔ هم‌زمان پشتیبانی نمی‌شود؛ قفل مشورتی جلوی دو نویسنده را می‌گیرد).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';

export const PGSYNC_VERSION = 'PGSYNC-v1';
export interface PgLike { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; end?: () => Promise<void> }

// حافظه‌های نهان (قابل بازسازی) و پایگاه‌های SQLite زنده (کپی در حین نوشتن ناامن است) همگام نمی‌شوند
const BASE_EXCLUDE = [/^agentic\/webresearch\/cache\//, /(^|\/)[^/]*-cache\//, /\.sqlite(-wal|-shm|-journal)?$/, /\.db(-wal|-shm|-journal)?$/, /\.tmp$/, /\.lock$/, /(^|\/)\.[^/]+$/, /\.part$/];
const EXCLUDE = [...BASE_EXCLUDE, ...String(process.env.ARA_PG_SYNC_EXCLUDE ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((p) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))];
const LOCK_KEY = 74_210_311; // کلید قفل مشورتی (ثابت)

export function pgSyncEnabled(): boolean {
  return process.env.ARA_STORAGE === 'postgres' && Boolean(process.env.DATABASE_URL) && process.env.ARA_PG_SYNC !== '0';
}
const maxBytes = () => Math.max(1, Number(process.env.ARA_PG_MAX_FILE_MB || 25)) * 1024 * 1024;
const scanMs = () => Math.max(2, Number(process.env.ARA_PG_SYNC_SEC || 30)) * 1000;

interface Seen { size: number; mtimeMs: number; sha: string }
interface SyncState {
  db: PgLike | null; root: string; seen: Map<string, Seen>; pending: Set<string>; timer: NodeJS.Timeout | null; scanTimer: NodeJS.Timeout | null;
  watcher: fs.FSWatcher | null; flushing: Promise<void> | null; vector: boolean; owned: boolean;
  stats: { startedAt: string | null; hydrated: number; backfilled: number; written: number; deleted: number; failures: number; lastError: string | null; lastFlushAt: string | null; lastScanAt: string | null };
}
const S: SyncState = { db: null, root: '', seen: new Map(), pending: new Set(), timer: null, scanTimer: null, watcher: null, flushing: null, vector: false, owned: false,
  stats: { startedAt: null, hydrated: 0, backfilled: 0, written: 0, deleted: 0, failures: 0, lastError: null, lastFlushAt: null, lastScanAt: null } };

const rel = (abs: string) => path.relative(S.root, abs).split(path.sep).join('/');
const excluded = (r: string) => !r || r.startsWith('..') || EXCLUDE.some((re) => re.test(r));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const collectionOf = (r: string) => { const p = r.split('/'); return p.length > 2 ? `${p[0]}/${p[1]}` : p[0]; };

/** فیلدهای فهرستی برای گزارش‌گیری SQL (اختیاری؛ از سند JSON) */
function meta(doc: unknown): { nb: string | null; status: string | null } {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { nb: null, status: null };
  const d = doc as Record<string, unknown>;
  const nb = typeof d.neighborhoodId === 'string' ? d.neighborhoodId : null;
  const st = typeof d.status === 'string' ? d.status : null;
  return { nb, status: st };
}

export const MIGRATION_SQL = `
CREATE SCHEMA IF NOT EXISTS ara;
CREATE TABLE IF NOT EXISTS ara.server_files (
  rel_path text PRIMARY KEY,
  collection text NOT NULL,
  neighborhood_id text,
  status text,
  is_json boolean NOT NULL,
  doc jsonb,
  bytes bytea NOT NULL,
  sha256 text NOT NULL,
  size_bytes integer NOT NULL,
  mtime timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS server_files_collection_idx ON ara.server_files (collection, neighborhood_id);
CREATE INDEX IF NOT EXISTS server_files_status_idx ON ara.server_files (collection, status);
CREATE TABLE IF NOT EXISTS ara.sync_meta (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
`;
const VECTOR_SQL = `
CREATE TABLE IF NOT EXISTS ara.research_chunks (
  chunk_id text PRIMARY KEY, kind text NOT NULL, ref_id text NOT NULL, page integer NOT NULL, title text NOT NULL, body text NOT NULL,
  embedding vector(__DIM__) NOT NULL, embed_version text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS research_chunks_ref_idx ON ara.research_chunks (ref_id);
`;

async function connect(): Promise<PgLike> {
  const moduleName = 'pg';
  const pg = await import(/* @vite-ignore */ moduleName) as { default?: { Pool: new (o: object) => PgLike }; Pool?: new (o: object) => PgLike };
  const Pool = pg.Pool ?? pg.default!.Pool;
  return new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.ARA_PG_POOL_MAX || 5), ssl: process.env.ARA_PG_SSL === '1' ? { rejectUnauthorized: false } : undefined });
}

export async function migrate(db: PgLike, embedDim: number): Promise<{ vector: boolean }> {
  for (const stmt of MIGRATION_SQL.split(';').map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
  let vector = false;
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS vector');
    for (const stmt of VECTOR_SQL.replace('__DIM__', String(embedDim)).split(';').map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
    vector = true;
  } catch { vector = false; /* بدون pgvector: جست‌وجوی ترکیبی درون‌برنامه‌ای کافی است */ }
  await db.query(`INSERT INTO ara.sync_meta(key, value) VALUES ('schema', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ version: PGSYNC_VERSION, vector })]);
  return { vector };
}

function walk(dir: string, out: string[] = []): string[] {
  let ents: fs.Dirent[] = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p); }
  return out;
}

/** بازیابی از PG: فایل‌های نبود یا قدیمی‌ترِ محلی نوشته می‌شوند. خروجی: فهرست نسخهٔ PG برای پس‌پر کردن */
async function hydrate(db: PgLike): Promise<Map<string, { sha: string; mtime: number; deleted: boolean }>> {
  const remote = new Map<string, { sha: string; mtime: number; deleted: boolean }>();
  const { rows } = await db.query('SELECT rel_path, sha256, extract(epoch from mtime)*1000 AS mtime_ms, deleted_at IS NOT NULL AS deleted FROM ara.server_files');
  for (const r of rows) remote.set(String(r.rel_path), { sha: String(r.sha256), mtime: Number(r.mtime_ms), deleted: Boolean(r.deleted) });
  for (const [r, v] of remote) {
    if (v.deleted || excluded(r)) continue;
    const abs = path.join(S.root, r);
    let local: fs.Stats | null = null; try { local = fs.statSync(abs); } catch { local = null; }
    if (local && local.mtimeMs >= v.mtime - 1) continue; // محلی هم‌زمان یا تازه‌تر → پس‌پر کردن تصمیم می‌گیرد
    if (local && sha(fs.readFileSync(abs)) === v.sha) continue;
    const { rows: [row] } = await db.query('SELECT bytes FROM ara.server_files WHERE rel_path = $1', [r]);
    if (!row?.bytes) continue;
    const buf = Buffer.from(row.bytes as Uint8Array); // بایت‌های دقیق (doc فقط برای پرس‌وجوی SQL است)
    if (sha(buf) !== v.sha) { S.stats.lastError = `ناسازگاری هش در بازیابی ${r}`; continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    fs.utimesSync(abs, new Date(v.mtime), new Date(v.mtime));
    S.stats.hydrated++;
  }
  return remote;
}

function readLocal(abs: string): { st: fs.Stats; buf: Buffer } | null {
  try { const st = fs.statSync(abs); if (!st.isFile() || st.size > maxBytes()) return null; return { st, buf: fs.readFileSync(abs) }; } catch { return null; }
}

async function upsertFile(db: PgLike, r: string): Promise<'written' | 'deleted' | 'skipped'> {
  const abs = path.join(S.root, r);
  if (!fs.existsSync(abs)) {
    if (!S.seen.has(r)) return 'skipped';
    await db.query('UPDATE ara.server_files SET deleted_at = now(), updated_at = now() WHERE rel_path = $1 AND deleted_at IS NULL', [r]);
    S.seen.delete(r); return 'deleted';
  }
  const x = readLocal(abs); if (!x) return 'skipped';
  const h = sha(x.buf); const prev = S.seen.get(r);
  if (prev && prev.sha === h) { S.seen.set(r, { size: x.st.size, mtimeMs: x.st.mtimeMs, sha: h }); return 'skipped'; }
  let doc: unknown = null; let isJson = false;
  if (r.endsWith('.json')) { try { doc = JSON.parse(x.buf.toString('utf8')); isJson = true; } catch { isJson = false; } }
  // jsonb رشتهٔ دارای \u0000 را نمی‌پذیرد → در این حالت فقط بایت خام
  if (isJson && x.buf.includes('\\u0000')) isJson = false;
  const m = meta(doc);
  await db.query(`INSERT INTO ara.server_files (rel_path, collection, neighborhood_id, status, is_json, doc, bytes, sha256, size_bytes, mtime, updated_at, deleted_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10/1000.0),now(),NULL)
    ON CONFLICT (rel_path) DO UPDATE SET collection=EXCLUDED.collection, neighborhood_id=EXCLUDED.neighborhood_id, status=EXCLUDED.status, is_json=EXCLUDED.is_json,
      doc=EXCLUDED.doc, bytes=EXCLUDED.bytes, sha256=EXCLUDED.sha256, size_bytes=EXCLUDED.size_bytes, mtime=EXCLUDED.mtime, updated_at=now(), deleted_at=NULL`,
  [r, collectionOf(r), m.nb, m.status, isJson, isJson ? x.buf.toString('utf8') : null, x.buf, h, x.st.size, x.st.mtimeMs]);
  S.seen.set(r, { size: x.st.size, mtimeMs: x.st.mtimeMs, sha: h });
  return 'written';
}

function schedule(delay = 400) {
  if (!S.db || S.timer) return;
  S.timer = setTimeout(() => { S.timer = null; void flush(); }, delay);
  S.timer.unref?.();
}
/** اعلام صریح تغییر (اختیاری؛ پایش پوشه هم آن را می‌یابد) */
export function notifyWrite(absPath: string) { if (!S.db) return; const r = rel(absPath); if (!excluded(r)) { S.pending.add(r); schedule(); } }

export async function flush(): Promise<void> {
  if (!S.db) return;
  if (S.flushing) { await S.flushing; if (!S.pending.size) return; }
  S.flushing = (async () => {
    const batch = [...S.pending]; S.pending.clear();
    for (const r of batch) {
      try { const k = await upsertFile(S.db!, r); if (k === 'written') S.stats.written++; else if (k === 'deleted') S.stats.deleted++; }
      catch (e) { S.pending.add(r); S.stats.failures++; S.stats.lastError = String((e as Error)?.message ?? e).slice(0, 300); }
    }
    S.stats.lastFlushAt = new Date().toISOString();
  })();
  try { await S.flushing; } finally { S.flushing = null; }
  if (S.pending.size) schedule(5_000); // تلاش مجدد با فاصله
}

/** پویش کامل: تغییرهای از دست رفتهٔ پایش پوشه و حذف‌ها */
export async function scan(): Promise<number> {
  if (!S.db) return 0;
  const files = new Set(walk(S.root).map(rel).filter((r) => !excluded(r)));
  let n = 0;
  for (const r of files) {
    const prev = S.seen.get(r);
    let st: fs.Stats; try { st = fs.statSync(path.join(S.root, r)); } catch { continue; }
    if (!prev || prev.size !== st.size || Math.abs(prev.mtimeMs - st.mtimeMs) > 1) { S.pending.add(r); n++; }
  }
  for (const r of S.seen.keys()) if (!files.has(r)) { S.pending.add(r); n++; }
  S.stats.lastScanAt = new Date().toISOString();
  await flush();
  return n;
}

export interface StartOptions { db?: PgLike; watch?: boolean; embedDim?: number }
/** راه‌اندازی (در آغاز سرور، پیش از ساخت مسیرها). بدون پیکربندی → بی‌اثر */
export async function startPgSync(o: StartOptions = {}): Promise<ReturnType<typeof pgSyncStatus>> {
  if (S.db) return pgSyncStatus();
  if (!o.db && !pgSyncEnabled()) return pgSyncStatus();
  S.root = serverDataDir(); fs.mkdirSync(S.root, { recursive: true });
  S.stats = { startedAt: null, hydrated: 0, backfilled: 0, written: 0, deleted: 0, failures: 0, lastError: null, lastFlushAt: null, lastScanAt: null };
  try {
    const db = o.db ?? await connect();
    // پایگاه داده ممکن است هنوز آماده نباشد (راه‌اندازی هم‌زمان در docker): تا ۵ تلاش با فاصلهٔ فزاینده
    for (let i = 0; ; i++) { try { await db.query('SELECT 1'); break; } catch (e) { if (i >= 4) throw e; await new Promise((r) => setTimeout(r, 300 * 2 ** i)); } }
    S.owned = !o.db;
    const lock = process.env.ARA_PG_LOCK === '0' ? null : await db.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (lock?.rows[0] && lock.rows[0].ok === false) throw new Error('نمونهٔ دیگری از سرور در حال همگام‌سازی با همین پایگاه داده است (قفل مشورتی)');
    const { vector } = await migrate(db, o.embedDim ?? 256); S.vector = vector;
    S.db = db;
    const remote = await hydrate(db);
    // نقشهٔ «دیده‌شده» از PG؛ فایل‌های محلی جدید/تازه‌تر → پس‌پر کردن
    for (const r of walk(S.root).map(rel).filter((x) => !excluded(x))) {
      const x = readLocal(path.join(S.root, r)); if (!x) continue;
      const v = remote.get(r); const h = sha(x.buf);
      if (v && !v.deleted && v.sha === h) S.seen.set(r, { size: x.st.size, mtimeMs: x.st.mtimeMs, sha: h });
      else { S.pending.add(r); S.stats.backfilled++; }
    }
    await flush();
    S.stats.startedAt = new Date().toISOString();
    if (o.watch !== false) {
      try {
        S.watcher = fs.watch(S.root, { recursive: true }, (_e, f) => { if (f) { const r = String(f).split(path.sep).join('/'); if (!excluded(r)) { S.pending.add(r); schedule(); } } });
        S.watcher.unref?.();
      } catch { S.watcher = null; }
      S.scanTimer = setInterval(() => { void scan().catch(() => undefined); }, scanMs()); S.scanTimer.unref?.();
    }
    console.log(`[db] همگام‌سازی PostgreSQL فعال (${PGSYNC_VERSION}): بازیابی ${S.stats.hydrated}، پس‌پر ${S.stats.backfilled}، pgvector=${vector ? 'بله' : 'خیر'}`);
  } catch (e) {
    S.stats.lastError = String((e as Error)?.message ?? e).slice(0, 300); S.db = null;
    console.warn(`[db] همگام‌سازی PostgreSQL غیرفعال شد: ${S.stats.lastError} — فقط فایل محلی`);
  }
  return pgSyncStatus();
}

export async function stopPgSync(): Promise<void> {
  if (S.timer) clearTimeout(S.timer); if (S.scanTimer) clearInterval(S.scanTimer); S.timer = null; S.scanTimer = null;
  try { S.watcher?.close(); } catch { /* */ } S.watcher = null;
  if (S.db) {
    try { await scan(); } catch { /* */ }
    if (process.env.ARA_PG_LOCK !== '0') { try { await S.db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch { /* */ } }
    if (S.owned) { try { await S.db.end?.(); } catch { /* */ } }
  }
  S.db = null; S.seen.clear(); S.pending.clear();
}

export function pgDb(): PgLike | null { return S.db; }
export function pgVectorAvailable(): boolean { return Boolean(S.db) && S.vector; }
export function pgSyncStatus() {
  return { version: PGSYNC_VERSION, enabled: pgSyncEnabled(), active: Boolean(S.db), vector: S.vector && Boolean(S.db), tracked: S.seen.size, pending: S.pending.size, watching: Boolean(S.watcher), ...S.stats };
}

/** گزارش SQL: شمار پرونده‌ها به تفکیک مجموعه/وضعیت (برای داشبورد عملیات) */
export async function pgCollectionSummary(): Promise<Array<{ collection: string; status: string | null; n: number; bytes: number }>> {
  if (!S.db) return [];
  const { rows } = await S.db.query(`SELECT collection, status, count(*)::int AS n, sum(size_bytes)::bigint AS bytes FROM ara.server_files WHERE deleted_at IS NULL GROUP BY 1,2 ORDER BY 1,2`);
  return rows.map((r) => ({ collection: String(r.collection), status: r.status === null ? null : String(r.status), n: Number(r.n), bytes: Number(r.bytes) }));
}
