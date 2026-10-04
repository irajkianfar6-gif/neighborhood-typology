import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';

type FetchLike = typeof fetch;
type ProviderState = {
  provider: string;
  status: 'online' | 'degraded' | 'offline';
  requests: number;
  successes: number;
  failures: number;
  cache_hits: number;
  stale_hits: number;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_latency_ms: number | null;
  last_error: string | null;
};

type CacheEntry = {
  value: unknown;
  expiresAt: number;
  staleUntil: number;
  fetchedAt: string;
};

type HealthsitesResult = {
  payload: ReturnType<typeof normalizeHealthsitesPayload>;
  provider: 'healthsites' | 'osm-overpass' | 'local-osm-pbf';
};

type ProviderPayload<T> = {
  payload: T;
  provider: string;
  fallback?: string;
};

export type LocalPoiPoint = {
  t?: string;
  n?: string;
  c?: [number, number];
};

export interface ExternalDataProxyOptions {
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  staleTtlMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  localPoiPath?: string;
  overpassEndpoints?: string[];
}

const DEFAULT_OPTIONS = {
  // باید از OVERPASS_SERVER_TIMEOUT_S (۸ ثانیه) بزرگ‌تر بماند، وگرنه قطع کارخواه
  // همیشه پیش از پاسخ Overpass رخ می‌دهد.
  timeoutMs: 12_000,
  cacheTtlMs: 5 * 60_000,
  staleTtlMs: 30 * 60_000,
  maxRetries: 2,
  retryDelayMs: 150,
} as const;

const INDICATOR_PATTERN = /^[A-Za-z0-9_.-]{1,96}$/;

