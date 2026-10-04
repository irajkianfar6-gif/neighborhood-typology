/**
 * لایه‌های OSM در سطح شهر با کش دیسکی.
 *
 * به‌جای پرس‌وجوی جداگانه برای هر محله (bbox ±۰٫۰۲°)، هر دسته یک‌بار برای کل محدودهٔ شهر
 * (+۱۵۰۰ متر حاشیه تا خدمات بیرون مرز هم دیده شوند) واکشی و کش می‌شود. سپس همهٔ محلات
 * از همین لایه با هندسهٔ مرز واقعی محاسبه می‌شوند — هم دقیق‌تر، هم سازگار برای توزیع مرجع.
 * تاریخ داده = osm3s.timestamp_osm_base پاسخ Overpass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';
import { type AreaGeom, areaM2, type BBox, type Ring } from './geo';

export type LayerCategory = 'health' | 'education' | 'transit' | 'parks' | 'culture' | 'commerce';

export interface LayerPoint { lng: number; lat: number; kind: string; name?: string }
export interface LayerArea { geom: AreaGeom; kind: string; areaM2: number; name?: string }
export interface OsmLayer {
  category: LayerCategory;
  bbox: BBox;
  fetchedAt: string;
  observedAt: string | null;
  endpoint: string;
  points: LayerPoint[];
  areas: LayerArea[];
}

export const OVERPASS_ENDPOINTS = (process.env.OVERPASS_ENDPOINTS ?? 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter')
  .split(',').map((s) => s.trim()).filter(Boolean);

const TTL_MS = Number(process.env.ARA_OSM_LAYER_TTL_DAYS || 30) * 86_400_000;

function bboxStr(b: BBox): string {
  return `${b[1].toFixed(5)},${b[0].toFixed(5)},${b[3].toFixed(5)},${b[2].toFixed(5)}`;
}

export function layerQuery(category: LayerCategory, b: BBox): string {
  const bb = bboxStr(b);
  const head = '[out:json][timeout:240][maxsize:536870912];';
  switch (category) {
    case 'health':
      return `${head}(nwr["amenity"~"^(hospital|clinic|doctors|pharmacy|health_post|dentist)$"](${bb});nwr["healthcare"~"^(hospital|clinic|centre|doctor|pharmacy|health_post)$"](${bb}););out center tags qt;`;
    case 'education':
      return `${head}(nwr["amenity"~"^(school|university|college|library|kindergarten)$"](${bb}););out center tags qt;`;
    case 'transit':
      return `${head}(node["highway"="bus_stop"](${bb});nwr["public_transport"="station"](${bb});nwr["railway"~"^(station|halt|subway_entrance|tram_stop)$"](${bb});nwr["amenity"="bus_station"](${bb}););out center tags qt;`;
    case 'parks':
      return `${head}(way["leisure"~"^(park|garden|nature_reserve|playground|recreation_ground)$"](${bb});relation["leisure"~"^(park|garden|nature_reserve)$"](${bb});way["landuse"~"^(recreation_ground|forest|grass|meadow|village_green|orchard)$"](${bb});way["natural"~"^(wood|scrub|grassland)$"](${bb}););out geom tags qt;`;
    case 'culture':
      return `${head}(nwr["historic"](${bb});nwr["heritage"](${bb});nwr["tourism"~"^(museum|gallery|attraction)$"](${bb});nwr["amenity"~"^(theatre|arts_centre|community_centre|library|cinema|place_of_worship|cultural_centre)$"](${bb}););out center tags qt;`;
    case 'commerce':
      return `${head}(nwr["shop"](${bb});nwr["office"](${bb});nwr["craft"](${bb});nwr["amenity"~"^(marketplace|bank|restaurant|cafe|fast_food)$"](${bb}););out center tags qt;`;
  }
}

type OsmEl = {
  type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number;
  center?: { lat: number; lon: number }; tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{ type: string; role: string; geometry?: Array<{ lat: number; lon: number }> }>;
};

function kindOf(category: LayerCategory, t: Record<string, string>): string {
  switch (category) {
    case 'health': return t.amenity || t.healthcare || 'health';
    case 'education': return t.amenity || 'education';
    case 'transit': {
      const name = `${t.name ?? ''} ${t['name:en'] ?? ''} ${t.network ?? ''}`;
      const rapid = t.railway === 'station' || t.railway === 'subway_entrance' || t.station === 'subway' || t.subway === 'yes'
        || /مترو|metro|subway|brt|تندرو|بی آر تی|بی‌آرتی/i.test(name) || t.public_transport === 'station' || t.amenity === 'bus_station';
      return rapid ? 'rapid' : 'bus';
    }
    case 'parks': return t.leisure || t.landuse || t.natural || 'green';
    case 'culture': return t.historic ? 'historic' : t.heritage ? 'heritage' : t.tourism || t.amenity || 'culture';
    case 'commerce': return t.shop ? 'shop' : t.office ? 'office' : t.craft ? 'craft' : t.amenity || 'commerce';
  }
}

/** ادغام سادهٔ قطعات حلقه‌ای اعضای outer رابطه بر اساس نقاط انتهایی */
function assembleRings(parts: Ring[]): Ring[] {
  const rings: Ring[] = [];
  const open = parts.filter((p) => p.length >= 2).map((p) => [...p]);
  const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  while (open.length) {
    let cur = open.shift()!;
    let progressed = true;
    while (!same(cur[0], cur[cur.length - 1]) && progressed) {
      progressed = false;
      for (let i = 0; i < open.length; i++) {
        const p = open[i];
        const end = cur[cur.length - 1];
        if (same(end, p[0])) cur = cur.concat(p.slice(1));
        else if (same(end, p[p.length - 1])) cur = cur.concat([...p].reverse().slice(1));
        else continue;
        open.splice(i, 1); progressed = true; break;
      }
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

export function parseLayer(category: LayerCategory, payload: { elements?: OsmEl[]; osm3s?: { timestamp_osm_base?: string } }, bbox: BBox, endpoint: string): OsmLayer {
  const points: LayerPoint[] = [];
  const areas: LayerArea[] = [];
  for (const el of payload.elements ?? []) {
    const t = el.tags ?? {};
    const kind = kindOf(category, t);
    if (category === 'parks') {
      let rings: Ring[] = [];
      if (el.type === 'way' && el.geometry?.length) {
        const r = el.geometry.map((g) => [g.lon, g.lat] as [number, number]);
        if (r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) rings = [r];
      } else if (el.type === 'relation' && el.members) {
        rings = assembleRings(el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry!.map((g) => [g.lon, g.lat] as [number, number])));
      }
      for (const ring of rings) {
        const geom: AreaGeom = { type: 'Polygon', coordinates: [ring] };
        areas.push({ geom, kind, areaM2: areaM2(geom), name: t.name });
      }
      continue;
    }
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    points.push({ lng, lat, kind, name: t.name });
  }
  return {
    category, bbox, endpoint, points, areas,
    fetchedAt: new Date().toISOString(),
    observedAt: payload.osm3s?.timestamp_osm_base ?? null,
  };
}

export async function overpass(query: string, timeoutMs = 300_000): Promise<{ payload: unknown; endpoint: string }> {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ARA-Neighborhood-Decision-Support/2.0', accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok || !text.trimStart().startsWith('{')) throw new Error(`overpass ${res.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
      const payload = JSON.parse(text) as { remark?: string };
      if (payload.remark && /error|timed out|out of memory/i.test(payload.remark)) throw new Error(`overpass remark: ${payload.remark}`);
      return { payload, endpoint };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('all overpass endpoints failed');
}

function cacheFile(citySlug: string, category: LayerCategory): string {
  return path.join(serverDataDir(), 'osm-cache', citySlug, `${category}.json`);
}

const inflight = new Map<string, Promise<OsmLayer>>();

export interface LayerLoadResult { layer: OsmLayer | null; cache: 'HIT' | 'MISS' | 'STALE' | 'NONE'; error?: string }

export function readCachedLayer(citySlug: string, category: LayerCategory): { layer: OsmLayer; ageMs: number } | null {
  const file = cacheFile(citySlug, category);
  if (!fs.existsSync(file)) return null;
  try {
    const layer = JSON.parse(fs.readFileSync(file, 'utf8')) as OsmLayer;
    return { layer, ageMs: Date.now() - Date.parse(layer.fetchedAt) };
  } catch { return null; }
}

/** لایهٔ شهر را از کش یا Overpass می‌گیرد؛ اگر واکشی شکست بخورد کش کهنه با برچسب STALE برمی‌گردد */
export async function getCityLayer(citySlug: string, category: LayerCategory, bbox: BBox, opts: { forceRefresh?: boolean; offline?: boolean } = {}): Promise<LayerLoadResult> {
  const cached = readCachedLayer(citySlug, category);
  if (cached && !opts.forceRefresh && cached.ageMs < TTL_MS) return { layer: cached.layer, cache: 'HIT' };
  if (opts.offline) return cached ? { layer: cached.layer, cache: 'STALE' } : { layer: null, cache: 'NONE', error: 'offline and no cache' };
  const key = `${citySlug}:${category}`;
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const { payload, endpoint } = await overpass(layerQuery(category, bbox));
      const layer = parseLayer(category, payload as { elements?: OsmEl[] }, bbox, endpoint);
      const file = cacheFile(citySlug, category);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(layer));
      return layer;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try {
    return { layer: await p, cache: 'MISS' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return cached ? { layer: cached.layer, cache: 'STALE', error: message } : { layer: null, cache: 'NONE', error: message };
  }
}

export const ALL_CATEGORIES: LayerCategory[] = ['health', 'education', 'transit', 'parks', 'culture', 'commerce'];
