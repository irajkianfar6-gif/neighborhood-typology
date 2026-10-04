import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { createTypologyRouter } from './typologyRouter';
import { MemoryTypologyStore } from './typologyStore';
import fs from 'node:fs';
import path from 'node:path';

// لایه‌های حجیم public/data (کاتالوگ ۲۱۷۵۲ فایل و places.json) در مخزن نیستند و با
// scripts/extract_pbf_layers.py ساخته می‌شوند. بدون آن‌ها این تست‌ها «رد» نمی‌شوند، صریحاً skip می‌شوند.
const PUBLIC_DATA_DIR = path.resolve(process.env.ARA_PUBLIC_DATA_DIR || path.join(process.cwd(), 'public', 'data'));
const NO_CATALOG = !fs.existsSync(path.join(PUBLIC_DATA_DIR, 'typology', 'source_catalog.json')) && 'public/data/typology/source_catalog.json موجود نیست';
const NO_PLACES = !fs.existsSync(path.join(PUBLIC_DATA_DIR, 'pbf', 'places.json')) && 'public/data/pbf/places.json موجود نیست';

test('exposes the resumable typology lifecycle over HTTP', async (context) => {
  const app = express();
  app.use('/api/typology', createTypologyRouter({ store: new MemoryTypologyStore(), codeVersion: 'test' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api/typology`;
  const health = await fetch(`${base}/health`).then((response) => response.json()) as { data: { ok: boolean } };
  assert.equal(health.data.ok, true);

  const created = await fetch(`${base}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      neighborhood_name: 'محله آزمون مسیر',
      city_or_county: 'تهران',
      province: 'تهران',
      settlement_type: 'urban',
      reference_year: 1405,
      purpose: 'baseline',
    }),
  }).then((response) => response.json()) as { data: { run_id: string; status: string } };
  assert.equal(created.data.status, 'LOCATION_AMBIGUOUS');

  const listed = await fetch(`${base}/runs?limit=5`).then((response) => response.json()) as { data: { runs: Array<{ run_id: string }> } };
  assert.equal(listed.data.runs.length, 1);
  assert.equal(listed.data.runs[0].run_id, created.data.run_id);

  const resumed = await fetch(`${base}/runs/${created.data.run_id}`).then((response) => response.json()) as { data: { status: string; coverage: { total: number } } };
  assert.equal(resumed.data.status, 'LOCATION_AMBIGUOUS');
  assert.equal(resumed.data.coverage.total, 419);

  const invalid = await fetch(`${base}/runs/not-a-uuid`);
  const invalidBody = await invalid.json() as { error: { code: string } };
  assert.equal(invalid.status, 400);
  assert.equal(invalidBody.error.code, 'INVALID_RUN_ID');
});

