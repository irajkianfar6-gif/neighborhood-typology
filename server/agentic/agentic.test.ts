/** فریمورک ایجنتیک: قرارداد شاهد، اجراکنندهٔ ابزار، سیاست عامل‌ها، گراف استاندارد و سرور MCP */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-agentic-'));

test('JSON schema validator enforces types, required, enum, pattern and unknown properties', async () => {
  const { validate } = await import('./schema');
  const s = { type: 'object' as const, additionalProperties: false, required: ['a'], properties: { a: { type: 'integer' as const, minimum: 1 }, b: { enum: ['x', 'y'] }, c: { type: 'string' as const, pattern: '^[a-z]+$' } } };
  assert.deepEqual(validate(s, { a: 2, b: 'x', c: 'ok' }), []);
  assert.ok(validate(s, {}).some((e) => e.includes('/a')));
  assert.ok(validate(s, { a: 0 }).length);
  assert.ok(validate(s, { a: 1, b: 'z' }).length);
  assert.ok(validate(s, { a: 1, c: 'NO' }).length);
  assert.ok(validate(s, { a: 1, zz: 1 }).some((e) => e.includes('ناشناخته')));
});

test('evidence packets are valid, tamper-evident and flag shared covariates', async () => {
  const { layerValues } = await import('../official/tehranLayers');
  const { toEvidencePacket, validatePacket, independenceSummary } = await import('./evidencePacket');
  const vals = layerValues('tehran:m605');
  assert.ok(vals.length >= 3);
  const packets = vals.map((v) => toEvidencePacket(v, 'tehran:m605', 'agent:A3'));
  for (const p of packets) assert.deepEqual(validatePacket(p), [], p.indicator);
  const tampered = { ...packets[0], value: (packets[0].value ?? 0) + 1 };
  assert.ok(validatePacket(tampered).some((e) => e.startsWith('/hash')));
  const ind = independenceSummary(packets);
  const divar = ind.sharedGroups.find((g) => g.group === 'covariate:divar-housing-price');
  assert.ok(divar && divar.indicators.length >= 2, 'لایه‌های هم‌متغیر دیوار باید وابسته علامت بخورند');
  // قطعی بودن: بستهٔ یکسان → هش یکسان
  assert.equal(toEvidencePacket(vals[0], 'tehran:m605', 'agent:A3').hash, packets[0].hash);
});

test('tool catalog: every tool has schemas, annotations and at least one active agent', async () => {
  const { listTools, describeTool } = await import('./registry');
  const { AGENTS } = await import('./agents');
  const tools = listTools();
  assert.ok(tools.length >= 20);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const t of tools) {
    const d = describeTool(t);
    assert.equal(d.inputSchema.type, 'object'); assert.equal(d.outputSchema.type, 'object');
    assert.ok(d.description.length > 20);
    assert.ok(AGENTS.some((a) => a.id !== 'operator' && a.tools.includes(t.name)), `${t.name} هیچ عاملی ندارد`);
  }
});

test('tool executor enforces least privilege, input contract and unknown tools', async () => {
  const { callTool } = await import('./registry');
  const unknown = await callTool('nope', {});
  assert.equal(unknown.error?.code, 'UNKNOWN_TOOL');
  const forbidden = await callTool('run_analysis', { neighborhoodId: 'tehran:m605' }, { agentId: 'A13' });
  assert.equal(forbidden.error?.code, 'FORBIDDEN');
  const bad = await callTool('resolve_neighborhood', { name: 'ی' }, { agentId: 'A1' });
  assert.equal(bad.error?.code, 'INVALID_INPUT');
  const extra = await callTool('get_neighborhood_profile', { neighborhoodId: 'tehran:m605', hack: true }, { agentId: 'A1' });
  assert.equal(extra.error?.code, 'INVALID_INPUT');
  const nf = await callTool('get_neighborhood_profile', { neighborhoodId: 'tehran:zzz999' }, { agentId: 'A1' });
  assert.equal(nf.error?.code, 'NOT_FOUND');
  const okr = await callTool('resolve_neighborhood', { name: 'یوسف آباد', city: 'تهران' }, { agentId: 'A1' });
  assert.ok(okr.ok); assert.equal((okr.output!.best as { neighborhoodId: string }).neighborhoodId, 'tehran:m605');
  assert.match(okr.inputHash, /^sha256:/);
  const { listTrace } = await import('./trace');
  assert.ok(listTrace({ tool: 'run_analysis' }).some((t) => t.errorCode === 'FORBIDDEN'), 'رد دسترسی هم باید ثبت شود');
});

