/**
 * کلاینت هوش مصنوعی (API سازگار با Anthropic Messages).
 * پیکربندی فقط از متغیرهای محیطی: ARA_ANTHROPIC_BASE_URL، ARA_ANTHROPIC_API_KEY، ARA_LLM_MODEL.
 * کلید هرگز در مخزن ثبت نمی‌شود (در فایل ‎.env‎ که در git نادیده گرفته می‌شود بگذارید).
 * خروجی مدل فقط پیشنهاد/تفسیر است و قبل از استفاده با طرح‌واره اعتبارسنجی می‌شود.
 */
import { complete, providers } from './gateway';
export interface LlmConfig { baseUrl: string; apiKey: string; model: string; version: string; timeoutMs: number; configured: boolean }

export function llmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const apiKey = env.ARA_ANTHROPIC_API_KEY || '';
  const anyFallback = Boolean(env.ARA_AI_FALLBACK_API_KEY && env.ARA_AI_FALLBACK_BASE_URL && env.ARA_AI_FALLBACK_MODEL);
  return {
    baseUrl: (env.ARA_ANTHROPIC_BASE_URL || 'https://api.justwoker.icu').replace(/\/+$/, ''),
    apiKey, model: env.ARA_LLM_MODEL || 'claude-opus-4-8', version: env.ARA_ANTHROPIC_VERSION || '2023-06-01',
    timeoutMs: Number(env.ARA_ANTHROPIC_TIMEOUT_MS || 180_000), configured: Boolean(apiKey) || anyFallback,
  };
}

export class LlmError extends Error {
  constructor(public code: 'AI_NOT_CONFIGURED' | 'AI_UPSTREAM' | 'AI_BAD_OUTPUT', message: string, public detail?: unknown) { super(message); }
}

type Fetch = typeof fetch;

/**
 * فراخوانی مدل از راه درگاه (AIGW-v1): تلاش دوباره برای خطاهای گذرا، قطع‌کنندهٔ مدار و جایگزینی خودکار با سرویس پشتیبان.
 * با deps.config فقط همان سرویس استفاده می‌شود (آزمون‌ها/فراخوانی صریح).
 */
export async function llmText(opts: { system: string; prompt: string; maxTokens?: number; temperature?: number }, deps: { fetch?: Fetch; config?: LlmConfig; retries?: number } = {}): Promise<{ text: string; model: string; usage?: unknown }> {
  if (deps.config && !deps.config.configured) throw new LlmError('AI_NOT_CONFIGURED', 'سرویس هوش مصنوعی پیکربندی نشده است.');
  const list = deps.config ? [{ id: 'primary' as const, labelFa: 'سرویس اصلی', format: 'anthropic' as const, baseUrl: deps.config.baseUrl, apiKey: deps.config.apiKey, model: deps.config.model, version: deps.config.version, timeoutMs: deps.config.timeoutMs }] : providers();
  if (!list.length) throw new LlmError('AI_NOT_CONFIGURED', 'سرویس هوش مصنوعی پیکربندی نشده است.');
  const body = { system: opts.system, messages: [{ role: 'user', content: opts.prompt }], max_tokens: Math.min(opts.maxTokens ?? 4000, Number(process.env.ARA_ANTHROPIC_MAX_TOKENS || 8000)), temperature: opts.temperature ?? 0.2 };
  try {
    const r = await complete(body, { fetch: deps.fetch, retries: deps.retries, list });
    return { text: r.text, model: r.provider.model, usage: r.usage };
  } catch (e) {
    const x = e as { code?: string; message?: string; detail?: unknown };
    if (x.code === 'AI_NOT_CONFIGURED') throw new LlmError('AI_NOT_CONFIGURED', 'سرویس هوش مصنوعی پیکربندی نشده است.');
    throw new LlmError('AI_UPSTREAM', 'سرویس هوش مصنوعی موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.', x.detail ?? x.message);
  }
}

/** نخستین شیء JSON معتبر در متن مدل (با یا بدون ```json) */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    if (start < 0) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(c.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  throw new LlmError('AI_BAD_OUTPUT', 'خروجی مدل JSON معتبر نبود');
}

/** پاسخ JSON با یک بار درخواست اصلاح در صورت خرابی ساختار */
export async function llmJson<T>(opts: { system: string; prompt: string; maxTokens?: number; validate: (x: unknown) => T }, deps: { fetch?: Fetch; config?: LlmConfig; retries?: number } = {}): Promise<{ data: T; model: string }> {
  const sys = `${opts.system}\n\nخروجی را فقط و فقط به صورت یک شیء JSON معتبر بده، بدون متن اضافه و بدون توضیح. از ابزار یا فایل استفاده نکن.`;
  let prompt = opts.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await llmText({ system: sys, prompt, maxTokens: opts.maxTokens }, deps);
    try {
      return { data: opts.validate(extractJson(r.text)), model: r.model };
    } catch (e) {
      if (attempt === 1) throw e instanceof LlmError ? e : new LlmError('AI_BAD_OUTPUT', `خروجی مدل با ساختار مورد انتظار نمی‌خواند: ${e instanceof Error ? e.message : e}`);
      prompt = `${opts.prompt}\n\nپاسخ قبلی تو قابل استفاده نبود (${e instanceof Error ? e.message : 'ساختار نامعتبر'}). دوباره فقط JSON معتبر با همان ساختار خواسته‌شده بده.`;
    }
  }
  throw new LlmError('AI_BAD_OUTPUT', 'خروجی مدل نامعتبر بود');
}
