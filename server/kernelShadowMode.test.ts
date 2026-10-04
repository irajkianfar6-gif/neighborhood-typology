// ============================================================
// Shadow mode tests (فاز ۳)
//   A) مقایسهٔ خالص — بدون I/O
//   B) اجرای واقعی سایه روی kernel + انبار گزارش‌ها
//   C) یکپارچگی با مسیر محصول: پاسخ /analyze دست‌نخورده می‌ماند
// ============================================================
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { buildDecisionSupportRouter } from './decisionSupportRouter';
import {
  compareShadow,
  runShadowComparison,
  scheduleShadowComparison,
  getShadowReport,
  listShadowReports,
  clearShadowReports,
  shadowRuntimeSummary,
  shadowModeSetting,
  scheduleShadowComparison as schedule,
  type ShadowCardInput,
} from './kernelShadowMode';
import type { KernelRunResult } from './kernelTypes';
import { stopKernelService } from './kernelClient';

test.after(stopKernelService);

// ---------- fixtures ----------
function fakeKernel(overrides: {
  capitals?: Record<string, { value: number | null; status: string }>;
  caueo?: Record<string, { value: number | null; status: string }>;
  qtr?: Record<string, { value: number | null; status: string }>;
  chain_gaps?: Record<string, { value: number | null; status: string }>;
  equity?: { value: number | null; status: string };
  bottleneck?: Record<string, unknown>;
} = {}): KernelRunResult {
  const agg = (m?: Record<string, { value: number | null; status: string }>) =>
    Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, {
      name: k, value: v.value, status: v.status, formula_id: 'f', inputs: [], sources: {},
      versions: {}, note: 'test fixture',
    }]));
  return {
    run_id: 'CALC-v0.2+test',
    neighborhood: null,
    calc_run: { calculation_version_id: 'CALC-v0.2+test' } as KernelRunResult['calc_run'],
    reproducibility_key: {
      data_version: 'd1', methodology_version: 'algo.txt-2026', indicator_version: 'registry-419-v1',
      weight_set: 'W-v1', threshold_set: 'T-v1', calculation_version: 'CALC-v0.2',
    },
    fingerprint: 'sha256:test',
    indicators: [],
    aggregates: {
      capitals: agg(overrides.capitals),
      caueo: agg(overrides.caueo),
      qtr: agg(overrides.qtr),
      chain_gaps: agg(overrides.chain_gaps),
      equity: {
        name: 'equity_gap', value: overrides.equity?.value ?? null,
        status: overrides.equity?.status ?? 'INSUFFICIENT_COVERAGE',
        formula_id: 'equity', inputs: [], sources: {}, versions: {}, note: 'test fixture',
      },
      bottleneck: overrides.bottleneck ?? {
        status: 'INSUFFICIENT_COVERAGE', primary_bottleneck: null, note: 'no evidence',
        ai_independent: true, needed_data: ['گروه‌بندی رسمی'],
      },
    },
    drilldown_index: {},
    engine: { stages: [], count: 0 },
    publish_gate: { can_publish_numeric_scores: false, n_valid_standardized_scores: 0, reasons: [], rule: '' },
  } as KernelRunResult;
}

const TS_CARD: ShadowCardInput = {
  capitalScores: [
    { capitalKey: 'H', score: 80, band: 'GOOD' },
    { capitalKey: 'S', score: 70, band: 'MODERATE' },
    { capitalKey: 'E', score: 60, band: 'MODERATE' },   // → kernel EC
    { capitalKey: 'P', score: 65, band: 'MODERATE' },
    { capitalKey: 'N', score: 55, band: 'WEAK' },
  ],
  chainProfile: {
    H: [{ stage: 'CAPACITY', score: 80 }, { stage: 'ACCESS', score: 70 }],
    S: [{ stage: 'CAPACITY', score: 60 }, { stage: 'ACCESS', score: 50 }],
  },
  chainGaps: { G_CA: 12, G_AU: 8, G_UE: 5, G_EO: 3 },
  qualityVerdict: { Q: 72, T: 68, R: 64 },
  equityMap: [
    { indicatorCode: 'H1', bestGroup: 'شمال', worstGroup: 'جنوب', gap: 18, verdict: 'critical' },
    { indicatorCode: 'S1', bestGroup: 'شمال', worstGroup: 'جنوب', gap: 9, verdict: 'unequal_but_good' },
  ],
  equityDataStatus: 'measured',
  bottleneck: { capital: 'N', transition: ['USE', 'EXPERIENCE'], location: 'محله', group: 'کل' },
};

