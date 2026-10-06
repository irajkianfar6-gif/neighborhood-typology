/** تبدیل تاریخ میلادی به شمسی (الگوریتم استاندارد jalaali؛ بدون وابستگی) */
function div(a: number, b: number) { return Math.floor(a / b); }

export function toJalali(date: Date): { jy: number; jm: number; jd: number } {
  const gy = date.getUTCFullYear(), gm = date.getUTCMonth() + 1, gd = date.getUTCDate();
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

/** «YYYY-MM» شمسی برای یک تاریخ ISO */
export function jalaliMonth(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const { jy, jm } = toJalali(d);
  return `${jy}-${String(jm).padStart(2, '0')}`;
}
