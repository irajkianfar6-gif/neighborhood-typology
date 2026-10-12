/**
 * پشتیبان‌گیری دوره‌ای از دادهٔ سمت‌سرور (BACKUP-v1)
 *  - بایگانی tar.gz از پوشهٔ داده (بدون حافظه‌های نهان و SQLite زنده؛ همان قواعد همگام‌سازی) + مانیفست (فهرست، هش هر فایل، هش بایگانی).
 *  - محل: ARA_BACKUP_DIR (پیش‌فرض: پوشهٔ هم‌سطح «‎<data>-backups»؛ هرگز داخل پوشهٔ داده)؛ نگه‌داری ARA_BACKUP_KEEP نسخه (۱۴).
 *  - زمان‌بندی: ARA_BACKUP_HOURS (۰ = خاموش). راستی‌آزمایی: هش بایگانی + فهرست tar با مانیفست.
 *  - بازگردانی فقط با اسکریپت خط فرمان (scripts/restore-backup.mjs؛ پیش‌فرض اجرای آزمایشی) — از API انجام نمی‌شود.
 */
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isExcludedPath } from '../db/pgSync';
import { serverDataDir } from '../paths';
import { alert } from './ops';

export const BACKUP_VERSION = 'BACKUP-v1';
export function backupDir(): string { const d = path.resolve(process.env.ARA_BACKUP_DIR || `${serverDataDir()}-backups`); fs.mkdirSync(d, { recursive: true }); return d; }
const keep = () => Math.max(1, Number(process.env.ARA_BACKUP_KEEP || 14));
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const NAME_RE = /^ara-backup-\d{8}-\d{6}(-\d+)?\.tar\.gz$/;

function walk(dir: string, root: string, out: string[] = []): string[] {
  let ents: fs.Dirent[] = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, root, out); else if (e.isFile()) { const r = path.relative(root, p).split(path.sep).join('/'); if (!isExcludedPath(r)) out.push(r); } }
  return out;
}

export interface BackupManifest { version: string; name: string; createdAt: string; source: string; files: number; bytes: number; archiveBytes: number; archiveSha256: string; entries: Array<{ path: string; size: number; sha256: string }> }

export function createBackup(): BackupManifest {
  const root = serverDataDir(); const out = backupDir();
  if (path.resolve(out).startsWith(path.resolve(root) + path.sep)) throw new Error('پوشهٔ پشتیبان نباید داخل پوشهٔ داده باشد');
  const files = walk(root, root).sort();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let name = `ara-backup-${stamp}.tar.gz`; for (let i = 1; fs.existsSync(path.join(out, name)); i++) name = `ara-backup-${stamp}-${i}.tar.gz`;
  const entries = files.map((r) => { const f = path.join(root, r); return { path: r, size: fs.statSync(f).size, sha256: sha(f) }; });
  const list = path.join(out, `.${name}.list`); fs.writeFileSync(list, files.join('\0'));
  const tmp = path.join(out, `.${name}.part`);
  const r = spawnSync('tar', ['-czf', tmp, '-C', root, '--null', '-T', list], { encoding: 'utf8' });
  fs.rmSync(list, { force: true });
  if (r.status !== 0) { fs.rmSync(tmp, { force: true }); void alert('backup_failed', 'پشتیبان‌گیری ناموفق', String(r.stderr || r.error?.message).slice(0, 300)); throw new Error(`tar ناموفق: ${String(r.stderr || r.error?.message).slice(0, 200)}`); }
  fs.renameSync(tmp, path.join(out, name));
  const m: BackupManifest = { version: BACKUP_VERSION, name, createdAt: new Date().toISOString(), source: root, files: files.length, bytes: entries.reduce((a, e) => a + e.size, 0), archiveBytes: fs.statSync(path.join(out, name)).size, archiveSha256: sha(path.join(out, name)), entries };
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(m, null, 1));
  pruneBackups();
  return m;
}

export function listBackups(): Array<Omit<BackupManifest, 'entries'>> {
  const out = backupDir();
  return fs.readdirSync(out).filter((f) => NAME_RE.test(f)).sort().reverse().map((f) => {
    try { const { entries: _e, ...rest } = JSON.parse(fs.readFileSync(path.join(out, `${f}.json`), 'utf8')) as BackupManifest; return rest; }
    catch { return { version: '?', name: f, createdAt: fs.statSync(path.join(out, f)).mtime.toISOString(), source: '', files: 0, bytes: 0, archiveBytes: fs.statSync(path.join(out, f)).size, archiveSha256: '' }; }
  });
}

export function pruneBackups(): string[] {
  const out = backupDir(); const all = fs.readdirSync(out).filter((f) => NAME_RE.test(f)).sort();
  const drop = all.slice(0, Math.max(0, all.length - keep()));
  for (const f of drop) { fs.rmSync(path.join(out, f), { force: true }); fs.rmSync(path.join(out, `${f}.json`), { force: true }); }
  return drop;
}

/** راستی‌آزمایی: هش بایگانی و تطابق فهرست tar با مانیفست */
export function verifyBackup(name: string): { ok: boolean; reasons: string[]; files: number } {
  if (!NAME_RE.test(name)) throw Object.assign(new Error('نام پشتیبان نامعتبر است'), { status: 400 });
  const out = backupDir(); const f = path.join(out, name); const reasons: string[] = [];
  if (!fs.existsSync(f)) throw Object.assign(new Error('پشتیبان یافت نشد'), { status: 404 });
  let m: BackupManifest | null = null; try { m = JSON.parse(fs.readFileSync(`${f}.json`, 'utf8')); } catch { reasons.push('مانیفست یافت نشد'); }
  if (m && sha(f) !== m.archiveSha256) reasons.push('هش بایگانی با مانیفست نمی‌خواند');
  const r = spawnSync('tar', ['-tzf', f], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) reasons.push('بایگانی خوانا نیست');
  const listed = new Set(String(r.stdout ?? '').split('\n').filter((x) => x && !x.endsWith('/')).map((x) => x.replace(/^\.\//, '')));
  if (m) for (const e of m.entries) if (!listed.has(e.path)) { reasons.push(`فایل ${e.path} در بایگانی نیست`); break; }
  return { ok: reasons.length === 0, reasons, files: listed.size };
}

let timer: NodeJS.Timeout | null = null;
export function startBackupSchedule(): boolean {
  const h = Number(process.env.ARA_BACKUP_HOURS || 0);
  if (!(h > 0) || timer) return Boolean(timer);
  timer = setInterval(() => { try { createBackup(); } catch (e) { console.warn('[backup]', (e as Error).message); } }, h * 3_600_000);
  timer.unref?.();
  return true;
}
export function backupScheduleStatus() { return { version: BACKUP_VERSION, everyHours: Number(process.env.ARA_BACKUP_HOURS || 0), keep: keep(), dir: process.env.ARA_BACKUP_DIR ? 'configured' : 'default' }; }
