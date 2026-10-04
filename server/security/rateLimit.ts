/**
 * محدودیت نرخ درون‌حافظه‌ای (پنجرهٔ لغزان ساده) بدون وابستگی خارجی.
 * برای چند نمونه پشت load balancer باید با Redis جایگزین شود.
 */
import type { NextFunction, Request, Response } from 'express';

export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string; name: string }) {
  const hits = new Map<string, number[]>();
  const keyOf = options.key ?? ((req: Request) => `${req.ip}|${req.header('authorization') ?? ''}`);
  const timer = setInterval(() => {
    const cutoff = Date.now() - options.windowMs;
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, options.windowMs);
  timer.unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const k = keyOf(req);
    const arr = (hits.get(k) ?? []).filter((t) => t > now - options.windowMs);
    if (arr.length >= options.max) {
      res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: `محدودیت ${options.max} درخواست در ${Math.round(options.windowMs / 1000)} ثانیه برای ${options.name}.` } });
      return;
    }
    arr.push(now);
    hits.set(k, arr);
    res.setHeader('RateLimit-Remaining', String(options.max - arr.length));
    next();
  };
}
