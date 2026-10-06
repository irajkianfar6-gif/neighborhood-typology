/**
 * محاسبهٔ شاخص‌های خودکار (کانال open_auto) روی مرز واقعی محله و جمعیت‌وزن‌دار.
 * هر خروجی یک DocumentedValue کامل است؛ اگر داده نباشد raw=null با دلیل و اقدام بعدی.
 *
 * P2 پیوستگی معابر   — گراف پیادهٔ OSM درون مرز (بزرگ‌ترین مؤلفهٔ متصل ÷ کل طول)
 * P4 دسترسی خدمات    — سهم جمعیت با ≤۱۵ دقیقه پیاده تا مرکز سلامت پایه
 * P5 حمل‌ونقل پایدار  — سهم جمعیت در ۴۰۰ متری ایستگاه اتوبوس یا ۸۰۰ متری مترو/BRT
 * N1 دسترسی سبز      — سهم جمعیت در ۳۰۰ متری فضای سبز عمومی ≥ ۰٫۵ هکتار
 * N2 پوشش سبز        — سهم نمونه‌های ۵۰ متری درون پهنه‌های سبز OSM (پروکسی) یا NDVI (رستر)
 * N3 کیفیت هوا        — میانگین PM2.5 مدل CAMS (Open-Meteo) ۹۲ روز اخیر (open_model)
 * N4/N5/R2/R5        — در openData.ts (سیل+گسل+شیب، پوشش زمین، بنگاه‌های در دسترس، Ookla)
 * R1 اتصال شهری      — میانهٔ جمعیت‌وزن‌دار زمان پیاده تا شبکهٔ سریع (پروکسی)
 * R3 دسترسی دانش     — میانهٔ جمعیت‌وزن‌دار زمان پیاده تا مدرسه/دانشگاه/کتابخانه
 * C1 دارایی فرهنگی   — دارایی‌های فرهنگی درون مرز ÷ جمعیت ×۱۰۰۰
 * E2 فرصت شغلی محلی  — بنگاه‌های ثبت‌شده در OSM درون مرز ÷ جمعیت ×۱۰۰۰ (پروکسی)
 */
import fs from 'node:fs';
import path from 'node:path';
import { kernelClient } from '../kernelClient';
import { serverDataDir } from '../paths';
import type { DocumentedValue } from '../evidence/types';
import type { NeighborhoodContext } from './context';
import type { GazetteerEntry } from './gazetteer';
import { type AreaGeom, bboxOf, distanceToGeomM, gridInside, haversineM, overpassPoly, pointInGeom, weightedMedian } from './geo';
import { type LayerCategory, type OsmLayer, overpass } from './osmLayers';
import { WALK_M_PER_MIN, walkDistances } from './routing';
import { computeN4, computeN5, computeR2, computeR5 } from './openData';

export type CityLayers = Partial<Record<LayerCategory, OsmLayer | null>>;

const nowIso = () => new Date().toISOString();
const r1 = (x: number) => Math.round(x * 10) / 10;

function missing(code: string, unit: string, reason: string, nextAction: string, extra: Partial<DocumentedValue> = {}): DocumentedValue {
  return {
    code, raw: null, unit, source: '—', sourceIds: [], channel: 'open_auto', tier: 'open_measured', geographyLevel: 'neighborhood',
    observedAt: null, fetchedAt: nowIso(), method: 'none', methodQuality: 0, sampleAdequacy: 0, cadence: 'monthly',
    missingReason: reason, nextAction, ...extra,
  };
}

function shareWithin(ctx: NeighborhoodContext, distances: Array<number | null>, thresholdM: number): number {
  let ok = 0, total = 0;
  ctx.gridOrigins.forEach((c, i) => {
    total += c.weight;
    const d = distances[i];
    if (d !== null && d <= thresholdM) ok += c.weight;
  });
  return total > 0 ? (ok / total) * 100 : 0;
}

function osmBase(layer: OsmLayer): { source: string; sourceIds: string[]; observedAt: string | null; fetchedAt: string } {
  return { source: `OpenStreetMap (Overpass ${new URL(layer.endpoint).host})`, sourceIds: [`osm:${layer.category}`], observedAt: layer.observedAt, fetchedAt: layer.fetchedAt };
}

