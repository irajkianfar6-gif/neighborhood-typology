import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-open-'));
process.env.ARA_SERVER_DATA_DIR = tmp;
const { combineHazard, computeN4, computeR2, computeR5, countWithin, distanceToLinesM, ooklaCellSpeeds, quadkeyAt, resilienceScore } = await import('./openData');

const cell = (lat: number, lng: number, weight = 1) => ({ lat, lng, weight, id: `${lat},${lng}` });
const ctxOf = (cells: ReturnType<typeof cell>[]) => ({
  neighborhoodId: 'x:1', areaKm2: 1, population: { value: 1000 }, density: 1000, structure: { source: null },
  gridOrigins: cells, gridWeighting: 'worldpop', gridCellM: 250, warnings: [],
}) as never;
const entry = { neighborhoodId: 'testcity:m1', citySlug: 'testcity', boundary: { geojson: { type: 'Polygon', coordinates: [[[51, 35], [51.01, 35], [51.01, 35.01], [51, 35.01], [51, 35]]] } } } as never;

test('quadkey matches Bing tile scheme (Tehran z8 = 12300300)', () => {
  assert.equal(quadkeyAt(35.7, 51.4, 8), '12300300');
  assert.equal(quadkeyAt(35.7, 51.4, 16).length, 16);
});

test('distance to fault polyline ≈ perpendicular metres', () => {
  const d = distanceToLinesM([51.0, 35.0045], [[[50.99, 35.0], [51.01, 35.0]]]);
  assert.ok(Math.abs(d - 497) < 10, `got ${d}`);
});

test('hazard union is population-weighted and missing layers are ignored', () => {
  const r = combineHazard([3, 1, 1], [[1, 0, 0], null, [0, 0, 1]]);
  assert.deepEqual(r.exposed, [1, 0, 1]);
  assert.equal(r.share, 80);
});

test('resilience score weights and renormalises without hazard', () => {
  assert.equal(resilienceScore({ tree: 1, otherVeg: 0, built: 0 }, 0), 80);
  assert.equal(Math.round(resilienceScore({ tree: 0, otherVeg: 0, built: 1 }, null)), 0);
  assert.equal(Math.round(resilienceScore({ tree: 0.5, otherVeg: 0, built: 0.5 }, null)), 38);
});

test('countWithin counts only points inside radius', () => {
  const pts = [{ lat: 35, lng: 51 }, { lat: 35.005, lng: 51 }, { lat: 35.02, lng: 51 }];
  assert.deepEqual(countWithin([{ lat: 35, lng: 51 }], pts, 1000), [2]);
});

test('R2 reports median accessible businesses, missing without layer', () => {
  const layer = { category: 'commerce', points: [{ lat: 35.001, lng: 51.001, kind: 'shop' }, { lat: 35.002, lng: 51.002, kind: 'office' }], areas: [], endpoint: 'https://overpass-api.de/api/interpreter', observedAt: '2026-01-01', fetchedAt: '2026-01-02' } as never;
  const v = computeR2(ctxOf([cell(35.001, 51.001), cell(35.5, 51.5)]), layer);
  assert.ok(v.raw !== null && v.unit === 'count' && v.tier === 'proxy');
  assert.equal(computeR2(ctxOf([cell(35, 51)]), null).raw, null);
});

test('Ookla speeds: test-weighted fixed+mobile; R5 missing until data prepared', () => {
  const c = { lat: 35.005, lng: 51.005 };
  const q = quadkeyAt(c.lat, c.lng, 16);
  const s = ooklaCellSpeeds([c, { lat: 36, lng: 52 }], [
    { type: 'fixed', zoom: 16, tiles: [{ q, d: 20_000, u: 1, lat: 1, tests: 3, devices: 1 }] },
    { type: 'mobile', zoom: 16, tiles: [{ q, d: 60_000, u: 1, lat: 1, tests: 1, devices: 1 }] },
  ] as never);
  assert.equal(s[0]!.mbps, 30);
  assert.equal(s[1], null);
  assert.equal(computeR5(entry, ctxOf([cell(35.005, 51.005)])).raw, null);
  fs.mkdirSync(path.join(tmp, 'open-vector', 'testcity'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'open-vector', 'testcity', 'ookla_fixed.json'), JSON.stringify({ source: 'Ookla', type: 'fixed', quarter: '2025-Q4', periodStart: '2025-10-01', fetchedAt: '2026-01-01', zoom: 16, tiles: [{ q, d: 25_000, u: 1, lat: 1, tests: 500, devices: 100 }] }));
  const v = computeR5(entry, ctxOf([cell(35.005, 51.005)]));
  assert.equal(v.raw, 25);
  assert.equal(v.unit, 'Mbps');
});

test('N4 without kernel uses fault buffer only and stays honest when nothing is prepared', async () => {
  const none = await computeN4({ ...(entry as object), citySlug: 'nocity' } as never, ctxOf([cell(35.005, 51.005)]), false);
  assert.equal(none.value.raw, null);
  fs.writeFileSync(path.join(tmp, 'open-vector', 'testcity', 'faults.json'), JSON.stringify({ source: 'GEM', fetchedAt: '2026-01-01', faults: [{ name: 'f', slip_type: null, lines: [[[50.99, 35.005], [51.02, 35.005]]] }] }));
  const r = await computeN4(entry, ctxOf([cell(35.005, 51.005, 1), cell(35.02, 51.005, 1)]), false);
  assert.equal(r.value.raw, 50);
  assert.deepEqual(r.exposedCells, [1, 0]);
});
