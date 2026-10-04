import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { buildDecisionSupportRouter } from './decisionSupportRouter';
import * as connectors from '../src/algorithm/realDataConnectors';
import { stopKernelService } from './kernelClient';

// موتور kernel در برخی مسیرها به‌صورت فرزند اجرا می‌شود؛ بدون توقف، فرایند تست باز می‌ماند
test.after(stopKernelService);

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

test('client no longer exposes the heuristic indicator synthesizer', () => {
  // نگاشت شمارش POI/شاخص ملی به امتیاز محله حذف شد (ساخت عدد بدون پشتوانه)
  assert.equal('combineToAlgorithmIndicators' in connectors, false);
});

test('rejects empty and unknown indicator payloads', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve())));

  const empty = await fetch(`${api.base}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ neighborhoodName: 'نوغان', indicatorValues: {} }),
  });
  assert.equal(empty.status, 422);
  assert.equal((await empty.json() as { error: { code: string } }).error.code, 'INSUFFICIENT_EVIDENCE');

  const unknown = await fetch(`${api.base}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ neighborhoodName: 'نوغان', indicatorValues: { TEST_01: 50 } }),
  });
  assert.equal(unknown.status, 422);
  assert.equal((await unknown.json() as { error: { code: string } }).error.code, 'INVALID_INDICATOR_VALUES');
});

test('analyzes measured values through the HTTP API without filling missing indicators', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve())));
  const indicatorValues = { H1: 80, H3: 72, S1: 70, S2: 64, E1: 60, P1: 65, P4: 58, N1: 55, C1: 75, G1: 50, R1: 68 };

  const response = await fetch(`${api.base}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ neighborhoodName: 'نوغان', purpose: 'baseline', indicatorValues }),
  });
  assert.equal(response.status, 200);
  // قرارداد فعلی analyze: { success, data: { runId, card } } — کارت زیر data.card قرار دارد.
  const payload = await response.json() as { success: boolean; data: { runId: string; card: { neighborhoodName: string; capitalScores: Array<{ capitalKey: string; indicatorCount: number }> } } };
  assert.equal(payload.success, true);
  assert.ok(payload.data.runId, 'analyze must return a runId');
  assert.equal(payload.data.card.neighborhoodName, 'نوغان');
  assert.deepEqual(payload.data.card.capitalScores.map((capital) => [capital.capitalKey, capital.indicatorCount]), [
    ['H', 2], ['S', 2], ['E', 1], ['P', 2], ['N', 1], ['C', 1], ['G', 1], ['R', 1],
  ]);
});

test('exposes the 164-indicator registry and its summary', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve())));

  const registry = await fetch(`${api.base}/registry`);
  assert.equal(registry.status, 200);
  const payload = await registry.json() as {
    data: {
      metadata: { indicator_count: number; core_indicator_count: number; version: string };
      summary: { indicator_count: number; core_indicator_count: number; by_engine: Record<string, number> };
    };
  };
  assert.equal(payload.data.metadata.indicator_count, 164);
  assert.equal(payload.data.metadata.core_indicator_count, 40);
  assert.equal(payload.data.summary.indicator_count, 164);
  assert.ok(payload.data.metadata.version.startsWith('sha256:'));

  const coreOnly = await fetch(`${api.base}/registry/indicators?core=true&engine=${encodeURIComponent('سنجش')}`);
  const corePayload = await coreOnly.json() as { data: { count: number; rows: Array<{ isCore: boolean; engine: string }> } };
  assert.ok(corePayload.data.count > 0);
  assert.ok(corePayload.data.rows.every((row) => row.isCore && row.engine === 'سنجش'));
});

test('evidence assessment does not publish a card without eligible measurements', async (context) => {
  const api = await startServer();
  context.after(() => new Promise<void>((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve())));

  const response = await fetch(`${api.base}/evidence/assess`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ neighborhoodName: 'نوغان', observations: [] }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: { status: string; card: unknown; coverage: { publishable: boolean; gateFailures: string[] }; missingIndicators: unknown[] };
  };
  assert.equal(payload.data.card, null);
  assert.equal(payload.data.coverage.publishable, false);
  assert.ok(payload.data.coverage.gateFailures.length > 0);
  assert.ok(payload.data.missingIndicators.length > 0);
});