const weightNote = (ctx: NeighborhoodContext) => ctx.gridWeighting === 'worldpop' ? 'وزن جمعیتی WorldPop' : 'وزن یکنواخت (جمعیت شبکه در دسترس نیست)';
const weightQuality = (ctx: NeighborhoodContext) => (ctx.gridWeighting === 'worldpop' ? 1 : 0.85);

async function accessShare(code: string, ctx: NeighborhoodContext, layer: OsmLayer | null | undefined, filter: (kind: string) => boolean, thresholdM: number, label: string): Promise<DocumentedValue> {
  if (!layer) return missing(code, '%', 'لایهٔ OSM شهر در دسترس نیست', 'npx tsx scripts/fetch_city_layers.ts <city>');
  const targets = layer.points.filter((p) => filter(p.kind));
  if (!targets.length) return missing(code, '%', `هیچ ${label} در لایهٔ OSM شهر ثبت نشده`, 'تکمیل OSM یا دادهٔ رسمی');
  const dist = await walkDistances(ctx.gridOrigins, targets);
  const value = shareWithin(ctx, dist.distancesM, thresholdM);
  const cells = dist.distancesM.map((d) => (d !== null && d <= thresholdM ? 1 : 0));
  return {
    code, raw: r1(value), unit: '%', ...osmBase(layer), channel: 'open_auto', tier: 'open_measured', geographyLevel: 'neighborhood',
    method: `${dist.method}; آستانه ${thresholdM} متر؛ ${weightNote(ctx)}`, methodQuality: dist.methodQuality * weightQuality(ctx),
    sampleAdequacy: Math.min(1, ctx.gridOrigins.length / 4), cadence: 'monthly',
    notes: [dist.note, `${targets.length} مقصد در محدودهٔ شهر`].filter(Boolean) as string[],
    details: { targets: targets.length, origins: ctx.gridOrigins.length, thresholdM, cells },
  };
}

async function medianTime(code: string, ctx: NeighborhoodContext, layer: OsmLayer | null | undefined, filter: (kind: string) => boolean, label: string, tier: DocumentedValue['tier']): Promise<DocumentedValue> {
  if (!layer) return missing(code, 'min', 'لایهٔ OSM شهر در دسترس نیست', 'npx tsx scripts/fetch_city_layers.ts <city>', { lowerIsBetter: true });
  const targets = layer.points.filter((p) => filter(p.kind));
  if (!targets.length) return missing(code, 'min', `هیچ ${label} ثبت نشده`, 'تکمیل OSM', { lowerIsBetter: true });
  const dist = await walkDistances(ctx.gridOrigins, targets, 8000);
  const med = weightedMedian(ctx.gridOrigins.map((c, i) => ({ value: (dist.distancesM[i] ?? 8000) / WALK_M_PER_MIN, weight: c.weight })));
  return {
    code, raw: med === null ? null : r1(med), unit: 'min', ...osmBase(layer), channel: 'open_auto', tier, geographyLevel: 'neighborhood',
    method: `میانهٔ وزنی زمان پیاده (${WALK_M_PER_MIN} م/دقیقه)؛ ${dist.method}؛ ${weightNote(ctx)}`, methodQuality: dist.methodQuality * weightQuality(ctx),
    sampleAdequacy: Math.min(1, ctx.gridOrigins.length / 4), cadence: 'monthly', lowerIsBetter: true,
    notes: [dist.note].filter(Boolean) as string[], details: { targets: targets.length },
  };
}

function perCapitaInside(code: string, entry: GazetteerEntry, ctx: NeighborhoodContext, layer: OsmLayer | null | undefined, filter: (kind: string) => boolean, label: string, tier: DocumentedValue['tier']): DocumentedValue {
  if (!layer) return missing(code, 'per_1000', 'لایهٔ OSM شهر در دسترس نیست', 'npx tsx scripts/fetch_city_layers.ts <city>');
  const inside = layer.points.filter((p) => filter(p.kind) && pointInGeom(p.lng, p.lat, entry.boundary.geojson)).length;
  const pop = ctx.population.value;
  if (!pop || pop < 100) {
    return missing(code, 'per_1000', 'جمعیت محله نامعلوم است؛ شمارش خام بدون مخرج امتیاز نمی‌گیرد', 'تنظیم WORLDPOP_COG_PATH یا بارگذاری POP مرکز آمار', { details: { countInside: inside } });
  }
  return {
    code, raw: Math.round((inside / pop) * 1000 * 100) / 100, unit: 'per_1000', numerator: inside, denominator: pop, denominatorKind: 'population',
    ...osmBase(layer), channel: 'open_auto', tier, geographyLevel: 'neighborhood',
    method: `${label} درون مرز ÷ جمعیت (${ctx.population.source}) × ۱۰۰۰`, methodQuality: ctx.population.tier === 'official' ? 1 : 0.85,
    sampleAdequacy: 1, cadence: 'monthly', details: { countInside: inside, population: pop },
  };
}

