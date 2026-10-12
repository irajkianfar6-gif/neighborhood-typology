/** ذخیرهٔ فایل‌محور اشیای فاز ۵ (کارزار میدانی، پایش مداخله، پیشنهاد واسنجی) */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverDataDir } from '../../paths';

export type Kind = 'campaigns' | 'monitoring' | 'proposals';
const dir = (k: Kind) => { const d = path.join(serverDataDir(), 'agentic', 'field', k); fs.mkdirSync(d, { recursive: true }); return d; };
const safe = (id: string) => id.replace(/[^\w.-]/g, '_');
export const newId = (p: string) => `${p}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
export function save<T extends { id: string }>(k: Kind, x: T): T { fs.writeFileSync(path.join(dir(k), `${safe(x.id)}.json`), JSON.stringify(x, null, 1)); return x; }
export function load<T>(k: Kind, id: string): T | null { const f = path.join(dir(k), `${safe(id)}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) as T : null; }
export function list<T extends { createdAt: string }>(k: Kind, filter: (x: T) => boolean = () => true): T[] {
  return fs.readdirSync(dir(k)).filter((f) => f.endsWith('.json')).flatMap((f) => { try { return [JSON.parse(fs.readFileSync(path.join(dir(k), f), 'utf8')) as T]; } catch { return []; } })
    .filter(filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
