/**
 * گزتیر یکپارچهٔ محلات.
 *
 * منابع (به‌ترتیب اولویت):
 *  ۱) mahalat/*.geojson — مرز رسمی شهرداری تهران (۳۹۱ محله) و محلات کرج (OSM admin / نقطه)
 *  ۲) data/gazetteer/*.geojson — لایه‌های افزودنی هر شهر با همان طرح ویژگی‌ها
 *     (name_fa, city_fa, province_fa, mantaqe_name_fa, feature_level, confidence, source, boundary_source)
 *
 * سطح مرز:
 *  official   — مرز رسمی شهرداری
 *  osm_admin  — مرز اداری OSM
 *  derived    — نقطه بدون مرز؛ بافر ۵۰۰ متری با برچسب پروکسی (سقف انتشار: PROVISIONAL)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../paths';
import { type AreaGeom, areaM2, bboxOf, centroidOf, expandBBox, type Ring } from './geo';
import { citySlug, matchKey, normalizeFa } from './text';

export type BoundaryTier = 'official' | 'osm_admin' | 'derived';

export interface GazetteerEntry {
  neighborhoodId: string;
  nameFa: string;
  nameAlt: string[];
  nameEn?: string;
  cityFa: string;
  citySlug: string;
  districtFa?: string;
  provinceFa: string;
  centroid: { lat: number; lng: number };
  boundary: {
    geojson: AreaGeom;
    source: string;
    tier: BoundaryTier;
    version: string;
    hash: string;
    isProxy: boolean;
    areaKm2: number;
  };
  wikidata?: string | null;
  osmId?: number | null;
  /** کلیدهای تطبیق از پیش محاسبه‌شده */
  keys: string[];
}

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };

function bufferPoint(lng: number, lat: number, radiusM: number, steps = 48): AreaGeom {
  const ring: Ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([
      lng + (radiusM * Math.cos(a)) / (111_320 * Math.cos((lat * Math.PI) / 180)),
      lat + (radiusM * Math.sin(a)) / 111_320,
    ]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function featureToEntry(f: Feature, file: string): GazetteerEntry | null {
  const p = f.properties ?? {};
  if (p.feature_level && p.feature_level !== 'mahalleh') return null;
  const nameFa = str(p.name_fa);
  const cityFa = str(p.city_fa);
  if (!nameFa || !cityFa) return null;
  const slug = citySlug(cityFa);
  const boundarySource = str(p.boundary_source) ?? '';
  const munCode = /code=(\d+)/.exec(boundarySource)?.[1];
  const relId = /relation\/(\d+)/.exec(boundarySource)?.[1];
  const osmId = typeof p.osm_id === 'number' ? p.osm_id : relId ? Number(relId) : typeof p.point_osm_id === 'number' ? p.point_osm_id : null;
  const localId = munCode ? `m${munCode}` : osmId ? `osm${osmId}` : `h${crypto.createHash('sha1').update(`${nameFa}|${JSON.stringify(f.geometry?.coordinates ?? '').slice(0, 200)}`).digest('hex').slice(0, 10)}`;

  let geojson: AreaGeom;
  let tier: BoundaryTier;
  let isProxy = false;
  if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') {
    geojson = f.geometry as unknown as AreaGeom;
    const src = `${str(p.source) ?? ''} ${boundarySource}`;
    tier = /municipality|شهرداری/i.test(src) && !/^OSM/i.test(boundarySource) ? 'official' : 'osm_admin';
  } else if (f.geometry?.type === 'Point') {
    const [lng, lat] = f.geometry.coordinates as [number, number];
    geojson = bufferPoint(lng, lat, 500);
    tier = 'derived';
    isProxy = true;
  } else {
    return null;
  }
  const json = JSON.stringify(geojson);
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  const extraction = str(p.extraction_date) ?? 'unknown';
  const alt = new Set<string>();
  for (const v of [p.name_alt, p.name_en, p.name_latin]) {
    if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && alt.add(x));
    else if (typeof v === 'string' && v.trim()) alt.add(v.trim());
  }
  // نام‌های ترکیبی «الف - ب» هر جزء را هم نام جایگزین می‌کنیم
  if (/[-–]/.test(nameFa)) nameFa.split(/\s*[-–]\s*/).forEach((part) => part && alt.add(part));
  const keys = [...new Set([matchKey(nameFa), ...[...alt].map(matchKey)].filter(Boolean))];
  return {
    neighborhoodId: `${slug}:${localId}`,
    nameFa,
    nameAlt: [...alt],
    nameEn: str(p.name_en),
    cityFa,
    citySlug: slug,
    districtFa: str(p.mantaqe_name_fa),
    provinceFa: str(p.province_fa) ?? '',
    centroid: typeof p.centroid_lat === 'number' && typeof p.centroid_lon === 'number'
      ? { lat: p.centroid_lat, lng: p.centroid_lon }
      : centroidOf(geojson),
    boundary: {
      geojson,
      source: boundarySource || str(p.source) || path.basename(file),
      tier,
      version: `${path.basename(file)}@${extraction}`,
      hash,
      isProxy,
      areaKm2: Math.round((areaM2(geojson) / 1e6) * 10000) / 10000,
    },
    wikidata: str(p.wikidata) ?? null,
    osmId,
    keys,
  };
}

