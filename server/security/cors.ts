/**
 * CORS با فهرست مجاز. ARA_ALLOWED_ORIGINS="https://ara.example.ir,http://localhost:3000"
 * در توسعه (بدون تنظیم) localhost مجاز است؛ در production بدون تنظیم، فقط same-origin.
 */
import type { NextFunction, Request, Response } from 'express';

export function corsMiddleware(env: NodeJS.ProcessEnv = process.env) {
  const configured = (env.ARA_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const devDefault = env.NODE_ENV === 'production' ? [] : [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
  const allow = (origin: string) => configured.includes('*') || configured.includes(origin) || devDefault.some((re) => re.test(origin));
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header('origin');
    if (origin && allow(origin)) {
      res.setHeader('Access-Control-Allow-Origin', configured.includes('*') ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ARA-Token, X-Correlation-ID');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'X-Correlation-ID, X-Provider, X-Provider-Fallback, X-Cache, X-Provider-Latency-Ms, Warning, RateLimit-Remaining');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(origin && !allow(origin) ? 403 : 204);
      return;
    }
    next();
  };
}
