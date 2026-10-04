/** نرمال‌سازی متن فارسی برای تطبیق نام محله */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeFa(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/[إأآ]/g, 'ا')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u200c\u200d\u200e\u200f]/g, ' ')
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[()\[\]{}،,؛;:_/\\.\-–—«»"']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const PREFIXES = /^(محله|محلهٔ|کوی|شهرک|برزن|ناحیه|منطقه)\s+/;
/** کلید تطبیق: بدون پیشوند، بدون فاصله */
export function matchKey(value: string): string {
  return normalizeFa(value).replace(PREFIXES, '').replace(/\s+/g, '');
}

/** شباهت Jaro-Winkler در بازهٔ ۰..۱ */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array<boolean>(a.length).fill(false);
  const bM = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = bM[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const CITY_SLUGS: Record<string, string> = {
  'تهران': 'tehran', 'کرج': 'karaj', 'مشهد': 'mashhad', 'اصفهان': 'isfahan', 'شیراز': 'shiraz',
  'تبریز': 'tabriz', 'قم': 'qom', 'اهواز': 'ahvaz', 'کرمانشاه': 'kermanshah', 'رشت': 'rasht',
};
export function citySlug(cityFa: string): string {
  const n = normalizeFa(cityFa);
  if (CITY_SLUGS[n]) return CITY_SLUGS[n];
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `city${h.toString(36)}`;
}
