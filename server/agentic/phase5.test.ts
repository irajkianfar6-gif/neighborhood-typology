/** فاز ۵ فریمورک ایجنتیک: کارزار میدانی (FIELD-v1)، پایش مداخله (MON-v1)، یادگیری (LEARN-v1)، OCR و حذف نام برند/مدل */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-agentic-p5-'));
process.env.ARA_ANTHROPIC_API_KEY = '';

const NB = 'tehran:m605';
const ages = ['18-29', '30-44', '45-64', '65+'] as const;
function response(i: number, collectorId: string, durationSec = 240) {
  const answers: Record<string, number> = {};
  for (const [k, c] of ['C1', 'C2', 'C3', 'A1', 'A2', 'A3', 'U1', 'U2', 'U3', 'E1', 'E2', 'E3', 'O1', 'O2', 'O3', 'C3X'].entries()) answers[c] = ((i + k) % 5) + 1;
  return { durationSec, consent: true, answers, demographics: { sex: (i % 2 ? 'male' : 'female') as 'male' | 'female', ageBand: ages[i % 4], tenure: 'owner' as const }, mode: 'interviewer' as const, collectorId };
}

test('field campaign lifecycle: draft → human approval → progress (quotas, collector QC) → close → outcome', async () => {
  const { createCampaign, decideCampaign, campaignProgress, closeCampaign } = await import('./field/campaign');
  const { addResponses } = await import('../survey/perceptualSurvey');
  const c = await createCampaign({ neighborhoodId: NB, offline: true });
  assert.equal(c.status, 'draft'); assert.equal(c.approval.status, 'pending');
  assert.ok(c.plan.targetN >= 30); assert.ok(c.plan.targetCodes.length > 0, 'شکاف‌های پیمایشی باید هدف باشند');
  await assert.rejects(createCampaign({ neighborhoodId: NB, offline: true }), /CAMPAIGN_OPEN|باز/);
  await assert.rejects(closeCampaign(c.id), (e: { code?: string }) => e.code === 'INVALID_STATE' || e.code === 'NOT_READY');
  const started = decideCampaign(c.id, 'approved', 'user:test');
  assert.equal(started.status, 'fielding'); assert.ok(started.startedAt);
  await new Promise((r) => setTimeout(r, 10));
  addResponses(NB, Array.from({ length: 40 }, (_, i) => response(i, 'enum-1')));
  addResponses(NB, Array.from({ length: 12 }, (_, i) => response(100 + i, 'enum-2', i < 6 ? 10 : 240)));
  const p = await campaignProgress(c.id);
  assert.equal(p.perceptual.received, 52); assert.equal(p.perceptual.accepted, 46);
  assert.ok(Object.keys(p.perceptual.rejectedByReason).length > 0);
  const e2 = p.collectors.find((x) => x.collectorId === 'enum-2')!;
  assert.equal(e2.flagged, true); assert.equal(p.collectors.find((x) => x.collectorId === 'enum-1')!.flagged, false);
  if (p.quotas.sex) assert.ok(Object.values(p.quotas.sex).every((q) => q.got > 0));
  assert.equal(p.readyToClose, true);
  const closed = await closeCampaign(c.id);
  assert.equal(closed.status, 'closed'); assert.ok(closed.after && closed.outcome);
  assert.ok(closed.outcome!.newlyScored.length + closed.outcome!.reliabilityGained.length > 0, 'دادهٔ میدانی باید پوشش یا اعتبار را بیفزاید');
  assert.ok(closed.after!.surveyN >= 46);
  // پس از بستن، کارزار تازه مجاز است
  const c2 = await createCampaign({ neighborhoodId: NB, offline: true });
  assert.equal(decideCampaign(c2.id, 'rejected', 'user:test').status, 'cancelled');
});

test('monitoring: judge rules, register (baseline) and evaluate', async () => {
  const { judge, libraryItems, registerMonitoring, evaluateMonitoring } = await import('./field/monitoring');
  assert.equal(judge({ score: 40, reliability: 0.8 }, { score: 50, reliability: 0.8 }).verdict, 'improved');
  assert.equal(judge({ score: 40, reliability: 0.8 }, { score: 30, reliability: 0.7 }).verdict, 'worsened');
  assert.equal(judge({ score: 40, reliability: 0.8 }, { score: 42, reliability: 0.8 }).verdict, 'no_change');
  assert.equal(judge({ score: 40, reliability: 0.3 }, { score: 60, reliability: 0.8 }).verdict, 'insufficient_data');
  assert.equal(judge(undefined, { score: 60, reliability: 0.8 }).verdict, 'insufficient_data');
  const lib = libraryItems(); assert.ok(lib.length > 0);
  const m = await registerMonitoring({ neighborhoodId: NB, libraryId: lib[0].id, startDate: '2024-01-01', registeredBy: 'user:test', offline: true });
  assert.ok(m.dueDate > m.startDate); assert.deepEqual(Object.keys(m.baseline.values).sort(), [...m.targets].sort());
  await assert.rejects(registerMonitoring({ neighborhoodId: NB, libraryId: 'IL-NOPE', registeredBy: 'user:test' }));
  const ev = await evaluateMonitoring(m.id);
  const last = ev.evaluations.at(-1)!;
  assert.equal(last.due, true); assert.equal(last.perTarget.length, m.targets.length);
  assert.ok(['improved', 'worsened', 'no_change', 'insufficient_data'].includes(last.overall));
});

