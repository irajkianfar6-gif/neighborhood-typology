/** لایه‌های محله‌ای تهران: پوشش، مقدار مستند (سنجه)، امتیازدهی، تشخیص و تجویز */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-layers-'));

test('pack covers every Tehran neighborhood of the gazetteer with an explicit geography level', async () => {
  const { tehranLayers } = await import('./tehranLayers');
  const { neighborhoodsOfCity } = await import('../neighborhood/gazetteer');
  const pack = tehranLayers();
  assert.ok(pack, 'neighborhood_layers_v1.json باید موجود باشد');
  const ids = neighborhoodsOfCity('tehran').map((e) => e.neighborhoodId);
  assert.ok(ids.length >= 380);
  for (const k of ['lighting', 'housing', 'employment', 'education'] as const) {
    const missing = ids.filter((id) => !pack.layers[k].byId[id]);
    assert.deepEqual(missing, [], `${k}: محله بدون رکورد`);
  }
  for (const k of ['housing', 'employment', 'education'] as const) {
    for (const id of ids) {
      const r = pack.layers[k].byId[id] as { level: string; match: string };
      assert.ok(['neighborhood', 'district'].includes(r.level));
      if (r.match === 'district_fallback') assert.equal(r.level, 'district', `${k}/${id}: مقدار منطقه باید برچسب منطقه داشته باشد`);
    }
    assert.ok(pack.layers[k].coverage.neighborhood >= 250, `${k}: پوشش محله‌ای کم است`);
  }
});

test('measure: H1/H3/E4 enter evidence as open_model; survey outranks; H1 is scored relative to its own layer', async () => {
  const { layerValues, H1_LAYER_UNIT } = await import('./tehranLayers');
  const { mergeDocumentedValues } = await import('../evidence/merge');
  const v = layerValues('tehran:m605');
  const by = Object.fromEntries(v.map((x) => [x.code, x]));
  assert.deepEqual(Object.keys(by).sort(), ['E4', 'H1', 'H3']);
  for (const x of v) { assert.equal(x.tier, 'open_model'); assert.ok(x.source.length > 10); assert.ok(x.observedAt); }
  assert.equal(by.E4.lowerIsBetter, true);
  assert.equal(by.H1.unit, H1_LAYER_UNIT);
  const merged = mergeDocumentedValues(v, 'tehran');
  assert.equal(merged.get('H1')!.scoringMethod, 'percentile');
  assert.ok(merged.get('H1')!.score! > 80, 'یوسف‌آباد در صدک‌های بالای تحصیلات');
  assert.equal(merged.get('H3')!.scoringMethod, 'normative');
  const e4 = merged.get('E4')!;
  assert.ok(e4.score! >= 0 && e4.score! <= 60, 'بار اجارهٔ بیش از ۵۰٪ امتیاز پایین می‌گیرد');
  // پیمایش محله بر برآورد مدل‌شده مقدم است
  const survey = { ...by.E4, raw: 35, tier: 'survey' as const, channel: 'survey' as const, source: 'پیمایش محله', sourceIds: ['survey:economic'], details: {} };
  const m2 = mergeDocumentedValues([...v, survey], 'tehran');
  assert.equal(m2.get('E4')!.tier, 'survey');
  assert.ok(m2.get('E4')!.alternatives.some((a) => a.tier === 'open_model'));
});

