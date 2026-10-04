/**
 * لاگ ممیزی درخواست‌های نوشتنی: نقش، مسیر، hash بدنه و شناسهٔ همبستگی.
 * بدنه ذخیره نمی‌شود (حریم خصوصی)؛ فقط SHA-256 آن.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from './auth';
import { serverDataDir } from '../paths';

export function auditMiddleware(file = path.join(serverDataDir(), 'audit.log')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!/^(POST|PUT|PATCH|DELETE)$/.test(req.method)) { next(); return; }
    const correlationId = req.header('x-correlation-id') || crypto.randomUUID();
    res.setHeader('X-Correlation-ID', correlationId);
    const started = Date.now();
    res.on('finish', () => {
      const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
      const line = JSON.stringify({
        at: new Date().toISOString(), correlationId, method: req.method, path: req.originalUrl.split('?')[0],
        role: req.araRole ?? 'unknown', authenticated: Boolean(req.araAuthenticated), status: res.statusCode,
        bodySha256: bodyHash, ip: req.ip, ms: Date.now() - started,
      });
      fs.appendFile(file, `${line}\n`, () => undefined);
    });
    next();
  };
}
