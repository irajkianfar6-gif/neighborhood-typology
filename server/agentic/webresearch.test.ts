/** پژوهش عمیق وب (WEBRES-v1/WEBCLIENT-v1): کلاینت با fetch ساختگی، راستی‌آزمایی قطعی عدد، حاکمیت انسانی و حداقل دسترسی */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-agentic-web-'));
process.env.ARA_ANTHROPIC_API_KEY = '';
process.env.YDC_API_KEY = 'test-key';
process.env.ARA_SEARCH_PROVIDER = 'none';

const NB = 'tehran:m605';
type Call = { url: string; method: string; body: unknown; key?: string };
function fakeFetch(handler: (c: Call) => unknown, calls: Call[] = []) {
  return {
    calls,
    fetch: async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const c = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, key: init.headers?.['X-API-Key'] };
      calls.push(c);
      const out = handler(c);
      if (out && typeof out === 'object' && 'status' in (out as object) && typeof (out as { status: unknown }).status === 'number') {
        const o = out as { status: number; body?: string };
        return { ok: o.status < 400, status: o.status, text: async () => o.body ?? '' };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(out) };
    },
  };
}

test('web client: search parsing, cache, daily budget guard, not-configured', async () => {
  const { youSearch, usageToday, WebServiceError } = await import('./research/webClient');
  const ff = fakeFetch(() => ({ results: { web: [{ url: 'https://amar.org.ir/a', title: 'سرشماری', description: 'توضیح', snippets: ['۱۲٫۵ درصد'] }] }, metadata: {} }));
  const hits = await youSearch('سرشماری تهران منطقه ۶', { country: 'IR' }, { fetch: ff.fetch });
  assert.equal(hits.length, 1); assert.equal(hits[0].url, 'https://amar.org.ir/a'); assert.deepEqual(hits[0].snippets, ['۱۲٫۵ درصد']);
  assert.equal(ff.calls[0].key, 'test-key'); assert.match(ff.calls[0].url, /ydc-index\.io\/v1\/search/);
  await youSearch('سرشماری تهران منطقه ۶', { country: 'IR' }, { fetch: ff.fetch });
  assert.equal(ff.calls.length, 1, 'پرسش تکراری باید از حافظهٔ نهان بیاید');
  const u = usageToday(); assert.equal(u.search, 1); assert.ok(u.cacheHits >= 1);
  process.env.ARA_WEBSEARCH_DAILY_LIMIT = '1';
  await assert.rejects(youSearch('پرسش دیگر', {}, { fetch: ff.fetch }), (e: unknown) => e instanceof WebServiceError && e.code === 'WEB_BUDGET');
  delete process.env.ARA_WEBSEARCH_DAILY_LIMIT;
  process.env.YDC_API_KEY = '';
  await assert.rejects(youSearch('x', {}, { fetch: ff.fetch }), (e: unknown) => e instanceof WebServiceError && e.code === 'WEB_NOT_CONFIGURED');
  process.env.YDC_API_KEY = 'test-key';
  const bad = fakeFetch(() => ({ status: 401, body: 'no' }));
  await assert.rejects(youSearch('y', {}, { fetch: bad.fetch }), (e: unknown) => e instanceof WebServiceError && e.code === 'WEB_UPSTREAM');
});

test('web client: research sync (standard) and background polling (deep); schema clamps lite', async () => {
  const { youResearch, clampEffort } = await import('./research/webClient');
  assert.equal(clampEffort('lite', true), 'standard');
  const out = { output: { content: { candidates: [], notes: 'x' }, content_type: 'object', sources: [{ url: 'https://a.ir/r', title: 'A', snippets: ['s'] }] } };
  const sync = fakeFetch(() => out);
  const r1 = await youResearch({ input: 'q1', effort: 'standard', outputSchema: { type: 'object' } }, { fetch: sync.fetch });
  assert.equal(r1.contentType, 'object'); assert.equal(r1.sources.length, 1); assert.equal(r1.costUsd, 0.05);
  assert.equal((sync.calls[0].body as { research_effort: string }).research_effort, 'standard');
  let polls = 0;
  const bg = fakeFetch((c) => {
    if (c.method === 'POST') { assert.equal((c.body as { background?: boolean }).background, true); return { task_id: 't1', status: 'queued' }; }
    polls++; return polls < 3 ? { status: 'running' } : { status: 'completed', result: out };
  });
  const r2 = await youResearch({ input: 'q2', effort: 'deep' }, { fetch: bg.fetch, sleep: async () => {} });
  assert.equal(r2.taskId, 't1'); assert.equal(polls, 3); assert.equal(r2.costUsd, 0.1);
  const again = await youResearch({ input: 'q2', effort: 'deep' }, { fetch: bg.fetch, sleep: async () => {} });
  assert.equal(again.cached, true); assert.equal(again.costUsd, 0);
});

