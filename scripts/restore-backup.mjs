#!/usr/bin/env node
/**
 * بازگردانی پشتیبان (BACKUP-v1) — پیش‌فرض اجرای آزمایشی؛ فقط با --apply تغییر می‌دهد.
 *   node scripts/restore-backup.mjs <archive.tar.gz> --target <data-dir> [--apply]
 * پیش از اجرا سرور را متوقف کنید. پوشهٔ فعلی به «<target>.pre-restore-<زمان>» منتقل می‌شود (حذف نمی‌شود).
 * اگر PostgreSQL فعال است، پس از بازگردانی سرور را با همان پایگاه داده راه بیندازید؛ فایل‌های تازه‌تر محلی به پایگاه داده فرستاده می‌شوند.
 */
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const archive = args.find((a) => !a.startsWith('--'));
const ti = args.indexOf('--target'); const target = ti >= 0 ? path.resolve(args[ti + 1] ?? '') : '';
const apply = args.includes('--apply');
const die = (m) => { console.error(`خطا: ${m}`); process.exit(1); };
if (!archive || !target) die('کاربرد: node scripts/restore-backup.mjs <archive.tar.gz> --target <data-dir> [--apply]');
if (!fs.existsSync(archive)) die('بایگانی یافت نشد');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let manifest; try { manifest = JSON.parse(fs.readFileSync(`${archive}.json`, 'utf8')); } catch { die('مانیفست (<archive>.json) یافت نشد'); }
if (sha(archive) !== manifest.archiveSha256) die('هش بایگانی با مانیفست نمی‌خواند (بایگانی خراب یا دست‌کاری‌شده)');
const tmp = `${target}.restore-tmp-${Date.now()}`;
fs.mkdirSync(tmp, { recursive: true });
const r = spawnSync('tar', ['-xzf', archive, '-C', tmp], { encoding: 'utf8' });
if (r.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); die(`استخراج ناموفق: ${r.stderr}`); }
let bad = 0;
for (const e of manifest.entries) { const f = path.join(tmp, e.path); if (!fs.existsSync(f) || sha(f) !== e.sha256) { bad++; if (bad <= 5) console.error(`ناسازگار: ${e.path}`); } }
if (bad) { fs.rmSync(tmp, { recursive: true, force: true }); die(`${bad} فایل با مانیفست نمی‌خواند؛ بازگردانی انجام نشد`); }
const existing = fs.existsSync(target) ? spawnSync('find', [target, '-type', 'f'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).length : 0;
console.log(`پشتیبان ${manifest.name} (${manifest.createdAt}) سالم است: ${manifest.files} فایل، ${(manifest.bytes / 1e6).toFixed(1)} مگابایت.`);
console.log(`پوشهٔ مقصد ${target}: ${existing} فایل فعلی.`);
if (!apply) { fs.rmSync(tmp, { recursive: true, force: true }); console.log('اجرای آزمایشی بود؛ برای اعمال --apply را اضافه کنید.'); process.exit(0); }
if (fs.existsSync(target)) { const moved = `${target}.pre-restore-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`; fs.renameSync(target, moved); console.log(`پوشهٔ فعلی به ${moved} منتقل شد.`); }
fs.renameSync(tmp, target);
console.log('بازگردانی انجام شد. سرور را دوباره راه بیندازید.');
