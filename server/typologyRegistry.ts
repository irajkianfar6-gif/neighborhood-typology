import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Geometry } from 'geojson';
import type { Candidate, IndicatorTask, IndicatorStatus, RegistryRow, TypologyRequest, LocationSearchResult } from './typologyTypes';

type GazetteerRow = [string, string, string, string, string, string, string, string, string];

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REGISTRY_PATH = path.resolve(SERVER_DIR, '..', 'neighborhood_typology', 'indicator_registry_419.csv');
const DEFAULT_GAZETTEER_PATH = path.resolve(SERVER_DIR, '..', 'src', 'data', 'portals', 'divisions', 'gazetteer.json');
const DEFAULT_PLACES_PATH = path.resolve(process.env.ARA_PUBLIC_DATA_DIR || path.resolve(SERVER_DIR, '..', 'public', 'data'), 'pbf', 'places.json');
const DEFAULT_ADMIN1_PATH = path.resolve(SERVER_DIR, '..', 'geojson', 'irn_admin1.geojson');
const DEFAULT_ADMIN2_PATH = path.resolve(SERVER_DIR, '..', 'geojson', 'irn_admin2.geojson');
const LOCAL_MAHALAT_DIR = path.resolve(SERVER_DIR, '..', 'mahalat');

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('Unterminated quoted field in indicator registry');
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.length > 0));
}