/** خواندن نقاط POI محلی از فایل PBF استخراج‌شده (fallback مشترک) */
export function readLocalPoiPoints(filePath: string = DEFAULT_LOCAL_POI_PATH): LocalPoiPoint[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { points?: LocalPoiPoint[] };
    return Array.isArray(parsed.points) ? parsed.points : [];
  } catch {
    return [];
  }
}
const FILTER_PATTERN = /^[A-Za-z0-9_$.'" =<>!()&|+-]{0,240}$/;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_LOCAL_POI_PATH = path.join(process.env.ARA_PUBLIC_DATA_DIR || path.join(PROJECT_ROOT, 'public', 'data'), 'pbf', 'pois.json');
/**
 * آینه‌های Overpass.
 *
 * تجربهٔ عملیاتی این شبکه (اندازه‌گیری‌شده):
 *  - `overpass.kumi.systems`، `overpass.private.coffee`، `maps.mail.ru`،
 *    `overpass.osm.jp` و آینه‌های روسی هیچ پاسخی نمی‌دهند (timeout کامل) و
 *    فقط به‌ازای هر آینه، زمان انتظار هر درخواست را بالا می‌برند.
 *  - `overpass.osm.ch` سریع است اما پوشش ایران ندارد و برای تهران «صفر کاذب»
 *    برمی‌گرداند، پس آینهٔ معتبر نیست.
 *  - آینه‌های رسمی `lz4.` و `z.` پوشش کامل دارند و پاسخ می‌دهند.
 * بنابراین فهرست به آینه‌های رسمی با پوشش جهانی محدود شده و با
 * `OVERPASS_ENDPOINTS` (جداشده با کاما) قابل بازنویسی است.
 */
export const DEFAULT_OVERPASS_ENDPOINTS = process.env.OVERPASS_ENDPOINTS?.trim()
  ? process.env.OVERPASS_ENDPOINTS.split(',').map((entry) => entry.trim()).filter(Boolean)
  : [
      'https://overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
      'https://z.overpass-api.de/api/interpreter',
    ];

/**
 * بودجهٔ زمانی سمت سرور Overpass (ثانیه).
 *
 * ناوردا: این مقدار باید همیشه از مهلت کارخواه کمتر باشد، وگرنه کارخواه پیش از
 * آنکه Overpass پاسخ بدهد قطع می‌کند و نتیجه همیشه «aborted/timeout» می‌شود.
 * مهلت کارخواه این پراکسی `DEFAULT_OPTIONS.timeoutMs` و در دروازهٔ منابع
 * `SourceRuntime#timeoutMs` است.
 */
export const OVERPASS_SERVER_TIMEOUT_S = 8;

/** مقادیر دقیق مهمان‌نوازی — فیلتر `"amenity"="x"` ایندکس‌پذیر است؛ regex به ۵۰۴ می‌خورد. */
const POI_AMENITIES = ['school', 'kindergarten', 'hospital', 'clinic', 'doctors', 'pharmacy', 'place_of_worship', 'bank', 'restaurant', 'cafe', 'fast_food'] as const;
const POI_SHOPS = ['supermarket', 'grocery'] as const;
const HEALTH_AMENITIES = ['hospital', 'clinic', 'doctors', 'pharmacy'] as const;
const SIDEWALK_VALUES = ['yes', 'both', 'left', 'right'] as const;

function bboxLiteral(south: number, west: number, north: number, east: number): string {
  return `${south},${west},${north},${east}`;
}

function overpassQuery(body: string): string {
  return `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}];(${body});out center tags;`;
}

/**
 * پرس‌وجوی POI با تطبیق دقیق مقادیر.
 *
 * نسخهٔ قبلی از `nwr["amenity"~"school|hospital|..."]` استفاده می‌کرد که اسکن
 * regex روی یک bbox متراکم است و روی آینهٔ عمومی به ۵۰۴ می‌خورد؛ نتیجه این بود که
 * استخراج زنده هرگز کامل نمی‌شد و همیشه به PBF محلی برمی‌گشت.
 */
export function buildPoiQuery(south: number, west: number, north: number, east: number): string {
  const bbox = bboxLiteral(south, west, north, east);
  const parts = [
    ...POI_AMENITIES.map((amenity) => `nwr["amenity"="${amenity}"](${bbox});`),
    `nwr["leisure"="park"](${bbox});`,
    `nwr["highway"="bus_stop"](${bbox});`,
    ...POI_SHOPS.map((shop) => `nwr["shop"="${shop}"](${bbox});`),
  ];
  return overpassQuery(parts.join(''));
}

/** پرس‌وجوی تأسیسات سلامت با تطبیق دقیق مقادیر */
export function buildHealthQuery(south: number, west: number, north: number, east: number): string {
  const bbox = bboxLiteral(south, west, north, east);
  return overpassQuery(HEALTH_AMENITIES.map((amenity) => `nwr["amenity"="${amenity}"](${bbox});`).join(''));
}

/** پرس‌وجوی پیاده‌مداری با تطبیق دقیق مقادیر */
export function buildWalkabilityQuery(south: number, west: number, north: number, east: number): string {
  const bbox = bboxLiteral(south, west, north, east);
  const parts = [
    `node["highway"="crossing"](${bbox});`,
    `node["highway"="traffic_signals"](${bbox});`,
    `node["highway"="street_lamp"](${bbox});`,
    ...SIDEWALK_VALUES.map((value) => `way["highway"]["sidewalk"="${value}"](${bbox});`),
  ];
  return overpassQuery(parts.join(''));
}

export const WHO_WORLD_BANK_FALLBACKS: Record<string, string> = {
  GHS_SHA_GHED_GDP_SHA2011: 'SH.XPD.CHEX.GD.ZS',
  WHS6_102: 'SH.MED.BEDS.ZS',
  WHS6_106: 'SH.MED.PHYS.ZS',
};

class UpstreamError extends Error {
  constructor(public readonly provider: string, public readonly status: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

class UpstreamTimeoutError extends UpstreamError {
  constructor(provider: string, timeoutMs: number) {
    super(provider, 504, `${provider} timed out after ${timeoutMs}ms`);
    this.name = 'UpstreamTimeoutError';
  }
}

function correlationId(req: Request): string {
  const incoming = req.header('x-correlation-id')?.trim();
  return incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
}

function createProviderState(provider: string): ProviderState {
  return {
    provider,
    status: 'offline',
    requests: 0,
    successes: 0,
    failures: 0,
    cache_hits: 0,
    stale_hits: 0,
    consecutive_failures: 0,
    last_success_at: null,
    last_failure_at: null,
    last_latency_ms: null,
    last_error: null,
  };
}

function isJsonLike(value: unknown): boolean {
  return value !== null && (Array.isArray(value) || typeof value === 'object');
}

function validateIndicator(value: string): boolean {
  return INDICATOR_PATTERN.test(value);
}

function normalizeFilter(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const filter = String(value).trim();
  return FILTER_PATTERN.test(filter) ? filter : null;
}

function parseCoordinates(req: Request): { lat: number; lng: number } | null {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 24 || lat > 40.5 || lng < 43 || lng > 64) return null;
  return { lat, lng };
}

function setResponseMetadata(res: Response, id: string, provider: string, cache: 'MISS' | 'HIT' | 'STALE', latencyMs?: number): void {
  res.setHeader('X-Correlation-ID', id);
  res.setHeader('X-Provider', provider);
  res.setHeader('X-Cache', cache);
  if (latencyMs !== undefined) res.setHeader('X-Provider-Latency-Ms', String(Math.max(0, Math.round(latencyMs))));
}

function toIso(now: () => number): string {
  return new Date(now()).toISOString();
}

export function normalizeHealthsitesPayload(payload: unknown): { features: Array<{ type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }> } {
  if (payload && typeof payload === 'object' && Array.isArray((payload as { features?: unknown }).features)) {
    return payload as { features: Array<{ type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }> };
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as { facilities?: unknown }).facilities)) {
    const facilities = (payload as { facilities: Array<Record<string, unknown>> }).facilities;
    return {
      features: facilities.map((facility) => ({
        type: 'Feature',
        geometry: facility.geometry ?? { type: 'Point', coordinates: [facility.lng ?? facility.lon ?? 0, facility.lat ?? 0] },
        properties: (facility.properties as Record<string, unknown> | undefined) ?? facility,
      })),
    };
  }
  return { features: [] };
}

