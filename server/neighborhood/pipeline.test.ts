import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGazetteer, neighborhoodsOfCity } from './gazetteer';
import { resolveNeighborhood, splitNameAndCity } from './resolver';
import { jaroWinkler, normalizeFa } from './text';

test('Persian normalization unifies ي/ی، ك/ک، ZWNJ and digits', () => {
  assert.equal(normalizeFa('يوسف‌آباد'), normalizeFa('یوسف آباد'));
  assert.equal(normalizeFa('كن'), normalizeFa('کن'));
  assert.ok(jaroWinkler('یوسف آباد', 'یوسف اباد') > 0.9);
});

test('"name، city" input is split', () => {
  const r = splitNameAndCity('یوسف آباد، تهران');
  assert.equal(r.name.trim(), 'یوسف آباد');
  assert.equal(r.city, 'تهران');
});

test('gazetteer loads official Tehran boundaries (391) and Karaj', () => {
  const { entries } = loadGazetteer();
  const tehran = neighborhoodsOfCity('تهران');
  assert.equal(tehran.length, 391);
  assert.ok(tehran.every((e) => e.boundary.tier === 'official' && !e.boundary.isProxy));
  assert.ok(entries.some((e) => e.citySlug === 'karaj'));
  const ids = new Set(entries.map((e) => e.neighborhoodId));
  assert.equal(ids.size, entries.length, 'شناسهٔ محله باید یکتا باشد');
});

test('every official Tehran neighborhood name resolves to itself or asks the user to choose', () => {
  const failures: string[] = [];
  for (const e of neighborhoodsOfCity('تهران')) {
    const r = resolveNeighborhood(e.nameFa, 'تهران');
    const ok = r.requiresUserChoice
      ? r.candidates.some((c) => c.entry.neighborhoodId === e.neighborhoodId)
      : r.best?.entry.neighborhoodId === e.neighborhoodId;
    if (!ok) failures.push(`${e.nameFa} → ${r.best?.entry.neighborhoodId ?? 'none'}`);
  }
  assert.deepEqual(failures, []);
});

test('ambiguous and unknown names never silently pick a neighborhood', () => {
  const dup = resolveNeighborhood('مهرشهر');
  assert.equal(dup.requiresUserChoice, true);
  assert.ok(dup.candidates.length >= 2);
  const unknown = resolveNeighborhood('ناکجاآباد خیالی');
  assert.ok(!unknown.best || unknown.requiresUserChoice);
});
