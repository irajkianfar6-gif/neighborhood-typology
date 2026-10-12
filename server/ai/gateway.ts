/**
 * درگاه هوش مصنوعی با جایگزینی خودکار (AIGW-v1)
 *  - سرویس اصلی (سازگار با Anthropic Messages؛ ARA_ANTHROPIC_*) + سرویس پشتیبان اختیاری:
 *    ARA_AI_FALLBACK_FORMAT=anthropic|openai، ARA_AI_FALLBACK_BASE_URL، ARA_AI_FALLBACK_API_KEY، ARA_AI_FALLBACK_MODEL
 *  - قطع‌کنندهٔ مدار برای هر سرویس: پس از ARA_AI_CIRCUIT_FAILS (۳) شکست پیاپی، تا ARA_AI_CIRCUIT_SEC (۶۰) ثانیه کنار گذاشته
 *    می‌شود؛ سپس یک درخواست آزمایشی (نیمه‌باز).
 *  - آمار سلامت بدون نام مدل/برند (فقط «اصلی»/«پشتیبان») برای رابط و پایش.
 */
import { incCounter } from '../ops/metrics';
import { alert, recordAiUsage } from '../ops/ops';

export type ProviderFormat = 'anthropic' | 'openai';
export interface Provider { id: 'primary' | 'fallback'; labelFa: string; format: ProviderFormat; baseUrl: string; apiKey: string; model: string; version: string; timeoutMs: number }
export interface Message { system: string; prompt: string; maxTokens: number; temperature: number }
export interface MessagesBody { model?: string; system?: unknown; messages?: unknown; max_tokens?: number; temperature?: number; stop_sequences?: unknown }

type Fetch = typeof fetch;
interface Health { state: 'closed' | 'open' | 'half_open'; consecutiveFailures: number; openedAt: number | null; calls: number; ok: number; failures: number; lastError: string | null; lastOkAt: string | null; lastLatencyMs: number | null }
const H = new Map<string, Health>();
const fresh = (): Health => ({ state: 'closed', consecutiveFailures: 0, openedAt: null, calls: 0, ok: 0, failures: 0, lastError: null, lastOkAt: null, lastLatencyMs: null });
const hOf = (p: Pick<Provider, 'id' | 'baseUrl'>) => { const k = `${p.id}|${p.baseUrl}`; let h = H.get(k); if (!h) { h = fresh(); H.set(k, h); } return h; };
const failsLimit = () => Math.max(1, Number(process.env.ARA_AI_CIRCUIT_FAILS || 3));
const openMs = () => Math.max(1, Number(process.env.ARA_AI_CIRCUIT_SEC || 60)) * 1000;

export function providers(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const out: Provider[] = [];
  const timeoutMs = Number(env.ARA_ANTHROPIC_TIMEOUT_MS || 180_000);
  if (env.ARA_ANTHROPIC_API_KEY) out.push({ id: 'primary', labelFa: 'سرویس اصلی', format: 'anthropic', baseUrl: (env.ARA_ANTHROPIC_BASE_URL || 'https://api.justwoker.icu').replace(/\/+$/, ''), apiKey: env.ARA_ANTHROPIC_API_KEY, model: env.ARA_LLM_MODEL || 'claude-opus-4-8', version: env.ARA_ANTHROPIC_VERSION || '2023-06-01', timeoutMs });
  if (env.ARA_AI_FALLBACK_API_KEY && env.ARA_AI_FALLBACK_BASE_URL && env.ARA_AI_FALLBACK_MODEL) {
    out.push({ id: 'fallback', labelFa: 'سرویس پشتیبان', format: env.ARA_AI_FALLBACK_FORMAT === 'anthropic' ? 'anthropic' : 'openai', baseUrl: env.ARA_AI_FALLBACK_BASE_URL.replace(/\/+$/, ''), apiKey: env.ARA_AI_FALLBACK_API_KEY, model: env.ARA_AI_FALLBACK_MODEL, version: env.ARA_ANTHROPIC_VERSION || '2023-06-01', timeoutMs: Number(env.ARA_AI_FALLBACK_TIMEOUT_MS || timeoutMs) });
  }
  return out;
}

/** سرویس قابل استفاده است؟ (مدار بسته، یا باز ولی زمان آزمایش رسیده) */
export function available(p: Provider, now = Date.now()): boolean {
  const h = hOf(p);
  if (h.state !== 'open') return true;
  if (h.openedAt !== null && now - h.openedAt >= openMs()) { h.state = 'half_open'; return true; }
  return false;
}
export function recordOk(p: Provider, ms: number) { const h = hOf(p); h.calls++; h.ok++; h.consecutiveFailures = 0; h.state = 'closed'; h.openedAt = null; h.lastOkAt = new Date().toISOString(); h.lastLatencyMs = ms; }
export function recordFail(p: Provider, err: string, now = Date.now()) {
  const h = hOf(p); h.calls++; h.failures++; h.consecutiveFailures++; h.lastError = err.slice(0, 300);
  if (h.state === 'half_open' || h.consecutiveFailures >= failsLimit()) {
    if (h.state !== 'open') void alert(`ai_circuit_${p.id}`, `${p.labelFa} هوش مصنوعی موقتاً کنار گذاشته شد`, `${h.consecutiveFailures} شکست پیاپی؛ آخرین خطا: ${h.lastError}`);
    h.state = 'open'; h.openedAt = now;
  }
}
export function aiHealth() {
  const list = providers();
  return { version: 'AIGW-v1', configured: list.length > 0, providers: list.map((p) => { const h = hOf(p); available(p); return { id: p.id, labelFa: p.labelFa, ...h, openedAt: h.openedAt ? new Date(h.openedAt).toISOString() : null }; }), anyAvailable: list.some((p) => available(p)) };
}
export function _resetAiHealth() { H.clear(); }