// ---------- P2: گراف پیاده ----------
const WALKABLE = 'primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|footway|path|service|steps|track|cycleway|primary_link|secondary_link|tertiary_link|corridor';

export function connectivityFromWays(ways: Array<Array<[number, number]>>, geom: AreaGeom): { ratio: number; totalM: number; largestM: number; components: number } {
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; let c = x; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  const add = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const segs: Array<{ a: string; len: number }> = [];
  for (const way of ways) {
    for (let i = 0; i < way.length - 1; i++) {
      const p = way[i], q = way[i + 1];
      const mid: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (!pointInGeom(mid[0], mid[1], geom)) continue;
      const ka = `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
      const kb = `${q[0].toFixed(7)},${q[1].toFixed(7)}`;
      add(ka); add(kb); union(ka, kb);
      segs.push({ a: ka, len: haversineM({ lng: p[0], lat: p[1] }, { lng: q[0], lat: q[1] }) });
    }
  }
  const byRoot = new Map<string, number>();
  let total = 0;
  for (const s of segs) { const r = find(s.a); byRoot.set(r, (byRoot.get(r) ?? 0) + s.len); total += s.len; }
  const largest = Math.max(0, ...byRoot.values());
  return { ratio: total > 0 ? (largest / total) * 100 : 0, totalM: total, largestM: largest, components: byRoot.size };
}

async function computeP2(entry: GazetteerEntry, opts: { offline?: boolean }): Promise<DocumentedValue> {
  const cacheFile = path.join(serverDataDir(), 'osm-cache', entry.citySlug, 'network', `${entry.neighborhoodId.replace(/[^\w.-]/g, '_')}.json`);
  let cached: { ways: Array<Array<[number, number]>>; observedAt: string | null; fetchedAt: string; endpoint: string } | null = null;
  if (fs.existsSync(cacheFile)) cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < Number(process.env.ARA_OSM_LAYER_TTL_DAYS || 30) * 86_400_000;
  if (!fresh && !opts.offline) {
    try {
      const q = `[out:json][timeout:120];way["highway"~"^(${WALKABLE})$"]["foot"!~"no"]["access"!~"private|no"](poly:"${overpassPoly(entry.boundary.geojson)}");out geom qt;`;
      const { payload, endpoint } = await overpass(q, 60_000);
      const p = payload as { elements?: Array<{ geometry?: Array<{ lat: number; lon: number }> }>; osm3s?: { timestamp_osm_base?: string } };
      cached = { ways: (p.elements ?? []).map((e) => (e.geometry ?? []).map((g) => [g.lon, g.lat] as [number, number])).filter((w) => w.length >= 2), observedAt: p.osm3s?.timestamp_osm_base ?? null, fetchedAt: nowIso(), endpoint };
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cached));
    } catch (error) {
      if (!cached) return missing('P2', '%', `واکشی شبکهٔ معابر ناموفق: ${error instanceof Error ? error.message : error}`, 'تکرار پس از دسترس‌پذیری Overpass');
    }
  }
  if (!cached) return missing('P2', '%', 'شبکهٔ معابر در کش نیست (حالت آفلاین)', 'اجرای تحلیل آنلاین');
  const c = connectivityFromWays(cached.ways, entry.boundary.geojson);
  if (c.totalM < 200) return missing('P2', '%', 'طول شبکهٔ معابر نگاشته‌شده کمتر از ۲۰۰ متر است', 'تکمیل OSM');
  return {
    code: 'P2', raw: r1(c.ratio), unit: '%', source: `OpenStreetMap highway graph (${new URL(cached.endpoint).host})`, sourceIds: ['osm:network'],
    channel: 'open_auto', tier: 'open_measured', geographyLevel: 'neighborhood', observedAt: cached.observedAt, fetchedAt: cached.fetchedAt,
    method: 'طول بزرگ‌ترین مؤلفهٔ متصل گراف پیاده ÷ کل طول شبکهٔ درون مرز', methodQuality: 0.9, sampleAdequacy: Math.min(1, c.totalM / 5000), cadence: 'monthly',
    details: { totalKm: r1(c.totalM / 1000), largestKm: r1(c.largestM / 1000), components: c.components },
  };
}

// ---------- N2: پوشش سبز ----------
async function computeN2(entry: GazetteerEntry, parks: OsmLayer | null | undefined, useKernel: boolean): Promise<DocumentedValue> {
  if (useKernel && process.env.NDVI_COG_PATH) {
    try {
      const { status, payload } = await kernelClient.zonalStats({ raster_id: 'ndvi', geometry: entry.boundary.geojson, threshold: 0.3 });
      const r = payload.result;
      if (status === 200 && r?.share_ge_threshold !== undefined) {
        return {
          code: 'N2', raw: r1(r.share_ge_threshold * 100), unit: '%', source: `NDVI raster (${r.file})`, sourceIds: ['raster:ndvi'], channel: 'satellite', tier: 'open_measured',
          geographyLevel: 'neighborhood', observedAt: process.env.NDVI_OBSERVED_AT ?? null, observedAtUnknown: !process.env.NDVI_OBSERVED_AT, fetchedAt: nowIso(),
          method: 'سهم پیکسل‌های NDVI ≥ ۰٫۳ درون مرز', methodQuality: 1, sampleAdequacy: r.valid_fraction, cadence: 'monthly',
        };
      }
    } catch { /* fall back to OSM proxy */ }
  }
  if (!parks) return missing('N2', '%', 'لایهٔ سبز OSM و رستر NDVI در دسترس نیست', 'تنظیم NDVI_COG_PATH یا واکشی لایه‌های شهر');
  const samples = gridInside(entry.boundary.geojson, 50);
  const b = bboxOf(entry.boundary.geojson);
  const candidates = parks.areas.filter((a) => { const ab = bboxOf(a.geom); return !(ab[2] < b[0] || ab[0] > b[2] || ab[3] < b[1] || ab[1] > b[3]); });
  const green = samples.filter((s) => candidates.some((a) => pointInGeom(s.lng, s.lat, a.geom))).length;
  return {
    code: 'N2', raw: r1((green / samples.length) * 100), unit: '%', ...osmBase(parks), channel: 'open_auto', tier: 'proxy', geographyLevel: 'neighborhood',
    method: 'سهم نقاط نمونهٔ ۵۰ متری درون پهنه‌های سبز نگاشته‌شده در OSM (پوشش تاج درختان خیابانی را نمی‌بیند)', methodQuality: 0.6,
    sampleAdequacy: Math.min(1, samples.length / 100), cadence: 'monthly',
    nextAction: 'برای سنجش مستقیم: NDVI_COG_PATH (Sentinel-2 فصل رشد) را تنظیم کنید', details: { samples: samples.length, greenSamples: green },
  };
}

// ---------- N3: کیفیت هوا ----------
async function computeN3(entry: GazetteerEntry, opts: { offline?: boolean }): Promise<DocumentedValue> {
  const { lat, lng } = entry.centroid;
  const cacheFile = path.join(serverDataDir(), 'air-cache', `${lat.toFixed(2)}_${lng.toFixed(2)}.json`);
  let data: { mean: number; days: number; hours: number; latest: string; fetchedAt: string } | null = null;
  if (fs.existsSync(cacheFile)) {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (opts.offline || Date.now() - Date.parse(c.fetchedAt) < 86_400_000) data = c;
  }
  if (!data && !opts.offline) {
    try {
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=pm2_5&past_days=92&forecast_days=0&timezone=UTC`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const body = await res.json() as { hourly?: { time: string[]; pm2_5: Array<number | null> } };
      const vals = (body.hourly?.pm2_5 ?? []).map((v, i) => ({ v, t: body.hourly!.time[i] })).filter((x) => typeof x.v === 'number') as Array<{ v: number; t: string }>;
      if (vals.length < 24 * 30) throw new Error(`فقط ${vals.length} ساعت داده`);
      data = { mean: vals.reduce((a, x) => a + x.v, 0) / vals.length, days: Math.round(vals.length / 24), hours: vals.length, latest: `${vals[vals.length - 1].t}Z`, fetchedAt: nowIso() };
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(data));
    } catch (error) {
      return missing('N3', 'µg/m³', `Open-Meteo در دسترس نیست: ${error instanceof Error ? error.message : error}`, 'اتصال کانکتور aqms-doe/air-tehran (ایستگاه رسمی)', { lowerIsBetter: true });
    }
  }
  if (!data) return missing('N3', 'µg/m³', 'دادهٔ هوا در کش نیست (آفلاین)', 'اجرای آنلاین', { lowerIsBetter: true });
  return {
    code: 'N3', raw: r1(data.mean), unit: 'µg/m³', source: 'CAMS global via Open-Meteo Air Quality API', sourceIds: ['open-meteo-air'],
    channel: 'open_auto', tier: 'open_model', geographyLevel: 'district', observedAt: data.latest, fetchedAt: data.fetchedAt,
    method: `میانگین PM2.5 ساعتی ${data.days} روز اخیر در مرکز محله (شبکهٔ مدل ~۱۱ کیلومتر؛ نه میانگین سالانه)`, methodQuality: 0.7,
    sampleAdequacy: Math.min(1, data.days / 365), cadence: 'daily', lowerIsBetter: true,
    nextAction: 'برای سطح official: ایستگاه‌های پایش aqms.doe.ir / air.tehran.ir با درون‌یابی IDW جمعیت‌وزن‌دار',
  };
}