export function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH): {
  rows: RegistryRow[];
  version: string;
  path: string;
} {
  const raw = fs.readFileSync(registryPath, 'utf8').replace(/^\uFEFF/, '');
  const csv = parseCsvRows(raw);
  const headers = csv.shift();
  if (!headers) throw new Error('Indicator registry is empty');

  const rows = csv.map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`Registry row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index]])) as RegistryRow;
  });

  const codes = new Set(rows.map((row) => row.code));
  if (rows.length !== 419 || codes.size !== 419) {
    throw new Error(`Approved registry must contain exactly 419 unique indicators; found ${rows.length}/${codes.size}`);
  }
  const expectedCounts = { PHY: 177, BEH: 209, NOR: 33 };
  for (const [prefix, expected] of Object.entries(expectedCounts)) {
    const count = rows.filter((row) => row.code.startsWith(`${prefix}-`)).length;
    if (count !== expected) throw new Error(`Registry ${prefix} count is ${count}; expected ${expected}`);
  }

  return {
    rows,
    version: `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`,
    path: registryPath,
  };
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizePersianText(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[ؤ]/g, 'و')
    .replace(/[إأ]/g, 'ا')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u200c\u200d\u200e\u200f]/g, ' ')
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[()\[\]{}،,؛;:_/\\.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('fa');
}

function withoutSettlementPrefix(value: string): string {
  return normalizePersianText(value).replace(/^(محله|کوی|شهرک|روستا|دهستان)\s+/, '');
}

type PbfPlace = { t?: string; c?: [number, number]; n?: string };
type AdminCenter = { id: string; name: string; center: { lat: number; lng: number } };
type LocalNeighborhood = LocationSearchResult & { geometry: Geometry; municipality_region?: number; municipality_region_name?: string; district_name?: string; area_km2?: number | null; perimeter_km?: number | null; source_detail?: string; data_quality_note?: string; tentative_match?: boolean; layer_type: 'neighborhood' | 'district' };

function loadPbfPlaces(file = DEFAULT_PLACES_PATH): PbfPlace[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { points?: unknown };
    return Array.isArray(parsed.points)
      ? parsed.points.filter((item): item is PbfPlace => {
          const row = item as PbfPlace;
          return Array.isArray(row.c) && row.c.length === 2 && row.c.every((value) => typeof value === 'number') && typeof row.n === 'string' && row.n.trim().length > 0;
        })
      : [];
  } catch {
    return [];
  }
}

function loadAdminCenters(file: string, nameKey: string, idKey: string): AdminCenter[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { features?: Array<{ properties?: Record<string, unknown> }> };
    return (parsed.features ?? []).flatMap((feature) => {
      const properties = feature.properties ?? {};
      const lat = Number(properties.center_lat);
      const lng = Number(properties.center_lon);
      const name = String(properties[nameKey] ?? '').trim();
      const id = String(properties[idKey] ?? '').trim();
      return Number.isFinite(lat) && Number.isFinite(lng) && name ? [{ id, name, center: { lat, lng } }] : [];
    });
  } catch {
    return [];
  }
}

const PBF_PLACES = loadPbfPlaces();
const PBF_PLACE_INDEX = PBF_PLACES
  .filter((place) => ['neighbourhood', 'suburb', 'quarter', 'locality', 'town', 'city', 'village'].includes(place.t ?? ''))
  .map((place, index) => ({
    ...place,
    normalized: normalizePersianText(place.n ?? ''),
    id: `pbf-place:${index}`,
  }));
const ADMIN1_CENTERS = loadAdminCenters(DEFAULT_ADMIN1_PATH, 'adm1_name1', 'adm1_pcode');
const ADMIN2_CENTERS = loadAdminCenters(DEFAULT_ADMIN2_PATH, 'adm2_name1', 'adm2_pcode');
const CITY_PLACES = PBF_PLACE_INDEX.filter((place) => place.t === 'city' || place.t === 'town');

function loadLocalNeighborhoods(): LocalNeighborhood[] {
  if (!fs.existsSync(LOCAL_MAHALAT_DIR)) return [];
  const files = fs.readdirSync(LOCAL_MAHALAT_DIR).filter((file) => file.toLowerCase().endsWith('.geojson'));
  const rows: LocalNeighborhood[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(LOCAL_MAHALAT_DIR, file), 'utf8')) as { features?: Array<{ geometry?: Geometry; properties?: Record<string, unknown> }> };
      for (const [index, feature] of (parsed.features ?? []).entries()) {
        const properties = feature.properties ?? {};
        const geometry = feature.geometry;
        const name = String(properties.name_fa ?? '').trim();
        const city = String(properties.city_fa ?? '').trim();
        const featureLevel = String(properties.feature_level ?? '');
        if (!geometry || !name || !city || (featureLevel !== 'mahalleh' && featureLevel !== 'mantaqe')) continue;
        const cityKey = normalizePersianText(city).includes('کرج') ? 'karaj' : normalizePersianText(city).includes('تهران') ? 'tehran' : normalizePersianText(city);
        const sourceText = String(properties.source ?? '');
        const official = cityKey === 'tehran' && sourceText.includes('Tehran Municipality');
        const candidateId = `mahalat:${cityKey}:${String(properties.osm_id ?? index)}`;
        const centerLat = Number(properties.centroid_lat);
        const centerLng = Number(properties.centroid_lon);
        if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) continue;
        const hasAreaBoundary = geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
        rows.push({
          candidate_id: candidateId,
          canonical_name: name,
          alternative_names: [String(properties.name_en ?? ''), String(properties.name_latin ?? '')].filter(Boolean),
          province: String(properties.province_fa ?? (cityKey === 'tehran' ? 'استان تهران' : 'استان البرز')),
          province_id: cityKey === 'tehran' ? 'IR007' : 'IR030',
          city_or_county: city,
          settlement_type: 'urban',
          confidence: official ? 0.99 : 0.9,
          source: official ? 'TEHRAN_MUNICIPAL_OFFICIAL' : hasAreaBoundary ? 'KARAJ_OSM_NEIGHBORHOODS' : 'KARAJ_LOCAL_NEIGHBORHOOD_POINT',
          center: { lat: centerLat, lng: centerLng },
          boundary_available: hasAreaBoundary,
          boundary_geojson: hasAreaBoundary ? geometry : null,
          boundary_quality: official ? 'authoritative' : hasAreaBoundary ? 'confirmed_osm' : undefined,
          administrative_id: String(properties.within_municipal_code ?? properties.osm_id ?? ''),
          match_reason: official ? 'مرز رسمی شهرداری تهران' : hasAreaBoundary ? 'مرز محله از داده مکانی کرج' : 'نقطه معتبر محله در داده مکانی کرج؛ فاقد Polygon',
          geometry,
          municipality_region: Number.isFinite(Number(properties.mantaqe)) ? Number(properties.mantaqe) : undefined,
          municipality_region_name: String(properties.mantaqe_name_fa ?? ''),
          district_name: String(properties.nahiye_fa ?? ''),
          area_km2: Number.isFinite(Number(properties.area_km2)) ? Number(properties.area_km2) : null,
          perimeter_km: Number.isFinite(Number(properties.perimeter_km)) ? Number(properties.perimeter_km) : null,
          source_detail: sourceText,
          data_quality_note: String(properties.data_quality_note ?? ''),
          tentative_match: Boolean(properties.tentative_match),
          layer_type: featureLevel === 'mantaqe' ? 'district' : 'neighborhood',
        });
      }
    } catch {
      // An invalid optional city file must not prevent the national catalog from loading.
    }
  }
  return rows;
}

const LOCAL_NEIGHBORHOODS = loadLocalNeighborhoods();

type ProvinceContext = { name: string; id?: string };

function buildGazetteerProvinceIndex(rows: GazetteerRow[]): Map<string, ProvinceContext> {
  const index = new Map<string, ProvinceContext>();
  for (const row of rows) {
    const [provinceCode, province, , county, , , , locality, type] = row;
    const context = { name: province, id: provinceCode || undefined } satisfies ProvinceContext;
    const names = type === 'city' ? [county, locality] : [county];
    for (const name of names) {
      const normalized = normalizePersianText(name);
      const compact = normalized.replace(/\s+/g, '');
      if (normalized && !index.has(normalized)) index.set(normalized, context);
      if (compact && !index.has(compact)) index.set(compact, context);
    }
  }
  return index;
}

// Some deployments omit the optional admin boundary GeoJSON. The SCI
// gazetteer still provides an authoritative city/county -> province link.
const GAZETTEER_PROVINCE_BY_CITY = buildGazetteerProvinceIndex(loadGazetteer());

function nearestCenter(lng: number, lat: number, centers: AdminCenter[]): AdminCenter | null {
  let best: AdminCenter | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of centers) {
    const distance = (item.center.lng - lng) ** 2 + (item.center.lat - lat) ** 2;
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function provinceForPlace(lng: number, lat: number, cityName: string): ProvinceContext | null {
  const boundaryProvince = nearestCenter(lng, lat, ADMIN1_CENTERS);
  if (boundaryProvince) return { name: boundaryProvince.name, id: boundaryProvince.id || undefined };
  const normalized = normalizePersianText(cityName);
  return GAZETTEER_PROVINCE_BY_CITY.get(normalized)
    ?? GAZETTEER_PROVINCE_BY_CITY.get(normalized.replace(/\s+/g, ''))
    ?? null;
}

function nearestPlace(lng: number, lat: number): { name: string; distance: number } | null {
  let best: { name: string; distance: number } | null = null;
  for (const item of CITY_PLACES) {
    const distance = (Number(item.c?.[0]) - lng) ** 2 + (Number(item.c?.[1]) - lat) ** 2;
    if (!best || distance < best.distance) best = { name: item.n ?? '', distance };
  }
  return best;
}

function searchScore(normalizedQuery: string, normalizedName: string, type: string): { score: number; reason: string } | null {
  if (!normalizedName) return null;
  if (normalizedName === normalizedQuery) return { score: 1, reason: 'نام دقیق' };
  if (normalizedName.startsWith(normalizedQuery)) return { score: 0.9, reason: 'شروع نام' };
  if (normalizedName.includes(normalizedQuery)) return { score: 0.78, reason: 'شامل عبارت' };
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const nameTokens = new Set(normalizedName.split(' '));
  const tokenHit = queryTokens.length > 1 && queryTokens.every((token) => nameTokens.has(token));
  if (tokenHit) return { score: type === 'neighbourhood' ? 0.74 : 0.68, reason: 'تطبیق واژه‌ای' };
  return null;
}

function matchesLocationContext(contextQueries: string[], ...values: string[]): boolean {
  if (contextQueries.length === 0) return true;
  const normalizedValues = values.map(normalizePersianText).filter(Boolean);
  return contextQueries.every((query) => normalizedValues.some((value) => value.includes(query) || query.includes(value)));
}

function provisionalBoundary(lat: number, lng: number, type: string): { type: 'Polygon'; coordinates: number[][][] } {
  const radiusMeters = type === 'suburb' ? 1400 : type === 'village' ? 950 : type === 'city' || type === 'town' ? 1800 : 750;
  const latRadius = radiusMeters / 111_320;
  const lngRadius = radiusMeters / (111_320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const ring = Array.from({ length: 33 }, (_, index) => {
    const angle = index / 32 * Math.PI * 2;
    return [lng + Math.cos(angle) * lngRadius, lat + Math.sin(angle) * latRadius];
  });
  return { type: 'Polygon', coordinates: [ring] };
}

export function searchLocationCatalog(query: string, limit = 20): LocationSearchResult[] {
  const queryParts = String(query ?? '')
    .split(/[،,]/)
    .map((part) => withoutSettlementPrefix(part))
    .filter(Boolean);
  const normalizedQuery = withoutSettlementPrefix(query);
  // Inputs from the decision assistant commonly use "neighborhood, city".
  // Keep the city as a context filter while scoring the neighborhood itself;
  // comparing the comma-joined string against the place name would otherwise
  // reject valid local catalog entries such as "گوهردشت، کرج".
  const placeQuery = queryParts[0] ?? normalizedQuery;
  const contextQueries = queryParts.slice(1);
  if (normalizedQuery.length < 2) return [];
  const localRows = LOCAL_NEIGHBORHOODS.filter((row) => row.layer_type === 'neighborhood').flatMap((row) => {
    if (!matchesLocationContext(contextQueries, row.city_or_county, row.province)) return [];
    const match = searchScore(placeQuery, withoutSettlementPrefix(row.canonical_name), 'neighbourhood');
    return match ? [{ ...row, confidence: Math.min(0.99, Math.max(row.confidence, match.score)), match_reason: `${match.reason} · ${row.match_reason}` }] : [];
  });
  const rows = PBF_PLACE_INDEX.flatMap((place) => {
    const match = searchScore(placeQuery, place.normalized, place.t ?? '');
    if (!match || !place.c) return [];
    const lng = Number(place.c[0]);
    const lat = Number(place.c[1]);
    const county = nearestCenter(lng, lat, ADMIN2_CENTERS);
    const nearestCity = nearestPlace(lng, lat);
    const urban = place.t === 'city' || place.t === 'town';
    const cityOrCounty = urban ? (place.n ?? '') : (nearestCity?.name || county?.name || '');
    const province = provinceForPlace(lng, lat, cityOrCounty);
    if (!matchesLocationContext(contextQueries, cityOrCounty, province?.name ?? '')) return [];
    const confidence = Math.min(0.98, match.score + (place.t === 'neighbourhood' || place.t === 'quarter' ? 0.04 : 0) + (province ? 0.02 : 0));
    return [{
      candidate_id: place.id,
      canonical_name: place.n ?? 'محدوده بدون نام',
      alternative_names: [],
      province: province?.name ?? '',
      province_id: province?.id,
      city_or_county: cityOrCounty,
      settlement_type: place.t === 'village' ? 'rural' : 'urban',
      confidence: Number(confidence.toFixed(2)),
      source: 'PBF_PLACES_LOCAL',
      center: { lat, lng },
      boundary_available: true,
      boundary_geojson: provisionalBoundary(lat, lng, place.t ?? ''),
      boundary_quality: 'provisional',
      administrative_id: county?.id,
      match_reason: match.reason,
    } satisfies LocationSearchResult];
  });
  const unique = new Map([...localRows, ...rows].map((row) => [row.candidate_id, row]));
  return [...unique.values()]
    .sort((a, b) => b.confidence - a.confidence || a.canonical_name.localeCompare(b.canonical_name, 'fa'))
    .slice(0, Math.max(1, Math.min(50, Math.trunc(limit))));
}

export function localNeighborhoodBoundaries(city?: string): Array<{
  type: 'Feature';
  geometry: Geometry;
  properties: Omit<LocalNeighborhood, 'geometry' | 'boundary_geojson'>;
}> {
  const normalizedCity = normalizePersianText(city ?? '');
  return LOCAL_NEIGHBORHOODS
    .filter((row) =>
      row.layer_type === 'neighborhood' &&
      ['Polygon', 'MultiPolygon'].includes(row.geometry.type) &&
      (!normalizedCity || normalizePersianText(row.city_or_county).includes(normalizedCity)),
    )
    .map((row) => {
      const { geometry, boundary_geojson: _boundaryGeoJson, ...properties } = row;
      return { type: 'Feature', geometry, properties };
    });
}

export function localAdministrativeBoundaries(city?: string): Array<{
  type: 'Feature';
  geometry: Geometry;
  properties: Omit<LocalNeighborhood, 'geometry' | 'boundary_geojson'>;
}> {
  const normalizedCity = normalizePersianText(city ?? '');
  return LOCAL_NEIGHBORHOODS
    .filter((row) =>
      row.layer_type === 'district' &&
      ['Polygon', 'MultiPolygon'].includes(row.geometry.type) &&
      (!normalizedCity || normalizePersianText(row.city_or_county).includes(normalizedCity)),
    )
    .map((row) => {
      const { geometry, boundary_geojson: _boundaryGeoJson, ...properties } = row;
      return { type: 'Feature', geometry, properties };
    });
}

function pointOnSegment(lng: number, lat: number, start: number[], end: number[]): boolean {
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (lat - y1) * (x2 - x1) - (lng - x1) * (y2 - y1);
  if (Math.abs(cross) > 1e-10) return false;
  return lng >= Math.min(x1, x2) - 1e-10 && lng <= Math.max(x1, x2) + 1e-10 && lat >= Math.min(y1, y2) - 1e-10 && lat <= Math.max(y1, y2) + 1e-10;
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const prior = ring[previous];
    if (pointOnSegment(lng, lat, prior, current)) return true;
    const intersects = (current[1] > lat) !== (prior[1] > lat)
      && lng < ((prior[0] - current[0]) * (lat - current[1])) / (prior[1] - current[1]) + current[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, polygon: number[][][]): boolean {
  return polygon.length > 0 && pointInRing(lng, lat, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(lng, lat, hole));
}

function geometryContainsPoint(geometry: Geometry, lng: number, lat: number): boolean {
  if (geometry.type === 'Polygon') return pointInPolygon(lng, lat, geometry.coordinates as number[][][]);
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as number[][][][]).some((polygon) => pointInPolygon(lng, lat, polygon));
  return false;
}

export function nearbyLocationCatalog(lat: number, lng: number, limit = 12): LocationSearchResult[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 24 || lat > 40.5 || lng < 43 || lng > 64) return [];
  const boundedLocal = LOCAL_NEIGHBORHOODS
    .filter((row) => row.layer_type === 'neighborhood' && row.boundary_available && geometryContainsPoint(row.geometry, lng, lat))
    .sort((a, b) => (a.boundary_quality === 'authoritative' ? -1 : 0) - (b.boundary_quality === 'authoritative' ? -1 : 0))
    .map((row) => ({
      ...row,
      confidence: row.boundary_quality === 'authoritative' ? 0.99 : Math.max(0.92, row.confidence),
      match_reason: row.boundary_quality === 'authoritative' ? 'نقطه داخل مرز رسمی محله' : 'نقطه داخل مرز مکانی محله کرج',
    }));
  const nearbyLocalPoints = LOCAL_NEIGHBORHOODS
    .filter((row) => row.layer_type === 'neighborhood' && row.geometry.type === 'Point')
    .map((row) => ({ row, distance: (row.center.lng - lng) ** 2 + (row.center.lat - lat) ** 2 }))
    .filter(({ distance }) => distance <= 0.03 ** 2)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map(({ row, distance }, index) => ({
      ...row,
      confidence: Number(Math.max(0.72, Math.min(0.9, 0.9 - Math.sqrt(distance) * 4 - index * 0.01)).toFixed(2)),
      match_reason: index === 0 ? 'نزدیک‌ترین نقطه معتبر محله در داده مکانی کرج؛ فاقد Polygon' : 'نقطه محله مجاور در داده مکانی کرج؛ فاقد Polygon',
    }));
  const nationalPlaces = PBF_PLACE_INDEX
    .map((place) => ({ place, distance: (Number(place.c?.[0]) - lng) ** 2 + (Number(place.c?.[1]) - lat) ** 2 }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(1, Math.min(30, Math.trunc(limit))))
    .map(({ place, distance }, index) => {
      const placeLng = Number(place.c?.[0]);
      const placeLat = Number(place.c?.[1]);
      const county = nearestCenter(placeLng, placeLat, ADMIN2_CENTERS);
      const nearestCity = nearestPlace(placeLng, placeLat);
      const urban = place.t === 'city' || place.t === 'town';
      const cityOrCounty = urban ? (place.n ?? '') : (nearestCity?.name || county?.name || '');
      const province = provinceForPlace(placeLng, placeLat, cityOrCounty);
      return {
        candidate_id: place.id,
        canonical_name: place.n ?? 'محدوده بدون نام',
        alternative_names: [],
        province: province?.name ?? '',
        province_id: province?.id,
        city_or_county: cityOrCounty,
        settlement_type: place.t === 'village' ? 'rural' : 'urban',
        confidence: Number(Math.max(0.55, Math.min(0.94, 0.94 - Math.sqrt(distance) * 2.5 - index * 0.01)).toFixed(2)),
        source: 'PBF_PLACES_LOCAL_NEARBY',
        center: { lat: placeLat, lng: placeLng },
        boundary_available: true,
        boundary_geojson: provisionalBoundary(placeLat, placeLng, place.t ?? ''),
        boundary_quality: 'provisional',
        administrative_id: county?.id,
        match_reason: index === 0 ? 'نزدیک‌ترین محدوده به نقطه انتخابی' : 'محدوده مجاور',
      } satisfies LocationSearchResult;
    });
  const unique = new Map([...boundedLocal, ...nearbyLocalPoints, ...nationalPlaces].map((row) => [row.candidate_id, row]));
  return [...unique.values()].slice(0, Math.max(1, Math.min(30, Math.trunc(limit))));
}

function loadGazetteer(gazetteerPath = DEFAULT_GAZETTEER_PATH): GazetteerRow[] {
  if (!fs.existsSync(gazetteerPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(gazetteerPath, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((row): row is GazetteerRow => Array.isArray(row) && row.length >= 9);
}

function stableCandidateId(parts: string[]): string {
  return `gazetteer:${crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)}`;
}

export function resolveCandidates(request: TypologyRequest, gazetteerPath = DEFAULT_GAZETTEER_PATH): Candidate[] {
  const provinceQuery = normalizePersianText(request.province ?? '');
  const cityQuery = normalizePersianText(request.city_or_county ?? '');
  const neighborhoodQuery = withoutSettlementPrefix(request.neighborhood_name);
  const rows = loadGazetteer(gazetteerPath);

  const matches = rows
    .map((row) => {
      const [provinceCode, province, countyCode, county, districtCode, district, localityCode, locality, type] = row;
      const provinceName = normalizePersianText(province);
      const countyName = normalizePersianText(county);
      const districtName = normalizePersianText(district);
      const localityName = withoutSettlementPrefix(locality);
      if (provinceQuery && provinceName !== provinceQuery) return null;

      let score = provinceQuery && provinceName === provinceQuery ? 0.35 : 0;
      if (cityQuery === countyName || cityQuery === localityName || cityQuery === districtName) score += 0.4;
      else if ([countyName, districtName, localityName].some((name) => name.includes(cityQuery) || cityQuery.includes(name))) score += 0.2;

      if (neighborhoodQuery && localityName === neighborhoodQuery) score += 0.25;
      else if (neighborhoodQuery && localityName && (localityName.includes(neighborhoodQuery) || neighborhoodQuery.includes(localityName))) score += 0.1;

      const settlementMatches = request.settlement_type === 'urban' ? type === 'city' : type === 'dehestan';
      if (settlementMatches) score += 0.05;
      if (score < 0.55) return null;

      const candidateId = stableCandidateId(row);
      const candidateName = locality || request.neighborhood_name;
      return {
        id: candidateId,
        candidate_id: candidateId,
        name: candidateName,
        canonical_name: candidateName,
        province,
        city_or_county: county || request.city_or_county,
        settlement_type: request.settlement_type,
        hierarchy: {
          province_code: provinceCode || undefined,
          county_code: countyCode || undefined,
          district_code: districtCode || undefined,
          locality_code: localityCode || undefined,
        },
        center: null,
        confidence: Math.min(0.89, Number(score.toFixed(2))),
        requires_confirmation: true as const,
        boundary_available: false as const,
        sources: [{ type: 'SCI_GAZETTEER', id: `${provinceCode}-${countyCode}-${districtCode}-${localityCode || type}` }],
        source: 'SCI_GAZETTEER',
        notes: ['Gazetteer match identifies administrative context only; it does not provide a neighborhood polygon.'],
      } satisfies Candidate;
    })
    .filter((candidate) => candidate !== null) as Candidate[];
  const ranked = matches
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name, 'fa'));

  const unique = new Map(ranked.map((candidate) => [candidate.id, candidate]));
  const candidates = [...unique.values()].slice(0, 20);
  if (candidates.length > 0) return candidates;

  const fallbackId = crypto
    .createHash('sha256')
    .update([request.province ?? '', request.city_or_county ?? '', request.neighborhood_name].map(normalizePersianText).join('|'))
    .digest('hex')
    .slice(0, 16);
  const fallbackCandidateId = `user-input:${fallbackId}`;
  return [{
    id: fallbackCandidateId,
    candidate_id: fallbackCandidateId,
    name: request.neighborhood_name,
    canonical_name: request.neighborhood_name,
    province: request.province ?? '',
    city_or_county: request.city_or_county ?? '',
    settlement_type: request.settlement_type,
    hierarchy: {},
    center: null,
    confidence: 0.35,
    requires_confirmation: true,
    boundary_available: false,
    sources: [{ type: 'USER_INPUT', id: fallbackId }],
    source: 'USER_INPUT',
    notes: ['No authoritative local match was found. Upload and confirm a polygon before computation.'],
  }];
}

function initialNextAction(accessMode: string): string {
  if (accessMode.includes('میدانی')) return 'بسته پیمایش یا ممیزی میدانی مصوب را آماده کنید.';
  if (accessMode.includes('سازمانی')) return 'درخواست رسمی داده سازمانی را ایجاد و تا دریافت پیگیری کنید.';
  if (accessMode.includes('برخط')) return 'پس از تایید مرز، اتصال دهنده مجاز داده را اجرا کنید.';
  return 'راهنمای دسترسی رجیستر را بازبینی و مسئول تامین داده را تعیین کنید.';
}

export function buildIndicatorTasks(registry: RegistryRow[]): IndicatorTask[] {
  return registry
    .slice()
    .sort((a, b) => Number(a.source_order) - Number(b.source_order))
    .map((row) => ({
      code: row.code,
      domain: row.domain,
      axis: row.axis,
      indicator: row.indicator,
      driver_id: row.driver_id,
      coefficient: Number(row.coefficient),
      domain_weight_percent: Number(row.domain_weight_percent),
      direction: row.direction,
      calc_family: row.calc_family,
      access_mode: row.access_mode,
      playbooks: row.playbook_codes.split(',').map((code) => code.trim()).filter(Boolean),
      source_requirements: row.source_requirements,
      formula_text: row.formula_text,
      formula_version: `${row.code}@1.0`,
      mapping_confidence: row.mapping_confidence,
      status: 'PLANNED' as IndicatorStatus,
      next_action: initialNextAction(row.access_mode),
      measurement_ids: [],
    }));
}

export function startedTaskStatus(task: IndicatorTask): Pick<IndicatorTask, 'status' | 'next_action' | 'missing_reason'> {
  const access = task.access_mode;
  if (access.includes('میدانی')) {
    const isSurvey = task.calc_family.includes('survey');
    return {
      status: isSurvey ? 'WAITING_FOR_SURVEY' : 'WAITING_FOR_FIELD_AUDIT',
      next_action: isSurvey
        ? 'بسته پیمایش ناشناس سازی شده و مورد تایید را گردآوری و بارگذاری کنید.'
        : 'ممیزی میدانی مکان مند مصوب را تکمیل و مستندات آن را بارگذاری کنید.',
      missing_reason: isSurvey ? 'survey_data_not_received' : 'field_audit_not_received',
    };
  }
  if (access.includes('سازمانی')) {
    return {
      status: 'WAITING_FOR_ORGANIZATIONAL_DATA',
      next_action: 'داده تجمیعی سازمانی را همراه منشا، نسخه، مجوز و checksum بارگذاری کنید.',
      missing_reason: 'organizational_data_not_received',
    };
  }
  if (access.includes('برخط')) {
    return {
      status: 'NOT_AVAILABLE',
      next_action: 'اتصال دهنده مورد تایید رجیستر را اجرا کنید و برآورد مدلی را جایگزین داده نکنید.',
      missing_reason: 'approved_connector_not_executed',
    };
  }
  return {
    status: 'NOT_AVAILABLE',
    next_action: 'منبع و playbook مصوب تامین داده را تعیین و به مسئول آن واگذار کنید.',
    missing_reason: 'approved_source_not_configured',
  };
}
