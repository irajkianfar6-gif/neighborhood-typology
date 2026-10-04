import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { buildKernelRouter } from './kernelRouter';
import { stopKernelService } from './kernelClient';
import { loadPilotArtifacts, compareWithPilot, loadPilotBoundary } from './kernelShadow';
import { mappingSummary, buildKernelRecord, classifyEvidenceStream } from './indicatorMapping';
import {
  isNumericStatus, numericOrNull, collectAbstentions, gateAllowsNumericPublishing,
  type KernelRunResult,
} from './kernelTypes';

// فرایند kernel که تست‌ها خودکار راه‌اندازی می‌کنند باید بسته شود؛ وگرنه node --test هرگز خارج نمی‌شود.
test.after(async () => { await stopKernelService(); });

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/kernel', buildKernelRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/kernel` };
}

test('contract: missing status never carries a number (never zeroed)', () => {
  assert.equal(isNumericStatus('OBSERVED'), true);
  assert.equal(isNumericStatus('PROXY'), true);
  assert.equal(isNumericStatus('ESTIMATED'), true);
  for (const s of ['MISSING', 'INVALID', 'PENDING_VALIDATION', 'WAITING_FOR_DATA', 'ACCESS_REQUIRED', 'SOURCE_UNAVAILABLE']) {
    assert.equal(isNumericStatus(s), false, s);
    assert.equal(numericOrNull(s, 42), null, `${s} must not carry a number`);
    assert.equal(numericOrNull(s, 0), null, `${s} must never become 0`);
  }
  assert.equal(numericOrNull('OBSERVED', 42.5), 42.5);
});

test('pilot artifacts are present and gate decision is CONDITIONAL PASS', () => {
  const art = loadPilotArtifacts();
  assert.equal(art.available, true, `pilot artifacts missing in ${art.artifactDir}`);
  assert.equal((art.gate_report as any)?.D_gate_decision, 'CONDITIONAL PASS');
  assert.equal((art.neighborhood_result?.indicators?.length ?? 0) > 0, true);
});

test('health endpoint reaches the live kernel service', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((e) => e ? reject(e) : resolve())));

  const res = await fetch(`${api.base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; kernel: { engine: { stages: string[] }; gate_summary: { pilot_gate_decision: string } } };
  assert.equal(body.ok, true);
  assert.equal(body.kernel.engine.stages.length, 16);
  assert.equal(body.kernel.gate_summary.pilot_gate_decision, 'CONDITIONAL PASS');
});

test('live calculation run: gate blocks numeric publishing + shadow match with pilot', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((e) => e ? reject(e) : resolve())));

  const res = await fetch(`${api.base}/calculation-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data_version: 'pilot-D6-2026-09-02' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as {
    fingerprint: string; publish_gate: { can_publish_numeric_scores: boolean; reasons: string[] };
    can_publish_numeric_scores: boolean; shadow_comparison: { matched: boolean; fields: unknown[] };
    abstentions: Array<{ field: string; status: string; reason: string | null }>; result: KernelRunResult;
  };
  assert.match(body.fingerprint, /^sha256:/);
  // Phase-0 architecture decision: uncalibrated W/T ⇒ numbers may NOT be published
  assert.equal(body.publish_gate.can_publish_numeric_scores, false);
  assert.equal(body.can_publish_numeric_scores, false);
  assert.ok(body.publish_gate.reasons.length >= 2, 'gate must cite W and T calibration');
  // shadow mode: identical inputs + versions ⇒ identical fingerprint as the real pilot artifact
  assert.equal(body.shadow_comparison.matched, true, JSON.stringify(body.shadow_comparison.fields));
  // every abstention carries a reason (acceptance test: پاسخ API علت هر abstention را دارد)
  assert.ok(body.abstentions.length > 0);
  for (const a of body.abstentions) {
    assert.ok(a.status, 'abstention status present');
    assert.ok((a.reason ?? '').length > 0 || (a.field === 'bottleneck'), `abstention ${a.field} needs a reason`);
  }
  // missing never zeroed in the live result
  for (const agg of [body.result.aggregates.capitals, body.result.aggregates.caueo, body.result.aggregates.qtr]) {
    for (const v of Object.values(agg)) {
      if (v.value === 0) assert.equal(v.status, 'OBSERVED', 'zero only when truly OBSERVED');
    }
  }
});

