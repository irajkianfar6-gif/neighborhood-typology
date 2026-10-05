/** گردآوری دادهٔ پیمایشی: ماژول خانوار، ثبت‌های محلی، برنامهٔ گردآوری و ورود به کارت تصمیم */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-collect-'));

const NB = 'tehran:m605';
const ages = ['18-29', '30-44', '45-64', '65+'] as const;

function response(i: number) {
  const v = (k: number) => ((i + k) % 5) + 1; // پاسخ متنوع و قطعی
  const answers: Record<string, number> = {};
  for (const [k, c] of ['C1', 'C2', 'C3', 'A1', 'A2', 'A3', 'U1', 'U2', 'U3', 'E1', 'E2', 'E3', 'O1', 'O2', 'O3', 'C3X'].entries()) answers[c] = v(k);
  answers.S3X = i % 2;
  answers.EMP = (i % 4) + 1;
  answers.H2X = i % 3 === 0 ? 0 : 1;
  answers.H4X = i % 2;
  answers.S4X = i % 5 === 0 ? 1 : 0;
  answers.C4X = i % 4 === 0 ? 1 : 0;
  answers.C5X = i % 2;
  return { durationSec: 240, consent: true, answers, demographics: { sex: (i % 2 ? 'male' : 'female') as 'male' | 'female', ageBand: ages[i % 4], tenure: 'owner' as const }, mode: 'interviewer' as const, collectorId: 'enum-1', followUps: i < 3 ? { E1: 'کوچهٔ پشت مدرسه تاریک است' } : undefined };
}

test('household module estimates H2/H3/H4/S4/C4/C5 only for eligible respondents', async () => {
  const { addResponses, summarizeSurvey, MIN_ELIGIBLE } = await import('../survey/perceptualSurvey');
  const stored = addResponses(NB, Array.from({ length: 160 }, (_, i) => response(i)));
  assert.equal(stored.filter((s) => s.qc.accepted).length, 160);
  const s = summarizeSurvey(NB);
  const by = Object.fromEntries(s.indicators.map((x) => [x.code, x]));
  for (const c of ['S1', 'S2', 'S3', 'C3', 'H2', 'H3', 'S4', 'C4', 'C5']) assert.ok(by[c], `${c} باید برآورد شود`);
  // H3: شاغل بیمه‌دار ÷ (شاغل + بیکار) — EMP=1,2,3 هر کدام ۴۰ نفر → ۳۳٫۳٪
  assert.equal(by.H3.n, 120);
  assert.equal(by.H3.score, 33.3);
  // C5 فقط جوانان ۱۸–۲۹
  assert.equal(by.C5.n, 40);
  assert.equal(by.H2.module, 'household');
  assert.equal(by.H2.unit, '%');
  // H4 فقط شاغلان ماهر؛ اگر کمتر از ۳۰ باشد در pending می‌ماند
  const h4n = Array.from({ length: 160 }, (_, i) => response(i)).filter((r) => r.answers.H2X === 1 && [1, 2].includes(r.answers.EMP)).length;
  if (h4n < MIN_ELIGIBLE) assert.ok(s.pending.some((p) => p.code === 'H4'));
  else assert.ok(by.H4);
  assert.ok(s.chainProfile.CAPACITY && s.chainProfile.OUTCOME);
  assert.equal(s.followUpSamples.length, 3);
  assert.equal(s.byMode.interviewer, 160);
});

test('invalid household answers are rejected with explicit reasons', async () => {
  const { validateResponse } = await import('../survey/perceptualSurvey');
  const r = response(1);
  const bad = validateResponse({ ...r, answers: { ...r.answers, EMP: 7, S4X: 3 } }, []);
  assert.ok(bad.reasons.includes('INVALID_CHOICE'));
  assert.ok(bad.reasons.includes('INVALID_BINARY'));
});

