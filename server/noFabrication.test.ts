/**
 * تست‌های «عدم ساخت عدد»: هیچ مسیر کد نباید مقدار محله را از جانشین ملی/استانی، شمارش POI
 * با ضریب دلبخواه یا مقدار تصادفی بسازد؛ نبود داده باید به «امتناع» برسد نه عدد.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkIndicatorGeography } from './decisionSupportRouter';
import { PROJECT_ROOT } from './paths';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-nofab-'));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'data', 'dist'].includes(e.name)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

test('national/province/city values are rejected as neighborhood indicators', () => {
  assert.match(checkIndicatorGeography({ H1: 'national' }) ?? '', /cannot be used/);
  assert.match(checkIndicatorGeography({ G2: 'province' }) ?? '', /cannot be used/);
  assert.match(checkIndicatorGeography({ E1: 'city' }) ?? '', /cannot be used/);
  assert.equal(checkIndicatorGeography({ P4: 'neighborhood', S1: 'block' }), undefined);
  assert.equal(checkIndicatorGeography(undefined), undefined);
});

test('the heuristic synthesizer is gone from the client and server code', () => {
  const files = [...walk(path.join(PROJECT_ROOT, 'src')), ...walk(path.join(PROJECT_ROOT, 'server'))];
  const offenders = files.filter((f) => /combineToAlgorithmIndicators\s*\(/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(PROJECT_ROOT, f)), []);
});

test('evidence pipeline modules never use random numbers', () => {
  const dirs = ['server/neighborhood', 'server/evidence', 'server/ingestion', 'server/survey'].map((d) => path.join(PROJECT_ROOT, d));
  const offenders = dirs.flatMap((d) => walk(d)).filter((f) => /Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(PROJECT_ROOT, f)), []);
});

test('with no reachable data the by-name pipeline abstains instead of inventing values', async () => {
  const { analyzeByName } = await import('./neighborhood/orchestrator');
  const result = await analyzeByName({ name: 'یوسف آباد', city: 'تهران', offline: true, useKernel: false });
  assert.ok('card' in result, 'یوسف‌آباد باید resolve شود');
  if (!('card' in result)) return;
  const { card } = result;
  assert.equal(card.schema, 'ara.decision-card.v2');
  assert.equal(card.neighborhood.neighborhoodId, 'tehran:m605');
  assert.equal(card.publication.level, 'INSUFFICIENT');
  assert.equal(card.engine, null, 'موتور نباید روی شواهد ناکافی اجرا شود');
  assert.equal(result.engineCard, null);
  for (const ind of card.indicators) {
    if (ind.score === null) {
      assert.ok(ind.missingReason, `${ind.code}: نبود داده باید دلیل داشته باشد`);
    } else {
      assert.notEqual(ind.source, '—', `${ind.code}: مقدار بدون منبع`);
      assert.ok(!/national|world bank|WHO|UNESCO/i.test(ind.source), `${ind.code}: منبع ملی وارد امتیاز محله شده`);
    }
  }
  assert.ok(card.whatWouldChangeThis.length > 0, 'فهرست دادهٔ لازم باید پر باشد');
  assert.ok(card.abstentions.some((a) => a.section === 'engine' || a.section === 'diagnosticType'));
});