export class AttemptError extends Error { constructor(message: string, public transient: boolean) { super(message); } }

function anthropicRequest(p: Provider, body: MessagesBody) {
  return { url: `${p.baseUrl}/v1/messages`, headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': p.version }, body: { ...body, model: p.model, stream: false } };
}
/** تبدیل درخواست Messages به Chat Completions (فقط متن) */
function openaiRequest(p: Provider, body: MessagesBody) {
  const sys = typeof body.system === 'string' ? body.system : Array.isArray(body.system) ? (body.system as Array<{ text?: string }>).map((x) => x.text ?? '').join('\n') : '';
  const msgs = (Array.isArray(body.messages) ? body.messages : []) as Array<{ role: string; content: unknown }>;
  const text = (c: unknown) => (typeof c === 'string' ? c : Array.isArray(c) ? (c as Array<{ type?: string; text?: string }>).filter((x) => x.type === 'text' || x.text).map((x) => x.text ?? '').join('\n') : '');
  return {
    url: `${p.baseUrl}/v1/chat/completions`, headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${p.apiKey}` },
    body: { model: p.model, max_tokens: body.max_tokens, temperature: body.temperature, stop: body.stop_sequences, messages: [...(sys ? [{ role: 'system', content: sys }] : []), ...msgs.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text(m.content) }))] },
  };
}

/** یک تلاش روی یک سرویس؛ خروجی همیشه در قالب Messages (content[{type:'text'}]) */
async function attempt(p: Provider, body: MessagesBody, f: Fetch): Promise<{ text: string; usage?: unknown; stopReason: string | null }> {
  const r = p.format === 'anthropic' ? anthropicRequest(p, body) : openaiRequest(p, body);
  let res: Response;
  try { res = await f(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal: AbortSignal.timeout(p.timeoutMs) }); }
  catch (e) { throw new AttemptError(e instanceof Error ? e.message : String(e), true); }
  const raw = await res.text();
  let j: Record<string, unknown> | null = null; try { j = JSON.parse(raw); } catch { j = null; }
  if (!j) throw new AttemptError(`پاسخ غیر JSON (وضعیت ${res.status})`, true);
  const err = j.error as { code?: string; message?: string } | undefined;
  if (!res.ok || err) {
    const msg = err?.message ?? `وضعیت ${res.status}`;
    const transient = res.status === 429 || res.status >= 500 || res.status === 408 || /model_not_found|No available channel|overloaded|rate|exhausted|timeout/i.test(`${err?.code ?? ''} ${msg}`);
    throw new AttemptError(msg, transient);
  }
  if (p.format === 'anthropic') {
    const text = ((j.content as Array<{ type: string; text?: string }>) ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (!text.trim()) throw new AttemptError('پاسخ خالی', true);
    return { text, usage: j.usage, stopReason: (j.stop_reason as string) ?? null };
  }
  const ch = (j.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined)?.[0];
  const text = ch?.message?.content ?? '';
  if (!text.trim()) throw new AttemptError('پاسخ خالی', true);
  return { text, usage: j.usage, stopReason: ch?.finish_reason === 'length' ? 'max_tokens' : 'end_turn' };
}

/**
 * اجرای درخواست با سرویس‌های سالم به ترتیب؛ هر سرویس `retries` تلاش با عقب‌نشینی نمایی.
 * خطای غیرگذرا (مثلاً کلید نامعتبر) همان سرویس را رها می‌کند و به بعدی می‌رود.
 */
export async function complete(body: MessagesBody, deps: { fetch?: Fetch; retries?: number; sleep?: (ms: number) => Promise<void>; list?: Provider[] } = {}): Promise<{ text: string; provider: Provider; usage?: unknown; stopReason: string | null }> {
  const list = deps.list ?? providers();
  if (!list.length) throw Object.assign(new Error('سرویس هوش مصنوعی پیکربندی نشده است.'), { code: 'AI_NOT_CONFIGURED' });
  const f = deps.fetch ?? fetch; const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const usable = list.filter((p) => available(p));
  const chain = usable.length ? usable : list.slice(0, 1); // همه باز → یک تلاش روی اصلی
  const perProvider = deps.retries ?? (chain.length > 1 ? 1 : 3);
  const errors: string[] = [];
  for (const p of chain) {
    for (let a = 0; a <= perProvider; a++) {
      if (a) await sleep(Math.min(8000, 800 * 2 ** (a - 1)));
      const t0 = Date.now();
      try { const out = await attempt(p, body, f); recordOk(p, Date.now() - t0); recordAiUsage(p.id, true, out.usage); incCounter('ara_ai_calls_total', { provider: p.id, outcome: 'ok' }); return { ...out, provider: p }; }
      catch (e) {
        const ae = e instanceof AttemptError ? e : new AttemptError(String(e), true);
        recordFail(p, ae.message); recordAiUsage(p.id, false); incCounter('ara_ai_calls_total', { provider: p.id, outcome: 'error' }); errors.push(`${p.labelFa}: ${ae.message}`);
        if (!ae.transient || !available(p)) break;
      }
    }
  }
  throw Object.assign(new Error('سرویس هوش مصنوعی موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.'), { code: 'AI_UPSTREAM', detail: errors.slice(-4) });
}

/** پاسخ در قالب Messages برای پراکسی رابط (بدون نام مدل) */
export function toMessagesResponse(r: { text: string; usage?: unknown; stopReason: string | null }) {
  return { id: `msg_${Date.now().toString(36)}`, type: 'message', role: 'assistant', model: 'ai', content: [{ type: 'text', text: r.text }], stop_reason: r.stopReason ?? 'end_turn', usage: r.usage ?? null };
}