test('learning: proposals are drafted, deduplicated and only applied by human decision', async () => {
  const { generateProposals, listProposals, decideProposal } = await import('./field/learning');
  const a = await generateProposals();
  assert.ok(a.created.some((p) => p.kind === 'collector_qc') || listProposals().some((p) => p.kind === 'collector_qc'), 'پرسشگر پرخطا باید پیشنهاد بازبینی بگیرد');
  const b = await generateProposals();
  assert.equal(b.created.length, 0, 'پیشنهاد تکراری ساخته نشود');
  const p = listProposals()[0];
  assert.equal(p.status, 'proposed');
  assert.equal(decideProposal(p.id, 'approved', 'user:test')!.status, 'approved');
  assert.equal(decideProposal('prop_nope', 'approved', 'x'), null);
});

test('field cycle, least privilege and Karaj generalization (no code change)', async () => {
  const { fieldCycle } = await import('./field/cycle');
  const cy = fieldCycle(NB);
  assert.equal(cy.stages.length, 7); assert.ok(cy.stages.find((s) => s.key === 'remeasure')!.done);
  const { callTool } = await import('./registry');
  const forb = await callTool('create_field_campaign', { neighborhoodId: NB, offline: true }, { agentId: 'A11' });
  assert.equal(forb.ok, false); assert.equal(forb.error!.code, 'FORBIDDEN');
  const { AGENTS } = await import('./agents');
  for (const a of AGENTS) for (const t of a.tools) assert.ok(!/decide|approve/.test(t), `${a.id} نباید ابزار تصمیم انسانی داشته باشد`);
  const res = await callTool('resolve_neighborhood', { name: 'مهرشهر', city: 'کرج' }, { agentId: 'A1' });
  assert.ok(res.ok);
  const best = (res.output as { best: { neighborhoodId: string } | null; candidates: Array<{ neighborhoodId: string }> });
  const kid = best.best?.neighborhoodId ?? best.candidates[0]?.neighborhoodId;
  assert.ok(kid && kid.startsWith('karaj:'), 'محلهٔ کرج باید پیدا شود');
  const kc = await callTool('create_field_campaign', { neighborhoodId: kid, offline: true }, { agentId: 'A8' });
  assert.ok(kc.ok, JSON.stringify(kc.error));
  assert.ok(fieldCycle(kid).campaigns.length === 1);
});

test('OCR: scanned page image yields Persian text, flagged for human review, no auto tables', async () => {
  const { extractBuffer, ocrAvailable } = await import('./research/documents');
  assert.ok(ocrAvailable());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-ocr-t-'));
  execFileSync('pdftoppm', ['-r', '150', '-png', '-f', '1', '-l', '1', path.join(import.meta.dirname, 'fixtures', 'district6.pdf'), path.join(dir, 'p')]);
  const img = fs.readdirSync(dir).find((f) => f.endsWith('.png'))!;
  const buf = fs.readFileSync(path.join(dir, img));
  const r = extractBuffer('scan.png', buf);
  assert.equal(r.kind, 'png'); assert.equal(r.content.tables.length, 0);
  const text = r.content.pages[0].text.replace(/\s+/g, ' ');
  assert.match(text, /امیرآباد/); assert.match(text, /یوسف ?آباد/);
  assert.equal(r.verification.agreement, null); assert.ok(r.warnings.some((w) => /بازبینی انسانی/.test(w)));
  // PDF اسکن‌شده (بدون لایهٔ متن) هم به OCR می‌رود
  const pdf = path.join(dir, 'scan.pdf');
  execFileSync('magick', [path.join(dir, img), pdf]);
  const rp = extractBuffer('scan.pdf', fs.readFileSync(pdf));
  assert.equal(rp.kind, 'pdf'); assert.match(rp.content.pages[0].text, /امیرآباد/);
  assert.ok(rp.warnings.some((w) => /OCR/.test(w)));
});

test('brand scrub: model and vendor names never reach the user', async () => {
  const { scrubText, scrubValue } = await import('../ai/brandScrub');
  assert.equal(scrubText('پاسخ از claude-opus-4-8'), 'پاسخ از هوش مصنوعی');
  assert.equal(scrubText('Anthropic و OpenAI و gpt-4o'), 'هوش مصنوعی و هوش مصنوعی و هوش مصنوعی');
  assert.equal(scrubText('anthropicProxy و open_model'), 'anthropicProxy و open_model');
  assert.match(scrubText('ARA_ANTHROPIC_API_KEY تنظیم نشده'), /^کلید سرویس هوش مصنوعی/);
  assert.deepEqual(scrubValue({ a: ['Claude'], n: 3 }), { a: ['هوش مصنوعی'], n: 3 });
});
