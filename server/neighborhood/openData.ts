/**
 * شاخص‌های خودکار از دادهٔ باز جهانی (آماده‌شده با npm run neighborhood:open-data -- <city>):
 *
 * N4 مواجهه با خطر       — سهم جمعیت در پهنهٔ خطر: سیل T100 (JRC) ∪ حریم گسل فعال (GEM) ∪ شیب تند (Copernicus DEM)
 * N5 تاب‌آوری اقلیمی     — میانگین وزنی جمعیتی امتیاز سلول: پوشش درختی، سایر پوشش گیاهی، سطح نفوذپذیر (ESA WorldCover) و نبود خطر (N4)
 * R2 دسترسی به فرصت شغلی — میانهٔ جمعیت‌وزن‌دار تعداد بنگاه‌های OSM در ۲۰ دقیقه پیاده‌روی
 * R5 اتصال دیجیتال       — میانهٔ جمعیت‌وزن‌دار سرعت دانلود (Speedtest by Ookla، کاشی‌های ~۶۱۰ متری)
 *
 * هیچ مقدار پیش‌فرضی ساخته نمی‌شود: نبود هر منبع → missing با دلیل و اقدام بعدی.
 */
import fs from 'node:fs';
import path from 'node:path';
import { kernelClient } from '../kernelClient';
import { serverDataDir } from '../paths';
import type { DocumentedValue } from '../evidence/types';
import type { NeighborhoodContext } from './context';
import type { GazetteerEntry } from './gazetteer';
import { haversineM, weightedMedian } from './geo';
import type { OsmLayer } from './osmLayers';
import { WALK_M_PER_MIN } from './routing';

const nowIso = () => new Date().toISOString();
const r1 = (x: number) => Math.round(x * 10) / 10;
const PREPARE = (city: string) => `npm run neighborhood:open-data -- ${city}`;

export const FAULT_BUFFER_M = () => Number(process.env.ARA_FAULT_BUFFER_M || 500);
export const STEEP_SLOPE_PCT = () => Number(process.env.ARA_STEEP_SLOPE_PCT || 20);
export const JOB_WALK_MIN = () => Number(process.env.ARA_JOB_WALK_MIN || 20);
const DETOUR = 1.3;

function missing(code: string, unit: string, reason: string, nextAction: string, extra: Partial<DocumentedValue> = {}): DocumentedValue {
  return {
    code, raw: null, unit, source: '—', sourceIds: [], channel: 'open_auto', tier: 'open_measured', geographyLevel: 'neighborhood',
    observedAt: null, fetchedAt: nowIso(), method: 'none', methodQuality: 0, sampleAdequacy: 0, cadence: 'static',
    missingReason: reason, nextAction, ...extra,
  };
}

export function openVectorDir(city: string): string { return path.join(serverDataDir(), 'open-vector', city); }
function readJson<T>(file: string): T | null {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as T : null; } catch { return null; }
}

// ---------- هندسهٔ خطی ----------
/** فاصلهٔ نقطه تا پاره‌خط (متر، تقریب مسطح محلی) */
export function pointToSegmentM(p: [number, number], a: [number, number], b: [number, number]): number {
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180), ky = 110_540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
export function distanceToLinesM(p: [number, number], lines: Array<Array<[number, number]>>): number {
  let best = Infinity;
  for (const ln of lines) for (let i = 0; i < ln.length - 1; i++) best = Math.min(best, pointToSegmentM(p, ln[i], ln[i + 1]));
  return best;
}

