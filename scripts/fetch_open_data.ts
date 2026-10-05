/**
 * آماده‌سازی یک‌بارهٔ دادهٔ باز جهانی برای شاخص‌های N4 (خطر)، N5 (تاب‌آوری اقلیمی) و R5 (اتصال دیجیتال).
 *   npm run neighborhood:open-data -- tehran [--only faults,flood,worldcover,slope,ookla]
 * فقط پنجرهٔ محدودهٔ شهر از فایل‌های راه‌دور خوانده می‌شود (نه کل فایل‌ها). پیش‌نیاز: pip install -r kernel/requirements.txt
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { findPython } from '../server/kernelClient';
import { cityBBox, listCities } from '../server/neighborhood/gazetteer';
import { PROJECT_ROOT, serverDataDir } from '../server/paths';

const slug = process.argv[2];
if (!slug || slug.startsWith('--')) {
  console.log('usage: npm run neighborhood:open-data -- <city>   cities:', listCities().map((c) => c.citySlug).join(', '));
  process.exit(1);
}
const bbox = cityBBox(slug);
if (!bbox) { console.error('unknown city', slug); process.exit(1); }
const onlyIdx = process.argv.indexOf('--only');
const args = ['-X', 'utf8', path.join(PROJECT_ROOT, 'kernel', 'gis', 'open_data.py'), '--city', slug, '--bbox', bbox.map((x) => x.toFixed(5)).join(','), '--out', serverDataDir()];
if (onlyIdx > 0 && process.argv[onlyIdx + 1]) args.push('--only', process.argv[onlyIdx + 1]);
const r = spawnSync(findPython(), args, { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
process.exit(r.status ?? 1);
