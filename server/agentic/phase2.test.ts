/** فاز ۲ فریمورک ایجنتیک: صف کار پایدار، اجرای دسته‌ای شهر، دستیار عامل‌محور با اتکای عددی */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-agentic-p2-'));
process.env.ARA_ANTHROPIC_API_KEY = '';

const fakeLlm = (replies: string[]) => { let i = 0; const prompts: string[] = []; return { prompts, fn: async (_s: string, p: string) => { prompts.push(p); return { text: replies[Math.min(i++, replies.length - 1)], model: 'fake' }; } }; };

test('job queue runs, retries, cancels and recovers persisted jobs', async () => {
  const { JobQueue } = await import('./jobQueue');
  const q = new JobQueue(1);
  let flaky = 0;
  q.register('graph', async (job) => { if (job.payload.flaky && flaky++ === 0) throw new Error('boom'); await new Promise((r) => setTimeout(r, 30)); return { ok: '1' }; });
  const a = q.enqueue('graph', { flaky: true }, { maxAttempts: 2 });
  const b = q.enqueue('graph', {});
  const c = q.enqueue('graph', {});
  q.cancel(c.jobId);
  const ja = await q.waitFor(a.jobId, 5000), jb = await q.waitFor(b.jobId, 5000);
  assert.equal(ja?.status, 'done'); assert.equal(ja?.attempts, 2); assert.equal(ja?.ref.ok, '1');
  assert.equal(jb?.status, 'done');
  assert.equal(q.get(c.jobId)?.status, 'cancelled');
  // کار «در حال اجرا» یتیم پس از راه‌اندازی دوباره بازیابی می‌شود
  const orphan = q.enqueue('batch', {});
  const st = q.get(orphan.jobId)!; st.status = 'running'; q.save(st);
  const q2 = new JobQueue(1);
  q2.register('batch', async () => ({ recovered: 'yes' }));
  assert.equal(q2.recover(), 1);
  const jo = await q2.waitFor(orphan.jobId, 5000);
  assert.equal(jo?.status, 'done'); assert.equal(jo?.ref.recovered, 'yes');
  assert.equal(q2.stats().cancelled >= 1, true);
});

test('numeric grounding ignores ids/codes/dates and flags invented numbers', async () => {
  const { numbersIn, ungroundedNumbers, toLatinDigits } = await import('./copilot');
  assert.equal(toLatinDigits('۱۲٫۵'), '12.5');
  const n = numbersIn('محله m605 در فرضیهٔ H1 و تاریخ 2024-05-01 سهم ۴۲٪ دارد');
  assert.deepEqual(n, ['42']);
  const g = ungroundedNumbers('سهم ۴۲٪ و تراکم ۹۹۹ نفر', [{ share: 0.42 }, { x: 42 }]);
  assert.deepEqual(g.ungrounded, ['999']);
});

test('guessNeighborhood extracts the neighborhood from a free question', async () => {
  const { guessNeighborhood } = await import('./copilot');
  const { resolveNeighborhood } = await import('../neighborhood/resolver');
  const g = guessNeighborhood('وضعیت محله یوسف آباد تهران را تحلیل کن');
  assert.equal(resolveNeighborhood(g.name, g.city).best?.entry.neighborhoodId, 'tehran:m605');
});