test('deterministic number verification: grounding, citation, spatial level, plausibility', async () => {
  const { checkCandidate, containsValue } = await import('./research/webResearch');
  assert.ok(containsValue('نرخ باسوادی ۹۲٫۴ درصد است', 92.4, true));
  assert.ok(containsValue('ratio 0.924', 92.4, true));
  assert.ok(!containsValue('نرخ ۸۰ درصد', 92.4, true));
  const entry = { neighborhoodId: NB, nameFa: 'یوسف آباد', cityFa: 'تهران' };
  const src = [{ url: 'https://amar.org.ir/t', title: 'T', snippets: ['منطقه ۶: ۹۲٫۴ درصد'] }];
  const base = { value: 92.4, unit: 'percent', period: '1395', spatialLevel: 'neighborhood' as const, areaName: 'یوسف‌آباد', sourceUrl: 'https://amar.org.ir/t', sourceTitle: 'T', quote: 'یوسف آباد ۹۲٫۴ درصد ۱۳۹۵', isOfficial: true };
  const page = new Map([['amar.org.ir/t', 'جدول: محله یوسف آباد — ۹۲٫۴ درصد (سرشماری ۱۳۹۵)']]);
  const ok = checkCandidate(base, { code: 'H1', entry, district: 6, sources: src, pageText: page });
  assert.equal(ok.status, 'acceptable'); assert.equal(ok.grounding, 'page'); assert.equal(ok.contractLevel, 'neighborhood'); assert.ok(ok.periodEnd);
  const quoteOnly = checkCandidate({ ...base, value: 71.3, quote: '۷۱٫۳ درصد' }, { code: 'H1', entry, district: 6, sources: src, pageText: page });
  assert.equal(quoteOnly.grounding, 'quote_only'); assert.equal(quoteOnly.status, 'rejected');
  const uncited = checkCandidate({ ...base, sourceUrl: 'https://made-up.example/x' }, { code: 'H1', entry, district: 6, sources: src, pageText: page });
  assert.equal(uncited.cited, false); assert.equal(uncited.status, 'rejected');
  const dist = checkCandidate({ ...base, spatialLevel: 'district', areaName: 'منطقه ۶' }, { code: 'H1', entry, district: 6, sources: src, pageText: new Map() });
  assert.equal(dist.grounding, 'snippet'); assert.equal(dist.contractLevel, 'district'); assert.equal(dist.status, 'needs_review');
  const wrongDist = checkCandidate({ ...base, spatialLevel: 'district', areaName: 'منطقه ۱۲' }, { code: 'H1', entry, district: 6, sources: src, pageText: page });
  assert.equal(wrongDist.spatial, 'mismatch'); assert.equal(wrongDist.contractLevel, null);
  const popSrc = [{ url: 'https://amar.org.ir/t', title: 'T', snippets: ['جمعیت منطقه ۶: ۲۵۰۹۰۵ نفر'] }];
  const popDist = checkCandidate({ ...base, value: 250905, unit: 'person', spatialLevel: 'district', areaName: 'منطقه ۶', quote: '۲۵۰۹۰۵ نفر' }, { code: 'POP', entry, district: 6, sources: popSrc, pageText: new Map() });
  assert.equal(popDist.contractLevel, null, 'شاخص شمارشی منطقه به محله گسترده نمی‌شود');
  const self = checkCandidate({ ...base, sourceUrl: 'https://github.com/irajkianfar6-gif/neighborhood-typology' }, { code: 'H1', entry, district: 6, sources: [{ ...src[0], url: 'https://github.com/irajkianfar6-gif/neighborhood-typology' }], pageText: new Map([['github.com/irajkianfar6-gif/neighborhood-typology', 'یوسف آباد ۹۲٫۴ درصد ۱۳۹۵']]) });
  assert.equal(self.status, 'rejected', 'منبع خودارجاع پذیرفته نمی‌شود');
  const city = checkCandidate({ ...base, spatialLevel: 'city', areaName: 'تهران' }, { code: 'H1', entry, district: 6, sources: src, pageText: page });
  assert.equal(city.spatial, 'too_coarse'); assert.equal(city.contractLevel, null);
  const bigPct = checkCandidate({ ...base, value: 140, quote: '۱۴۰' }, { code: 'H1', entry, district: 6, sources: [{ ...src[0], snippets: ['۱۴۰ درصد'] }], pageText: new Map() });
  assert.equal(bigPct.plausible, false); assert.equal(bigPct.status, 'rejected');
});

