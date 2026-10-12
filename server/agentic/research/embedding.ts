/**
 * تعبیهٔ برداری سبک و قطعی (EMB-HASH-v1): n-گرم نویسه‌ای (۲ تا ۴) روی متن یکسان‌سازی‌شدهٔ فارسی، درهم‌سازی علامت‌دار
 * در ۲۵۶ بُعد و نرمال‌سازی L2. بدون مدل و بدون شبکه؛ نسبت به پسوند، نیم‌فاصله و املای متفاوت مقاوم است.
 * «معنایی» به‌معنای شباهت شکلی واژه‌هاست، نه فهم مفهومی؛ برای بازیابی ترکیبی کنار BM25 به کار می‌رود.
 */
import { normalizeFa } from '../../neighborhood/text';
import { lamAlefFold } from './documents';

export const EMBED_VERSION = 'EMB-HASH-v1';
export const EMBED_DIM = 256;

function fnv(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

export function embed(text: string): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  const words = lamAlefFold(normalizeFa(String(text ?? ''))).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  for (const w of words) {
    const t = `^${w}$`;
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= t.length; i++) {
      const h = fnv(t.slice(i, i + n)); v[h % EMBED_DIM] += (h & 0x80000000) ? -1 : 1;
    }
  }
  let norm = 0; for (const x of v) norm += x * x; norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm;
  return v;
}
export function cosine(a: Float32Array, b: Float32Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export const toPgVector = (v: Float32Array) => `[${Array.from(v, (x) => x.toFixed(5)).join(',')}]`;
