/** دادهٔ رسمی تهران: مرجع منطقه، معیار درآمد، بستهٔ جمعیت محله‌ای و ماژول اقتصادی پرسشنامه */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-official-'));

test('district reference: census 1395, CPI and HEIS income benchmark', async () => {
  const { tehranReference, districtPopulation, districtProfile, cpiAt, incomeBenchmark, tehranDistrictOf } = await import('./tehranReference');
  assert.ok(tehranReference());
  assert.equal(tehranDistrictOf('tehran:m605'), 6);
  assert.equal(tehranDistrictOf('karaj:m1'), null);
  const p12 = districtPopulation(12);
  assert.ok(p12 && p12 > 200_000 && p12 < 300_000);
  const cpi = cpiAt('1400-06');
  assert.ok(cpi && cpi.value > 80 && cpi.value < 120, 'شاخص ۱۴۰۰ حول ۱۰۰');
  const b = incomeBenchmark('2025-06-01');
  assert.ok(b && b.monthlyMToman > 40 && b.monthlyMToman < 70);
  // تعدیل تورمی: معیار بعدی بزرگ‌تر یا مساوی
  const later = incomeBenchmark('2026-03-01');
  assert.ok(later && later.monthlyMToman >= b.monthlyMToman);
  const d6 = districtProfile(6)!;
  assert.equal(d6.level, 'district');
  assert.ok(d6.population.census1395 && d6.population.census1395.pop > 0);
  assert.ok(d6.housing.latest && d6.housing.latest.rank >= 1 && d6.housing.latest.rank <= 22);
  assert.ok(d6.housing.priceToIncomeYears && d6.housing.priceToIncomeYears.value > d6.housing.priceToIncomeYears.unitM2 / 100);
  // منطقهٔ ۱ گران‌تر از منطقهٔ ۱۸
  assert.ok(districtProfile(1)!.housing.latest!.priceMRialPerM2 > districtProfile(18)!.housing.latest!.priceMRialPerM2);
  assert.equal(districtProfile(99), null);
});

test('official neighborhood population pack passes the data contract', async () => {
  const { readOfficialPack, listOfficialPacks } = await import('./tehranReference');
  const { validateContractCsv, populationConsistency } = await import('../ingestion/contractData');
  const packs = listOfficialPacks();
  assert.ok(packs.some((p) => p.id === 'tehran-pop-1395' && p.rows > 250));
  const { text } = readOfficialPack('tehran-pop-1395')!;
  const { rows, issues } = validateContractCsv(text);
  assert.equal(issues.filter((i) => i.severity === 'error').length, 0, JSON.stringify(issues.slice(0, 3)));
  assert.ok(rows.length > 250);
  assert.equal(populationConsistency(rows).length, 0, 'مجموع محلات نباید از جمعیت منطقه بیشتر شود');
});

test('count variables are rejected at district level; inflated populations warn', async () => {
  const { validateContractCsv, populationConsistency, CONTRACT_COLUMNS } = await import('../ingestion/contractData');
  const line = (o: Record<string, string>) => CONTRACT_COLUMNS.map((c) => o[c] ?? '').join(',');
  const head = CONTRACT_COLUMNS.join(',');
  const d = validateContractCsv([head, line({ indicator_code: 'POP', value: '250000', unit: 'نفر', period_end: '2016-09-22', source_org: 'test', district: 'tehran:6' })].join('\n'));
  assert.ok(d.issues.some((i) => i.code === 'DISTRICT_COUNT'));
  const big = validateContractCsv([head, line({ indicator_code: 'POP', neighborhood_id: 'tehran:m605', value: '900000', unit: 'نفر', period_end: '2016-09-22', source_org: 'test' })].join('\n'));
  assert.ok(populationConsistency(big.rows).some((i) => i.code === 'POP_EXCEEDS_DISTRICT'));
});

test('economy module: E4 housing burden, E1 income ratio, H1/H5 and number QC', async () => {
  const { addResponses, summarizeSurvey } = await import('../survey/perceptualSurvey');
  const NB = 'tehran:m601';
  const likert = (i: number) => Object.fromEntries(['C1', 'C2', 'C3', 'A1', 'A2', 'A3', 'U1', 'U2', 'U3', 'E1', 'E2', 'E3'].map((c, k) => [c, ((i + k) % 5) + 1]));
  const resp = (i: number) => ({
    durationSec: 300, consent: true, mode: 'interviewer' as const, collectorId: 'e1', collectedAt: '2025-06-01T08:00:00Z',
    answers: { ...likert(i), EDU: (i % 5) + 1, H5X: i % 2, INC: 40, RENT: 10, DEPOSIT: i % 2 ? 100 : 0, HHSIZE: 3, AREA: 80 },
    demographics: { sex: (i % 2 ? 'male' : 'female') as 'male' | 'female', ageBand: '30-44' as const, tenure: 'renter' as const },
  });
  const stored = addResponses(NB, [...Array.from({ length: 40 }, (_, i) => resp(i)), { ...resp(99), answers: { ...resp(99).answers, INC: -5 } }]);
  assert.deepEqual(stored.at(-1)!.qc.reasons, ['INVALID_NUMBER']);
  const s = summarizeSurvey(NB, {}, { incomeBenchmark: () => ({ monthlyMToman: 50, month: '1404-03', basis: 'test' }) });
  const by = Object.fromEntries(s.indicators.map((x) => [x.code, x]));
  // اجاره ۱۰ + ۳٪ ودیعه (۰ یا ۱۰۰) → ۱۰ یا ۱۳ از ۴۰ = ۲۵٪ یا ۳۲٫۵٪
  assert.ok(by.E4 && by.E4.score >= 25 && by.E4.score <= 32.5);
  assert.equal(by.E4.n, 40);
  assert.equal(by.E1.score, 0.8);
  assert.ok(by.H1 && by.H5);
  assert.equal(by.H5.score, 50);
  assert.equal(s.economy.incomeN, 40);
  assert.equal(s.economy.medianIncomeMToman, 40);
  assert.equal(s.economy.tenure.renter, 40);
});

test('bulk CSV parses numeric economy columns with Persian digits', async () => {
  const { parseSurveyCsv } = await import('../../src/algorithm/surveyBulk');
  const head = 'consent,sex,age_band,tenure,duration_sec,C1,C2,A1,A2,U1,U2,E2,E3,INC,RENT,DEPOSIT';
  const r = parseSurveyCsv([head, 'بله,زن,30-44,مستأجر,300,1,2,3,4,5,1,2,3,۴۵٫۵,12,500'].join('\n'));
  assert.equal(r.rows.length, 1, JSON.stringify(r.issues));
  assert.equal(r.rows[0].answers.INC, 45.5);
  assert.equal(r.rows[0].answers.DEPOSIT, 500);
});
