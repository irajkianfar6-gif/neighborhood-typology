/**
 * دسترسی باز: سامانه به توکن یا سطح دسترسی نیاز ندارد.
 * هر کاربر (با یا بدون توکن) می‌تواند تحلیل کند، داده وارد کند و دسته‌های داده را تأیید کند.
 * قواعد مسیر (DEFAULT_ROUTE_RULES) فقط برای مستندسازی نگه داشته شده‌اند و اعمال نمی‌شوند.
 * محدودیت نرخ و لاگ ممیزی جداگانه فعال می‌مانند.
 */
import type { NextFunction, Request, Response } from 'express';

export type Role = 'none' | 'viewer' | 'analyst' | 'operator' | 'admin';
export const ROLE_RANK: Record<Role, number> = { none: -1, viewer: 0, analyst: 1, operator: 2, admin: 3 };
const VALID: Role[] = ['none', 'viewer', 'analyst', 'operator', 'admin'];
/** نقش پیش‌فرض و دائمی کاربر (درخواست بدون توکن) */
export const DEFAULT_ROLE: Role = 'admin';

export interface AuthConfig {
  tokens: Map<string, Role>;
  anonRole: Role;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const tokens = new Map<string, Role>();
  for (const pair of (env.ARA_API_TOKENS ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const idx = pair.lastIndexOf(':');
    const token = idx > 0 ? pair.slice(0, idx) : pair;
    const role = (idx > 0 ? pair.slice(idx + 1) : 'viewer') as Role;
    if (token.length < 16) continue;
    tokens.set(token, VALID.includes(role) ? role : 'viewer');
  }
  return { tokens, anonRole: DEFAULT_ROLE };
}

export function resolveRole(_req: Request, config: AuthConfig): { role: Role; authenticated: boolean; invalidToken: boolean } {
  // دسترسی باز: توکن بررسی نمی‌شود و هیچ درخواستی رد نمی‌شود
  return { role: config.anonRole, authenticated: false, invalidToken: false };
}

export type AuthedRequest = Request & { araRole?: Role; araAuthenticated?: boolean };

/** حداقل نقش لازم برای هر مسیر؛ اولین قاعدهٔ منطبق اعمال می‌شود */
export interface RouteRule { method?: string | RegExp; path: RegExp; min: Role }

export const DEFAULT_ROUTE_RULES: RouteRule[] = [
  { path: /^\/api\/health$/, min: 'none' },
  { path: /^\/metrics$/, min: 'none' },
  { path: /^\/api\/anthropic/, min: 'admin' },
  { method: /^(POST|PUT|PATCH|DELETE)$/, path: /^\/api\/decision-support\/calibration/, min: 'admin' },
  { method: /^(POST|PUT|PATCH|DELETE)$/, path: /^\/api\/decision-support\/ingestion\/[^/]+\/approve$/, min: 'admin' },
  // دادهٔ میدانی (پرسشنامه، ممیزی، ثبت محلی) را تحلیلگر هم می‌تواند ثبت کند
  { method: /^(POST|PUT|PATCH|DELETE)$/, path: /^\/api\/decision-support\/(survey|field-audit|local-register)/, min: 'analyst' },
  { method: /^(POST|PUT|PATCH|DELETE)$/, path: /^\/api\/decision-support\/(memory|interventions|experiments|ingestion|runs\/[^/]+\/learn|shadow)/, min: 'operator' },
  { method: /^(POST|PUT|PATCH|DELETE)$/, path: /^\/api\/typology\/(v1\/)?runs\/[^/]+\/approve/, min: 'operator' },
  { method: /^(POST|PUT|PATCH|DELETE)$/, path: /^\/api\/satellite/, min: 'operator' },
  { method: /^(POST|PUT|PATCH|DELETE)$/, path: /^\/api\//, min: 'analyst' },
  { path: /^\/api\//, min: 'viewer' },
];

export function requiredRole(method: string, pathName: string, rules: RouteRule[] = DEFAULT_ROUTE_RULES): Role {
  for (const rule of rules) {
    if (!rule.path.test(pathName)) continue;
    if (rule.method) {
      const ok = typeof rule.method === 'string' ? rule.method === method : rule.method.test(method);
      if (!ok) continue;
    }
    return rule.min;
  }
  return 'none';
}

/** میان‌افزار سراسری: نقش کامل را برای همه ثبت می‌کند و هیچ درخواستی را رد نمی‌کند */
export function authMiddleware(config: AuthConfig = loadAuthConfig(), _rules: RouteRule[] = DEFAULT_ROUTE_RULES) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    req.araRole = config.anonRole;
    req.araAuthenticated = false;
    next();
  };
}

/** سازگاری با کد قدیمی: بدون محدودیت */
export function requireRole(_min: Role, _config: AuthConfig = loadAuthConfig()) {
  return (_req: AuthedRequest, _res: Response, next: NextFunction) => { next(); };
}