test('standard graph runs end-to-end offline with gates, critic, report and approvals', async () => {
  const { runStandardGraph, loadRun, decideApproval } = await import('./pipeline');
  const run = await runStandardGraph({ name: 'یوسف آباد', city: 'تهران', offline: true });
  assert.ok(['completed', 'blocked'].includes(run.status), `status=${run.status} ${JSON.stringify(run.steps.filter((s) => s.status === 'failed'))}`);
  assert.equal(run.neighborhoodId, 'tehran:m605');
  const tools = run.steps.map((s) => s.tool);
  for (const t of ['resolve_neighborhood', 'collect_evidence', 'assess_evidence', 'run_analysis', 'locate_bottleneck', 'test_hypotheses', 'assess_local_layers', 'map_interventions', 'verify_analysis', 'render_report']) assert.ok(tools.includes(t), t);
  assert.ok(run.steps.every((s) => s.status === 'done'), JSON.stringify(run.steps.filter((s) => s.status !== 'done')));
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5']) assert.ok(run.gates.some((x) => x.id === g), g);
  const critic = run.outputs.critic as { checks: Array<{ id: string; status: string }> };
  assert.equal(critic.checks.find((c) => c.id === 'C2')?.status, 'pass');
  assert.equal(critic.checks.find((c) => c.id === 'C8')?.status, 'pass');
  assert.equal(critic.checks.find((c) => c.id === 'C3')?.status, 'pass');
  assert.equal(critic.checks.find((c) => c.id === 'C7')?.status, 'warn', 'لایه‌های هم‌متغیر باید هشدار وابستگی بدهند');
  assert.match(run.outputs.report ?? '', /یوسف/);
  assert.ok((run.outputs.reproducibilityKey as Record<string, string>).interventionLibrary?.startsWith('IL-'));
  assert.ok(loadRun(run.runId));
  const pres = run.approvals.find((a) => a.kind === 'prescription');
  if (pres) {
    const after = decideApproval(run.runId, pres.id, 'approved', 'آزمون');
    assert.equal(after?.approvals.find((a) => a.id === pres.id)?.status, 'approved');
    assert.equal(after?.gates.find((g) => g.id === 'G6')?.status, 'passed');
  }
  // دومین اجرا با همان ورودی همان اثرانگشت را می‌دهد (تکرارپذیری)
  const again = await runStandardGraph({ neighborhoodId: 'tehran:m605', offline: true });
  assert.equal(again.analysisId, run.analysisId);
});

test('ambiguous names stop at G1 and ask the user', async () => {
  const { runStandardGraph } = await import('./pipeline');
  const run = await runStandardGraph({ name: 'مهرشهر', offline: true });
  assert.equal(run.status, 'needs_user');
  assert.equal(run.gates[0].status, 'blocked');
  assert.ok(run.approvals.some((a) => a.kind === 'neighborhood_choice'));
  assert.ok(!run.steps.some((s) => s.tool === 'run_analysis'));
});

test('MCP server: initialize, tools/list (filtered by agent), tools/call and notifications', async () => {
  const express = (await import('express')).default;
  const { createAgenticRouter } = await import('./router');
  const app = express(); app.use('/api/agentic', createAgenticRouter());
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agentic`;
  const rpc = (body: unknown, agent?: string) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(agent ? { 'x-ara-agent': agent } : {}) }, body: JSON.stringify(body) });
  try {
    const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json();
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.ok(init.result.capabilities.tools);
    const note = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(note.status, 202);
    const all = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    assert.ok(all.result.tools.length >= 20);
    const a13 = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, 'A13')).json();
    assert.deepEqual(a13.result.tools.map((t: { name: string }) => t.name), ['render_report']);
    const call = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'resolve_neighborhood', arguments: { name: 'یوسف آباد', city: 'تهران' } } })).json();
    assert.equal(call.result.isError, false);
    assert.equal(call.result.structuredContent.best.neighborhoodId, 'tehran:m605');
    const denied = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'run_analysis', arguments: { neighborhoodId: 'tehran:m605' } } }, 'A13')).json();
    assert.equal(denied.result.isError, true);
    const missing = await (await rpc({ jsonrpc: '2.0', id: 6, method: 'nope' })).json();
    assert.equal(missing.error.code, -32601);
    const rest = await (await fetch(`${base}/tools`)).json();
    assert.ok(rest.success && rest.data.length >= 20);
    const forbid = await fetch(`${base}/tools/run_analysis/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: 'A2', input: { neighborhoodId: 'tehran:m605' } }) });
    assert.equal(forbid.status, 403);
  } finally { server.close(); }
});