test('local registers produce S5/G1/G5 shares and G3 network density with minimums', async () => {
  const { addRecords, saveNetwork, summarizeRegister, voidEntry } = await import('../survey/localRegister');
  const today = new Date().toISOString().slice(0, 10);
  const bad = addRecords(NB, [{ kind: 'problem', title: '', date: 'x', flag: true, recordedBy: '' }]);
  assert.equal(bad.stored, 0);
  assert.ok(bad.errors[0].errors.length >= 2);
  const r = addRecords(NB, Array.from({ length: 6 }, (_, i) => ({ kind: 'problem' as const, title: `مسئله ${i}`, date: today, flag: i < 3, evidenceRef: i < 2 ? `صورت‌جلسه ${i}` : undefined, recordedBy: 'شورایار' })));
  assert.equal(r.stored, 6);
  addRecords(NB, [{ kind: 'process', title: 'بودجهٔ مشارکتی', date: today, flag: true, recordedBy: 'x' }]);
  let s = summarizeRegister(NB);
  assert.equal(s.byKind.problem.value, 50);
  assert.equal(s.byKind.process.value, null, 'کمتر از ۵ پرونده نباید عدد بدهد');
  assert.ok(voidEntry(NB, r.ids[0], 'admin'));
  s = summarizeRegister(NB);
  assert.equal(s.byKind.problem.inWindow, 5);
  assert.equal(s.byKind.problem.value, 40);
  assert.equal(saveNetwork(NB, { actors: ['شورایاری', 'مسجد'], links: [[0, 0]], assessedBy: 'x' }).stored, false);
  saveNetwork(NB, { actors: ['شورایاری', 'سرای محله', 'مسجد', 'مدرسه'], links: [[0, 1], [1, 2], [0, 1]], assessedBy: 'کارشناس' });
  s = summarizeRegister(NB);
  assert.equal(s.network?.links.length, 2, 'پیوند تکراری حذف می‌شود');
  assert.equal(s.indicators.find((i) => i.code === 'G3')?.value, 33.3);
});

test('collection plan reports progress per module and recommended sample size', async () => {
  const { buildCollectionPlan, recommendedSampleSize } = await import('../survey/collectionPlan');
  const { summarizeSurvey } = await import('../survey/perceptualSurvey');
  const { summarizeAudits } = await import('../survey/fieldAudit');
  const { summarizeRegister } = await import('../survey/localRegister');
  assert.equal(recommendedSampleSize(null), 384);
  assert.equal(recommendedSampleSize(1000), 278);
  const plan = buildCollectionPlan({ survey: summarizeSurvey(NB), audit: summarizeAudits(NB), register: summarizeRegister(NB), population: 20000, cardIndicators: [{ code: 'S5', score: 70, channel: 'contract', tier: 'official' }] });
  assert.equal(plan.modules.length, 5);
  const audit = plan.modules.find((m) => m.key === 'audit')!;
  assert.equal(audit.status, 'empty');
  const s5 = plan.modules.find((m) => m.key === 'register')!.indicators.find((i) => i.code === 'S5')!;
  assert.equal(s5.card.coveredElsewhere, true);
  assert.ok(!plan.unlockable.includes('S5'));
});

test('survey and register values reach the decision card with their own tier', async () => {
  const { analyzeByName } = await import('./orchestrator');
  const result = await analyzeByName({ neighborhoodId: NB, offline: true, useKernel: false });
  assert.ok('card' in result);
  if (!('card' in result)) return;
  const by = Object.fromEntries(result.card.indicators.map((i) => [i.code, i]));
  assert.equal(by.H3.channel, 'survey');
  assert.ok(by.H3.score !== null, 'H3 با آستانهٔ هنجاری امتیاز می‌گیرد');
  assert.equal(by.C4.channel, 'survey');
  assert.ok(by.C4.score !== null);
  assert.equal(by.S5.channel, 'field');
  assert.equal(by.S5.raw, 40);
  assert.equal(by.G3.tier, 'expert');
  assert.ok(result.card.localRegister && result.card.localRegister.records >= 6);
});
