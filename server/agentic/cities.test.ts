/** CITY-v1: ورود شهر تازه، نمایهٔ شهر، آمادگی، و منابع بومی/حذف منابع ویژهٔ تهران */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-city-'));
process.env.ARA_SERVER_DATA_DIR = path.join(root, 'data');
process.env.ARA_GAZETTEER_DIRS = path.join(root, 'gz');
process.env.ARA_CITY_DIRS = path.join(root, 'cities');
fs.mkdirSync(path.join(root, 'gz'), { recursive: true }); fs.mkdirSync(path.join(root, 'cities'), { recursive: true });
const sq = (x: number, y: number) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y + 0.01], [x, y]]] });

test('normalizeCityGeojson maps common property names, keeps points as points, skips non-Persian names', async () => {
  const { normalizeCityGeojson } = await import('./cityOnboard');
  const r = normalizeCityGeojson({ features: [
    { properties: { NAME_FA: 'فهادان', district: '1' }, geometry: sq(54.36, 31.9) },
    { properties: { 'name:fa': 'صفائیه', name: 'Safaieh' }, geometry: { type: 'Point', coordinates: [54.35, 31.87] } },
    { properties: { name: 'Unknown' }, geometry: sq(54.3, 31.8) },
    { properties: { name: 'خط' }, geometry: { type: 'LineString', coordinates: [] } },
  ] }, { cityFa: 'یزد', provinceFa: 'یزد', official: true, sourceLabel: 'طرح تفصیلی' });
  assert.equal(r.stats.kept, 2); assert.equal(r.stats.polygons, 1); assert.equal(r.stats.points, 1); assert.equal(r.skipped.length, 2);
  assert.equal(r.features[0].properties.mantaqe_name_fa, 'منطقه 1');
  assert.match(String(r.features[0].properties.source), /شهرداری یزد/);
  assert.equal(r.features[1].properties.boundary_source, 'point');
});

test('onboarded city becomes matchable, gets readiness and local sources; Tehran-only catalog entries are excluded', async () => {
  const { normalizeCityGeojson } = await import('./cityOnboard');
  const feats = normalizeCityGeojson({ features: ['فهادان', 'شهدا', 'آزادشهر', 'صفائیه', 'اکبرآباد'].map((n, i) => ({ properties: { name_fa: n, district: String(1 + (i % 2)) }, geometry: sq(54.3 + i * 0.02, 31.9) })) }, { cityFa: 'یزد', official: true }).features;
  fs.writeFileSync(path.join(root, 'gz', 'yazd.geojson'), JSON.stringify({ type: 'FeatureCollection', features: feats }));
  fs.writeFileSync(path.join(root, 'cities', 'yazd.json'), JSON.stringify({ cityFa: 'یزد', provinceFa: 'یزد', officialDomains: ['https://www.yazd.ir/'], sources: [{ title: 'سالنامهٔ آماری شهر یزد', url: 'https://www.yazd.ir/salnameh', publisher: 'شهرداری یزد', indicators: ['N2'], spatialLevel: 'district' }] }));
  const { loadGazetteer } = await import('../neighborhood/gazetteer'); loadGazetteer(true);
  const { cityReadiness, allOfficialDomains, knownCityNames, cityProfile } = await import('./cities');
  const r = cityReadiness('یزد');
  assert.equal(r.slug, 'yazd'); assert.equal(r.neighborhoods, 5); assert.equal(r.boundaries.official, 5); assert.equal(r.districts, 2);
  assert.equal(r.level, 'partial'); assert.ok(r.nextSteps.some((s) => /دادهٔ تأییدشده/.test(s)));
  assert.ok(allOfficialDomains().includes('yazd.ir')); assert.ok(knownCityNames().includes('یزد'));
  assert.equal(cityProfile('yazd')?.cityFa, 'یزد');
  const { matchUnit } = await import('./research/spatialMatch');
  const m = matchUnit({ name: 'صفائیه' }, 'یزد');
  assert.equal(m.matchType, 'exact'); assert.match(m.targets[0], /^yazd:/);
  const { discoverSources } = await import('./research/discovery');
  const d = await discoverSources({ indicators: ['N2'], city: 'یزد', verify: false });
  const urls = d.cards.map((c) => c.url);
  assert.ok(urls.some((u) => u.includes('yazd.ir/salnameh')));
  assert.ok(!urls.some((u) => u.includes('atlas.tehran.ir')));
  assert.equal(cityReadiness('شهر ناموجود').level, 'not_onboarded');
});
