/**
 * حذف نام مدل‌ها و برندهای هوش مصنوعی از هر پاسخ رو به کاربر.
 * رابط کاربری فقط «هوش مصنوعی» را می‌بیند؛ نام دقیق مدل فقط در پیکربندی و ثبت‌های داخلی سرور می‌ماند.
 */
import type { NextFunction, Request, Response } from 'express';
import { llmConfig } from './llm';

export const AI_LABEL = 'هوش مصنوعی';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BRANDS = String.raw`claude[\w.-]*|gpt-?\d[\w.-]*|chat-?gpt|o[134]-(?:mini|preview)[\w.-]*|anthropic|openai|gemini[\w.-]*|llama[\w.-]*|mistral[\w.-]*|mixtral[\w.-]*|deepseek[\w.-]*|qwen[\w.-]*|copilot-gpt|کلود|آنتروپیک|اوپن‌?ای‌?آی|جمنای|جیمینای|چت‌?جی‌?پی‌?تی`;
let cached: { key: string; re: RegExp } | null = null;

function pattern(): RegExp {
  const c = llmConfig();
  let host = '';
  try { host = new URL(c.baseUrl).host; } catch { /* نشانی نامعتبر */ }
  const key = `${c.model}|${host}`;
  if (cached?.key === key) return cached.re;
  const extra = [c.model, host].filter((x) => x && x.length >= 4).map(esc);
  // مرز واژه دستی: پیش و پس از نام برند حرف/رقم لاتین نباشد (anthropicProxy یا pipeline_model دست نمی‌خورد)
  const re = new RegExp(`(?<![A-Za-z0-9_])(?:${[...extra, BRANDS].join('|')})(?![A-Za-z0-9_])|ARA_ANTHROPIC_[A-Z_]+|ARA_LLM_MODEL`, 'gi');
  cached = { key, re };
  return re;
}

/** متن را پاک می‌کند (امن برای درون رشتهٔ JSON: جایگزین بدون نقل‌قول و بک‌اسلش است) */
export function scrubText(s: string): string {
  return s.replace(pattern(), (m) => (/^ARA_/.test(m) ? 'کلید سرویس هوش مصنوعی' : AI_LABEL));
}

/** هر مقدار JSON را بازگشتی پاک می‌کند */
export function scrubValue<T>(v: T): T {
  if (typeof v === 'string') return scrubText(v) as T;
  if (Array.isArray(v)) return v.map(scrubValue) as T;
  if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = scrubValue(x);
    return o as T;
  }
  return v;
}

/** میان‌افزار: res.json همهٔ مسیرهای /api را پیش از ارسال پاک می‌کند */
export function brandScrubMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    const orig = res.json.bind(res);
    res.json = ((body: unknown) => {
      try {
        const s = JSON.stringify(body);
        if (s !== undefined && pattern().test(s)) { pattern().lastIndex = 0; return orig(scrubValue(body)); }
        pattern().lastIndex = 0;
      } catch { /* ساختار چرخه‌ای: بدون تغییر */ }
      return orig(body);
    }) as Response['json'];
    next();
  };
}
