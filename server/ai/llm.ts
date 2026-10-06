/**
 * کلاینت مدل زبانی (API سازگار با Anthropic Messages).
 * پیکربندی فقط از متغیرهای محیطی: ARA_ANTHROPIC_BASE_URL، ARA_ANTHROPIC_API_KEY، ARA_LLM_MODEL.
 * کلید هرگز در مخزن ثبت نمی‌شود (در فایل ‎.env‎ که در git نادیده گرفته می‌شود بگذارید).
 * خروجی مدل فقط پیشنهاد/تفسیر است و قبل از استفاده با طرح‌واره اعتبارسنجی می‌شود.
 */
export interface LlmConfig { baseUrl: string; apiKey: string; model: string; version: string; timeoutMs: number; configured: boolean }

export function llmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const apiKey = env.ARA_ANTHROPIC_API_KEY || '';
  return {
    baseUrl: (env.ARA_ANTHROPIC_BASE_URL || 'https://api.justwoker.icu').replace(/\/+$/, ''),
    apiKey, model: env.ARA_LLM_MODEL || 'claude-opus-4-8', version: env.ARA_ANTHROPIC_VERSION || '2023-06-01',
    timeoutMs: Number(env.ARA_ANTHROPIC_TIMEOUT_MS || 180_000), configured: Boolean(apiKey),
  };
}

export class LlmError extends Error {
  constructor(public code: 'AI_NOT_CONFIGURED' | 'AI_UPSTREAM' | 'AI_BAD_OUTPUT', message: string, public detail?: unknown) { super(message); }
}

type Fetch = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** فراخوانی مدل با تلاش دوباره برای خطاهای گذرا (کانال ناموجود، ۴۲۹، ۵xx، صفحهٔ HTML) */
export async function llmText(opts: { system: string; prompt: string; maxTokens?: number; temperature?: number }, deps: { fetch?: Fetch; config?: LlmConfig; retries?: number } = {}): Promise<{ text: string; model: string; usage?: unknown }> {
  const cfg = deps.config ?? llmConfig();
  if (!cfg.configured) throw new LlmError('AI_NOT_CONFIGURED', 'کلید مدل هوش مصنوعی (ARA_ANTHROPIC_API_KEY) تنظیم نشده است.');
  const f = deps.fetch ?? fetch;
  const retries = deps.retries ?? 4;
  let last = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(Math.min(8000, 800 * 2 ** (attempt - 1)));
    try {
      const res = await f(`${cfg.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': cfg.version },
        body: JSON.stringify({ model: cfg.model, max_tokens: Math.min(opts.maxTokens ?? 4000, Number(process.env.ARA_ANTHROPIC_MAX_TOKENS || 8000)), temperature: opts.temperature ?? 0.2, system: opts.system, messages: [{ role: 'user', content: opts.prompt }] }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      const raw = await res.text();
      let body: { content?: Array<{ type: string; text?: string }>; error?: { code?: string; message?: string; type?: string }; model?: string; usage?: unknown } | null = null;
      try { body = JSON.parse(raw); } catch { body = null; }
      if (!body) { last = `پاسخ غیر JSON (وضعیت ${res.status})`; continue; }
      if (!res.ok || body.error) {
        last = body.error?.message ?? `وضعیت ${res.status}`;
        const transient = res.status === 429 || res.status >= 500 || /model_not_found|No available channel|overloaded|rate/i.test(`${body.error?.code} ${last}`);
        if (transient) continue;
        throw new LlmError('AI_UPSTREAM', `سرویس مدل خطا داد: ${last}`);
      }
      const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      if (!text.trim()) { last = 'پاسخ خالی'; continue; }
      return { text, model: body.model ?? cfg.model, usage: body.usage };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new LlmError('AI_UPSTREAM', `سرویس مدل پس از چند تلاش پاسخ نداد: ${last}`);
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