// ============================================================
// A) مقایسهٔ خالص
// ============================================================
test('shadow: kernel abstention against a numeric TS value is reported as ts_only', () => {
  const kernel = fakeKernel({
    capitals: { H: { value: null, status: 'WAITING_FOR_DATA' } },
    caueo: {}, qtr: {}, chain_gaps: {},
  });
  const { cells, summary, divergences } = compareShadow({ card: TS_CARD, kernel });

  const h = cells.find(c => c.dimension === 'capital' && c.key === 'H');
  assert.ok(h, 'capital H cell must exist');
  assert.equal(h.ts_value, 80);
  assert.equal(h.ts_status, 'PUBLISHED');
  assert.equal(h.kernel_value, null, 'kernel abstained — no number');
  assert.equal(h.kernel_status, 'WAITING_FOR_DATA');
  assert.equal(h.verdict, 'ts_only');
  assert.equal(h.delta, null, 'delta is undefined when one side abstains — never coerced');

  assert.ok(summary.ts_only > 0);
  assert.ok(divergences.some(d => d.includes('خودداری')), 'divergence must name the kernel abstention');
});

test('shadow: both numeric produces a kernel-minus-ts delta', () => {
  const kernel = fakeKernel({
    qtr: { Q: { value: 66, status: 'OBSERVED' }, T: { value: null, status: 'WAITING_FOR_DATA' }, R: { value: null, status: 'WAITING_FOR_DATA' } },
  });
  const { cells, summary } = compareShadow({ card: TS_CARD, kernel });

  const q = cells.find(c => c.dimension === 'qtr' && c.key === 'Q');
  assert.ok(q);
  assert.equal(q.verdict, 'both_numeric');
  assert.equal(q.ts_value, 72);
  assert.equal(q.kernel_value, 66);
  assert.equal(q.delta, -6, 'delta = kernel − TS');
  assert.equal(summary.both_numeric, 1);
  assert.equal(summary.max_abs_delta, 6);
});

test('shadow: K is kernel-only and Q/T/R stay separate', () => {
  const kernel = fakeKernel({
    qtr: {
      K: { value: 61, status: 'OBSERVED' },
      Q: { value: null, status: 'INSUFFICIENT_COVERAGE' },
      T: { value: null, status: 'WAITING_FOR_DATA' },
      R: { value: null, status: 'WAITING_FOR_DATA' },
    },
  });
  const { cells } = compareShadow({ card: TS_CARD, kernel });

  const k = cells.find(c => c.dimension === 'qtr' && c.key === 'K');
  assert.ok(k, 'K cell must exist');
  assert.equal(k.verdict, 'kernel_only');
  assert.equal(k.ts_value, null, 'TS never publishes K — absent, not zero');
  assert.equal(k.kernel_value, 61);

  // Q/T/R در هیچ امتیاز ترکیبی ادغام نمی‌شوند: سه سلول جدا باقی می‌مانند
  const qtrKeys = cells.filter(c => c.dimension === 'qtr').map(c => c.key).sort();
  assert.deepEqual(qtrKeys, ['K', 'Q', 'R', 'T']);
});

test('shadow: TS capital E is compared against kernel EC', () => {
  const kernel = fakeKernel({
    capitals: { EC: { value: 55, status: 'OBSERVED' } },
  });
  const { cells } = compareShadow({ card: TS_CARD, kernel });

  const e = cells.find(c => c.dimension === 'capital' && c.key === 'E');
  assert.ok(e, 'TS E must produce a cell');
  assert.equal(e.ts_value, 60);
  assert.equal(e.kernel_value, 55, 'must read kernel EC, not E');
  assert.equal(e.verdict, 'both_numeric');
  assert.match(e.note, /EC/);
});

test('shadow: a missing TS value stays null and never becomes zero', () => {
  const card: ShadowCardInput = { ...TS_CARD, capitalScores: [{ capitalKey: 'H', score: Number.NaN }] };
  const kernel = fakeKernel({ capitals: { H: { value: 40, status: 'OBSERVED' } } });
  const { cells } = compareShadow({ card, kernel });

  const h = cells.find(c => c.key === 'H');
  assert.ok(h);
  assert.equal(h.ts_value, null, 'NaN must never be treated as a number or 0');
  assert.equal(h.ts_status, 'ABSENT');
  assert.equal(h.verdict, 'kernel_only');
});

test('shadow: both abstaining yields both_abstain and no fabricated delta', () => {
  const kernel = fakeKernel({ equity: { value: null, status: 'INSUFFICIENT_COVERAGE' } });
  const card: ShadowCardInput = { ...TS_CARD, equityMap: [] };
  const { cells, summary } = compareShadow({ card, kernel });

  const eq = cells.find(c => c.dimension === 'equity');
  assert.ok(eq);
  assert.equal(eq.verdict, 'both_abstain');
  assert.equal(eq.kernel_value, null);
  assert.equal(summary.mean_abs_delta, null);
});

