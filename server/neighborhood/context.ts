/**
 * بافت محله: مساحت، جمعیت (با منبع و سال)، ساختار سنی/جنسی و شبکهٔ مبدأ ۲۵۰ متری
 * با وزن جمعیتی. مخرج همهٔ نسبت‌ها و وزن همهٔ شاخص‌های دسترسی از همین‌جا می‌آید.
 *
 * اولویت منبع جمعیت: قرارداد مرکز آمار (POP تأییدشده) → WorldPop (zonal در kernel) → نامعلوم.
 */
import { kernelClient } from '../kernelClient';
import { approvedValuesFor } from '../ingestion/contractData';
import type { GazetteerEntry } from './gazetteer';
import { type GridCell, gridInside } from './geo';

export const GRID_CELL_M = Number(process.env.ARA_GRID_CELL_M || 250);

export interface PopulationEstimate {
  value: number | null;
  source: string;
  year: number | null;
  tier: 'official' | 'open_model' | 'none';
  method: string;
  validFraction?: number;
}

export interface NeighborhoodContext {
  neighborhoodId: string;
  areaKm2: number;
  population: PopulationEstimate;
  density: number | null;
  structure: {
    male?: number; female?: number; pop25plus?: number; pop15to64?: number; pop15plus?: number;
    ageBands?: Record<string, number>; households?: number; source: string | null;
  };
  gridOrigins: GridCell[];
  gridWeighting: 'worldpop' | 'uniform';
  gridCellM: number;
  warnings: string[];
}

function worldpopYear(): number | null {
  const m = /(19|20)\d{2}/.exec(process.env.WORLDPOP_COG_PATH ?? '');
  return m ? Number(m[0]) : null;
}

export async function buildNeighborhoodContext(entry: GazetteerEntry, opts: { useKernel?: boolean; asOf?: string } = {}): Promise<NeighborhoodContext> {
  const warnings: string[] = [];
  const grid = gridInside(entry.boundary.geojson, GRID_CELL_M);
  const contract = approvedValuesFor(entry.neighborhoodId, opts.asOf).filter((v) => !v.group_key);
  const cv = (code: string) => contract.find((v) => v.indicator_code === code);

  let population: PopulationEstimate = { value: null, source: 'نامعلوم', year: null, tier: 'none', method: 'none' };
  let gridWeighting: NeighborhoodContext['gridWeighting'] = 'uniform';
  const pop = cv('POP');
  if (pop) {
    population = { value: pop.value, source: `${pop.source_org}${pop.dataset_id ? ` / ${pop.dataset_id}` : ''}`, year: Number(pop.period_end.slice(0, 4)), tier: 'official', method: 'contract_aggregate' };
  }

  if (opts.useKernel !== false && process.env.WORLDPOP_COG_PATH) {
    try {
      const { status, payload } = await kernelClient.zonalStats({
        raster_id: 'worldpop', geometry: entry.boundary.geojson,
        cell_centers: grid.map((c) => [c.lng, c.lat]), cell_size_m: GRID_CELL_M,
      });
      const r = payload.result;
      if (status === 200 && r && r.sum !== null) {
        if (r.cells && r.cells.length === grid.length && r.cells.some((x) => x > 0)) {
          grid.forEach((c, i) => { c.weight = r.cells![i]; });
          gridWeighting = 'worldpop';
        }
        if (!pop) {
          population = { value: Math.round(r.sum), source: `WorldPop (${r.file})`, year: worldpopYear(), tier: 'open_model', method: 'zonal_sum_100m', validFraction: r.valid_fraction };
        } else if (r.sum > 0 && Math.abs(r.sum - pop.value) / pop.value > 0.25) {
          warnings.push(`اختلاف جمعیت قراردادی (${pop.value}) و WorldPop (${Math.round(r.sum)}) بیش از ۲۵٪ است`);
        }
      } else {
        warnings.push(`zonal WorldPop ناموفق: ${payload.error?.code ?? status}`);
      }
    } catch (error) {
      warnings.push(`kernel zonal در دسترس نیست: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (!pop) {
    warnings.push('WORLDPOP_COG_PATH تنظیم نشده و جمعیت قراردادی هم نیست؛ شاخص‌های سرانه محاسبه نمی‌شوند و وزن شبکه یکنواخت است');
  }

  const ageBands: Record<string, number> = {};
  for (const [code, band] of [['POP_AGE_18_29', '18-29'], ['POP_AGE_30_44', '30-44'], ['POP_AGE_45_64', '45-64'], ['POP_AGE_65PLUS', '65+']] as const) {
    const v = cv(code);
    if (v) ageBands[band] = v.value;
  }
  const structureSource = contract.some((v) => v.indicator_code.startsWith('POP_')) ? 'قرارداد (مرکز آمار)' : null;
  return {
    neighborhoodId: entry.neighborhoodId,
    areaKm2: entry.boundary.areaKm2,
    population,
    density: population.value !== null && entry.boundary.areaKm2 > 0 ? Math.round(population.value / entry.boundary.areaKm2) : null,
    structure: {
      male: cv('POP_MALE')?.value, female: cv('POP_FEMALE')?.value, pop25plus: cv('POP_25PLUS')?.value,
      pop15to64: cv('POP_15_64')?.value, pop15plus: cv('POP_15PLUS')?.value,
      ageBands: Object.keys(ageBands).length ? ageBands : undefined, households: cv('HOUSEHOLDS')?.value, source: structureSource,
    },
    gridOrigins: grid,
    gridWeighting,
    gridCellM: GRID_CELL_M,
    warnings,
  };
}