const isPark = (a: { kind: string; areaM2: number }) => ['park', 'garden', 'nature_reserve', 'recreation_ground', 'village_green'].includes(a.kind) && a.areaM2 >= 5000;

async function computeN1(ctx: NeighborhoodContext, parks: OsmLayer | null | undefined): Promise<DocumentedValue> {
  if (!parks) return missing('N1', '%', 'لایهٔ فضای سبز OSM در دسترس نیست', 'واکشی لایه‌های شهر');
  const big = parks.areas.filter(isPark);
  if (!big.length) return missing('N1', '%', 'هیچ فضای سبز عمومی ≥۰٫۵ هکتار ثبت نشده', 'تکمیل OSM/دادهٔ سازمان پارک‌ها');
  const threshold = 300;
  // فاصلهٔ اقلیدسی تا لبهٔ پارک × ضریب پیچش (یا Valhalla در نسخهٔ بعد)
  let ok = 0, total = 0;
  const cells: number[] = [];
  for (const c of ctx.gridOrigins) {
    total += c.weight;
    const near = big.some((a) => {
      const b = bboxOf(a.geom);
      const pad = threshold / 111_320 * 1.5;
      if (c.lng < b[0] - pad * 1.3 || c.lng > b[2] + pad * 1.3 || c.lat < b[1] - pad || c.lat > b[3] + pad) return false;
      return distanceToGeomM(c.lng, c.lat, a.geom) * 1.3 <= threshold;
    });
    cells.push(near ? 1 : 0);
    if (near) ok += c.weight;
  }
  return {
    code: 'N1', raw: r1(total ? (ok / total) * 100 : 0), unit: '%', ...osmBase(parks), channel: 'open_auto', tier: 'open_measured', geographyLevel: 'neighborhood',
    method: `سهم جمعیت با فاصلهٔ پیادهٔ تقریبی (اقلیدسی تا لبه ×۱٫۳) ≤ ${threshold} متر تا فضای سبز عمومی ≥ ۰٫۵ هکتار؛ ${weightNote(ctx)}`,
    methodQuality: 0.75 * weightQuality(ctx), sampleAdequacy: Math.min(1, ctx.gridOrigins.length / 4), cadence: 'monthly',
    details: { parks: big.length, cells },
  };
}

