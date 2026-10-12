/** اتکای عددی: هر عدد متن باید در خروجی ابزار/کارت پشتوانه داشته باشد (مشترک دستیار و نقاد) */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹', AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, ',');
}
/** عددهای مستقل متن (نه بخشی از شناسه‌هایی مثل m605، H1 یا تاریخ ISO) */
export function numbersIn(text: string): string[] {
  const t = toLatinDigits(text);
  const out: string[] = [];
  const re = /(?<![A-Za-z0-9_:.\-/])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![A-Za-z0-9_:\-/])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) out.push(`${m[1].replace(/,/g, '')}${m[2] ? `.${m[2]}` : ''}`);
  return out;
}
function collectNumbers(v: unknown, into: number[]): void {
  if (typeof v === 'number' && Number.isFinite(v)) into.push(v);
  else if (typeof v === 'string') numbersIn(v).forEach((n) => into.push(Number(n)));
  else if (Array.isArray(v)) { into.push(v.length); v.forEach((x) => collectNumbers(x, into)); }
  else if (v && typeof v === 'object') { const vals = Object.values(v); into.push(vals.length); vals.forEach((x) => collectNumbers(x, into)); }
}
/** عددهای پاسخ که در هیچ خروجی ابزار (با گرد کردن مجاز یا تبدیل کسر→درصد) یا پرسش نیستند */
export function ungroundedNumbers(answer: string, sources: unknown[], question = ''): { checked: number; ungrounded: string[] } {
  const pool: number[] = [];
  sources.forEach((s) => collectNumbers(s, pool));
  numbersIn(question).forEach((n) => pool.push(Number(n)));
  const nums = numbersIn(answer).filter((n) => Number(n) > 10 || n.includes('.'));
  const ungrounded = nums.filter((n) => {
    const x = Number(n); const d = n.includes('.') ? n.split('.')[1].length : 0;
    const r = (y: number) => Math.round(y * 10 ** d) / 10 ** d;
    return !pool.some((y) => r(y) === x || r(y * 100) === x || Math.trunc(y) === x);
  });
  return { checked: nums.length, ungrounded: [...new Set(ungrounded)] };
}