test('shadow: equity compares the largest TS group gap against the kernel aggregate', () => {
  const kernel = fakeKernel({ equity: { value: 12, status: 'OBSERVED' } });
  const { cells } = compareShadow({ card: TS_CARD, kernel });

  const eq = cells.find(c => c.dimension === 'equity');
  assert.ok(eq);
  assert.equal(eq.ts_value, 18, 'largest of 18 and 9');
  assert.equal(eq.kernel_value, 12);
  assert.equal(eq.delta, -6);
});

test('shadow: an abstaining kernel bottleneck is recorded as kernel_abstained', () => {
  const { bottleneck_comparison } = compareShadow({ card: TS_CARD, kernel: fakeKernel() });
  assert.equal(bottleneck_comparison.agreement, 'kernel_abstained');
  assert.equal(bottleneck_comparison.kernel_primary, null);
  assert.equal(bottleneck_comparison.ts?.capital, 'N');
  assert.match(bottleneck_comparison.note, /بدون شواهد/);
});

test('shadow: derived C-A-U-E-O stages are marked derived, not card values', () => {
  const kernel = fakeKernel({ caueo: { C: { value: null, status: 'WAITING_FOR_DATA' } } });
  const { cells } = compareShadow({ card: TS_CARD, kernel });

  const c = cells.find(c => c.dimension === 'caueo' && c.key === 'C');
  assert.ok(c);
  assert.equal(c.ts_source, 'derived');
  assert.equal(c.ts_value, 70, 'mean of 80 and 60 across capitals');
  assert.match(c.note, /مشتق/);
});

// ============================================================
// B) اجرای واقعی سایه
// ============================================================
const LIVE_VALUES = { H1: 80, H3: 72, S1: 70, S2: 64, E1: 60, P1: 65, P4: 58, N1: 55, C1: 75, G1: 50, R1: 68 };

test('shadow: a live kernel run produces a completed report with a real fingerprint', async () => {
  clearShadowReports();
  const report = await runShadowComparison({
    tsRunId: 'run-shadow-live-1',
    neighborhoodName: 'نوغان',
    indicatorValues: LIVE_VALUES,
    card: TS_CARD,
    dataVersion: 'shadow-test-v1',
  });

  assert.equal(report.status, 'completed', report.error ?? 'expected a completed shadow run');
  assert.match(report.kernel_fingerprint ?? '', /^sha256:/);
  assert.ok(report.kernel_run_id);
  assert.equal(report.kernel_gate_open, false, 'gate must stay closed without W/T calibration');
  assert.ok(report.records_sent > 0);
  assert.ok(report.cells.length > 0);
  assert.equal(report.mapped, report.records_sent - report.unmapped.length);
  assert.equal(report.rules.length > 0, true);
});

test('shadow: an unmappable payload errors honestly instead of fabricating a comparison', async () => {
  const report = await runShadowComparison({
    tsRunId: 'run-shadow-unmappable',
    neighborhoodName: 'ناشناخته',
    indicatorValues: { ZZ: 10, YY: 20 },
    card: TS_CARD,
  });

  assert.equal(report.status, 'error');
  assert.ok(report.error, 'the reason must be reported, not swallowed');
  assert.equal(report.cells.length, 0);
  assert.equal(report.kernel_fingerprint, null);
  assert.deepEqual(report.unmapped.sort(), ['YY', 'ZZ']);
});

test('shadow: the scheduled runner stores reports and never throws', async () => {
  clearShadowReports();
  const stored = await scheduleShadowComparison({
    tsRunId: 'run-shadow-store',
    neighborhoodName: 'نوغان',
    indicatorValues: LIVE_VALUES,
    card: TS_CARD,
  });

  assert.ok(stored);
  const fetched = getShadowReport('run-shadow-store');
  assert.ok(fetched, 'report must be retrievable by TS run id');
  assert.equal(fetched.ts_run_id, 'run-shadow-store');
  assert.equal(listShadowReports().length, 1);

  const runtime = shadowRuntimeSummary();
  assert.equal(runtime.total, 1);
  assert.equal(runtime.completed, 1);
  assert.equal(runtime.errored, 0);
});

test('shadow: mode defaults to async and can be turned off', () => {
  const previous = process.env.ARA_KERNEL_SHADOW;
  delete process.env.ARA_KERNEL_SHADOW;
  assert.equal(shadowModeSetting(), 'async', 'product latency must not change by default');

  process.env.ARA_KERNEL_SHADOW = 'off';
  assert.equal(shadowModeSetting(), 'off');
  process.env.ARA_KERNEL_SHADOW = 'await';
  assert.equal(shadowModeSetting(), 'await');

  if (previous === undefined) delete process.env.ARA_KERNEL_SHADOW;
  else process.env.ARA_KERNEL_SHADOW = previous;
});