test('drilldown endpoint serves the 10-level provenance chain', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((e) => e ? reject(e) : resolve())));

  const runRes = await fetch(`${api.base}/calculation-runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data_version: 'pilot-D6-2026-09-02' }),
  });
  const run = await runRes.json() as { run_id: string; result: KernelRunResult };
  const vid = run.result.indicators[0].raw.provenance_value_id;

  const dd = await fetch(`${api.base}/calculation-runs/${encodeURIComponent(run.run_id)}/drilldown/${encodeURIComponent(vid)}`);
  assert.equal(dd.status, 200);
  const body = await dd.json() as { chain_levels: string[]; drilldown: { source: { source_name: string | null }; qc: { quality_score: number | null }; confidence: { level: string } | null } };
  assert.equal(body.chain_levels.length, 10);
  assert.ok(body.drilldown.source, 'drilldown includes the source level');
  assert.ok(body.drilldown.confidence, 'drilldown includes confidence');
  assert.ok('quality_score' in body.drilldown.qc);

  const missing = await fetch(`${api.base}/calculation-runs/${encodeURIComponent(run.run_id)}/drilldown/VAL-NOPE`);
  assert.equal(missing.status, 404);
});

test('boundary endpoint serves labeled proxy with provenance and abstains for unknown', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((e) => e ? reject(e) : resolve())));

  const res = await fetch(`${api.base}/gis/boundaries/IR-THR-D6`);
  assert.equal(res.status, 200);
  const b = await res.json() as { is_proxy: boolean; is_official: boolean; provenance: Record<string, unknown>; geometry_geojson: { type: string } | null };
  assert.equal(b.is_proxy, true);
  assert.equal(b.is_official, false);
  assert.ok(Object.keys(b.provenance).length > 0, 'boundary without provenance is rejected');

  const unknown = await fetch(`${api.base}/gis/boundaries/UNKNOWN-XYZ`);
  assert.equal(unknown.status, 404);
  const ue = await unknown.json() as { error: { code: string } };
  assert.equal(ue.error.code, 'SOURCE_UNAVAILABLE');
});

test('weight override changes the fingerprint (versioning contract)', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((e) => e ? reject(e) : resolve())));

  const mk = async (weight_override?: Record<string, number>) => {
    const r = await fetch(`${api.base}/calculation-runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data_version: 'pilot-D6-2026-09-02', ...(weight_override ? { weight_override } : {}) }),
    });
    return (await r.json()) as { fingerprint: string; calculation_version_id: string };
  };
  const base = await mk();
  const mod = await mk({ 'PHY-003': 7.0 });
  assert.notEqual(mod.fingerprint, base.fingerprint);
  assert.notEqual(mod.calculation_version_id, base.calculation_version_id);
  // rerun reproduces byte-identical
  const again = await mk();
  assert.equal(again.fingerprint, base.fingerprint);
});

test('mapping: every TS core_40 code resolves to a defensible kernel code + evidence streams', () => {
  const s = mappingSummary();
  assert.equal(s.total, 40);
  assert.equal(s.mapped, 40, `unmapped: ${s.unmapped.join(',')}`);
  // known defensible links
  const h1 = buildKernelRecord({ code: 'H1', value: 72 });
  assert.equal(h1.mapping.kernel_code, 'BEH-127');
  assert.deepEqual(classifyEvidenceStream('H1'), ['perceptual', 'behavioral']);
  assert.deepEqual(classifyEvidenceStream('N1'), ['gis', 'objective']);
  // unknown code abstains honestly
  const zz = buildKernelRecord({ code: 'ZZ9', value: 1 });
  assert.equal(zz.record, null);
  assert.equal(zz.mapping.confidence, 'unmapped');
});

test('analyze endpoint runs TS payload through the kernel with mapping transparency', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((e) => e ? reject(e) : resolve())));

  const res = await fetch(`${api.base}/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data_version: 'analyze-smoke',
      indicatorValues: { H1: 72, S2: 64, P1: 58, ZZ9: 10 },
      groupValues: { H1: { 'کم‌درآمد': 55, 'پرم درآمد': 85 } },
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as {
    fingerprint: string; unmapped_count: number; mappings: Array<{ ts_code: string; kernel_code: string | null }>;
    publish_gate: { can_publish_numeric_scores: boolean };
    result: { indicators: Array<{ raw: { provenance_value_id: string; evidence_stream: string[] } }> };
  };
  assert.match(body.fingerprint, /^sha256:/);
  assert.equal(body.unmapped_count, 1, 'ZZ9 must be reported as unmapped');
  const h1 = body.mappings.find((m) => m.ts_code === 'H1');
  assert.equal(h1?.kernel_code, 'BEH-127');
  // group records present for equity (H1 groups)
  const vids = body.result.indicators.map((p) => p.raw.provenance_value_id);
  assert.ok(vids.includes('VAL-TS-H1-G-کم‌درآمد'), 'group-disaggregated record present');
  assert.ok(vids.includes('VAL-TS-H1'));
  // numbers stay unpublished (W/T uncalibrated)
  assert.equal(body.publish_gate.can_publish_numeric_scores, false);
});

test('analyze rejects empty/invalid payloads without fabricating', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((e) => e ? reject(e) : resolve())));

  const empty = await fetch(`${api.base}/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ indicatorValues: {} }),
  });
  assert.equal(empty.status, 422);
  const bad = await fetch(`${api.base}/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ indicatorValues: { H1: 'abc' } }),
  });
  assert.equal(bad.status, 422);
  const be = await bad.json() as { error: { code: string } };
  assert.equal(be.error.code, 'INVALID_INPUT');

  const allUnknown = await fetch(`${api.base}/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ indicatorValues: { ZZ9: 5, YY8: 6 } }),
  });
  assert.equal(allUnknown.status, 422);
  const ae = await allUnknown.json() as { error: { code: string } };
  assert.equal(ae.error.code, 'INSUFFICIENT_COVERAGE');
});

test('kernel boundary POST guards provenance (via analyze path the service test covers it directly)', () => {
  // boundary POST guard is exercised end-to-end in kernel/service/test_kernel_service.py;
  // here we pin the TS-side contract: boundary loader never fabricates for unknown ids
  const local = loadPilotBoundary('UNKNOWN-XYZ');
  assert.equal(local, null);
});

test('compareWithPilot matches a live result against the real pilot artifact', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((e) => e ? reject(e) : resolve())));

  const res = await fetch(`${api.base}/calculation-runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data_version: 'pilot-D6-2026-09-02' }),
  });
  const body = await res.json() as { result: KernelRunResult };
  const cmp = compareWithPilot(body.result);
  assert.equal(cmp.matched, true, JSON.stringify(cmp.fields));
});