let cache: { entries: GazetteerEntry[]; byId: Map<string, GazetteerEntry> } | null = null;

export function gazetteerDirs(): string[] {
  const extra = process.env.ARA_GAZETTEER_DIRS?.split(path.delimiter).filter(Boolean) ?? [];
  return [path.join(PROJECT_ROOT, 'mahalat'), path.join(PROJECT_ROOT, 'data', 'gazetteer'), ...extra];
}

export function loadGazetteer(force = false): { entries: GazetteerEntry[]; byId: Map<string, GazetteerEntry> } {
  if (cache && !force) return cache;
  const entries: GazetteerEntry[] = [];
  const byId = new Map<string, GazetteerEntry>();
  for (const dir of gazetteerDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.geojson')).sort()) {
      const full = path.join(dir, file);
      let data: { features?: Feature[] };
      try { data = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '')); } catch { continue; }
      (data.features ?? []).forEach((f) => {
        const e = featureToEntry(f, full);
        if (!e) return;
        let id = e.neighborhoodId;
        let n = 2;
        while (byId.has(id)) id = `${e.neighborhoodId}-${n++}`;
        e.neighborhoodId = id;
        entries.push(e);
        byId.set(id, e);
      });
    }
  }
  cache = { entries, byId };
  return cache;
}

export function getNeighborhood(id: string): GazetteerEntry | undefined {
  return loadGazetteer().byId.get(id);
}

export function neighborhoodsOfCity(cityFaOrSlug: string): GazetteerEntry[] {
  const slug = /^[a-z0-9]+$/.test(cityFaOrSlug) ? cityFaOrSlug : citySlug(cityFaOrSlug);
  return loadGazetteer().entries.filter((e) => e.citySlug === slug);
}

export function listCities(): Array<{ cityFa: string; citySlug: string; count: number }> {
  const m = new Map<string, { cityFa: string; citySlug: string; count: number }>();
  for (const e of loadGazetteer().entries) {
    const c = m.get(e.citySlug) ?? { cityFa: e.cityFa, citySlug: e.citySlug, count: 0 };
    c.count++;
    m.set(e.citySlug, c);
  }
  return [...m.values()];
}

/** خلاصهٔ سبک برای پاسخ API (بدون هندسه) */
export function publicEntry(e: GazetteerEntry, confidence?: number) {
  return {
    neighborhoodId: e.neighborhoodId,
    nameFa: e.nameFa,
    nameEn: e.nameEn,
    cityFa: e.cityFa,
    districtFa: e.districtFa,
    provinceFa: e.provinceFa,
    centroid: e.centroid,
    boundaryTier: e.boundary.tier,
    boundaryIsProxy: e.boundary.isProxy,
    areaKm2: e.boundary.areaKm2,
    ...(confidence !== undefined ? { confidence: Math.round(confidence * 1000) / 1000 } : {}),
  };
}

export { normalizeFa };

/** محدودهٔ کل محلات یک شهر + حاشیهٔ متری (برای واکشی یک‌بارهٔ لایه‌های شهر) */
export function cityBBox(slug: string, marginM = 1500): [number, number, number, number] | null {
  const list = neighborhoodsOfCity(slug);
  if (!list.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const x of list) {
    const b = bboxOf(x.boundary.geojson);
    w = Math.min(w, b[0]); s = Math.min(s, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3]);
  }
  return expandBBox([w, s, e, n], marginM);
}
