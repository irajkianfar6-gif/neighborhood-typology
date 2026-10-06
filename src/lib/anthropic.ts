// حکیم — client حداقلی و تایپ‌شده برای سرویس سازگار با Anthropic Messages.
// درخواست به مسیر یکسان-مبدأ `/api/anthropic` می‌رود؛ پراکسی سرور توسعه (vite.config.ts)
// کلید را تزریق کرده و به پایانه خارجی (پیش‌فرض api.justwoker.icu) هدایت می‌کند.

export interface AnthropicChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  id?: string;
  content?: AnthropicContentBlock[];
  model?: string;
  stop_reason?: string;
  error?: { type?: string; message?: string };
}

const MODEL = import.meta.env.VITE_ANTHROPIC_MODEL || 'claude-opus-4-8';

async function postChat(
  messages: AnthropicChatMessage[],
  opts: { system?: string; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120000);
  let res: Response;
  try {
    res = await fetch('/api/anthropic/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.system ? { system: opts.system } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: ctrl.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as AnthropicResponse;
      detail = body.error?.message || '';
    } catch {
      // بدنه قابل‌خواندن نبود
    }
    throw new Error(`خطای سرویس (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as AnthropicResponse;

  if (data.error) {
    throw new Error(data.error.message || 'خطای نامشخص سرویس');
  }

  const text = (data.content || [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text as string)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('پاسخ خالی از سرویس دریافت شد');
  }

  return text;
}

/**
 * ارسال یک گفتگو به مدل و بازگرداندن متن پاسخ.
 * در صورت خطای شبکه/API یک استثنا با پیام قابل‌فهم پرتاب می‌کند.
 */
export async function chatWithAnthropic(
  messages: AnthropicChatMessage[],
  opts: { system?: string; maxTokens?: number } = {},
): Promise<string> {
  return postChat(messages, opts);
}

/**
 * ارسال گفتگو با درخواست خروجی JSON ساخت‌یافته و بازگرداندن آبجکت تحلیل‌شده.
 * اگر مدل JSON را در قاب یا با متن اضافه برگرداند، به‌صورت مقاوم استخراج می‌شود.
 */
export async function chatWithAnthropicJSON<T>(
  messages: AnthropicChatMessage[],
  opts: { system?: string; maxTokens?: number; timeoutMs?: number } = {},
): Promise<T> {
  const system = `${opts.system ?? ''}\n\nمهم: خروجی را فقط و فقط به‌صورت یک JSON معتبر و بدون هیچ متن اضافه، قاب کد یا توضیحی برگردان. کلیدها را با "" نقل‌قول کن.`.trim();
  const text = await postChat(messages, { ...opts, system, maxTokens: opts.maxTokens ?? 2048 });
  const parsed = extractJsonObject(text);
  if (parsed == null) {
    throw new Error('خروجی مدل قابل تجزیه به JSON نبود');
  }
  return parsed as T;
}

/**
 * استخراج مقاوم اولین شیء JSON از متن (حذف قاب کد، متن اضافه، متن پیش/پس از شیء).
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = cleaned.slice(start, end + 1);
  try {
    const v = JSON.parse(slice);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    // تلاش دوم: حذف کاماهای دنباله‌دار قبل از } یا ]
    try {
      const repaired = slice
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u200c\u200f]/g, '');
      const v = JSON.parse(repaired);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}
