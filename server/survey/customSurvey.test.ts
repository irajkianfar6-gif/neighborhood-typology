/** پرسشنامهٔ سفارشی: اعتبارسنجی تعریف، امتیازدهی، کنترل کیفیت، برآورد، نسخه‌بندی، ورود به کارت و هوش مصنوعی (با سرویس ساختگی) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-custom-'));
const NB = 'tehran:m605';
const ages = ['18-29', '30-44', '45-64', '65+'] as const;

const def = () => ({
  title: 'امنیت و مشارکت', scope: { kind: 'neighborhoods' as const, neighborhoods: [NB] }, collectDemographics: true, minDurationSec: 30, minEligible: 30,
  items: [
    { code: 'SAFE1', text: 'شب‌ها در کوچه احساس امنیت می‌کنم', kind: 'likert5' as const, required: true, mapping: { code: 'S1', role: 'primary' as const, method: 'scale_mean' as const } },
    { code: 'SAFE2', text: 'از تاریکی معابر نگرانم', kind: 'likert5' as const, required: true, mapping: { code: 'S1', role: 'primary' as const, method: 'scale_mean' as const, reversed: true } },
    { code: 'PART', text: 'در سال گذشته در جلسهٔ محله شرکت کردید؟', kind: 'binary' as const, required: true, mapping: { code: 'X_PART', role: 'primary' as const, method: 'share_top' as const } },
    { code: 'RENT', text: 'اجارهٔ ماهانه (میلیون تومان)', kind: 'number' as const, min: 0, max: 200, showIf: { item: 'tenure', op: 'eq' as const, value: 2 } },
    { code: 'NOTE', text: 'مهم‌ترین مشکل محله؟', kind: 'text' as const },
  ],
});
function resp(i: number) {
  const a = ((i % 5) + 1);
  return {
    consent: true, durationSec: 120, mode: 'interviewer' as const,
    demographics: { sex: (i % 2 ? 'male' : 'female') as 'male' | 'female', ageBand: ages[i % 4], tenure: (i % 3 === 0 ? 'renter' : 'owner') as 'renter' | 'owner' },
    answers: { SAFE1: a, SAFE2: 6 - a, PART: i % 4 === 0 ? 1 : 0, ...(i % 3 === 0 ? { RENT: 10 + i % 7 } : {}), ...(i % 10 === 0 ? { NOTE: i % 20 === 0 ? 'روشنایی کوچه کم است' : 'پارکینگ نیست' } : {}) },
  };
}

test('definition validation catches structural errors', async () => {
  const { validateDefinition } = await import('../../src/algorithm/customSurveyModel');
  const ok = validateDefinition({ ...def() } as never).filter((i) => i.severity === 'error');
  assert.deepEqual(ok, []);
  const bad = validateDefinition({ title: '', minEligible: 5, minDurationSec: 0, collectDemographics: false, items: [
    { code: '1x', text: '', kind: 'choice', options: [{ value: 1, label: 'a' }] },
    { code: 'A', text: 't', kind: 'text', mapping: { code: 'S1', role: 'primary', method: 'scale_mean' } },
    { code: 'B', text: 't', kind: 'likert5', showIf: { item: 'tenure', op: 'eq', value: 1 }, mapping: { code: 'ZZ', role: 'primary', method: 'scale_mean' } },
  ] } as never);
  const msgs = bad.filter((i) => i.severity === 'error').map((i) => `${i.item ?? ''}:${i.field ?? ''}`);
  for (const k of [':title', ':minEligible', '1x:code', '1x:text', '1x:options', 'A:mapping', 'B:showIf', 'B:mapping']) assert.ok(msgs.includes(k), `انتظار خطای ${k}`);
});

test('itemScore methods are deterministic and oriented (100 = desirable)', async () => {
  const { itemScore } = await import('../../src/algorithm/customSurveyModel');
  const lik = { code: 'L', text: 't', kind: 'likert5' as const, mapping: { code: 'S1', role: 'primary' as const, method: 'scale_mean' as const } };
  assert.equal(itemScore(lik, 5), 100); assert.equal(itemScore(lik, 3), 50); assert.equal(itemScore(lik, 1), 0);
  assert.equal(itemScore({ ...lik, mapping: { ...lik.mapping, reversed: true } }, 5), 0);
  assert.equal(itemScore({ ...lik, mapping: { ...lik.mapping, method: 'share_top' } }, 4), 100);
  assert.equal(itemScore({ ...lik, mapping: { ...lik.mapping, method: 'share_top' } }, 3), 0);
  const num = { code: 'N', text: 't', kind: 'number' as const, min: 0, max: 100, mapping: { code: 'E4', role: 'check' as const, method: 'numeric_normative' as const, best: 10, worst: 60 } };
  assert.equal(itemScore(num, 10), 100); assert.equal(itemScore(num, 35), 50); assert.equal(itemScore(num, 90), 0);
  assert.equal(itemScore(num, 150), null, 'خارج از محدوده = نامعتبر');
  const ch = { code: 'C', text: 't', kind: 'multi' as const, options: [{ value: 1, label: 'a', score: 100 }, { value: 2, label: 'b', score: 0 }], mapping: { code: 'S2', role: 'primary' as const, method: 'option_score' as const } };
  assert.equal(itemScore(ch, [1, 2]), 50);
  const cond = { code: 'K', text: 't', kind: 'number' as const, min: 0, max: 10, mapping: { code: 'H1', role: 'primary' as const, method: 'share_condition' as const, op: 'gte' as const, threshold: 3, reversed: true } };
  assert.equal(itemScore(cond, 4), 0); assert.equal(itemScore(cond, 1), 100);
});

test('lifecycle: draft → publish lock → responses with QC → summary → new version', async () => {
  const m = await import('./customSurvey');
  const { questionnaire: q } = m.createQuestionnaire(def());
  assert.equal(q.status, 'draft');
  assert.throws(() => m.addCustomResponses(q.id, NB, [resp(0)]), /منتشرشده/);
  const pub = m.publishQuestionnaire(q.id);
  assert.equal(pub.status, 'published');
  assert.throws(() => m.updateQuestionnaire(q.id, def()), (e: unknown) => e instanceof m.SurveyError && e.status === 409);
  assert.throws(() => m.addCustomResponses(q.id, 'tehran:m1', [resp(0)]), (e: unknown) => e instanceof m.SurveyError && e.code === 'OUT_OF_SCOPE');

  const bad = [
    { ...resp(1), consent: false }, { ...resp(2), durationSec: 5 }, { ...resp(3), answers: { ...resp(3).answers, SAFE1: 9 } },
    { ...resp(4), answers: { SAFE2: 2, PART: 0 } }, { ...resp(5), answers: { ...resp(5).answers, ZZZ: 1 } },
  ];
  const stored = m.addCustomResponses(q.id, NB, [...Array.from({ length: 60 }, (_, i) => resp(i)), ...bad]);
  assert.equal(stored.filter((s) => s.qc.accepted).length, 60);
  const reasons = stored.filter((s) => !s.qc.accepted).map((s) => s.qc.reasons[0]);
  assert.deepEqual(reasons, ['NO_CONSENT', 'TOO_FAST', 'INVALID_VALUE', 'REQUIRED_MISSING', 'UNKNOWN_ITEM']);
  const dup = m.addCustomResponses(q.id, NB, [{ ...resp(7), deviceId: 'dev-1' }, { ...resp(8), deviceId: 'dev-1' }]);
  assert.deepEqual(dup.map((d) => d.qc.accepted), [true, false]);

  const s = m.summarizeCustom(pub, NB);
  assert.equal(s.nAccepted, 61);
  const S1 = s.indicators.find((e) => e.code === 'S1')!;
  // SAFE1=a و SAFE2 معکوس=6-a ⇒ هر دو گویه امتیاز یکسان؛ میانگین a روی ۱..۵ ≈ ۵۰
  assert.ok(S1.score! > 40 && S1.score! < 60, `S1=${S1.score}`);
  assert.ok(S1.ci95![0] < S1.score! && S1.ci95![1] > S1.score!);
  assert.equal(S1.alpha, 1, 'دو گویهٔ کاملاً هم‌جهت ⇒ α=۱');
  assert.equal(S1.publishable, true);
  const X = s.indicators.find((e) => e.code === 'X_PART')!;
  assert.equal(X.core, false);
  const rent = s.items.find((i) => i.code === 'RENT')!;
  assert.equal(rent.eligible, s.items.find((i) => i.code === 'RENT')!.n, 'فقط مستأجران واجد شرایط‌اند');
  assert.ok(rent.n > 0 && rent.n < 61);
  assert.ok(s.items.find((i) => i.code === 'NOTE')!.textSamples!.length >= 6);
  assert.ok(Object.keys(S1.groups.sex ?? {}).length === 2);
  assert.match(m.exportCsv(pub, NB), /SAFE1/);

  const v2 = m.newVersion(q.id);
  assert.equal(v2.version, 2); assert.equal(v2.status, 'draft'); assert.equal(v2.parentId, q.id);
  m.publishQuestionnaire(v2.id);
  assert.equal(m.getQuestionnaire(q.id)!.status, 'archived', 'نسخهٔ قبلی بایگانی می‌شود');
  assert.equal(m.loadCustomResponses(q.id, NB).length, 67, 'پاسخ‌های نسخهٔ قبل محفوظ است');
});

test('publishable core indicators reach the decision card; check-role values never stand alone', async () => {
  const m = await import('./customSurvey');
  const { questionnaire: q } = m.createQuestionnaire({ ...def(), title: 'اعتماد و سروصدا', items: [
    { code: 'G1Q', text: 'به شورایاری محله اعتماد دارم', kind: 'likert5', required: true, mapping: { code: 'G1', role: 'primary', method: 'scale_mean' } },
    { code: 'NOISE', text: 'سروصدای ترافیک آزاردهنده است', kind: 'likert5', required: true, mapping: { code: 'N2', role: 'check', method: 'scale_mean', reversed: true } },
  ] } as never);
  m.publishQuestionnaire(q.id);
  m.addCustomResponses(q.id, NB, Array.from({ length: 40 }, (_, i) => ({ ...resp(i), answers: { G1Q: (i % 5) + 1, NOISE: ((i + 2) % 5) + 1 } })));
  const { analyzeByName } = await import('../neighborhood/orchestrator');
  const result = await analyzeByName({ neighborhoodId: NB, offline: true, useKernel: false });
  assert.ok('card' in result);
  if (!('card' in result)) return;
  const by = Object.fromEntries(result.card.indicators.map((i) => [i.code, i]));
  assert.equal(by.G1.channel, 'survey');
  assert.equal(by.G1.tier, 'survey');
  assert.match(by.G1.source, /پرسشنامهٔ سفارشی/);
  assert.equal(by.G1.scoringMethod, 'survey_scale');
  assert.ok(Math.abs(by.G1.score! - 50) < 1);
  assert.ok(!(by.S1?.source ?? '').includes('امنیت و مشارکت') || by.S1.tier === 'survey');
  for (const ind of result.card.indicators) assert.ok(!ind.source.includes('کنترلی'), 'گویهٔ کنترلی هرگز مقدار اصلی کارت نمی‌شود');

  // ادغام: کنترلی در کنار منبع دیگر فقط در alternatives
  const { mergeDocumentedValues } = await import('../evidence/merge');
  const base = { code: 'N2', unit: 'score_0_100', geographyLevel: 'neighborhood', observedAt: '2025-01-01', fetchedAt: '2025-01-01', method: 'x', methodQuality: 1, sampleAdequacy: 1, cadence: 'annual', sourceIds: ['a'] } as const;
  const merged = mergeDocumentedValues([
    { ...base, raw: 70, source: 'open', channel: 'open', tier: 'open_measured' },
    { ...base, raw: 20, source: 'پرسشنامه کنترلی', channel: 'survey', tier: 'proxy', sourceIds: ['survey:custom:x'], details: { role: 'check' } },
  ] as never, 'tehran');
  const n2 = merged.get('N2')!;
  assert.equal(n2.tier, 'open_measured');
  assert.equal(n2.alternatives[0].tier, 'proxy');
  const alone = mergeDocumentedValues([{ ...base, raw: 20, source: 'c', channel: 'survey', tier: 'proxy', details: { role: 'check' } }] as never, 'tehran');
  assert.equal(alone.has('N2'), false, 'کنترلی به‌تنهایی مقدار نمی‌سازد');
});

test('llm client retries transient upstream errors and extracts JSON', async () => {
  const { llmText, extractJson, llmJson, LlmError } = await import('../ai/llm');
  const config = { baseUrl: 'https://x.test', apiKey: 'k', model: 'm', version: '2023-06-01', timeoutMs: 1000, configured: true };
  let calls = 0;
  const fetchMock = (async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'No available channel' } }), { status: 503 });
    if (calls === 2) return new Response('<html>bad gateway</html>', { status: 502 });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'نتیجه:\n```json\n{"a": "}{", "b": [1,2]}\n```' }], model: 'm' }), { status: 200 });
  }) as typeof fetch;
  const r = await llmText({ system: 's', prompt: 'p' }, { fetch: fetchMock, config, retries: 3 });
  assert.equal(calls, 3);
  assert.deepEqual(extractJson(r.text), { a: '}{', b: [1, 2] });
  await assert.rejects(llmText({ system: 's', prompt: 'p' }, { config: { ...config, configured: false } }), (e: unknown) => e instanceof LlmError && e.code === 'AI_NOT_CONFIGURED');
  const auth = (async () => new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 })) as typeof fetch;
  await assert.rejects(llmText({ system: 's', prompt: 'p' }, { fetch: auth, config, retries: 3 }), /invalid key/);
  let n = 0;
  const repair = (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: n++ === 0 ? 'no json here' : '{"ok":true}' }] }), { status: 200 })) as typeof fetch;
  const j = await llmJson({ system: 's', prompt: 'p', validate: (x) => x as { ok: boolean } }, { fetch: repair, config, retries: 0 });
  assert.equal(j.data.ok, true);
});

test('AI draft is sanitized, repaired and saved as draft; interpretation numbers are computed by code', async () => {
  const ai = await import('./customSurveyAi');
  const m = await import('./customSurvey');
  const config = { baseUrl: 'https://x.test', apiKey: 'k', model: 'mock-model', version: '2023-06-01', timeoutMs: 1000, configured: true };
  const reply = (obj: unknown) => (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], model: 'mock-model' }), { status: 200 })) as typeof fetch;
  const draft = await ai.aiDraft({ goal: 'سنجش احساس امنیت شبانهٔ ساکنان', neighborhoodId: NB }, { config, fetch: reply({
    title: 'امنیت شبانه', description: 'd', purpose: 'p', items: [
      { code: 'Q1', text: 'شب‌ها احساس امنیت می‌کنم', kind: 'likert5', required: true, mapping: { code: 'S1', role: 'primary', method: 'scale_mean' } },
      { code: 'Q1', text: 'نور معابر کافی است', kind: 'likert5', mapping: { code: 'lighting', role: 'primary', method: 'scale_mean' } },
      { code: '۳', text: 'فاصله تا ایستگاه اتوبوس (دقیقه)', kind: 'number', min: 0, max: 60, mapping: { code: 'N2', role: 'primary', method: 'numeric_normative', best: 5, worst: 30 } },
      { code: 'Q4', text: 'پیشنهاد شما؟', kind: 'text', mapping: { code: 'S1', role: 'primary', method: 'scale_mean' } },
      { code: 'Q5', text: 'x', kind: 'evil', __proto__: { polluted: true } },
    ] }) });
  const q = draft.questionnaire;
  assert.equal(q.status, 'draft');
  assert.equal(q.ai?.drafted?.model, 'mock-model');
  assert.equal(new Set(q.items.map((i) => i.code)).size, q.items.length, 'کدها یکتا شدند');
  assert.equal(q.items[1].mapping?.code, 'X_LIGHTING');
  assert.equal(q.items[2].mapping?.role, 'check', 'شاخص عینی ⇒ نقش کنترلی');
  assert.equal(q.items[3].mapping, undefined, 'گویهٔ متنی نگاشت ندارد');
  assert.ok(draft.issues.some((i) => i.item === q.items[4].code && i.field === 'kind'), 'نوع نامعتبر گزارش می‌شود');

  const pubQ = m.listQuestionnaires().find((x) => x.title === 'امنیت و مشارکت' && x.version === 1)!;
  const summary = m.summarizeCustom(pubQ, NB);
  const textIds = summary.items.flatMap((i) => (i.textSamples ?? []).map((t) => `${i.code}:${t.id}`));
  const interp = await ai.aiInterpret(pubQ, summary, { config, fetch: reply({
    summary: 'خلاصه', keyFindings: [{ text: 'امنیت متوسط است', basis: ['S1', 'FAKE'] }], cautions: ['n کم'],
    themes: [{ label: 'روشنایی', description: '...', answerIds: [textIds[0], 'NOTE:fake', textIds[0]] }, { label: 'خالی', description: '', answerIds: ['nope'] }],
    actions: [{ text: 'بهبود روشنایی', linkedIndicators: ['S1', 'BAD'] }],
  }) });
  assert.deepEqual(interp.keyFindings[0].basis, ['S1'], 'استناد ساختگی حذف می‌شود');
  assert.equal(interp.themes.length, 1, 'مضمون بدون پاسخ واقعی حذف می‌شود');
  assert.equal(interp.themes[0].count, 1, 'شمارش با کد و بدون تکرار');
  assert.deepEqual(interp.actions[0].linkedIndicators, ['S1']);
  assert.deepEqual(ai.loadInterpretation(pubQ.id, NB)?.summary, 'خلاصه');
});