test('exposes a compact catalog summary for the 419-indicator audit dashboard', { skip: NO_CATALOG }, async (context) => {
  const app = express();
  app.use('/api/typology', createTypologyRouter({ store: new MemoryTypologyStore(), codeVersion: 'test' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/typology/data-catalog/summary`);
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { file_count: number; indicator_count: number; province_count: number; indicator_links: Record<string, unknown> } };
  assert.equal(body.data.file_count, 21752);
  assert.equal(body.data.indicator_count, 419);
  assert.equal(body.data.province_count, 31);
  assert.ok(Object.keys(body.data.indicator_links).length >= 419);
});

test('searches local Iranian neighborhood points without requiring city or province input', { skip: NO_PLACES }, async (context) => {
  const app = express();
  app.use('/api/typology', createTypologyRouter({ store: new MemoryTypologyStore(), codeVersion: 'test' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/typology/locations/search?q=نوغان`);
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { results: Array<{ canonical_name: string; province: string; center: { lat: number; lng: number } }> } };
  assert.ok(body.data.results.length > 0);
  assert.equal(body.data.results[0].canonical_name, 'نوغان');
  assert.ok(body.data.results[0].province.length > 0);
  assert.ok(Number.isFinite(body.data.results[0].center.lat));
});

test('searches a neighborhood with comma-separated city context', async (context) => {
  const app = express();
  app.use('/api/typology', createTypologyRouter({ store: new MemoryTypologyStore(), codeVersion: 'test' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/typology/locations/search?q=${encodeURIComponent('گوهردشت، کرج')}`);
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { results: Array<{ canonical_name: string; city_or_county: string; center: { lat: number; lng: number } }> } };
  assert.ok(body.data.results.length > 0);
  assert.equal(body.data.results[0].canonical_name, 'گوهردشت');
  assert.equal(body.data.results[0].city_or_county, 'کرج');
  assert.ok(Number.isFinite(body.data.results[0].center.lat));
  assert.ok(Number.isFinite(body.data.results[0].center.lng));
});

test('creates a run from a selected local location while city and province are omitted', async (context) => {
  const app = express();
  app.use('/api/typology', createTypologyRouter({ store: new MemoryTypologyStore(), codeVersion: 'test' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/typology/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      neighborhood_name: 'نوغان',
      city_or_county: '',
      province: '',
      settlement_type: 'urban',
      reference_year: 1405,
      purpose: 'baseline',
      selected_location: {
        candidate_id: 'pbf-place:test', canonical_name: 'نوغان', province: 'خراسان رضوی', city_or_county: 'مشهد',
        settlement_type: 'urban', confidence: 0.95, source: 'PBF_PLACES_LOCAL', center: { lat: 36.3, lng: 59.6 },
        boundary_available: true, boundary_quality: 'provisional', boundary_geojson: { type: 'Polygon', coordinates: [[[59.59, 36.29], [59.61, 36.29], [59.61, 36.31], [59.59, 36.31], [59.59, 36.29]]] },
      },
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { data: { candidates: Array<{ candidate_id: string; province: string; city_or_county: string }> } };
  assert.equal(body.data.candidates[0].candidate_id, 'pbf-place:test');
  assert.equal(body.data.candidates[0].province, 'خراسان رضوی');
  assert.equal(body.data.candidates[0].city_or_county, 'مشهد');
});

test('serves Tehran and Karaj neighborhood polygons with provenance metadata', async (context) => {
  const app = express();
  app.use('/api/typology', createTypologyRouter({ store: new MemoryTypologyStore(), codeVersion: 'test' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/typology/locations/boundaries`);
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { features: Array<{ geometry: { type: string }; properties: { city_or_county: string; boundary_quality: string; area_km2: number | null; candidate_id: string; canonical_name: string; center: { lat: number; lng: number } } }> } };
  assert.equal(body.data.features.length, 497);
  assert.ok(body.data.features.some((feature) => feature.properties.city_or_county === 'تهران' && feature.properties.boundary_quality === 'authoritative'));
  assert.ok(body.data.features.some((feature) => feature.properties.city_or_county === 'کرج' && feature.properties.boundary_quality === 'confirmed_osm'));
  assert.ok(body.data.features.every((feature) => ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)));

  const pointResponse = await fetch(`http://127.0.0.1:${port}/api/typology/locations/search?q=%DA%AF%D9%88%D9%87%D8%B1%D8%AF%D8%B4%D8%AA`);
  assert.equal(pointResponse.status, 200);
  const pointBody = await pointResponse.json() as { data: { results: Array<{ canonical_name: string; boundary_available: boolean; boundary_geojson: unknown }> } };
  const pointNeighborhood = pointBody.data.results.find((result) => result.canonical_name === '\u06af\u0648\u0647\u0631\u062f\u0634\u062a');
  assert.ok(pointNeighborhood);
  assert.equal(pointNeighborhood.boundary_available, false);
  assert.equal(pointNeighborhood.boundary_geojson, null);

  const official = body.data.features.find((feature) => feature.properties.city_or_county === 'تهران' && feature.properties.boundary_quality === 'authoritative');
  assert.ok(official);
  const nearbyResponse = await fetch(`http://127.0.0.1:${port}/api/typology/locations/nearby?lat=${official.properties.center.lat}&lng=${official.properties.center.lng}`);
  assert.equal(nearbyResponse.status, 200);
  const nearbyBody = await nearbyResponse.json() as { data: { results: Array<{ candidate_id: string; boundary_quality?: string; match_reason: string }> } };
  assert.equal(nearbyBody.data.results[0].candidate_id, official.properties.candidate_id);
  assert.equal(nearbyBody.data.results[0].boundary_quality, 'authoritative');
  assert.match(nearbyBody.data.results[0].match_reason, /مرز رسمی/);
});

test('serves Karaj district context separately from neighborhood boundaries', async (context) => {
  const app = express();
  app.use('/api/typology', createTypologyRouter({ store: new MemoryTypologyStore(), codeVersion: 'test' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/typology/locations/administrative-boundaries?city=کرج`);
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { features: Array<{ properties: { layer_type: string; city_or_county: string }; geometry: { type: string } }> } };
  assert.equal(body.data.features.length, 10);
  assert.ok(body.data.features.every((feature) => feature.properties.layer_type === 'district'));
  assert.ok(body.data.features.every((feature) => feature.properties.city_or_county === 'کرج'));
  assert.ok(body.data.features.every((feature) => ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)));
});
