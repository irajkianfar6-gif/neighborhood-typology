/** DISAGG-v1: برآورد شفاف منطقه → محله برای شمارشی‌ها؛ جمع ثابت، برچسب مدل‌محور، تأیید کارشناس */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-disagg-'));

test('apportion keeps the exact total', async () => {
  const { apportion } = await import('./research/disaggregate');
  const out = apportion(1001, [1, 1, 1]);
  assert.equal(out.reduce((a, b) => a + b, 0), 1001);
  assert.deepEqual(apportion(10, [3, 1]), [8, 2]);
});

test('rates are never disaggregated; counts use area weights only with real boundaries', async () => {
  const { estimateFromDistrict } = await import('./research/disaggregate');
  assert.throws(() => estimateFromDistrict({ city: 'تهران', district: 6, code: 'E1', value: 40, periodEnd: '2021-10', sourceOrg: 'x' }), /شمارشی نیست/);
  const r = estimateFromDistrict({ city: 'تهران', district: 6, code: 'POP', value: 251384, periodEnd: '2021-10', sourceOrg: 'مرکز آمار' });
  assert.equal(r.status, 'DRY_RUN'); assert.equal(r.batchId, null);
  assert.equal(r.method, 'area'); assert.equal(r.reliability, 'very_low');
  assert.ok(r.estimates.length >= 5);
  assert.equal(r.estimates.reduce((a, x) => a + x.estimate, 0), 251384);
  for (const x of r.estimates) assert.ok(x.low <= x.estimate && x.estimate <= x.high);
  assert.match(r.label, /برآورد مدل‌محور/); assert.match(r.label, /سرشماری محله نیست/);
  assert.ok(r.tried.some((t) => t.method === 'prior_share' && !t.ok));
});

test('expert approval path: estimate batch is pending, labeled estimated, and prior shares win when available', async () => {
  const { estimateFromDistrict } = await import('./research/disaggregate');
  const { createBatch, reviewBatch, approvedValuesFor, getBatch, CONTRACT_COLUMNS } = await import('../ingestion/contractData');
  const dry = estimateFromDistrict({ city: 'تهران', district: 6, code: 'POP', value: 250000, periodEnd: '2021-10', sourceOrg: 'مرکز آمار' });
  const ids = dry.estimates.map((x) => x.neighborhoodId);
  // دادهٔ سطح محلهٔ دورهٔ پیشین (۱۳۹۵) برای همهٔ محله‌ها: سهم‌ها از این می‌آیند
  const lines = ids.map((id, i) => CONTRACT_COLUMNS.map((k) => ({ indicator_code: 'POP', neighborhood_id: id, value: String(1000 * (i + 1)), unit: 'count', period_end: '2016-10', source_org: 'مرکز آمار' } as Record<string, string>)[k] ?? '').join(','));
  const prior = createBatch([CONTRACT_COLUMNS.join(','), ...lines].join('\n') + '\n', 'test', 'tester');
  reviewBatch(prior.batchId, 'expert', 'APPROVED');
  const r = estimateFromDistrict({ city: 'تهران', district: 6, code: 'POP', value: 250000, periodEnd: '2021-10', sourceOrg: 'مرکز آمار', dryRun: false });
  assert.equal(r.method, 'prior_share'); assert.equal(r.reliability, 'medium');
  assert.equal(r.status, 'PENDING_EXPERT'); assert.ok(r.batchId);
  const total = ids.reduce((a, _, i) => a + (i + 1), 0);
  assert.ok(Math.abs(r.estimates[0].estimate - 250000 / total) <= 1);
  const b = getBatch(r.batchId!)!;
  assert.equal(b.status, 'PENDING_REVIEW');
  assert.ok(b.rows.every((x) => x.geography_level === 'estimated'));
  assert.ok(b.issues.some((x) => x.code === 'MODEL_ESTIMATE'));
  // پیش از تأیید، برآورد دیده نمی‌شود؛ پس از تأیید با برچسب «estimated»
  assert.equal(approvedValuesFor(ids[0]).find((v) => v.indicator_code === 'POP')!.period_end, '2016-10');
  reviewBatch(r.batchId!, 'expert', 'APPROVED');
  const v = approvedValuesFor(ids[0]).find((x) => x.indicator_code === 'POP')!;
  assert.equal(v.geography_level, 'estimated'); assert.match(v.dataset_id ?? '', /^estimate:DISAGG-v1:prior_share:/);
});

test('contract channel marks approved estimates as model-based with lower method quality', async () => {
  const { createBatch, reviewBatch, CONTRACT_COLUMNS } = await import('../ingestion/contractData');
  const { contractValues } = await import('../neighborhood/channels');
  const row = { indicator_code: 'E1', neighborhood_id: 'tehran:m605', value: '30', unit: '%', period_end: '2021-10', source_org: 'آزمون', dataset_id: 'estimate:DISAGG-v1:covariate:est_t' } as Record<string, string>;
  const b = createBatch([CONTRACT_COLUMNS.join(','), CONTRACT_COLUMNS.map((k) => row[k] ?? '').join(',')].join('\n') + '\n', 'test', 'tester');
  reviewBatch(b.batchId, 'expert', 'APPROVED');
  const e1 = contractValues('tehran:m605').values.find((v) => v.code === 'E1');
  assert.ok(e1); assert.equal(e1.tier, 'open_model'); assert.equal(e1.methodQuality, 0.5); assert.match(e1.method, /برآورد مدل‌محور/);
});
