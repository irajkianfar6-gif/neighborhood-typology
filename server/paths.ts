/**
 * مسیرهای مشترک دادهٔ سمت‌سرور.
 * ARA_PUBLIC_DATA_DIR اجازه می‌دهد لایه‌های OSM/typology در Docker (volume فقط‌خواندنی)
 * یا تست‌ها (fixture) از مسیر دیگری خوانده شوند.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');
export function publicDataDir(): string {
  return path.resolve(process.env.ARA_PUBLIC_DATA_DIR || path.join(PROJECT_ROOT, 'public', 'data'));
}
export function serverDataDir(): string {
  return path.resolve(process.env.ARA_SERVER_DATA_DIR || path.join(SERVER_DIR, 'data'));
}
