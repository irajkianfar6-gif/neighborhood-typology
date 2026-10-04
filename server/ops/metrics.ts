/**
 * متریک‌های Prometheus بدون وابستگی خارجی: زمان پاسخ، خطا، سطح انتشار کارت‌ها و سلامت منابع.
 * GET /metrics  (بدون احراز هویت؛ در تولید فقط از شبکهٔ داخلی در دسترس قرار دهید)
 */
import type { NextFunction, Request, Response } from 'express';

const counters = new Map<string, number>();
const histSum = new Map<string, number>();
const histCount = new Map<string, number>();
const gauges = new Map<string, number>();

function key(name: string, labels: Record<string, string | number>): string {
  const l = Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`).join(',');
  return l ? `${name}{${l}}` : name;
}
export function incCounter(name: string, labels: Record<string, string | number> = {}, by = 1): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
}
export function observe(name: string, labels: Record<string, string | number>, value: number): void {
  const k = key(name, labels);
  histSum.set(k, (histSum.get(k) ?? 0) + value);
  histCount.set(k, (histCount.get(k) ?? 0) + 1);
}
export function setGauge(name: string, labels: Record<string, string | number>, value: number): void {
  gauges.set(key(name, labels), value);
}

function routeLabel(req: Request): string {
  return req.path
    .replace(/\/[0-9a-f-]{16,}/gi, '/:id')
    .replace(/\/neighborhoods\/[^/]+\/(evidence|missing-data|history|boundary)/, '/neighborhoods/:id/$1')
    .slice(0, 80);
}

export function metricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) { next(); return; }
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const labels = { method: req.method, route: routeLabel(req), status: res.statusCode };
      incCounter('ara_http_requests_total', labels);
      observe('ara_http_request_duration_seconds', { method: req.method, route: routeLabel(req) }, seconds);
    });
    next();
  };
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [k, v] of counters) lines.push(`${k} ${v}`);
  for (const [k, v] of histSum) {
    const [name, rest] = k.includes('{') ? [k.slice(0, k.indexOf('{')), k.slice(k.indexOf('{'))] : [k, ''];
    lines.push(`${name}_sum${rest} ${v}`);
    lines.push(`${name}_count${rest} ${histCount.get(k) ?? 0}`);
  }
  for (const [k, v] of gauges) lines.push(`${k} ${v}`);
  lines.push(`ara_process_uptime_seconds ${Math.round(process.uptime())}`);
  lines.push(`ara_process_resident_memory_bytes ${process.memoryUsage().rss}`);
  return `${lines.join('\n')}\n`;
}

export function metricsHandler(_req: Request, res: Response): void {
  res.type('text/plain; version=0.0.4').send(renderMetrics());
}
