import assert from 'node:assert/strict';
import test from 'node:test';
import { bulkTemplateCsv, parseSurveyCsv } from './surveyBulk';
import { ALL_ITEMS, LIKERT_CODES } from './surveyInstrument';
import { LIKERT_ITEMS } from '../../server/survey/perceptualSurvey';

test('frontend instrument and server validation use the same Likert items', () => {
  assert.deepEqual([...LIKERT_CODES].sort(), [...LIKERT_ITEMS].sort());
  assert.equal(new Set(ALL_ITEMS.map((i) => i.code)).size, ALL_ITEMS.length);
});

test('bulk CSV template round-trips and Persian labels/digits are mapped', () => {
  const t = parseSurveyCsv(bulkTemplateCsv());
  assert.equal(t.rows.length, 1);
  assert.equal(t.issues.filter((i) => i.level === 'error').length, 0);
  const tsv = ['consent\tsex\tage_band\tduration_sec\tE2\tE3\tS3X\tEMP', 'بله\tزن\t۱۸-۲۹\t۳۰۰\t۵\t۴\tخیر\t۲', 'بله\tمرد\t30-44\t300\t9\t4\tشاید\t1'].join('\n');
  const r = parseSurveyCsv(tsv);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0].answers, { E2: 5, E3: 4, S3X: 0, EMP: 2 });
  assert.equal(r.rows[0].demographics.sex, 'female');
  assert.equal(r.rows[0].demographics.ageBand, '18-29');
  assert.ok(r.issues.some((i) => i.row === 3 && i.level === 'error'));
  assert.ok(r.issues.some((i) => i.row === 2 && i.level === 'warning'), 'کمتر از ۸ گویه باید هشدار بدهد');
});
