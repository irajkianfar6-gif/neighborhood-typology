import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Geometry, Position } from 'geojson';

/** مسیر public/data؛ ARA_PUBLIC_DATA_DIR اولویت دارد (Docker volume / fixture تست) */
function publicDataDirFor(root: string): string {
  return process.env.ARA_PUBLIC_DATA_DIR ? path.resolve(process.env.ARA_PUBLIC_DATA_DIR) : path.join(root, 'public', 'data');
}
import type { IndicatorTask, TypologyRun } from './typologyTypes';

export interface AutoEvidenceOptions {
  rootDirectory?: string;
  maxRecords?: number;
}

export interface AutoEvidenceResult {
  source: 'local-catalog';
  province_id: string | null;
  province_directory: string | null;
  area_km2: number | null;
  records: Record<string, unknown>[];
  skipped: Array<{ code: string; reason: string }>;
  layers: Array<{ tag: string; path: string; count: number }>;
}

type Feature = { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> };

const GROUPS = ['education', 'health', 'transport', 'public_services', 'utilities', 'industrial', 'water', 'green', 'buildings'] as const;
const DIRECT_LOCAL_FAMILIES = new Set(['network_access', 'spatial_statistic', 'per_capita_or_density']);
const ROAD_LENGTH_INDICATORS = new Set(['PHY-016', 'PHY-037', 'PHY-089', 'PHY-104', 'PHY-109', 'PHY-163', 'PHY-164', 'NOR-023', 'NOR-026']);
const GREEN_AREA_INDICATORS = new Set(['PHY-056', 'PHY-074', 'PHY-102', 'PHY-119', 'PHY-127', 'PHY-139', 'PHY-144', 'BEH-131', 'BEH-133', 'BEH-165']);
const LANDUSE_AREA_INDICATORS = new Map<string, Set<string>>([
  ['PHY-160', new Set(['industrial'])],
  ['BEH-055', new Set(['industrial'])],
  ['PHY-057', new Set(['water', 'wetland'])],
]);
const TAG_TERMS: Record<string, string[]> = {
  education: ['مدرسه', 'آموزش', 'تحصیل', 'کتابخانه', 'دانشگاه', 'فرهنگ', 'educat', 'school', 'library'],
  health: ['بهداشت', 'سلامت', 'درمان', 'بیمارستان', 'پزشک', 'اورژانس', 'health', 'hospital', 'clinic'],
  transport: ['اتوبوس', 'حمل', 'ترافیک', 'معبر', 'خیابان', 'راه', 'دوچرخه', 'پارکینگ', 'transport', 'bus', 'street', 'road'],
  green: ['پارک', 'سبز', 'فضای باز', 'پوشش گیاهی', 'green', 'park', 'vegetation'],
  water: ['آب', 'فاضلاب', 'آبگرفتگی', 'آب سطحی', 'water', 'wastewater'],
  buildings: ['ساختمان', 'مسکن', 'کالبد', 'بافت', 'housing', 'building', 'morphology'],
  public_services: ['خدمات عمومی', 'خدمت رسانی', 'پلیس', 'آتش', 'خدمات', 'public service', 'police', 'fire'],
  utilities: ['انشعاب', 'زیرساخت', 'برق', 'گاز', 'تأسیسات', 'utility', 'energy'],
  industrial: ['صنعت', 'کارگاه', 'فعالیت', 'industrial', 'workshop'],
};

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[\u200c\u200f\u064b-\u065f]/g, '').replace(/[ _-]+/g, ' ').trim();
}

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function pointFromGeometry(geometry: Feature['geometry']): Position | null {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  const values: Position[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') values.push([value[0], value[1]]);
    else if (Array.isArray(value)) value.forEach(walk);
  };
  walk(geometry.coordinates);
  if (!values.length) return null;
  return [values.reduce((sum, item) => sum + item[0], 0) / values.length, values.reduce((sum, item) => sum + item[1], 0) / values.length];
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point: Position, geometry: Geometry): boolean {
  if (geometry.type === 'Polygon') return pointInRing(point, geometry.coordinates[0] as Position[]) && !(geometry.coordinates.slice(1) as Position[][]).some((ring) => pointInRing(point, ring));
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => pointInRing(point, polygon[0] as Position[]) && !(polygon.slice(1) as Position[][]).some((ring) => pointInRing(point, ring)));
  return false;
}