export function normalizeOverpassPayload(payload: unknown): { features: Array<{ type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }> } {
  const elements = payload && typeof payload === 'object' && Array.isArray((payload as { elements?: unknown }).elements)
    ? (payload as { elements: Array<Record<string, unknown>> }).elements
    : [];
  return {
    features: elements.map((element) => {
      const tags = (element.tags as Record<string, unknown> | undefined) ?? {};
      const lat = Number(element.lat ?? (element.center as Record<string, unknown> | undefined)?.lat ?? 0);
      const lon = Number(element.lon ?? (element.center as Record<string, unknown> | undefined)?.lon ?? 0);
      const amenity = String(tags.amenity ?? '');
      const type = amenity === 'hospital' ? 'hospital' : amenity === 'pharmacy' ? 'pharmacy' : amenity === 'clinic' || amenity === 'doctors' ? 'clinic' : amenity || 'health facility';
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { ...tags, type, source: 'OSM_OVERPASS_FALLBACK' },
      };
    }),
  };
}

function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeWorldBankAsWho(payload: unknown, indicator: string, fallbackIndicator: string): { value: Array<Record<string, unknown>> } | null {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return null;
  const row = payload[1].find((candidate) => candidate && typeof candidate === 'object' && finiteNumber((candidate as Record<string, unknown>).value) !== null) as Record<string, unknown> | undefined;
  const value = finiteNumber(row?.value);
  if (value === null) return null;
  return {
    value: [{
      NumericValue: value,
      TimeDim: finiteNumber(row?.date),
      SpatialDim: 'IRN',
      IndicatorCode: indicator,
      SourceIndicatorCode: fallbackIndicator,
      Source: 'World Bank indicator fallback',
    }],
  };
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLng = (lng2 - lng1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function localFeatureCollection(points: LocalPoiPoint[], lat: number, lng: number, radiusKm: number, allowedTypes?: Set<string>): ReturnType<typeof normalizeHealthsitesPayload> {
  return {
    features: points.flatMap((point) => {
      const coordinates = point.c;
      const type = String(point.t ?? '').toLowerCase();
      if (!coordinates || (allowedTypes && !allowedTypes.has(type)) || haversineKm(lat, lng, coordinates[1], coordinates[0]) > radiusKm) return [];
      return [{
        type: 'Feature' as const,
        geometry: { type: 'Point', coordinates },
        properties: { type, name: point.n ?? null, source: 'LOCAL_OSM_PBF_FALLBACK' },
      }];
    }),
  };
}

export function countPoiFeatures(features: Array<{ properties?: Record<string, unknown> }>): Record<string, number> {
  const counts = { schools: 0, hospitals: 0, parks: 0, busStops: 0, supermarkets: 0, pharmacies: 0, mosques: 0, banks: 0, restaurants: 0 };
  for (const feature of features) {
    const properties = feature.properties ?? {};
    const amenity = String(properties.amenity ?? properties.type ?? '').toLowerCase();
    const shop = String(properties.shop ?? '').toLowerCase();
    const leisure = String(properties.leisure ?? '').toLowerCase();
    const highway = String(properties.highway ?? '').toLowerCase();
    if (amenity === 'school' || amenity === 'kindergarten') counts.schools += 1;
    else if (amenity === 'hospital' || amenity === 'clinic' || amenity === 'doctors') counts.hospitals += 1;
    else if (leisure === 'park' || amenity === 'park') counts.parks += 1;
    else if (highway === 'bus_stop' || amenity === 'bus_stop') counts.busStops += 1;
    else if (shop === 'supermarket' || shop === 'grocery' || amenity === 'supermarket' || amenity === 'grocery') counts.supermarkets += 1;
    else if (amenity === 'pharmacy') counts.pharmacies += 1;
    else if (amenity === 'place_of_worship') counts.mosques += 1;
    else if (amenity === 'bank') counts.banks += 1;
    else if (amenity === 'restaurant' || amenity === 'cafe' || amenity === 'fast_food') counts.restaurants += 1;
  }
  return counts;
}

export function normalizeOverpassFeatures(payload: unknown): Array<{ properties: Record<string, unknown> }> {
  const elements = payload && typeof payload === 'object' && Array.isArray((payload as { elements?: unknown }).elements)
    ? (payload as { elements: Array<Record<string, unknown>> }).elements
    : [];
  return elements.map((element) => ({ properties: (element.tags as Record<string, unknown> | undefined) ?? {} }));
}

export function normalizeWalkability(payload: unknown): { sidewalkDensity: number; crossingDensity: number; streetLightDensity: number } {
  const features = normalizeOverpassFeatures(payload);
  const crossings = features.filter((feature) => feature.properties.highway === 'crossing').length;
  const signals = features.filter((feature) => feature.properties.highway === 'traffic_signals').length;
  const streetLights = features.filter((feature) => feature.properties.highway === 'street_lamp').length;
  const sidewalks = features.filter((feature) => typeof feature.properties.sidewalk === 'string' && feature.properties.sidewalk !== 'no').length;
  return {
    crossingDensity: crossings * 5,
    streetLightDensity: (streetLights || signals) * 3,
    sidewalkDensity: sidewalks * 2,
  };
}

export function createExternalDataProxyRouter(options: ExternalDataProxyOptions = {}): Router {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const fetchImpl = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const providers = new Map<string, ProviderState>();
  const localPoiPath = options.localPoiPath ?? DEFAULT_LOCAL_POI_PATH;
  const overpassEndpoints = options.overpassEndpoints?.length ? options.overpassEndpoints : DEFAULT_OVERPASS_ENDPOINTS;
  let localPoiPoints: LocalPoiPoint[] | null | undefined;

  const stateFor = (provider: string): ProviderState => {
    const existing = providers.get(provider);
    if (existing) return existing;
    const created = createProviderState(provider);
    providers.set(provider, created);
    return created;
  };

  for (const provider of ['who', 'worldbank', 'unesco', 'healthsites', 'osm-overpass', 'local-osm-pbf']) stateFor(provider);

  function readLocalPoiPoints(): LocalPoiPoint[] {
    if (localPoiPoints !== undefined) return localPoiPoints ?? [];
    try {
      const parsed = JSON.parse(fs.readFileSync(localPoiPath, 'utf8')) as { points?: LocalPoiPoint[] };
      localPoiPoints = Array.isArray(parsed.points) ? parsed.points : [];
    } catch {
      localPoiPoints = null;
    }
    return localPoiPoints ?? [];
  }

  function markLocalFallback(): void {
    const state = stateFor('local-osm-pbf');
    state.requests += 1;
    state.successes += 1;
    state.consecutive_failures = 0;
    state.last_success_at = toIso(now);
    state.last_latency_ms = 0;
    state.last_error = null;
  }

  async function fetchWithHardTimeout(provider: string, url: string, init: RequestInit): Promise<globalThis.Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new UpstreamTimeoutError(provider, config.timeoutMs));
        }, config.timeoutMs);
      });
      return await Promise.race([
        fetchImpl(url, { ...init, signal: controller.signal }),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchUpstream(provider: string, url: string, init: RequestInit = {}, retryLimit = config.maxRetries): Promise<unknown> {
    const state = stateFor(provider);
    const started = now();
    let lastError: unknown;
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      state.requests += 1;
      try {
        const response = await fetchWithHardTimeout(provider, url, init);
        if (!response.ok) {
          const error = new UpstreamError(provider, response.status, `${provider} returned ${response.status}`);
          if (response.status < 500 && response.status !== 408 && response.status !== 429) throw error;
          lastError = error;
          if (attempt < retryLimit) {
            await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs * 2 ** attempt));
            continue;
          }
          throw error;
        }
        const data = await response.json() as unknown;
        if (!isJsonLike(data)) throw new Error(`${provider} returned a non-JSON object`);
        state.successes += 1;
        state.consecutive_failures = 0;
        state.last_success_at = toIso(now);
        state.last_latency_ms = now() - started;
        state.last_error = null;
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < retryLimit && !(error instanceof UpstreamError && error.status < 500 && error.status !== 408 && error.status !== 429)) {
          await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs * 2 ** attempt));
          continue;
        }
        break;
      }
    }
    state.failures += 1;
    state.consecutive_failures += 1;
    state.last_failure_at = toIso(now);
    state.last_latency_ms = now() - started;
    state.last_error = lastError instanceof Error ? lastError.message : 'upstream request failed';
    throw lastError instanceof Error ? lastError : new Error(state.last_error);
  }

  async function fetchOverpass(query: string): Promise<unknown> {
    let lastError: unknown;
    for (const endpoint of overpassEndpoints) {
      try {
        return await fetchUpstream('osm-overpass', endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'ARA-Neighborhood-Decision-Support/1.0',
          },
          body: `data=${encodeURIComponent(query)}`,
        }, 0);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All Overpass endpoints failed');
  }

  async function loadCached(provider: string, key: string, loader: () => Promise<unknown>): Promise<{ value: unknown; cache: 'MISS' | 'HIT' | 'STALE'; latencyMs: number }> {
    const timestamp = now();
    const existing = cache.get(key);
    const state = stateFor(provider);
    if (existing && existing.expiresAt > timestamp) {
      state.cache_hits += 1;
      return { value: existing.value, cache: 'HIT', latencyMs: 0 };
    }
    try {
      const started = now();
      const value = await loader();
      const fetchedAt = toIso(now);
      cache.set(key, { value, expiresAt: now() + config.cacheTtlMs, staleUntil: now() + config.cacheTtlMs + config.staleTtlMs, fetchedAt });
      return { value, cache: 'MISS', latencyMs: now() - started };
    } catch (error) {
      if (existing && existing.staleUntil > timestamp) {
        state.stale_hits += 1;
        return { value: existing.value, cache: 'STALE', latencyMs: 0 };
      }
      throw error;
    }
  }

  async function sendProviderError(res: Response, req: Request, provider: string, error: unknown): Promise<void> {
    const id = correlationId(req);
    const status = error instanceof UpstreamTimeoutError
      ? 504
      : error instanceof UpstreamError && error.status >= 400 && error.status < 500
        ? error.status
        : 502;
    setResponseMetadata(res, id, provider, 'MISS');
    res.status(status).json({
      ok: false,
      error: { code: 'EXTERNAL_PROVIDER_ERROR', provider, message: error instanceof Error ? error.message : 'upstream request failed' },
      correlation_id: id,
    });
  }

  const router = Router();

  router.get('/who/:indicator', async (req, res) => {
    const provider = 'who';
    const indicator = String(req.params.indicator);
    if (!validateIndicator(indicator)) return res.status(400).json({ ok: false, error: { code: 'INVALID_INDICATOR' } });
    const extraFilter = normalizeFilter(req.query.filter);
    if (req.query.filter !== undefined && extraFilter === null) return res.status(400).json({ ok: false, error: { code: 'INVALID_FILTER' } });
    const url = new URL(`https://ghoapi.azureedge.net/api/${encodeURIComponent(indicator)}`);
    url.searchParams.set('$filter', `SpatialDim eq 'IRN'${extraFilter ? ` and ${extraFilter}` : ''}`);
    url.searchParams.set('$orderby', 'TimeDim desc');
    url.searchParams.set('$top', '1');
    const id = correlationId(req);
    try {
      const result = await loadCached(provider, url.toString(), async () => {
        try {
          return { payload: await fetchUpstream(provider, url.toString()), provider } satisfies ProviderPayload<unknown>;
        } catch (primaryError) {
          const fallbackIndicator = WHO_WORLD_BANK_FALLBACKS[indicator];
          if (!fallbackIndicator) throw primaryError;
          const fallbackUrl = new URL(`https://api.worldbank.org/v2/country/IRN/indicator/${encodeURIComponent(fallbackIndicator)}`);
          fallbackUrl.searchParams.set('format', 'json');
          fallbackUrl.searchParams.set('per_page', '1');
          fallbackUrl.searchParams.set('mrnev', '1');
          const fallbackPayload = normalizeWorldBankAsWho(await fetchUpstream('worldbank', fallbackUrl.toString()), indicator, fallbackIndicator);
          if (!fallbackPayload) throw primaryError;
          return { payload: fallbackPayload, provider, fallback: 'worldbank' } satisfies ProviderPayload<unknown>;
        }
      });
      const providerResult = result.value as ProviderPayload<unknown>;
      setResponseMetadata(res, id, provider, result.cache, result.latencyMs);
      if (providerResult.fallback) res.setHeader('X-Provider-Fallback', providerResult.fallback);
      if (result.cache === 'STALE') res.setHeader('Warning', '110 - response is stale');
      return res.json(providerResult.payload);
    } catch (error) {
      return sendProviderError(res, req, provider, error);
    }
  });

  router.get('/worldbank/:indicator', async (req, res) => {
    const provider = 'worldbank';
    const indicator = String(req.params.indicator);
    if (!validateIndicator(indicator)) return res.status(400).json({ ok: false, error: { code: 'INVALID_INDICATOR' } });
    const url = new URL(`https://api.worldbank.org/v2/country/IRN/indicator/${encodeURIComponent(indicator)}`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('per_page', '1');
    url.searchParams.set('mrnev', '1');
    const id = correlationId(req);
    try {
      const result = await loadCached(provider, url.toString(), () => fetchUpstream(provider, url.toString()));
      setResponseMetadata(res, id, provider, result.cache, result.latencyMs);
      if (result.cache === 'STALE') res.setHeader('Warning', '110 - response is stale');
      return res.json(result.value);
    } catch (error) {
      return sendProviderError(res, req, provider, error);
    }
  });

  router.get('/unesco', async (req, res) => {
    return res.status(400).json({ ok: false, error: { code: 'INDICATOR_REQUIRED', message: 'Use /unesco/:indicator for a measured education series.' } });
  });

  router.get('/unesco/:indicator', async (req, res) => {
    const provider = 'unesco';
    const indicator = String(req.params.indicator);
    if (!validateIndicator(indicator)) return res.status(400).json({ ok: false, error: { code: 'INVALID_INDICATOR' } });
    const url = new URL(`https://api.worldbank.org/v2/country/IRN/indicator/${encodeURIComponent(indicator)}`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('per_page', '1');
    url.searchParams.set('mrnev', '1');
    const id = correlationId(req);
    try {
      const result = await loadCached(provider, url.toString(), () => fetchUpstream(provider, url.toString()));
      setResponseMetadata(res, id, provider, result.cache, result.latencyMs);
      res.setHeader('X-Provider-Fallback', 'worldbank');
      if (result.cache === 'STALE') res.setHeader('Warning', '110 - response is stale');
      return res.json(result.value);
    } catch (error) {
      return sendProviderError(res, req, provider, error);
    }
  });

  router.get('/healthsites', async (req, res) => {
    const coordinates = parseCoordinates(req);
    if (!coordinates) return res.status(400).json({ ok: false, error: { code: 'INVALID_COORDINATES' } });
    const { lat, lng } = coordinates;
    const primaryProvider = 'healthsites';
    // نسخهٔ ۲ بازنشسته شده است (به‌جای JSON یک پیام متنی برمی‌گرداند) و نسخهٔ ۳
    // به کلید `api-key` نیاز دارد؛ بدون کلید به مسیر اعلامی Overpass → PBF محلی می‌رویم.
    const healthsitesKey = process.env.HEALTHSITES_API_KEY?.trim();
    const primaryUrl = new URL('https://healthsites.io/api/v3/facilities/');
    primaryUrl.searchParams.set('extent', `${lng - 0.045},${lat - 0.045},${lng + 0.045},${lat + 0.045}`);
    primaryUrl.searchParams.set('page', '1');
    primaryUrl.searchParams.set('output', 'geojson');
    if (healthsitesKey) primaryUrl.searchParams.set('api-key', healthsitesKey);
    const key = primaryUrl.toString();
    const id = correlationId(req);
    try {
      const result = await loadCached(primaryProvider, key, async () => {
        if (healthsitesKey) {
          try {
            const payload = normalizeHealthsitesPayload(await fetchUpstream(primaryProvider, key, {}, 0));
            if (payload.features.length > 0) return { payload, provider: primaryProvider } satisfies HealthsitesResult;
            throw new Error('Healthsites returned no facilities for the requested extent');
          } catch {
            /* بدون داده از Healthsites، مسیر اعلامی ادامه می‌یابد */
          }
        }
        {
          const fallbackProvider = 'osm-overpass';
          const south = lat - 0.045;
          const west = lng - 0.045;
          const north = lat + 0.045;
          const east = lng + 0.045;
          const query = buildHealthQuery(south, west, north, east);
          try {
            return {
              payload: normalizeOverpassPayload(await fetchOverpass(query)),
              provider: fallbackProvider,
            } satisfies HealthsitesResult;
          } catch {
            const allowed = new Set(['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy', 'nursing_home', 'laboratory']);
            const payload = localFeatureCollection(readLocalPoiPoints(), lat, lng, 5, allowed);
            if (payload.features.length === 0) throw new Error('No health facilities were available from remote or local sources');
            markLocalFallback();
            return { payload, provider: 'local-osm-pbf' } satisfies HealthsitesResult;
          }
        }
      });
      const healthsitesResult = result.value as HealthsitesResult;
      const fallbackUsed = healthsitesResult.provider !== 'healthsites';
      setResponseMetadata(res, id, healthsitesResult.provider, result.cache, result.latencyMs);
      if (fallbackUsed) res.setHeader('X-Provider-Fallback', healthsitesResult.provider);
      if (result.cache === 'STALE') res.setHeader('Warning', '110 - response is stale');
      return res.json(healthsitesResult.payload);
    } catch (error) {
      return sendProviderError(res, req, primaryProvider, error);
    }
  });

  router.get('/osm/pois', async (req, res) => {
    const coordinates = parseCoordinates(req);
    if (!coordinates) return res.status(400).json({ ok: false, error: { code: 'INVALID_COORDINATES' } });
    const { lat, lng } = coordinates;
    const south = lat - 0.015;
    const west = lng - 0.015;
    const north = lat + 0.015;
    const east = lng + 0.015;
    const query = buildPoiQuery(south, west, north, east);
    const key = `osm-pois:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const id = correlationId(req);
    try {
      const result = await loadCached('osm-overpass', key, async () => {
        try {
          const payload = countPoiFeatures(normalizeOverpassFeatures(await fetchOverpass(query)));
          return { payload, provider: 'osm-overpass' } satisfies ProviderPayload<Record<string, number>>;
        } catch (primaryError) {
          const features = localFeatureCollection(readLocalPoiPoints(), lat, lng, 2.5).features;
          if (features.length === 0) throw primaryError;
          markLocalFallback();
          return { payload: countPoiFeatures(features), provider: 'local-osm-pbf', fallback: 'local-osm-pbf' } satisfies ProviderPayload<Record<string, number>>;
        }
      });
      const providerResult = result.value as ProviderPayload<Record<string, number>>;
      setResponseMetadata(res, id, providerResult.provider, result.cache, result.latencyMs);
      if (providerResult.fallback) res.setHeader('X-Provider-Fallback', providerResult.fallback);
      if (result.cache === 'STALE') res.setHeader('Warning', '110 - response is stale');
      return res.json(providerResult.payload);
    } catch (error) {
      return sendProviderError(res, req, 'osm-overpass', error);
    }
  });

  router.get('/osm/walkability', async (req, res) => {
    const coordinates = parseCoordinates(req);
    if (!coordinates) return res.status(400).json({ ok: false, error: { code: 'INVALID_COORDINATES' } });
    const { lat, lng } = coordinates;
    const south = lat - 0.01;
    const west = lng - 0.01;
    const north = lat + 0.01;
    const east = lng + 0.01;
    const query = buildWalkabilityQuery(south, west, north, east);
    const key = `osm-walkability:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const id = correlationId(req);
    try {
      const result = await loadCached('osm-overpass', key, async () => ({ payload: normalizeWalkability(await fetchOverpass(query)), provider: 'osm-overpass' } satisfies ProviderPayload<ReturnType<typeof normalizeWalkability>>));
      const providerResult = result.value as ProviderPayload<ReturnType<typeof normalizeWalkability>>;
      setResponseMetadata(res, id, providerResult.provider, result.cache, result.latencyMs);
      if (result.cache === 'STALE') res.setHeader('Warning', '110 - response is stale');
      return res.json(providerResult.payload);
    } catch (error) {
      setResponseMetadata(res, id, 'osm-overpass', 'MISS');
      res.setHeader('X-Provider-Fallback', 'unavailable');
      res.setHeader('Warning', '199 - walkability source temporarily unavailable');
      return res.json({ data_available: false, reason: error instanceof Error ? error.message : 'upstream request failed' });
    }
  });

  router.get('/health', (_req, res) => {
    const providerList = [...providers.values()].map((state) => {
      const status = state.consecutive_failures === 0 && state.successes > 0
        ? 'online'
        : state.successes > 0
          ? 'degraded'
          : 'offline';
      return { ...state, status };
    });
    res.json({ ok: true, service: 'external-data-proxy', proxies: ['who', 'worldbank', 'unesco', 'healthsites', 'osm/pois', 'osm/walkability'], providers: providerList, cache: { entries: cache.size, ttl_ms: config.cacheTtlMs, stale_ttl_ms: config.staleTtlMs } });
  });

  return router;
}
