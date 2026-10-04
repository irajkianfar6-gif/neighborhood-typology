/**
 * تازه‌سازی زمان‌بندی‌شدهٔ منابع (ARA_SCHEDULER_ENABLED=1):
 *  - لایه‌های OSM هر شهر: هر ARA_OSM_REFRESH_HOURS (پیش‌فرض ۷۲۰ = ماهانه)
 *  - تحلیل مجدد محلات فعال (کارت‌های موجود): هر ARA_REANALYZE_HOURS (پیش‌فرض ۲۴) — هوا روزانه تازه می‌شود
 * تغییرات > ۲σ در کارت ثبت و در /neighborhoods/system/status گزارش می‌شوند.
 */
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from './paths';
import { cityBBox, listCities } from './neighborhood/gazetteer';
import { ALL_CATEGORIES, getCityLayer, readCachedLayer } from './neighborhood/osmLayers';

interface JobState { lastRunAt: string | null; lastOk: boolean | null; lastError?: string; runs: number; failures: number }
const jobs: Record<string, JobState> = {};
let started = false;

function track(name: string): JobState { return (jobs[name] ??= { lastRunAt: null, lastOk: null, runs: 0, failures: 0 }); }

export async function refreshCityLayers(force = false): Promise<void> {
  for (const city of listCities()) {
    const bbox = cityBBox(city.citySlug);
    if (!bbox) continue;
    for (const cat of ALL_CATEGORIES) {
      const j = track(`osm:${city.citySlug}:${cat}`);
      j.runs++; j.lastRunAt = new Date().toISOString();
      const r = await getCityLayer(city.citySlug, cat, bbox, { forceRefresh: force });
      j.lastOk = r.cache === 'HIT' || r.cache === 'MISS';
      if (!j.lastOk) { j.failures++; j.lastError = r.error; }
    }
  }
}

export async function reanalyzeActive(): Promise<void> {
  const { analyzeByName } = await import('./neighborhood/orchestrator');
  const dir = path.join(serverDataDir(), 'neighborhood-cards');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = track('reanalyze');
    j.runs++; j.lastRunAt = new Date().toISOString();
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { card?: { neighborhood?: { neighborhoodId?: string } } };
      const id = prev.card?.neighborhood?.neighborhoodId;
      if (!id) continue;
      const r = await analyzeByName({ neighborhoodId: id });
      if ('card' in r) fs.writeFileSync(path.join(dir, f), JSON.stringify(r));
      j.lastOk = true;
    } catch (error) {
      j.lastOk = false; j.failures++; j.lastError = error instanceof Error ? error.message : String(error);
    }
  }
}

export function startScheduler(): void {
  if (started || process.env.ARA_SCHEDULER_ENABLED !== '1') return;
  started = true;
  const osmHours = Number(process.env.ARA_OSM_REFRESH_HOURS || 720);
  const reHours = Number(process.env.ARA_REANALYZE_HOURS || 24);
  setInterval(() => { void refreshCityLayers(true); }, osmHours * 3_600_000).unref();
  setInterval(() => { void reanalyzeActive(); }, reHours * 3_600_000).unref();
  setTimeout(() => { void refreshCityLayers(false); }, 30_000).unref();
  console.log(`[scheduler] enabled: osm every ${osmHours}h, reanalyze every ${reHours}h`);
}

export function schedulerStatus() {
  const layers = listCities().map((c) => ({
    city: c.citySlug,
    layers: Object.fromEntries(ALL_CATEGORIES.map((cat) => {
      const l = readCachedLayer(c.citySlug, cat);
      return [cat, l ? { fetchedAt: l.layer.fetchedAt, osmBase: l.layer.observedAt, ageDays: Math.round(l.ageMs / 86_400_000), features: l.layer.points.length + l.layer.areas.length } : null];
    })),
  }));
  return { enabled: started, jobs, layers, rasters: { worldpop: Boolean(process.env.WORLDPOP_COG_PATH), ndvi: Boolean(process.env.NDVI_COG_PATH), jrcFlood: Boolean(process.env.JRC_FLOOD_COG_PATH) }, valhalla: Boolean(process.env.VALHALLA_URL) };
}