test('planning: perceptual indicators only via survey; lexicon-only codes allowed; unknown codes skipped', async () => {
  const { planCodes, buildPrompt } = await import('./research/webResearch');
  const p = planCodes({ codes: ['S1', 'C3', 'H1', 'POP', 'E4', 'ZZ9'], gaps: [], max: 5 });
  assert.deepEqual(p.surveyOnly, ['S1', 'C3']); assert.deepEqual(p.notInContract, ['ZZ9']);
  assert.deepEqual(p.codes, ['H1', 'POP', 'E4']);
  assert.match(buildPrompt('POP', { nameFa: 'یوسف آباد', cityFa: 'تهران' }), /POP/);
});

test('end-to-end run with fake service → expert decision → contract batch PENDING_REVIEW', async () => {
  const { startWebResearch, runWebResearch, decideCandidate, getWebResearch } = await import('./research/webResearch');
  const { getBatch } = await import('../ingestion/contractData');
  const research = { output: { content_type: 'object', content: { notes: 'یافت شد', candidates: [
    { value: 92.4, unit: 'percent', period: '1395', spatialLevel: 'district', areaName: 'منطقه ۶', sourceUrl: 'https://amar.org.ir/t', sourceTitle: 'سرشماری', quote: 'منطقه ۶ نرخ باسوادی ۹۲٫۴ درصد (۱۳۹۵)', isOfficial: true },
    { value: 55, unit: 'percent', period: null, spatialLevel: 'neighborhood', areaName: 'یوسف آباد', sourceUrl: 'https://blog.example/x', sourceTitle: 'وبلاگ', quote: '۵۵ درصد', isOfficial: false },
  ] }, sources: [{ url: 'https://amar.org.ir/t', title: 'سرشماری', snippets: ['منطقه ۶: ۹۲٫۴ درصد'] }] } };
  const ff = fakeFetch((c) => (c.url.includes('/v1/research') ? research : c.url.includes('/v1/contents') ? [{ url: 'https://amar.org.ir/t', markdown: 'منطقه ۶ — نرخ باسوادی ۹۲٫۴ درصد، سرشماری ۱۳۹۵' }] : { results: { web: [] } }));
  const pageFetch = async () => ({ ok: false, status: 404, text: async () => '' });
  const r0 = await startWebResearch({ neighborhoodId: NB, codes: ['H1', 'S1'], effort: 'standard' });
  assert.deepEqual(r0.codes, ['H1']); assert.deepEqual(r0.skipped.surveyOnly, ['S1']);
  const r = await runWebResearch(r0.id, { deps: { fetch: ff.fetch, pageFetch: pageFetch as never } });
  assert.equal(r.status, 'completed');
  const f = r.findings[0]; assert.equal(f.status, 'found');
  const [good, bad] = f.candidates;
  assert.equal(good.check.grounding, 'page'); assert.equal(good.check.contractLevel, 'district'); assert.notEqual(good.status, 'rejected');
  assert.equal(bad.status, 'rejected');
  assert.throws(() => decideCandidate(r.id, 'H1', 1, 'approved', 'user:test'), /ردشده/);
  const d = decideCandidate(r.id, 'H1', 0, 'approved', 'user:test', { note: 'بررسی شد' });
  assert.ok(d.decision.batchId);
  const b = getBatch(d.decision.batchId!); assert.equal(b?.status, 'PENDING_REVIEW');
  assert.throws(() => decideCandidate(r.id, 'H1', 0, 'rejected', 'user:test'), /پیش‌تر/);
  assert.equal(getWebResearch(r.id)!.findings[0].candidates[0].decision!.decision, 'approved');
});

test('least privilege and governance: only A2 may run web research; no tool decides candidates; not configured', async () => {
  const { callTool } = await import('./registry');
  const { AGENTS } = await import('./agents');
  const { TOOLS } = await import('./tools');
  const denied = await callTool('web_research_indicators', { neighborhoodId: NB, codes: ['H1'] }, { agentId: 'A11' });
  assert.equal(denied.ok, false);
  assert.ok(!TOOLS.map((t) => t.name).some((n) => /decide|approve/.test(n) && /web/.test(n)), 'هیچ ابزار عامل نباید نامزد وب را تأیید کند');
  const holders = AGENTS.filter((a) => a.tools.includes('web_research_indicators')).map((a) => a.id);
  assert.deepEqual(holders, ['A2']);
  process.env.YDC_API_KEY = '';
  const nc = await callTool('web_research_indicators', { neighborhoodId: NB, codes: ['H1'] }, { agentId: 'A2' });
  assert.equal(nc.ok, false); assert.equal(nc.error?.code, 'WEB_NOT_CONFIGURED');
  process.env.YDC_API_KEY = 'test-key';
});
