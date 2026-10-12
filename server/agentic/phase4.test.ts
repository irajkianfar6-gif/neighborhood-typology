/** فاز ۴ فریمورک ایجنتیک: سناریو و حساسیت (A11)، نقاد CR-v2 و آزمون تزریق خطا (A12)، پیمایش (A8)، داشبورد (A14) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-agentic-p4-'));
process.env.ARA_ANTHROPIC_API_KEY = '';

const full = async (v = 70) => { const { ALGORITHM_INDICATORS } = await import('../../src/algorithm/algorithmIndicators'); return { inds: ALGORITHM_INDICATORS, all: Object.fromEntries(ALGORITHM_INDICATORS.map((i) => [i.code, v])) as Record<string, number> }; };

test('scenario engine: full coverage evaluates; lowering one stage moves the bottleneck; partial coverage is not evaluated', async () => {
  const { evaluateScores } = await import('./scenario');
  const { inds, all } = await full();
  const base = evaluateScores(all);
  assert.ok(base.covered && base.bottleneck && base.diagnosticType);
  const low = { ...all }; for (const i of inds) if (i.capitalKey === 'E' && i.chainStage === 'ACCESS') low[i.code] = 5;
  const s = evaluateScores(low);
  assert.equal(s.bottleneck?.capital, 'E'); assert.ok(s.capitals!.E < base.capitals!.E);
  const part = evaluateScores({ H1: 50, E1: 40 });
  assert.equal(part.covered, false); assert.ok(part.missingCapitals.length >= 6);
});

test('simulate & sensitivity on a real (offline) card: hypothetical, non-publishable, card untouched', async () => {
  const { runAnalysis, requireEntry } = await import('./state');
  const { simulateScenario, sensitivityAnalysis } = await import('./scenario');
  const r = await runAnalysis(requireEntry('tehran:m605'), { offline: true, persist: false });
  const before = JSON.stringify(r.card);
  const empty = simulateScenario(r, {});
  assert.equal(empty.publishable, false); assert.equal(empty.label, 'scenario');
  if (!empty.base.covered) assert.match(empty.note, /سرمایه/);
  const { all } = await full(60);
  const sim = simulateScenario(r, { ...all, ZZZ9: 10 });
  assert.equal(sim.scenario.covered, true); assert.ok(!('ZZZ9' in sim.overrides), 'کد ناشناخته نباید پذیرفته شود');
  assert.ok(sim.hypotheticalCodes.length > 0);
  const sens = sensitivityAnalysis(r, { scores: all, perturbation: 0.2 });
  assert.ok(['stable', 'fragile'].includes(sens.verdict)); assert.ok(sens.tested.length > 0);
  assert.ok(sens.stability! >= 0 && sens.stability! <= 1);
  if (!empty.base.covered) assert.equal(sensitivityAnalysis(r, { scores: { H1: 50 } }).verdict, 'not_evaluated');
  assert.equal(JSON.stringify(r.card), before, 'سناریو نباید کارت را تغییر دهد');
});

test('critic CR-v2: no false fail on real card and ≥90% detection of injected errors', async () => {
  const { runAnalysis, requireEntry } = await import('./state');
  const { verifyAnalysis, CRITIC_VERSION } = await import('./critic');
  const { runCriticSuite, MUTATIONS } = await import('./criticSuite');
  assert.equal(CRITIC_VERSION, 'CR-v2');
  const r = await runAnalysis(requireEntry('tehran:m605'), { offline: true, persist: false });
  const base = verifyAnalysis(r);
  assert.notEqual(base.verdict, 'fail', JSON.stringify(base.checks.filter((c) => c.status === 'fail')));
  for (const id of ['C12', 'C13', 'C14', 'C15']) assert.ok(base.checks.some((c) => c.id === id), id);
  const before = JSON.stringify(r.card);
  const suite = runCriticSuite(r);
  assert.equal(suite.total, MUTATIONS.length);
  assert.ok(suite.detectionRate >= 0.9, JSON.stringify(suite.cases.filter((c) => !c.detected)));
  assert.ok(suite.passed); assert.equal(JSON.stringify(r.card), before);
});

test('LLM advisory critic rejects hallucinated indicator codes and ungrounded numbers', async () => {
  const { runAnalysis, requireEntry } = await import('./state');
  const { llmReview } = await import('./criticSuite');
  const r = await runAnalysis(requireEntry('tehran:m605'), { offline: true, persist: false });
  const code = r.card.indicators[0].code;
  const reply = JSON.stringify({ issues: [
    { severity: 'high', indicator: code, problem: 'تفسیر این شاخص بدون دادهٔ گروهی تعمیم داده شده است' },
    { severity: 'high', indicator: 'XX99', problem: 'شاخص ساختگی که در کارت نیست' },
    { severity: 'medium', indicator: null, problem: 'نرخ بیکاری ۸۷٫۳ درصد است که با گزارش نمی‌خواند' },
  ] });
  const out = await llmReview(r, { llm: async () => ({ text: reply, model: 'fake' }) });
  assert.equal(out.used, true); assert.equal(out.issues.length, 1); assert.equal(out.rejected, 2);
  assert.equal(out.issues[0].indicator, code);
  const none = await llmReview(r);
  assert.equal(none.used, false);
});

test('phase-4 tools via executor: least privilege, survey status, dashboard aggregates', async () => {
  const { callTool } = await import('./registry');
  const { AGENTS } = await import('./agents');
  assert.ok(AGENTS.filter((a) => a.id !== 'operator').every((a) => a.status === 'active'), 'همهٔ ۱۵ عامل فعال');
  const forb = await callTool('draft_contract_batch', { docId: 'doc_x_00000000', tableId: 't1' }, { agentId: 'A11' });
  assert.equal(forb.error?.code, 'FORBIDDEN');
  const sim = await callTool('simulate_scenario', { neighborhoodId: 'tehran:m605', offline: true, overrides: { H1: 40 } }, { agentId: 'A11' });
  assert.ok(sim.ok, JSON.stringify(sim.error)); assert.equal(sim.output!.publishable, false);
  const self = await callTool('critic_self_test', { neighborhoodId: 'tehran:m605', offline: true }, { agentId: 'A12' });
  assert.ok(self.ok); assert.ok(Number(self.output!.detectionRate) >= 0.9);
  const sv = await callTool('get_survey_status', { neighborhoodId: 'tehran:m605' }, { agentId: 'A8' });
  assert.ok(sv.ok, JSON.stringify(sv.error));
  const o = sv.output as { perceptual: { nAccepted: number }; surveyFillableGaps: string[]; otherGaps: string[] };
  assert.equal(o.perceptual.nAccepted, 0);
  const { SURVEY_NATIVE } = await import('../../src/algorithm/customSurveyModel');
  assert.ok(o.surveyFillableGaps.every((c) => SURVEY_NATIVE.has(c)) && o.otherGaps.every((c) => !SURVEY_NATIVE.has(c)));
  const dq = await callTool('draft_gap_questionnaire', { neighborhoodId: 'tehran:m605' }, { agentId: 'A8' });
  assert.equal(dq.error?.code, 'LLM_UNAVAILABLE');
  assert.equal((await callTool('get_agent_dashboard', {}, { agentId: 'A11' })).error?.code, 'FORBIDDEN');
  const d = await callTool('get_agent_dashboard', {}, { agentId: 'A14' });
  assert.ok(d.ok);
  const dash = d.output as { agents: Array<{ id: string; calls: number; errors: number; p95Ms: number }>; tools: Array<{ tool: string; calls: number }>; totals: { calls: number } };
  assert.ok(dash.totals.calls >= 6);
  assert.ok(dash.agents.find((a) => a.id === 'A11')!.errors >= 1, 'رد دسترسی A11 خطا شمرده شود');
  assert.ok(dash.tools.some((t) => t.tool === 'simulate_scenario' && t.calls >= 1));
});

test('cache invalidation clears only the given neighborhood', async () => {
  const { runAnalysis, requireEntry, invalidateNeighborhood, analysisFor } = await import('./state');
  const r = await runAnalysis(requireEntry('tehran:m605'), { offline: true, persist: false });
  assert.ok(invalidateNeighborhood('tehran:m605') >= 1);
  await assert.rejects(analysisFor({ analysisId: r.card.fingerprint }), /حافظهٔ کاری/);
  assert.equal(invalidateNeighborhood('tehran:m605'), 0);
});
