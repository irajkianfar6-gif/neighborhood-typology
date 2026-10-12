/**
 * CITY-v1 — ورود شهر تازه به گزتیر: یکسان‌سازی GeoJSON محلات (رسمی یا OSM) به طرح گزتیر
 * (name_fa, city_fa, province_fa, mantaqe_name_fa, feature_level, source, boundary_source, extraction_date).
 * هیچ مرزی ساخته نمی‌شود: Point همان نقطه می‌ماند و گزتیر آن را «مرز تقریبی» (proxy) حساب می‌کند.
 */
import { normalizeFa } from '../neighborhood/text';

type Geom = { type: string; coordinates: unknown };
export interface RawFeature { type?: string; properties?: Record<string, unknown> | null; geometry?: Geom | null }
export interface OnboardOptions { cityFa: string; provinceFa?: string; official?: boolean; sourceLabel?: string; extractionDate?: string }
export interface OnboardResult {
  features: Array<{ type: 'Feature'; properties: Record<string, unknown>; geometry: Geom }>;
  stats: { input: number; kept: number; polygons: number; points: number; withDistrict: number; duplicatesRenamed: number };
  skipped: Array<{ index: number; reason: string }>;
}

const NAME_KEYS = ['name_fa', 'name:fa', 'NAME_FA', 'نام', 'نام_محله', 'mahalle', 'name', 'NAME', 'Name'];
const DISTRICT_KEYS = ['mantaqe_name_fa', 'district', 'DISTRICT', 'region', 'mantaqe', 'mantaghe', 'منطقه', 'zone', 'nahie'];
const pick = (p: Record<string, unknown>, keys: string[]) => { for (const k of keys) { const v = p[k]; if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return String(v).trim(); } return undefined; };
const PERSIAN = /[\u0600-\u06FF]/;

export function normalizeCityGeojson(input: { features?: RawFeature[] }, o: OnboardOptions): OnboardResult {
  const cityFa = normalizeFa(o.cityFa);
  const out: OnboardResult = { features: [], stats: { input: 0, kept: 0, polygons: 0, points: 0, withDistrict: 0, duplicatesRenamed: 0 }, skipped: [] };
  const seen = new Map<string, number>();
  const date = o.extractionDate ?? new Date().toISOString().slice(0, 10);
  (input.features ?? []).forEach((f, i) => {
    out.stats.input++;
    const p = f.properties ?? {};
    const g = f.geometry;
    if (!g || !['Polygon', 'MultiPolygon', 'Point'].includes(g.type)) { out.skipped.push({ index: i, reason: `هندسهٔ ${g?.type ?? 'خالی'} پشتیبانی نمی‌شود` }); return; }
    if (p.feature_level && p.feature_level !== 'mahalleh') { out.skipped.push({ index: i, reason: `سطح ${String(p.feature_level)} محله نیست` }); return; }
    let name = pick(p, NAME_KEYS);
    if (!name) { out.skipped.push({ index: i, reason: 'نام ندارد' }); return; }
    if (!PERSIAN.test(name)) { const fa = typeof p['name:fa'] === 'string' ? String(p['name:fa']) : null; if (fa) name = fa; else { out.skipped.push({ index: i, reason: `نام فارسی ندارد (${name.slice(0, 40)})` }); return; } }
    name = normalizeFa(name);
    const district = pick(p, DISTRICT_KEYS);
    const dupKey = `${name}|${district ?? ''}`;
    const n = (seen.get(dupKey) ?? 0) + 1; seen.set(dupKey, n);
    if (n > 1) out.stats.duplicatesRenamed++;
    const osmId = typeof p.osm_id === 'number' ? p.osm_id : typeof p['@id'] === 'string' && /\d+/.test(String(p['@id'])) ? Number(/\d+/.exec(String(p['@id']))![0]) : undefined;
    const isPoly = g.type !== 'Point';
    const src = o.official ? `شهرداری ${cityFa}${o.sourceLabel ? ` — ${o.sourceLabel}` : ''}` : (o.sourceLabel ?? 'OSM');
    out.features.push({
      type: 'Feature', geometry: g,
      properties: {
        name_fa: n > 1 ? `${name} (${n})` : name, city_fa: cityFa, ...(o.provinceFa ? { province_fa: normalizeFa(o.provinceFa) } : {}),
        ...(district ? { mantaqe_name_fa: /^\d+$|^[۰-۹]+$/.test(district) ? `منطقه ${district}` : district } : {}),
        feature_level: 'mahalleh', source: src, boundary_source: isPoly ? (o.official ? src : `OSM${osmId ? ` relation/${osmId}` : ''}`) : 'point',
        extraction_date: date, ...(osmId ? { osm_id: osmId } : {}),
        ...(typeof p.name_en === 'string' ? { name_en: p.name_en } : typeof p['name:en'] === 'string' ? { name_en: p['name:en'] } : {}),
      },
    });
    out.stats.kept++; if (isPoly) out.stats.polygons++; else out.stats.points++; if (district) out.stats.withDistrict++;
  });
  return out;
}

/** خروجی Overpass (out center/geom) → GeoJSON نقطه‌ای؛ فقط گره‌های place و مرکز رابطه‌ها (مرز از OSM ساخته نمی‌شود) */
export function overpassToGeojson(json: { elements?: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> }): { features: RawFeature[] } {
  const features: RawFeature[] = [];
  for (const e of json.elements ?? []) {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined || !e.tags) continue;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { ...e.tags, osm_id: e.id } });
  }
  return { features };
}
export function overpassQuery(cityFa: string): string {
  const n = cityFa.replace(/"/g, '');
  return `[out:json][timeout:120];area["name"="${n}"]["boundary"="administrative"]->.a;(node["place"~"^(neighbourhood|suburb|quarter)$"](area.a);relation["boundary"="administrative"]["admin_level"~"^(9|10)$"](area.a););out center tags;`;
}