test('copilot loop: tool actions, forbidden agent, invalid JSON, grounding revision', async () => {
  const { createSession, runCopilot } = await import('./copilot');
  const s = createSession('یوسف آباد تهران کجاست؟', true, null);
  const llm = fakeLlm([
    'not json',
    JSON.stringify({ thought: 'operator', action: { agent: 'operator', tool: 'resolve_neighborhood', input: { name: 'یوسف آباد' } } }),
    JSON.stringify({ thought: 'wrong agent', action: { agent: 'A7', tool: 'resolve_neighborhood', input: { name: 'یوسف آباد' } } }),
    JSON.stringify({ thought: 'resolve', action: { agent: 'A1', tool: 'resolve_neighborhood', input: { name: 'یوسف آباد', city: 'تهران' } } }),
    JSON.stringify({ thought: 'done', final: { answer: 'شناسهٔ محله tehran:m605 است و جمعیت ۸۸۸۸۸۸ نفر است', usedCalls: ['bogus'] } }),
    JSON.stringify({ thought: 'fixed', final: { answer: 'شناسهٔ محله tehran:m605 در تهران است', usedCalls: [] } }),
  ]);
  const out = await runCopilot(s.sessionId, { llm: llm.fn });
  assert.equal(out.status, 'answered');
  assert.equal(out.grounding?.revised, true);
  assert.deepEqual(out.grounding?.ungrounded, []);
  assert.ok(out.steps.some((x) => x.error?.includes('JSON') || x.thought === 'خروجی نامعتبر مدل'));
  assert.equal(out.steps.filter((x) => x.error?.startsWith('FORBIDDEN')).length, 2);
  const ok = out.steps.find((x) => x.tool === 'resolve_neighborhood' && x.ok);
  assert.ok(ok?.callId);
  assert.deepEqual(out.usedCalls, []);
  assert.ok(llm.prompts.some((p) => p.includes('888888')));
});

test('copilot without LLM key falls back to deterministic standard graph', async () => {
  const { createSession, runCopilot } = await import('./copilot');
  const s = createSession('وضعیت محله یوسف آباد تهران را تحلیل کن', true, null);
  assert.equal(s.mode, 'deterministic_fallback');
  const out = await runCopilot(s.sessionId);
  assert.equal(out.status, 'answered');
  assert.ok(out.runId);
  assert.ok(out.steps.length >= 5);
  assert.ok(out.answer?.includes('گراف قطعی'));
});

test('city batch (limit 3, offline) via queue: summary, CSV, resume', async () => {
  const { enqueueBatch } = await import('./jobs');
  const { getJobQueue } = await import('./jobQueue');
  const { loadBatch, batchCsv, runBatch, saveBatch } = await import('./batch');
  const { jobId, batchId, total } = enqueueBatch('تهران', { offline: true, limit: 3 });
  assert.equal(total, 3);
  const j = await getJobQueue().waitFor(jobId, 300_000);
  assert.equal(j?.status, 'done', j?.error ?? '');
  const b = loadBatch(batchId)!;
  assert.equal(b.status, 'completed'); assert.equal(b.done + b.failed, 3);
  assert.equal(Object.values(b.summary.byRunStatus).reduce((a, x) => a + x, 0), b.done);
  const csv = batchCsv(b);
  assert.ok(csv.startsWith('\uFEFF')); assert.equal(csv.trim().split('\n').length, 4);
  // ادامه: یک مورد را «در انتظار» کن و دوباره اجرا کن؛ فقط همان اجرا می‌شود
  const firstRun = b.items[0].runId;
  b.items[1] = { ...b.items[1], status: 'pending', runId: null }; b.status = 'cancelled'; saveBatch(b);
  const r = await runBatch(batchId);
  assert.equal(r.status, 'completed'); assert.equal(r.items[0].runId, firstRun); assert.ok(r.items[1].runId);
});

test('async graph run is queued then completes; queued job can be cancelled', async () => {
  const { enqueueGraph, cancelJob } = await import('./jobs');
  const { getJobQueue } = await import('./jobQueue');
  const { loadRun } = await import('./pipeline');
  const a = enqueueGraph({ neighborhoodId: 'tehran:m605', offline: true });
  assert.equal(loadRun(a.runId)?.status, 'queued');
  const j = await getJobQueue().waitFor(a.jobId, 300_000);
  assert.equal(j?.status, 'done', j?.error ?? '');
  assert.notEqual(loadRun(a.runId)?.status, 'queued');
  const q = getJobQueue();
  const prev = q.concurrency; q.concurrency = 0;
  const c = enqueueGraph({ neighborhoodId: 'tehran:m605', offline: true });
  assert.equal(cancelJob(c.jobId)?.status, 'cancelled');
  assert.equal(loadRun(c.runId)?.status, 'cancelled');
  q.concurrency = prev;
});
