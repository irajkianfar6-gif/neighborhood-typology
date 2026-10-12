/** درگاه هوش مصنوعی (AIGW-v1): جایگزینی خودکار، قطع‌کنندهٔ مدار، تبدیل قالب، سلامت بدون نام مدل */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-aigw-'));
import { _resetAiHealth, aiHealth, complete, providers, toMessagesResponse, type Provider } from '../ai/gateway';

const P: Provider = { id: 'primary', labelFa: 'سرویس اصلی', format: 'anthropic', baseUrl: 'https://primary.test', apiKey: 'k1', model: 'model-a', version: '2023-06-01', timeoutMs: 2000 };
const F: Provider = { id: 'fallback', labelFa: 'سرویس پشتیبان', format: 'openai', baseUrl: 'https://fallback.test', apiKey: 'k2', model: 'model-b', version: '2023-06-01', timeoutMs: 2000 };
const body = { system: 'سیستم', messages: [{ role: 'user', content: 'سلام' }], max_tokens: 50, temperature: 0 };
type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function fake(primary: () => Response, calls: Call[]) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    if (url.startsWith('https://primary.test')) return primary();
    return new Response(JSON.stringify({ choices: [{ message: { content: 'پاسخ پشتیبان' }, finish_reason: 'stop' }], usage: { total_tokens: 9 } }), { status: 200 });
  }) as typeof fetch;
}
const noSleep = async () => {};

test('failover: primary exhausted → OpenAI-compatible fallback with converted request', async () => {
  _resetAiHealth();
  const calls: Call[] = [];
  const r = await complete(body, { fetch: fake(() => new Response(JSON.stringify({ error: { message: 'all nodes exhausted' } }), { status: 503 }), calls), list: [P, F], sleep: noSleep });
  assert.equal(r.text, 'پاسخ پشتیبان'); assert.equal(r.provider.id, 'fallback');
  const fb = calls.find((c) => c.url === 'https://fallback.test/v1/chat/completions')!;
  assert.ok(fb, 'نشانی Chat Completions'); assert.equal(fb.headers.authorization, 'Bearer k2');
  assert.deepEqual((fb.body.messages as unknown[])[0], { role: 'system', content: 'سیستم' });
  assert.equal(fb.body.model, 'model-b');
  assert.equal(calls.filter((c) => c.url.startsWith('https://primary.test')).length, 2, 'اصلی با یک تلاش دوباره');
  const m = toMessagesResponse(r); assert.equal(m.content[0].text, 'پاسخ پشتیبان'); assert.equal(m.model, 'ai');
});

test('circuit breaker: opens after consecutive failures, skips primary, half-open trial after cooldown', async () => {
  _resetAiHealth(); process.env.ARA_AI_CIRCUIT_SEC = '1';
  const calls: Call[] = [];
  const down = fake(() => new Response('<html>502</html>', { status: 502 }), calls);
  await complete(body, { fetch: down, list: [P, F], sleep: noSleep, retries: 1 });
  await complete(body, { fetch: down, list: [P, F], sleep: noSleep, retries: 1 });
  const before = calls.filter((c) => c.url.startsWith('https://primary.test')).length;
  assert.ok(before >= 3);
  await complete(body, { fetch: down, list: [P, F], sleep: noSleep });
  assert.equal(calls.filter((c) => c.url.startsWith('https://primary.test')).length, before, 'مدار باز: اصلی رد می‌شود');
  await new Promise((r) => setTimeout(r, 1100));
  const okCalls: Call[] = [];
  const up = fake(() => new Response(JSON.stringify({ content: [{ type: 'text', text: 'اصلی برگشت' }] }), { status: 200 }), okCalls);
  const r = await complete(body, { fetch: up, list: [P, F], sleep: noSleep });
  assert.equal(r.provider.id, 'primary'); assert.equal(r.text, 'اصلی برگشت');
  delete process.env.ARA_AI_CIRCUIT_SEC;
});

test('non-transient error (invalid key) skips retries; all down → AI_UPSTREAM with detail; health hides model names', async () => {
  _resetAiHealth();
  const calls: Call[] = [];
  const r = await complete(body, { fetch: fake(() => new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 }), calls), list: [P, F], sleep: noSleep, retries: 3 });
  assert.equal(r.provider.id, 'fallback');
  assert.equal(calls.filter((c) => c.url.startsWith('https://primary.test')).length, 1, 'خطای کلید تلاش دوباره ندارد');
  await assert.rejects(complete(body, { fetch: (async () => { throw new Error('ECONNRESET'); }) as typeof fetch, list: [P], sleep: noSleep, retries: 1 }),
    (e: { code?: string; detail?: string[] }) => e.code === 'AI_UPSTREAM' && /ECONNRESET/.test(String(e.detail)));
  const env = { ARA_ANTHROPIC_API_KEY: 'a', ARA_LLM_MODEL: 'secret-model-x', ARA_AI_FALLBACK_API_KEY: 'b', ARA_AI_FALLBACK_BASE_URL: 'https://fb.test', ARA_AI_FALLBACK_MODEL: 'secret-model-y' } as NodeJS.ProcessEnv;
  const list = providers(env); assert.deepEqual(list.map((p) => [p.id, p.format]), [['primary', 'anthropic'], ['fallback', 'openai']]);
  const saved = { ...process.env }; Object.assign(process.env, env);
  const health = JSON.stringify(aiHealth());
  assert.ok(!/secret-model|fb\.test/.test(health), 'سلامت نام مدل یا نشانی را نشان نمی‌دهد');
  for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});
