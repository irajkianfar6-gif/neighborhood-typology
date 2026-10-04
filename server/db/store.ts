/**
 * لایهٔ ذخیره‌سازی ARA-NB-2.0
 *   ARA_STORAGE=json (پیش‌فرض) → فایل‌های server/data (منبع خواندن فعلی)
 *   ARA_STORAGE=postgres + DATABASE_URL → علاوه بر JSON، هر اجرا در PostGIS (schema ara) نوشته می‌شود
 * ماژول pg اختیاری است (npm i pg) و فقط در حالت postgres به‌صورت پویا بارگذاری می‌شود.
 */
import type { GazetteerEntry } from '../neighborhood/gazetteer';
import type { DecisionCardV2 } from '../neighborhood/orchestrator';
import type { ScoredValue } from '../evidence/types';

interface PgClientLike { query: (sql: string, params?: unknown[]) => Promise<unknown> }
let poolPromise: Promise<PgClientLike | null> | null = null;
let lastError: string | null = null;

export function storageMode(): 'json' | 'postgres' {
  return process.env.ARA_STORAGE === 'postgres' && process.env.DATABASE_URL ? 'postgres' : 'json';
}

async function pool(): Promise<PgClientLike | null> {
  if (storageMode() !== 'postgres') return null;
  poolPromise ??= (async () => {
    try {
      const moduleName = 'pg';
      const pg = await import(/* @vite-ignore */ moduleName) as { default?: { Pool: new (o: object) => PgClientLike }; Pool?: new (o: object) => PgClientLike };
      const Pool = pg.Pool ?? pg.default!.Pool;
      return new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.ARA_PG_POOL_MAX || 5) });
    } catch (error) {
      lastError = `pg module unavailable: ${error instanceof Error ? error.message : error}`;
      console.warn(`[db] ${lastError} — فقط JSON استفاده می‌شود`);
      return null;
    }
  })();
  return poolPromise;
}

export function storageStatus() { return { mode: storageMode(), lastError }; }

/** نوشتن کامل یک اجرا (محله، نسخهٔ مرز، بافت، اجرا، مقادیر، کارت) در یک تراکنش */
export async function persistRun(runId: string, entry: GazetteerEntry, card: DecisionCardV2, evidence: ScoredValue[], requestedBy?: string): Promise<boolean> {
  const db = await pool();
  if (!db) return false;
  try {
    await db.query('BEGIN');
    await db.query(`INSERT INTO ara.neighborhoods (neighborhood_id, name_fa, name_en, city_fa, city_slug, district_fa, province_fa)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (neighborhood_id) DO NOTHING`,
      [entry.neighborhoodId, entry.nameFa, entry.nameEn ?? null, entry.cityFa, entry.citySlug, entry.districtFa ?? null, entry.provinceFa ?? null]);
    await db.query(`INSERT INTO ara.boundary_versions (neighborhood_id, boundary_hash, version, tier, is_proxy, source, area_km2, geom)
      VALUES ($1,$2,$3,$4,$5,$6,$7, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($8),4326))) ON CONFLICT DO NOTHING`,
      [entry.neighborhoodId, entry.boundary.hash, entry.boundary.version, entry.boundary.tier, entry.boundary.isProxy, entry.boundary.source, entry.boundary.areaKm2, JSON.stringify(entry.boundary.geojson)]);
    await db.query(`INSERT INTO ara.context_snapshots (neighborhood_id, population, population_source, population_year, population_tier, area_km2, grid_weighting)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entry.neighborhoodId, card.context.population, card.context.populationSource, card.context.populationYear, card.context.populationTier, card.context.areaKm2, card.context.gridWeighting]);
    await db.query(`INSERT INTO ara.decision_runs (run_id, neighborhood_id, publication_level, fingerprint, reproducibility_key, engine_run_id, requested_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [runId, entry.neighborhoodId, card.publication.level, card.fingerprint, JSON.stringify(card.reproducibilityKey), card.engine?.runId ?? null, requestedBy ?? null]);
    for (const v of evidence) {
      await db.query(`INSERT INTO ara.documented_values (run_id, code, raw, unit, score, percentile, reliability, tier, channel, geography_level, source, observed_at, method, scoring_method, conflict, missing_reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [runId, v.code, v.raw, v.unit, v.score, v.percentile ?? null, v.reliability, v.tier, v.channel, v.geographyLevel, v.source, v.observedAt ? v.observedAt.slice(0, 10) : null, v.method, v.scoringMethod, v.conflict, v.missingReason ?? null]);
    }
    await db.query('INSERT INTO ara.cards (run_id, card) VALUES ($1,$2)', [runId, JSON.stringify(card)]);
    await db.query('COMMIT');
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    await db.query('ROLLBACK').catch(() => undefined);
    console.warn(`[db] persistRun failed: ${lastError}`);
    return false;
  }
}
