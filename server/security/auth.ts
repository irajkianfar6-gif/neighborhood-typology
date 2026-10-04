/**
 * احراز هویت و نقش‌ها برای API سامانه.
 *
 * ARA_API_TOKENS="tokenA:admin,tokenB:analyst,tokenC:viewer"
 * ARA_ANON_ROLE   نقش درخواست بدون توکن. پیش‌فرض: در production «viewer» (فقط خواندن)،
 *                 در توسعه «admin» تا UI محلی بدون پیکربندی کار کند.
 * نقش‌ها سلسله‌مراتبی‌اند: viewer < analyst < operator < admin
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type Role = 'none' | 'viewer' | 'analyst' | 'operator' | 'admin';
export const ROLE_RANK: Record<Role, number> = { none: -1, viewer: 0, analyst: 1, operator: 2, admin: 3 };
const VALID: Role[] = ['none', 'viewer', 'analyst', 'operator', 'admin'];

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
    if (token.length < 16) {
      console.warn('[auth] توکن کوتاه‌تر از ۱۶ نویسه نادیده گرفته شد');
      continue;
    }
    tokens.set(token, VALID.includes(role) ? role : 'viewer');
  }
  const requested = env.ARA_ANON_ROLE as Role | undefined;
  const anonRole: Role = requested && VALID.includes(requested)
    ? requested
    : env.NODE_ENV === 'production' ? 'viewer' : 'admin';
  return { tokens, anonRole };
}

function safeLookup(tokens: Map<string, Role>, presented: string): Role | undefined {
  // مقایسهٔ زمان‌ثابت برای جلوگیری از حملهٔ زمان‌سنجی
  const a = Buffer.from(presented);
  for (const [token, role] of tokens) {
    const b = Buffer.from(token);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return role;
  }
  return undefined;
}

export function resolveRole(req: Request, config: AuthConfig): { role: Role; authenticated: boolean; invalidToken: boolean } {
  const header = req.header('authorization') ?? '';
  const presented = header.replace(/^Bearer\s+/i, '').trim() || (req.header('x-ara-token') ?? '').trim();
  if (!presented) return { role: config.anonRole, authenticated: false, invalidToken: false };
  const role = safeLookup(config.tokens, presented);
  if (!role) return { role: 'none', authenticated: false, invalidToken: true };
  return { role, authenticated: true, invalidToken: false };
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
  { method: /^(POST|PUT|PATCH|DELETE)$/, path: /^\/api\/decision-support\/(memory|interventions|experiments|ingestion|survey|field-audit|runs\/[^/]+\/learn|shadow)/, min: 'operator' },
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

/** میان‌افزار سراسری: نقش را تعیین و بر اساس قواعد مسیر، دسترسی را کنترل می‌کند */
export function authMiddleware(config: AuthConfig = loadAuthConfig(), rules: RouteRule[] = DEFAULT_ROUTE_RULES) {
  if (config.tokens.size === 0 && config.anonRole === 'admin') {
    console.warn('[auth] هیچ توکنی تعریف نشده و نقش ناشناس admin است (حالت توسعه). در تولید ARA_API_TOKENS را تنظیم کنید.');
  }
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') { next(); return; }
    const min = requiredRole(req.method, req.path, rules);
    const { role, authenticated, invalidToken } = resolveRole(req, config);
    req.araRole = role;
    req.araAuthenticated = authenticated;
    if (invalidToken) {
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'توکن نامعتبر است.' } });
      return;
    }
    if (ROLE_RANK[role] < ROLE_RANK[min]) {
      res.status(authenticated ? 403 : 401).json({
        success: false,
        error: { code: authenticated ? 'FORBIDDEN' : 'UNAUTHORIZED', message: `این عملیات حداقل نقش «${min}» می‌خواهد.`, requiredRole: min },
      });
      return;
    }
    next();
  };
}

/** میان‌افزار محلی برای روترهایی که مستقل از سرور اصلی تست می‌شوند */
export function requireRole(min: Role, config: AuthConfig = loadAuthConfig()) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const role = req.araRole ?? resolveRole(req, config).role;
    if (ROLE_RANK[role] < ROLE_RANK[min]) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', requiredRole: min } });
      return;
    }
    next();
  };
}
