/** عدد و تاریخ در اسناد فارسی: ارقام فارسی/عربی، جداکنندهٔ هزارگان، اعشار «٫»، درصد و سال شمسی */
const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
export function latinDigits(s: string): string {
  return String(s ?? '').replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
}

export interface ParsedNumber { value: number; percent: boolean; raw: string }
/** «۱۲٬۳۴۵»، «12,345.6»، «۴۵٫۲٪»، «(12)»، «−3» → عدد؛ متن غیرعددی → null */
export function parseNumberFa(input: unknown): ParsedNumber | null {
  if (typeof input === 'number') return Number.isFinite(input) ? { value: input, percent: false, raw: String(input) } : null;
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  let s = latinDigits(raw).replace(/[\u200c\u200e\u200f\u202a-\u202e\s]/g, '');
  let percent = false;
  if (/[%٪]$|^[%٪]/.test(s)) { percent = true; s = s.replace(/[%٪]/g, ''); }
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[-−–]/.test(s)) { neg = true; s = s.slice(1); }
  s = s.replace(/٬/g, ',').replace(/٫/g, '.').replace(/\//g, '.');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? { value: neg ? -v : v, percent, raw } : null;
}

/** سال شمسی (۱۳۰۰..۱۴۹۹) یا میلادی (۱۹۵۰..۲۱۰۰) در متن؛ خروجی period_end میلادی (YYYY-MM) */
export function detectPeriod(text: string): { year: number; calendar: 'jalali' | 'gregorian'; periodEnd: string } | null {
  const t = latinDigits(text);
  const j = /(?:^|\D)(1[34]\d\d)(?:\D|$)/.exec(t);
  if (j) { const jy = Number(j[1]); return { year: jy, calendar: 'jalali', periodEnd: `${jy + 622}-03` }; }
  const g = /(?:^|\D)((?:19[5-9]|20\d)\d)(?:\D|$)/.exec(t);
  if (g) return { year: Number(g[1]), calendar: 'gregorian', periodEnd: `${g[1]}-12` };
  return null;
}