test('diagnosis + prescription: dark neighborhood → lighting finding, insecurity test and targeted P-UE-2', async () => {
  const { tehranLayers, assessLayers } = await import('./tehranLayers');
  const pack = tehranLayers()!;
  const L = pack.layers.lighting.byId;
  const ids = Object.keys(L).filter((k) => L[k].quality_grade === 'A');
  const darkest = ids.sort((a, b) => (L[a].score_0_100 ?? 0) - (L[b].score_0_100 ?? 0))[0];
  const brightest = ids[ids.length - 1];
  const a = assessLayers(darkest)!;
  assert.ok(a.findings.some((f) => f.id === 'LGT-LOW' && f.severity === 'high'));
  assert.ok(a.hypothesisTests.some((t) => t.frictionType === 'insecurity' && t.result === 'supports'));
  const rx = a.prescriptions.find((p) => p.libraryId === 'P-UE-2');
  assert.ok(rx && rx.spatialTargets && rx.spatialTargets.length > 0, 'تجویز روشنایی باید معابر هدف داشته باشد');
  assert.ok(rx.prerequisite, 'اجرای روشنایی مشروط به ممیزی میدانی است');
  const b = assessLayers(brightest)!;
  assert.ok(!b.findings.some((f) => f.id === 'LGT-LOW'));
  // همسویی پیمایش (U2 پایین) اطمینان را بالا می‌برد؛ ناهمسویی پایین می‌آورد
  const midDark = ids.find((k) => L[k].score_0_100! <= 30 && L[k].score_0_100! > 20 && L[k].index_ci95_high! < 100)!;
  const base = assessLayers(midDark)!.findings.find((f) => f.id === 'LGT-LOW')!;
  const agree = assessLayers(midDark, { surveyItemScores: { U2: 20 }, surveyN: 120 })!.findings.find((f) => f.id === 'LGT-LOW')!;
  const disagree = assessLayers(midDark, { surveyItemScores: { U2: 80 }, surveyN: 120 })!.findings.find((f) => f.id === 'LGT-LOW')!;
  const rank = { low: 0, medium: 1, high: 2 } as const;
  assert.ok(rank[agree.confidence] >= rank[base.confidence]);
  assert.ok(rank[disagree.confidence] <= rank[base.confidence]);
  assert.ok(agree.corroboration!.length > 0 && disagree.corroboration!.length > 0);
});

test('prescriptions only use library items; bottleneck alignment is flagged and ranked first', async () => {
  const { tehranLayers, assessLayers } = await import('./tehranLayers');
  const lib = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'kernel', 'registries', 'intervention_library_v1.json'), 'utf8')).items.map((i: { id: string }) => i.id);
  const pack = tehranLayers()!;
  const E = pack.layers.education.byId;
  const lowEdu = Object.keys(E).filter((k) => E[k].level === 'neighborhood' && (E[k].universitySharePct ?? 99) < 8)[0];
  assert.ok(lowEdu);
  const a = assessLayers(lowEdu, { bottleneck: { capital: 'H', transition: ['ACCESS', 'USE'] } })!;
  assert.ok(a.findings.some((f) => f.id === 'EDU-LOW'));
  for (const p of a.prescriptions) assert.ok(lib.includes(p.libraryId), p.libraryId);
  if (a.prescriptions.some((p) => p.alignedWithBottleneck)) assert.equal(a.prescriptions[0].alignedWithBottleneck, true);
  assert.ok(a.caveats.some((c) => c.includes('قیمت مسکن')), 'هشدار متغیر کمکی مشترک');
});

test('layers can be disabled and then contribute nothing', async () => {
  const mod = await import('./tehranLayers');
  process.env.ARA_DISABLE_LOCAL_LAYERS = '1';
  try {
    assert.equal(mod.tehranLayers(), null);
    assert.deepEqual(mod.layerValues('tehran:m605'), []);
    assert.equal(mod.assessLayers('tehran:m605'), null);
  } finally { delete process.env.ARA_DISABLE_LOCAL_LAYERS; }
  assert.equal(mod.assessLayers('karaj:m1'), null);
});

test('decision card carries the layer assessment and versions it', async () => {
  const { analyzeByName } = await import('../neighborhood/orchestrator');
  const r = await analyzeByName({ neighborhoodId: 'tehran:m605', offline: true, useKernel: false });
  assert.ok('card' in r);
  if (!('card' in r)) return;
  assert.ok(r.card.localLayers && r.card.localLayers.measures.length === 4);
  assert.match(r.card.reproducibilityKey.localLayers, /tehran-layers-v1\+LR-v1/);
  const e4 = r.card.indicators.find((i) => i.code === 'E4')!;
  assert.equal(e4.tier, 'open_model');
});