export async function computeOpenIndicators(entry: GazetteerEntry, ctx: NeighborhoodContext, layers: CityLayers, opts: { offline?: boolean; useKernel?: boolean; skipNetwork?: boolean; skipAir?: boolean } = {}): Promise<DocumentedValue[]> {
  const useKernel = opts.useKernel !== false;
  const basicHealth = (k: string) => ['hospital', 'clinic', 'doctors', 'health_post', 'centre', 'doctor', 'pharmacy'].includes(k);
  const knowledge = (k: string) => ['school', 'university', 'college', 'library'].includes(k);

  const p5 = await (async (): Promise<DocumentedValue> => {
    const layer = layers.transit;
    if (!layer) return missing('P5', '%', 'لایهٔ ایستگاه‌ها در دسترس نیست', 'واکشی لایه‌های شهر');
    const bus = await walkDistances(ctx.gridOrigins, layer.points.filter((p) => p.kind === 'bus'));
    const rapid = await walkDistances(ctx.gridOrigins, layer.points.filter((p) => p.kind === 'rapid'));
    let ok = 0, total = 0;
    const cells: number[] = [];
    ctx.gridOrigins.forEach((c, i) => {
      total += c.weight;
      const b = bus.distancesM[i], r = rapid.distancesM[i];
      const covered = (b !== null && b <= 400) || (r !== null && r <= 800);
      cells.push(covered ? 1 : 0);
      if (covered) ok += c.weight;
    });
    return {
      code: 'P5', raw: r1(total ? (ok / total) * 100 : 0), unit: '%', ...osmBase(layer), channel: 'open_auto', tier: 'open_measured', geographyLevel: 'neighborhood',
      method: `سهم جمعیت در ۴۰۰ متری ایستگاه اتوبوس یا ۸۰۰ متری مترو/BRT (${bus.method})؛ ${weightNote(ctx)}`, methodQuality: bus.methodQuality * weightQuality(ctx) * 0.9,
      sampleAdequacy: Math.min(1, ctx.gridOrigins.length / 4), cadence: 'monthly',
      notes: ['بدون فرکانس سرویس (GTFS)؛ با فید GTFS شرط سرفاصلهٔ ≤۱۵ دقیقه اعمال می‌شود', bus.note].filter(Boolean) as string[],
      details: { busStops: layer.points.filter((p) => p.kind === 'bus').length, rapidStations: layer.points.filter((p) => p.kind === 'rapid').length, cells },
    };
  })();

  const [p4, r3, r1v, n1, n2, n3, n4, p2] = await Promise.all([
    accessShare('P4', ctx, layers.health, basicHealth, 15 * WALK_M_PER_MIN, 'مرکز سلامت'),
    medianTime('R3', ctx, layers.education, knowledge, 'مدرسه/دانشگاه/کتابخانه', 'open_measured'),
    medianTime('R1', ctx, layers.transit, (k) => k === 'rapid', 'ایستگاه مترو/BRT', 'proxy'),
    computeN1(ctx, layers.parks),
    computeN2(entry, layers.parks, useKernel),
    opts.skipAir ? Promise.resolve(missing('N3', 'µg/m³', 'skipped', '—', { lowerIsBetter: true })) : computeN3(entry, opts),
    computeN4(entry, ctx, useKernel),
    opts.skipNetwork ? Promise.resolve(missing('P2', '%', 'skipped', '—')) : computeP2(entry, opts),
  ]);
  if (r1v.raw !== null) {
    r1v.method = `پروکسی R1: ${r1v.method}`;
    r1v.nextAction = 'برای تعریف رجیستر (زمان سفر به مراکز شهری) GTFS + Valhalla multimodal لازم است';
  }
  const c1 = perCapitaInside('C1', entry, ctx, layers.culture, () => true, 'دارایی فرهنگی/تاریخی/مذهبی', 'open_measured');
  const e2 = perCapitaInside('E2', entry, ctx, layers.commerce, () => true, 'بنگاه (shop/office/craft/خدمات) نگاشته‌شده', 'proxy');
  if (e2.raw !== null) e2.nextAction = 'برای سطح official: دادهٔ پروانهٔ فعال اتاق اصناف + بیمه‌شدگان تأمین اجتماعی';
  const n5 = await computeN5(entry, ctx, useKernel, n4);
  const r2 = computeR2(ctx, layers.commerce);
  const r5 = computeR5(entry, ctx);
  return [p2, p4, p5, n1, n2, n3, n4.value, n5, r1v, r2, r3, c1, e2, r5];
}