test('shadow: disabled mode short-circuits and stores nothing', async () => {
  const previous = process.env.ARA_KERNEL_SHADOW;
  process.env.ARA_KERNEL_SHADOW = 'off';
  clearShadowReports();
  const result = await schedule({
    tsRunId: 'run-shadow-off',
    neighborhoodName: 'نوغان',
    indicatorValues: LIVE_VALUES,
    card: TS_CARD,
  });
  assert.equal(result, null);
  assert.equal(listShadowReports().length, 0);
  if (previous === undefined) delete process.env.ARA_KERNEL_SHADOW;
  else process.env.ARA_KERNEL_SHADOW = previous;
});

// ============================================================
// C) یکپارچگی با مسیر محصول — پاسخ /analyze نباید تغییر کند
// ============================================================
async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/decision-support', buildDecisionSupportRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/decision-support` };
}

async function postAnalyze(base: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${base}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ neighborhoodName: 'نوغان', purpose: 'baseline', indicatorValues: LIVE_VALUES, ...body }),
  });
  return { status: response.status, payload: await response.json() as Record<string, unknown> };
}

test('shadow: the analyze response is byte-for-byte the same product contract with shadow on and off', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve())));
  const previous = process.env.ARA_KERNEL_SHADOW;

  process.env.ARA_KERNEL_SHADOW = 'off';
  const off = await postAnalyze(api.base);

  process.env.ARA_KERNEL_SHADOW = 'await';
  const on = await postAnalyze(api.base);

  if (previous === undefined) delete process.env.ARA_KERNEL_SHADOW;
  else process.env.ARA_KERNEL_SHADOW = previous;

  assert.equal(off.status, 200);
  assert.equal(on.status, 200);

  // همان قرارداد فعلی محصول: { success, data: { runId, card } }
  assert.deepEqual(Object.keys(off.payload).sort(), ['data', 'success']);
  assert.deepEqual(Object.keys(on.payload).sort(), ['data', 'success']);
  assert.deepEqual(
    Object.keys(on.payload.data as object).sort(),
    Object.keys(off.payload.data as object).sort(),
    'shadow must not add or remove any field on the product response',
  );
  assert.deepEqual(Object.keys(off.payload.data as object).sort(), ['card', 'runId']);

  // مقادیر موتور محصول با و بدون سایه یکسان است
  const cardOff = (off.payload.data as { card: Record<string, unknown> }).card;
  const cardOn = (on.payload.data as { card: Record<string, unknown> }).card;
  for (const field of ['capitalScores', 'chainGaps', 'qualityVerdict', 'equityMap', 'diagnosticType', 'chainProfile']) {
    assert.deepEqual(cardOn[field], cardOff[field], `product field «${field}» must be unchanged by shadow mode`);
  }
  assert.equal(
    Object.keys(cardOn).length,
    Object.keys(cardOff).length,
    'the shadow must not inject extra keys into the decision card',
  );
});

test('shadow: the report for a given analyze run is retrievable without touching the product response', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve())));
  const previous = process.env.ARA_KERNEL_SHADOW;
  process.env.ARA_KERNEL_SHADOW = 'await';
  clearShadowReports();

  const analyze = await postAnalyze(api.base);
  const runId = (analyze.payload.data as { runId: string }).runId;
  assert.ok(runId);

  const shadow = await fetch(`${api.base}/shadow/${runId}`);
  assert.equal(shadow.status, 200);
  const body = await shadow.json() as { success: boolean; data: { ts_run_id: string; status: string; summary: { total_cells: number }; rules: string[] } };
  assert.equal(body.success, true);
  assert.equal(body.data.ts_run_id, runId);
  assert.equal(body.data.status, 'completed');
  assert.ok(body.data.summary.total_cells > 0);
  assert.ok(body.data.rules.length > 0);

  const list = await fetch(`${api.base}/shadow`);
  const listBody = await list.json() as { success: boolean; data: { mode: string; runtime: { total: number }; reports: unknown[] } };
  assert.equal(listBody.data.mode, 'await');
  assert.equal(listBody.data.runtime.total, 1);
  assert.equal(listBody.data.reports.length, 1);

  if (previous === undefined) delete process.env.ARA_KERNEL_SHADOW;
  else process.env.ARA_KERNEL_SHADOW = previous;
});

test('shadow: an unknown run id is reported as not-ready instead of inventing a report', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve())));

  const response = await fetch(`${api.base}/shadow/run-does-not-exist`);
  assert.equal(response.status, 404);
  const body = await response.json() as { success: boolean; error: { code: string } };
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'SHADOW_NOT_READY');
});
