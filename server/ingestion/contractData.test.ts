import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CONTRACT_COLUMNS, approvedValuesFor, createBatch, reviewBatch, validateContractCsv } from './contractData';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-contract-'));
const header = CONTRACT_COLUMNS.join(',');
const row = (o: Partial<Record<typeof CONTRACT_COLUMNS[number], string>>) => CONTRACT_COLUMNS.map((c) => o[c] ?? '').join(',');

test('valid rows pass; unknown neighborhoods, PII and out-of-range values are caught', () => {
  const good = validateContractCsv([header, row({ indicator_code: 'H2', neighborhood_id: 'tehran:m605', numerator: '820', denominator: '1000', value: '82', unit: '%', period_end: '2025-09-30', source_org: 'آموزش و پرورش' })].join('\n'));
  assert.equal(good.issues.filter((i) => i.severity === 'error').length, 0);
  assert.equal(good.rows.length, 1);

  const bad = validateContractCsv([header,
    row({ indicator_code: 'H2', neighborhood_id: 'nowhere:x1', value: '82', period_end: '2025-09-30', source_org: 'x' }),
    row({ indicator_code: 'H2', neighborhood_id: 'tehran:m605', value: '182', period_end: '2025-09-30', source_org: 'x' }),
    row({ indicator_code: 'H2', neighborhood_id: 'tehran:m605', value: '50', period_end: '2025-09-30', source_org: '09121234567' }),
  ].join('\n'));
  assert.ok(bad.issues.filter((i) => i.severity === 'error').length >= 3, JSON.stringify(bad.issues));
});

test('values are only used after an explicit approval', () => {
  const csv = [header, row({ indicator_code: 'G1', neighborhood_id: 'tehran:m605', numerator: '45', denominator: '100', value: '45', unit: '%', period_end: '2025-06-30', source_org: 'شهرداری منطقه ۶' })].join('\n');
  const batch = createBatch(csv, 'municipality', 'tester');
  assert.equal(batch.status, 'PENDING_REVIEW');
  assert.equal(approvedValuesFor('tehran:m605').length, 0);
  reviewBatch(batch.batchId, 'reviewer', 'APPROVED');
  const approved = approvedValuesFor('tehran:m605');
  assert.equal(approved.length, 1);
  assert.equal(approved[0].indicator_code, 'G1');
});
