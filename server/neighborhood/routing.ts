/**
 * فاصلهٔ پیاده از مبدأهای شبکه تا نزدیک‌ترین مقصد.
 *  - اگر VALHALLA_URL تنظیم باشد: فاصلهٔ شبکه‌ای واقعی (sources_to_targets، costing=pedestrian)
 *    روی k نزدیک‌ترین نامزد اقلیدسی هر مبدأ.
 *  - وگرنه: فاصلهٔ اقلیدسی × ضریب پیچش ۱٫۳ (برچسب روش و کیفیت روش ۰٫۷۵).
 */
import { type GridCell, haversineM, PointIndex } from './geo';

export const DETOUR_FACTOR = 1.3;
export const WALK_M_PER_MIN = 80; // ۴٫۸ کیلومتر بر ساعت

export interface DistanceResult { distancesM: Array<number | null>; method: 'valhalla_pedestrian' | 'euclidean_detour'; methodQuality: number; note?: string }

function kNearest<T extends { lat: number; lng: number }>(points: T[], o: { lat: number; lng: number }, k: number, maxM: number): T[] {
  return points
    .map((p) => ({ p, d: haversineM(o, p) }))
    .filter((x) => x.d <= maxM)
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((x) => x.p);
}

async function valhallaMatrix(origins: GridCell[], targetsPer: Array<Array<{ lat: number; lng: number }>>): Promise<Array<number | null>> {
  const base = process.env.VALHALLA_URL!.replace(/\/+$/, '');
  const out: Array<number | null> = [];
  // هر مبدأ با نامزدهای خودش؛ دسته‌های ۲۰تایی برای کاهش رفت‌وبرگشت
  for (let i = 0; i < origins.length; i += 20) {
    const batch = origins.slice(i, i + 20);
    const results = await Promise.all(batch.map(async (o, j) => {
      const targets = targetsPer[i + j];
      if (!targets.length) return null;
      const res = await fetch(`${base}/sources_to_targets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sources: [{ lat: o.lat, lon: o.lng }], targets: targets.map((t) => ({ lat: t.lat, lon: t.lng })), costing: 'pedestrian', units: 'kilometers' }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`valhalla ${res.status}`);
      const body = await res.json() as { sources_to_targets?: Array<Array<{ distance: number | null }>> };
      const ds = (body.sources_to_targets?.[0] ?? []).map((x) => x.distance).filter((x): x is number => typeof x === 'number');
      return ds.length ? Math.min(...ds) * 1000 : null;
    }));
    out.push(...results);
  }
  return out;
}

export async function walkDistances(origins: GridCell[], targets: Array<{ lat: number; lng: number }>, maxM = 5000): Promise<DistanceResult> {
  const index = new PointIndex(targets);
  const euclid = origins.map((o) => {
    const n = index.nearest(o, maxM);
    return n ? n.distanceM * DETOUR_FACTOR : null;
  });
  if (process.env.VALHALLA_URL && targets.length) {
    try {
      const per = origins.map((o) => kNearest(targets, o, 5, maxM));
      const net = await valhallaMatrix(origins, per);
      return { distancesM: net, method: 'valhalla_pedestrian', methodQuality: 1 };
    } catch (error) {
      return { distancesM: euclid, method: 'euclidean_detour', methodQuality: 0.75, note: `Valhalla ناموفق (${error instanceof Error ? error.message : error}); فاصلهٔ اقلیدسی×${DETOUR_FACTOR}` };
    }
  }
  return { distancesM: euclid, method: 'euclidean_detour', methodQuality: 0.75, note: `مسیریاب محلی (VALHALLA_URL) تنظیم نشده؛ فاصلهٔ اقلیدسی×${DETOUR_FACTOR}` };
}