// ---------- Ookla quadkey ----------
export function quadkeyAt(lat: number, lng: number, z: number): string {
  const x = (lng + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  const tx = Math.floor(x * 2 ** z), ty = Math.floor(y * 2 ** z);
  let k = '';
  for (let i = z; i > 0; i--) { const m = 1 << (i - 1); k += String((tx & m ? 1 : 0) + (ty & m ? 2 : 0)); }
  return k;
}

interface OoklaFile { source: string; type: 'fixed' | 'mobile'; quarter: string; periodStart: string; fetchedAt: string; zoom: number; tiles: Array<{ q: string; d: number; u: number; lat: number; tests: number; devices: number }> }

/** ترکیب ثابت+همراه در هر سلول: میانگین سرعت وزن‌دهی‌شده با تعداد آزمون */
export function ooklaCellSpeeds(cells: Array<{ lat: number; lng: number }>, files: OoklaFile[]): Array<{ mbps: number; tests: number } | null> {
  const maps = files.map((f) => ({ z: f.zoom || 16, m: new Map(f.tiles.map((t) => [t.q, t])) }));
  return cells.map((c) => {
    let sum = 0, tests = 0;
    for (const { z, m } of maps) {
      const t = m.get(quadkeyAt(c.lat, c.lng, z));
      if (t && t.tests > 0) { sum += (t.d / 1000) * t.tests; tests += t.tests; }
    }
    return tests ? { mbps: sum / tests, tests } : null;
  });
}

export function computeR5(entry: GazetteerEntry, ctx: NeighborhoodContext): DocumentedValue {
  const dir = openVectorDir(entry.citySlug);
  const files = (['fixed', 'mobile'] as const).map((k) => readJson<OoklaFile>(path.join(dir, `ookla_${k}.json`))).filter(Boolean) as OoklaFile[];
  if (!files.length) return missing('R5', 'Mbps', 'کاشی‌های Ookla Open Data برای این شهر آماده نشده', PREPARE(entry.citySlug), { cadence: 'quarterly' });
  const speeds = ooklaCellSpeeds(ctx.gridOrigins, files);
  let covered = 0, total = 0, testsSum = 0;
  ctx.gridOrigins.forEach((c, i) => { total += c.weight; if (speeds[i]) { covered += c.weight; testsSum += speeds[i]!.tests; } });
  const med = weightedMedian(ctx.gridOrigins.map((c, i) => ({ value: speeds[i]?.mbps ?? NaN, weight: c.weight })));
  if (med === null) return missing('R5', 'Mbps', 'هیچ آزمون سرعتی در کاشی‌های درون مرز ثبت نشده', 'دادهٔ سازمان تنظیم مقررات (الگوی cra.csv)', { cadence: 'quarterly', details: { tilesLoaded: files.map((f) => f.tiles.length) } });
  const coverage = total ? covered / total : 0;
  return {
    code: 'R5', raw: r1(med), unit: 'Mbps', source: `${files[0].source} — ${files.map((f) => `${f.type} ${f.quarter}`).join('، ')}`,
    sourceIds: files.map((f) => `ookla:${f.type}:${f.quarter}`), channel: 'open_auto', tier: 'proxy', geographyLevel: 'neighborhood',
    observedAt: files.map((f) => f.periodStart).sort().pop() ?? null, fetchedAt: files[0].fetchedAt,
    method: `میانهٔ جمعیت‌وزن‌دار سرعت دانلود (ثابت+همراه، وزن تعداد آزمون) در کاشی‌های Ookla؛ پوشش جمعیتی کاشی‌های دارای آزمون ${Math.round(coverage * 100)}٪`,
    methodQuality: 0.7, sampleAdequacy: Math.min(1, coverage * Math.min(1, testsSum / 200)), cadence: 'quarterly',
    notes: ['فقط مؤلفهٔ «کیفیت» فرمول (پوشش × کیفیت × استفادهٔ مؤثر)؛ پوشش در sampleAdequacy لحاظ شده', 'داده جمع‌سپاری‌شده است و کاربران Speedtest نمونهٔ تصادفی نیستند', 'مجوز CC BY-NC-SA 4.0 — فقط استفادهٔ غیرتجاری'],
    nextAction: 'برای سطح official: دادهٔ سازمان تنظیم مقررات ارتباطات (الگوی cra.csv)',
    details: { coverage: Math.round(coverage * 1000) / 1000, tests: testsSum, quarters: files.map((f) => `${f.type}:${f.quarter}`) },
  };
}

// ---------- R2 ----------
/** تعداد نقاط در شعاع r (متر) برای هر مبدأ با سطل‌بندی ساده */
export function countWithin(origins: Array<{ lat: number; lng: number }>, points: Array<{ lat: number; lng: number }>, radiusM: number): number[] {
  const cell = 0.01;
  const buckets = new Map<string, Array<{ lat: number; lng: number }>>();
  for (const p of points) {
    const k = `${Math.floor(p.lat / cell)}:${Math.floor(p.lng / cell)}`;
    const a = buckets.get(k); if (a) a.push(p); else buckets.set(k, [p]);
  }
  return origins.map((o) => {
    const ring = Math.ceil(radiusM / (cell * 111_320 * Math.cos((o.lat * Math.PI) / 180))) + 1;
    const r0 = Math.floor(o.lat / cell), c0 = Math.floor(o.lng / cell);
    let n = 0;
    for (let dr = -ring; dr <= ring; dr++) for (let dc = -ring; dc <= ring; dc++) {
      for (const p of buckets.get(`${r0 + dr}:${c0 + dc}`) ?? []) if (haversineM(o, p) <= radiusM) n++;
    }
    return n;
  });
}

export function computeR2(ctx: NeighborhoodContext, commerce: OsmLayer | null | undefined): DocumentedValue {
  if (!commerce) return missing('R2', 'count', 'لایهٔ بنگاه‌های OSM شهر در دسترس نیست', 'npm run neighborhood:layers -- <city>', { cadence: 'monthly' });
  if (!commerce.points.length) return missing('R2', 'count', 'هیچ بنگاهی در OSM شهر ثبت نشده', 'تکمیل OSM', { cadence: 'monthly' });
  const minutes = JOB_WALK_MIN();
  const radius = (minutes * WALK_M_PER_MIN) / DETOUR;
  const counts = countWithin(ctx.gridOrigins, commerce.points, radius);
  const med = weightedMedian(ctx.gridOrigins.map((c, i) => ({ value: counts[i], weight: c.weight })));
  if (med === null) return missing('R2', 'count', 'شبکهٔ مبدأ خالی است', 'بررسی مرز', { cadence: 'monthly' });
  return {
    code: 'R2', raw: Math.round(med), unit: 'count', source: `OpenStreetMap (Overpass ${new URL(commerce.endpoint).host})`, sourceIds: ['osm:commerce'],
    channel: 'open_auto', tier: 'proxy', geographyLevel: 'neighborhood', observedAt: commerce.observedAt, fetchedAt: commerce.fetchedAt,
    method: `میانهٔ جمعیت‌وزن‌دار تعداد بنگاه‌های نگاشته‌شده (shop/office/craft/خدمات) در ${minutes} دقیقه پیاده (${Math.round(radius)} متر مستقیم = ${minutes * WALK_M_PER_MIN} متر مسیر با ضریب پیچش ${DETOUR})`,
    methodQuality: ctx.gridWeighting === 'worldpop' ? 0.7 : 0.6, sampleAdequacy: Math.min(1, ctx.gridOrigins.length / 4), cadence: 'monthly',
    notes: ['بنگاه OSM جانشین «فرصت شغلی» است؛ اندازهٔ بنگاه و تعداد شاغل را نمی‌بیند', 'فاصلهٔ مستقیم با ضریب پیچش؛ با VALHALLA_URL قابل جایگزینی با شبکهٔ واقعی'],
    nextAction: 'برای سطح official: تعداد شاغلان به تفکیک محل کار (تأمین اجتماعی/اصناف)',
    details: { walkMinutes: minutes, radiusM: Math.round(radius), cityPoints: commerce.points.length },
  };
}

// ---------- N4 ----------
interface FaultsFile { source: string; fetchedAt: string; faults: Array<{ name: string | null; slip_type: string | null; lines: Array<Array<[number, number]>> }> }

export interface HazardResult { value: DocumentedValue; exposedCells: number[] | null }

export function combineHazard(weights: number[], layers: Array<Array<number | null> | null>): { share: number; exposed: number[] } {
  const exposed = weights.map((_, i) => (layers.some((l) => l && (l[i] ?? 0) > 0) ? 1 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const hit = weights.reduce((a, w, i) => a + (exposed[i] ? w : 0), 0);
  return { share: total ? (hit / total) * 100 : 0, exposed };
}

export async function computeN4(entry: GazetteerEntry, ctx: NeighborhoodContext, useKernel: boolean): Promise<HazardResult> {
  const city = entry.citySlug;
  const centers = ctx.gridOrigins.map((c) => [c.lng, c.lat] as [number, number]);
  const components: string[] = [];
  const sources: string[] = [];
  const sourceIds: string[] = [];
  const layers: Array<Array<number | null>> = [];
  const detail: Record<string, unknown> = {};
  const failures: string[] = [];

  const faultsFile = process.env.ARA_FAULTS_GEOJSON_PATH ? null : readJson<FaultsFile>(path.join(openVectorDir(city), 'faults.json'));
  const faultLines = process.env.ARA_FAULTS_GEOJSON_PATH ? officialFaultLines(process.env.ARA_FAULTS_GEOJSON_PATH) : faultsFile?.faults.flatMap((f) => f.lines) ?? null;
  if (faultLines && faultLines.length) {
    const buf = FAULT_BUFFER_M();
    const d = centers.map((p) => distanceToLinesM(p, faultLines));
    layers.push(d.map((x) => (x <= buf ? 1 : 0)));
    components.push(`حریم ${buf} متری گسل فعال`);
    sources.push(process.env.ARA_FAULTS_GEOJSON_PATH ? `گسل‌های رسمی (${path.basename(process.env.ARA_FAULTS_GEOJSON_PATH)})` : 'GEM Global Active Faults');
    sourceIds.push('vector:faults');
    detail.nearestFaultM = Math.round(Math.min(...d));
  } else failures.push('گسل');

  if (useKernel) {
    const zonal = async (raster_id: string, threshold?: number) => {
      const { status, payload } = await kernelClient.zonalStats({ raster_id, geometry: entry.boundary.geojson, cell_centers: centers, cell_size_m: ctx.gridCellM, threshold, city });
      if (status !== 200 || !payload.result) throw new Error(payload.error?.code ?? String(status));
      return payload.result;
    };
    try {
      const r = await zonal('jrc_flood', 0.01);
      layers.push((r.cells ?? []).map((x) => (x > 0 ? 1 : 0)));
      components.push('عمق سیل T100 > ۰'); sources.push(`JRC CEMS-GloFAS flood hazard v2.1 (${r.file})`); sourceIds.push('raster:jrc_flood');
      detail.floodPixelShare = r.share_ge_threshold;
    } catch (e) { failures.push(`سیل (${e instanceof Error ? e.message : e})`); }
    try {
      const steep = STEEP_SLOPE_PCT();
      const r = await zonal('slope', steep);
      layers.push((r.cell_share_ge_threshold ?? []).map((x) => (x !== null && x >= 0.5 ? 1 : 0)));
      components.push(`شیب ≥ ${steep}٪ در بیش از نیمی از سلول`); sources.push(`Copernicus DEM GLO-30 (${r.file})`); sourceIds.push('raster:slope');
      detail.steepPixelShare = r.share_ge_threshold;
    } catch (e) { failures.push(`شیب (${e instanceof Error ? e.message : e})`); }
  } else failures.push('سیل و شیب (kernel خاموش)');

  if (!layers.length) {
    return { exposedCells: null, value: missing('N4', '%', `هیچ لایهٔ خطری آماده نیست: ${failures.join('، ')}`, PREPARE(city), { lowerIsBetter: true }) };
  }
  const { share, exposed } = combineHazard(ctx.gridOrigins.map((c) => c.weight), layers);
  return {
    exposedCells: exposed,
    value: {
      code: 'N4', raw: r1(share), unit: '%', source: sources.join(' + '), sourceIds, channel: 'satellite', tier: 'open_measured', geographyLevel: 'neighborhood',
      observedAt: null, observedAtUnknown: true, fetchedAt: faultsFile?.fetchedAt ?? nowIso(),
      method: `سهم جمعیت (${ctx.gridWeighting === 'worldpop' ? 'وزن WorldPop' : 'وزن یکنواخت'}) در سلول‌های ${ctx.gridCellM} متری که در دست‌کم یکی از این پهنه‌ها هستند: ${components.join('، ')}`,
      methodQuality: Math.min(1, 0.45 + 0.15 * layers.length), sampleAdequacy: Math.min(1, ctx.gridOrigins.length / 4), cadence: 'static', lowerIsBetter: true,
      notes: [
        ...(failures.length ? [`مؤلفه‌های در دسترس نبودند: ${failures.join('، ')}`] : []),
        'نقشهٔ گسل جهانی دقت ریزپهنه‌بندی ندارد؛ برای سطح official نقشهٔ ریزپهنه‌بندی لرزه‌ای/حریم گسل رسمی را با ARA_FAULTS_GEOJSON_PATH بدهید',
      ],
      nextAction: 'ریزپهنه‌بندی لرزه‌ای و حریم گسل مصوب (سازمان مدیریت بحران / پژوهشگاه زلزله)',
      details: { ...detail, components, exposedCells: exposed.reduce((a, b) => a + b, 0), cells: exposed.length },
    },
  };
}

function officialFaultLines(file: string): Array<Array<[number, number]>> | null {
  const fc = readJson<{ features?: Array<{ geometry?: { type: string; coordinates: unknown } }> }>(file);
  if (!fc?.features) return null;
  const out: Array<Array<[number, number]>> = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (g?.type === 'LineString') out.push(g.coordinates as Array<[number, number]>);
    else if (g?.type === 'MultiLineString') out.push(...(g.coordinates as Array<Array<[number, number]>>));
  }
  return out;
}

// ---------- N5 ----------
export const WORLDCOVER_GROUPS = { tree: [10], otherVeg: [20, 30, 40, 90, 95, 100], built: [50] };
export const N5_WEIGHTS = { tree: 0.4, otherVeg: 0.2, permeable: 0.2, noHazard: 0.2 };

export function resilienceScore(f: { tree: number; otherVeg: number; built: number }, hazardExposed: number | null): number {
  const parts: Array<[number, number]> = [
    [N5_WEIGHTS.tree, f.tree], [N5_WEIGHTS.otherVeg, f.otherVeg], [N5_WEIGHTS.permeable, 1 - f.built],
  ];
  if (hazardExposed !== null) parts.push([N5_WEIGHTS.noHazard, hazardExposed ? 0 : 1]);
  const w = parts.reduce((a, [x]) => a + x, 0);
  return (parts.reduce((a, [x, v]) => a + x * v, 0) / w) * 100;
}

export async function computeN5(entry: GazetteerEntry, ctx: NeighborhoodContext, useKernel: boolean, hazard: HazardResult): Promise<DocumentedValue> {
  if (!useKernel) return missing('N5', '0..100', 'kernel خاموش است (رستر پوشش زمین لازم است)', 'اجرا با kernel', { cadence: 'annual' });
  try {
    const { status, payload } = await kernelClient.zonalStats({
      raster_id: 'worldcover', geometry: entry.boundary.geojson, cell_centers: ctx.gridOrigins.map((c) => [c.lng, c.lat]), cell_size_m: ctx.gridCellM,
      city: entry.citySlug, class_groups: WORLDCOVER_GROUPS,
    });
    const r = payload.result;
    if (status !== 200 || !r?.cell_class_fractions) throw new Error(payload.error?.code ?? String(status));
    const scores = r.cell_class_fractions.map((f, i) => (f ? resilienceScore(f as { tree: number; otherVeg: number; built: number }, hazard.exposedCells ? hazard.exposedCells[i] : null) : NaN));
    let wsum = 0, acc = 0;
    ctx.gridOrigins.forEach((c, i) => { if (Number.isFinite(scores[i])) { wsum += c.weight; acc += c.weight * scores[i]; } });
    if (!wsum) throw new Error('هیچ پیکسل معتبری درون مرز نیست');
    const comps = ['پوشش درختی ×۰٫۴', 'سایر پوشش گیاهی ×۰٫۲', 'سطح نفوذپذیر (۱−ساخته‌شده) ×۰٫۲', ...(hazard.exposedCells ? ['بیرون از پهنهٔ خطر N4 ×۰٫۲'] : [])];
    return {
      code: 'N5', raw: r1(acc / wsum), unit: '0..100', source: `ESA WorldCover 10m 2021 v200 (${r.file})${hazard.exposedCells ? ' + N4' : ''}`,
      sourceIds: ['raster:worldcover', ...(hazard.exposedCells ? hazard.value.sourceIds : [])], channel: 'satellite', tier: 'proxy', geographyLevel: 'neighborhood',
      observedAt: '2021-12-31', fetchedAt: nowIso(),
      method: `میانگین جمعیت‌وزن‌دار امتیاز سلول‌های ${ctx.gridCellM} متری: ${comps.join(' + ')} (وزن‌ها بازبهنجار)`,
      methodQuality: 0.6, sampleAdequacy: r.valid_fraction, cadence: 'static',
      notes: ['شاخص ترکیبی جانشین است: ظرفیت خنک‌سازی و نفوذپذیری؛ دمای سطح (LST) و زیرساخت آب‌وهوایی هنوز وارد نشده', 'تصویر پوشش زمین مربوط به ۲۰۲۱ است (آخرین نسخهٔ منتشرشدهٔ WorldCover)'],
      nextAction: 'افزودن دمای سطح زمین تابستانه (Landsat) و دادهٔ رسمی تاب‌آوری',
      details: { classFractions: r.class_fractions, weights: N5_WEIGHTS, hazardIncluded: Boolean(hazard.exposedCells) },
    };
  } catch (error) {
    return missing('N5', '0..100', `رستر پوشش زمین در دسترس نیست: ${error instanceof Error ? error.message : error}`, PREPARE(entry.citySlug), { cadence: 'annual' });
  }
}