function geometryPositions(value: unknown): Position[] {
  const positions: Position[] = [];
  const walk = (item: unknown): void => {
    if (Array.isArray(item) && typeof item[0] === 'number' && typeof item[1] === 'number') positions.push([item[0], item[1]]);
    else if (Array.isArray(item)) item.forEach(walk);
  };
  walk(value);
  return positions;
}

function haversineKm(a: Position, b: Position): number {
  const radius = 6371;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function lineLengthKm(coordinates: unknown): number {
  const positions = geometryPositions(coordinates);
  let length = 0;
  for (let index = 1; index < positions.length; index += 1) length += haversineKm(positions[index - 1], positions[index]);
  return length;
}

function polygonAreaKm2(coordinates: unknown): number {
  const positions = geometryPositions(coordinates);
  if (positions.length < 3) return 0;
  const lat = positions.reduce((sum, point) => sum + point[1], 0) / positions.length;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = 111_320 * Math.max(0.2, Math.cos(lat * Math.PI / 180));
  let sum = 0;
  for (let index = 0; index < positions.length; index += 1) {
    const next = positions[(index + 1) % positions.length];
    sum += positions[index][0] * next[1] - next[0] * positions[index][1];
  }
  return Math.abs(sum / 2) * metersPerDegreeLat * metersPerDegreeLng / 1_000_000;
}

function pbfMetric(root: string, task: IndicatorTask, boundary: Geometry, cache: Map<string, unknown>): { value: number; unit: string; path: string; dataset: string } | null {
  const text = normalize(task.indicator);
  const roadTask = ROAD_LENGTH_INDICATORS.has(task.code);
  const greenTask = GREEN_AREA_INDICATORS.has(task.code);
  const landuseTags = LANDUSE_AREA_INDICATORS.get(task.code);
  const landuseTask = greenTask || Boolean(landuseTags);
  const file = roadTask ? path.join(publicDataDirFor(root), 'pbf', 'roads.json') : landuseTask ? path.join(publicDataDirFor(root), 'pbf', 'landuse.json') : '';
  if (!file || !fs.existsSync(file)) return null;
  const cached = cache.has(file) ? cache.get(file) : readJson(file);
  if (!cache.has(file)) cache.set(file, cached);
  const data = cached as { lines?: Array<{ t?: string; c?: unknown }>; polys?: Array<{ t?: string; c?: unknown }> } | null;
  if (!data) return null;
  const rows = roadTask ? data.lines ?? [] : data.polys ?? [];
  const allowed = roadTask
    ? new Set(['primary', 'secondary', 'tertiary', 'trunk', 'motorway', 'primary_link', 'secondary_link', 'trunk_link', 'motorway_link'])
    : text.includes('ØµÙ†Ø¹Øª')
      ? new Set(['industrial'])
      : text.includes('Ø¢Ø¨')
        ? new Set(['water', 'wetland'])
        : new Set(['forest', 'cemetery', 'recreation_ground', 'park', 'garden', 'grass']);
  let count = 0;
  let value = 0;
  for (const row of rows) {
    if (!row.c || (row.t && !allowed.has(row.t))) continue;
    const positions = geometryPositions(row.c);
    if (!positions.length) continue;
    const center: Position = [positions.reduce((sum, point) => sum + point[0], 0) / positions.length, positions.reduce((sum, point) => sum + point[1], 0) / positions.length];
    if (!pointInGeometry(center, boundary)) continue;
    count += 1;
    value += roadTask ? lineLengthKm(row.c) : polygonAreaKm2(row.c);
  }
  if (!count) return null;
  return {
    value: roadTask ? value : value || count,
    unit: roadTask ? 'km' : 'km2',
    path: file,
    dataset: roadTask ? 'pbf:roads:osm' : 'pbf:landuse:osm',
  };
}

function explicitLanduseMetric(root: string, task: IndicatorTask, boundary: Geometry, cache: Map<string, unknown>): { value: number; unit: string; path: string; dataset: string } | null {
  const allowed = LANDUSE_AREA_INDICATORS.get(task.code);
  if (!allowed) return null;
  const file = path.join(publicDataDirFor(root), 'pbf', 'landuse.json');
  if (!fs.existsSync(file)) return null;
  const cached = cache.has(file) ? cache.get(file) : readJson(file);
  if (!cache.has(file)) cache.set(file, cached);
  const rows = (cached as { polys?: Array<{ t?: string; c?: unknown }> } | null)?.polys ?? [];
  let count = 0;
  let value = 0;
  for (const row of rows) {
    if (!row.c || (row.t && !allowed.has(row.t))) continue;
    const positions = geometryPositions(row.c);
    if (!positions.length) continue;
    const center: Position = [positions.reduce((sum, point) => sum + point[0], 0) / positions.length, positions.reduce((sum, point) => sum + point[1], 0) / positions.length];
    if (!pointInGeometry(center, boundary)) continue;
    count += 1;
    value += polygonAreaKm2(row.c);
  }
  if (!count) return null;
  return { value: value || count, unit: 'km2', path: file, dataset: `pbf:landuse:osm:${Array.from(allowed).join('+')}` };
}

function provinceDirectory(root: string, province: string): { id: string; directory: string } | null {
  const base = path.join(root, 'geojson', 'new_data', 'iran-provinces', 'provinces');
  if (!fs.existsSync(base)) return null;
  const needle = normalize(province).replace(/^استان\s+/, '');
  for (const name of fs.readdirSync(base)) {
    const match = /^(IR-\d+)_([^/]+)$/.exec(name);
    if (match && (normalize(name).includes(needle) || normalize(match[2]).includes(needle) || needle.includes(normalize(match[2])))) return { id: match[1], directory: path.join(base, name) };
  }
  return null;
}

function tagForTask(task: IndicatorTask): string | null {
  const text = normalize(`${task.indicator} ${task.calc_family} ${task.axis}`);
  const ordered = ['education', 'health', 'transport', 'green', 'water', 'buildings', 'public_services', 'utilities', 'industrial'];
  return ordered.find((tag) => TAG_TERMS[tag].some((term) => text.includes(normalize(term)))) ?? null;
}

function scoreFromDensity(density: number, direction: string, tag: string): number {
  const ceilings: Record<string, number> = { education: 8, health: 3, transport: 4, public_services: 5, utilities: 3, industrial: 4, water: 1, buildings: 2000, green: 5 };
  const ratio = Math.max(0, Math.min(1, density / (ceilings[tag] ?? 5)));
  const base = 1 + ratio * 4;
  return Number((normalize(direction).includes('معکوس') ? 6 - base : base).toFixed(3));
}

function scoreFromAccessDistance(distanceKm: number, tag: string): number {
  const thresholds: Record<string, number> = { education: 0.8, health: 1.2, transport: 0.4, green: 0.4, public_services: 1, utilities: 1, water: 1.5 };
  const ratio = Math.max(0, Math.min(1, distanceKm / (thresholds[tag] ?? 1)));
  return Number((5 - ratio * 4).toFixed(3));
}

function summaryValue(directory: string, key: string): { value: number; path: string; fingerprint: string } | null {
  const candidates = [
    path.join(directory, 'satellite', 'satellite_statistics.json'),
    path.join(directory, 'environmental_statistics.json'),
    path.join(directory, 'socioeconomic_statistics.json'),
  ];
  for (const file of candidates) {
    const data = readJson(file) as Record<string, unknown> | null;
    if (!data) continue;
    const stack: unknown[] = [data];
    while (stack.length) {
      const item = stack.pop();
      if (!item || typeof item !== 'object') continue;
      for (const [name, value] of Object.entries(item as Record<string, unknown>)) {
        if (normalize(name) === normalize(key) && typeof value === 'number' && Number.isFinite(value)) return { value, path: file, fingerprint: sha256(file) };
        if (value && typeof value === 'object') stack.push(value);
      }
    }
  }
  return null;
}

function portalPopulation(root: string, province: string, referenceYear: number): { value: number; path: string; fingerprint: string; year: string } | null {
  const file = path.join(root, 'src', 'data', 'portals', 'population', 'projections-1396-1415.json');
  const rows = readJson(file) as Array<Record<string, unknown>> | null;
  if (!Array.isArray(rows)) return null;
  const target = normalize(province).replace(/^استان\s+/, '');
  const matches = rows.filter((row) => normalize(row.province).includes(target) || target.includes(normalize(row.province)));
  if (!matches.length) return null;
  const selected = matches.slice().sort((a, b) => Math.abs(Number(a.year) - referenceYear) - Math.abs(Number(b.year) - referenceYear))[0];
  const value = Number(selected.total);
  if (!Number.isFinite(value)) return null;
  return { value: value * (value < 100_000 ? 1_000 : 1), path: file, fingerprint: sha256(file), year: String(selected.year) };
}

function proxyValue(task: IndicatorTask, directory: string, root: string, province: string, referenceYear: number): { value: number; unit: string; sourcePath: string; fingerprint: string; dataset: string } | null {
  const text = normalize(task.indicator);
  if (text.includes('جمعیت') || text.includes('تراکم جمعیت')) {
    const portal = portalPopulation(root, province, referenceYear);
    return portal ? { value: portal.value, unit: 'person', sourcePath: portal.path, fingerprint: portal.fingerprint, dataset: `portals:sci-population:${portal.year}` } : null;
  }
  const key = text.includes('pm2') || text.includes('معلق') || text.includes('هوا') ? 'pm25_ug_m3_annual_mean' : text.includes('سبز') || text.includes('گیاهی') ? 'NDVI_mean' : text.includes('بیکاری') ? 'unemployment_rate' : '';
  if (!key) return null;
  const found = summaryValue(directory, key);
  if (!found) return null;
  return { value: found.value, unit: key.includes('pm') ? 'ug/m3' : 'index', sourcePath: found.path, fingerprint: found.fingerprint, dataset: `geojson:province-summary:${key}` };
}

export function buildLocalTypologyEvidence(run: TypologyRun, options: AutoEvidenceOptions = {}): AutoEvidenceResult {
  const root = options.rootDirectory ?? process.cwd();
  const selected = provinceDirectory(root, run.request.province);
  const boundary = run.boundary?.geojson;
  const result: AutoEvidenceResult = { source: 'local-catalog', province_id: selected?.id ?? null, province_directory: selected ? selected.directory : null, area_km2: run.boundary?.area_km2 ?? null, records: [], skipped: [], layers: [] };
  if (!selected || !boundary || (boundary.type !== 'Polygon' && boundary.type !== 'MultiPolygon')) {
    result.skipped.push({ code: '*', reason: !selected ? 'province_source_not_found' : 'boundary_not_confirmed' });
    return result;
  }
  const area = Math.max(0.01, run.boundary?.area_km2 ?? 1);
  const cache = new Map<string, { count: number; points: Position[]; file: string; fingerprint: string }>();
  const pbfCache = new Map<string, unknown>();
  for (const group of GROUPS) {
    const file = path.join(selected.directory, 'categorized', 'by_group', `${group}.geojson`);
    if (!fs.existsSync(file)) continue;
    const data = readJson(file) as { features?: Feature[] } | null;
    if (!data?.features) continue;
    let count = 0;
    const points: Position[] = [];
    for (const feature of data.features) {
      const point = pointFromGeometry(feature.geometry);
      if (point && pointInGeometry(point, boundary as Geometry)) {
        count += 1;
        points.push(point);
      }
    }
    const entry = { count, points, file, fingerprint: sha256(file) };
    cache.set(group, entry);
    result.layers.push({ tag: group, path: file, count });
  }

  const max = options.maxRecords ?? 180;
  for (const task of run.tasks) {
    if (result.records.length >= max) break;
    if (['survey', 'field_audit', 'composite'].includes(task.calc_family)) {
      result.skipped.push({ code: task.code, reason: 'survey_or_field_or_composite_requires_authorized_input' });
      continue;
    }
    const tag = tagForTask(task);
    const local = tag ? cache.get(tag) : undefined;
    let raw: number | null = null;
    let unit = 'count';
    let sourcePath = '';
    let version = '';
    let quality = 0.58;
    let geography = 'neighborhood boundary';
    if (local && DIRECT_LOCAL_FAMILIES.has(task.calc_family) && !ROAD_LENGTH_INDICATORS.has(task.code) && !GREEN_AREA_INDICATORS.has(task.code)) {
      if (task.calc_family === 'network_access' && local.points.length) {
        const center = pointFromGeometry(boundary as Feature['geometry']);
        if (center) {
          const distance = Math.min(...local.points.map((point) => haversineKm(center, point)));
          const score = scoreFromAccessDistance(distance, tag!);
          result.records.push({ indicator_code: task.code, raw_value: distance, cleaned_value: distance, unit: 'km straight-line', reference_date: run.request.reference_year ? String(run.request.reference_year) : undefined, geography, score_1_5: score, source: { device: 'local-geojson-catalog', url: `local://${local.file.replace(/\\/g, '/')}`, dataset_id: `geojson:${selected.id}:${tag}`, version: local.fingerprint, retrieved_at: new Date().toISOString(), license: 'local-source-with-original-provenance', checksum: local.fingerprint, coverage: 1 }, method: { formula_version: task.formula_version, code_commit: 'local-data-connector-v2-access-distance' }, quality: { spatial_coverage: 1, temporal_coverage: 0.6, score: 0.52, flags: ['AUTO_EXTRACTED_LOCAL_GEOJSON', 'STRAIGHT_LINE_ACCESS_PROXY', 'NETWORK_ROUTING_REQUIRED_FOR_VERIFIED_VALUE'] }, status: 'measured' });
          continue;
        }
      }
      raw = local.count;
      unit = `${tag} features`; sourcePath = local.file; version = local.fingerprint;
      const density = raw / area;
      const score = scoreFromDensity(density, task.direction, tag!);
      result.records.push({ indicator_code: task.code, raw_value: raw, cleaned_value: density, unit: `${unit}/km2`, numerator: raw, denominator: area, reference_date: run.request.reference_year ? String(run.request.reference_year) : undefined, geography, score_1_5: score, source: { device: 'local-geojson-catalog', url: `local://${sourcePath.replace(/\\/g, '/')}`, dataset_id: `geojson:${selected.id}:${tag}`, version, retrieved_at: new Date().toISOString(), license: 'local-source-with-original-provenance', checksum: version, coverage: 1 }, method: { formula_version: task.formula_version, code_commit: 'local-data-connector-v1' }, quality: { spatial_coverage: 1, temporal_coverage: 0.6, score: quality, flags: ['AUTO_EXTRACTED_LOCAL_GEOJSON'] }, status: 'measured' });
      continue;
    }
    if ((DIRECT_LOCAL_FAMILIES.has(task.calc_family) || LANDUSE_AREA_INDICATORS.has(task.code)) && (!local || ROAD_LENGTH_INDICATORS.has(task.code) || GREEN_AREA_INDICATORS.has(task.code) || LANDUSE_AREA_INDICATORS.has(task.code))) {
      const pbf = pbfMetric(root, task, boundary as Geometry, pbfCache) ?? explicitLanduseMetric(root, task, boundary as Geometry, pbfCache);
      if (pbf) {
        const density = pbf.value / area;
        const score = scoreFromDensity(density, task.direction, tag ?? (pbf.unit === 'km' ? 'transport' : 'green'));
        const fingerprint = sha256(pbf.path);
        const dataset = LANDUSE_AREA_INDICATORS.has(task.code) ? `pbf:landuse:osm:${Array.from(LANDUSE_AREA_INDICATORS.get(task.code) ?? []).join('+')}` : pbf.dataset;
        const metricFlags = ['AUTO_EXTRACTED_PBF', 'GEOMETRY_CLIPPED_TO_BOUNDARY', pbf.unit === 'km' ? 'LENGTH_DENSITY' : 'AREA_DENSITY'];
        if (LANDUSE_AREA_INDICATORS.has(task.code)) metricFlags.push('LANDUSE_CODE_FILTERED_PROXY');
        if (ROAD_LENGTH_INDICATORS.has(task.code)) metricFlags.push('ROAD_CLASS_FILTERED');
        result.records.push({ indicator_code: task.code, raw_value: pbf.value, cleaned_value: density, unit: `${pbf.unit}/km2`, numerator: pbf.value, denominator: area, reference_date: run.request.reference_year ? String(run.request.reference_year) : undefined, geography, score_1_5: score, source: { device: 'local-pbf-catalog', url: `local://${pbf.path.replace(/\\/g, '/')}`, dataset_id: dataset, version: fingerprint, retrieved_at: new Date().toISOString(), license: 'OpenStreetMap ODbL 1.0', checksum: fingerprint, coverage: 0.9 }, method: { formula_version: task.formula_version, code_commit: 'local-data-connector-v2-pbf-metrics' }, quality: { spatial_coverage: 0.9, temporal_coverage: 0.7, score: 0.62, flags: metricFlags }, status: 'measured' });
        result.layers.push({ tag: dataset, path: pbf.path, count: 1 });
        continue;
      }
    }
    const proxy = proxyValue(task, selected.directory, root, run.request.province, run.request.reference_year);
    if (!proxy) {
      result.skipped.push({ code: task.code, reason: local ? 'matching_layer_not_valid_for_formula_family' : 'no_matching_local_layer_or_summary' });
      continue;
    }
    raw = proxy.value; unit = proxy.unit; sourcePath = proxy.sourcePath; version = proxy.fingerprint; quality = 0.22; geography = 'province proxy';
    const score = proxy.dataset.startsWith('portals:') ? null : scoreFromDensity(raw, task.direction, tag ?? 'environment');
    result.records.push({ indicator_code: task.code, raw_value: raw, cleaned_value: raw, unit, reference_date: run.request.reference_year ? String(run.request.reference_year) : undefined, geography, score_1_5: score, source: { device: proxy.dataset.startsWith('portals:') ? 'local-portals-catalog' : 'local-province-summary', url: `local://${sourcePath.replace(/\\/g, '/')}`, dataset_id: proxy.dataset, version, retrieved_at: new Date().toISOString(), license: 'local-source-with-original-provenance', checksum: version, coverage: 0.25 }, method: { formula_version: task.formula_version, code_commit: 'local-data-connector-v1' }, quality: { spatial_coverage: 0.25, temporal_coverage: 0.5, score: quality, flags: ['PROXY_GEOGRAPHY', proxy.dataset.startsWith('portals:') ? 'AUTO_EXTRACTED_PORTALS' : 'AUTO_EXTRACTED_LOCAL_SUMMARY'] }, status: 'measured' });
  }
  return result;
}
