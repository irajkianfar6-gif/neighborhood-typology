/**
 * ساخت توزیع مرجع شهری (data/reference/reference_distribution_<city>.json)
 * از شاخص‌های باز همهٔ محلات شهر، با همان کدی که تحلیل تک‌محله را اجرا می‌کند.
 *
 *   npx tsx scripts/build_reference_distribution.ts --city tehran [--use-kernel] [--with-network] [--with-air] [--limit 50]
 *
 * پیش‌نیاز: لایه‌های شهر در کش (scripts/fetch_city_layers.ts). بدون --use-kernel وزن جمعیتی سلول‌ها یکنواخت است.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildNeighborhoodContext } from '../server/neighborhood/context';
import { neighborhoodsOfCity } from '../server/neighborhood/gazetteer';
import { computeOpenIndicators } from '../server/neighborhood/indicators';
import { loadCityLayers } from '../server/neighborhood/orchestrator';
import { referenceDir, type ReferenceDistribution } from '../server/evidence/normalize';
import { stopKernelService } from '../server/kernelClient';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const city = arg('--city') ?? 'tehran';
const useKernel = process.argv.includes('--use-kernel');
const limit = Number(arg('--limit') ?? Infinity);
const entries = neighborhoodsOfCity(city).slice(0, limit);
if (!entries.length) { console.error(`no neighborhoods for ${city}`); process.exit(1); }

const { layers, status } = await loadCityLayers(entries[0], true);
console.log('layers:', JSON.stringify(status));
const acc = new Map<string, { values: number[]; unit: string; lowerIsBetter?: boolean; observed: string[] }>();
let done = 0;
for (const entry of entries) {
  const ctx = await buildNeighborhoodContext(entry, { useKernel });
  const values = await computeOpenIndicators(entry, ctx, layers, { offline: true, useKernel, skipNetwork: !process.argv.includes('--with-network'), skipAir: !process.argv.includes('--with-air') });
  for (const v of values) {
    if (v.raw === null || !Number.isFinite(v.raw)) continue;
    const a = acc.get(v.code) ?? { values: [], unit: v.unit, lowerIsBetter: v.lowerIsBetter, observed: [] };
    a.values.push(v.raw);
    if (v.observedAt) a.observed.push(v.observedAt);
    acc.set(v.code, a);
  }
  if (++done % 25 === 0) console.log(`${done}/${entries.length}`);
}
const ref: ReferenceDistribution = {
  version: `ref-${city}-${new Date().toISOString().slice(0, 10)}`,
  citySlug: entries[0].citySlug, cityFa: entries[0].cityFa, builtAt: new Date().toISOString(), neighborhoods: entries.length,
  indicators: Object.fromEntries([...acc].map(([code, a]) => [code, {
    n: a.values.length, values: a.values.sort((x, y) => x - y), unit: a.unit, lowerIsBetter: a.lowerIsBetter,
    observedAt: a.observed.sort().at(-1) ?? null,
  }])),
};
fs.mkdirSync(referenceDir(), { recursive: true });
const out = path.join(referenceDir(), `reference_distribution_${ref.citySlug}.json`);
fs.writeFileSync(out, JSON.stringify(ref));
await stopKernelService().catch(() => undefined);
console.log('written', out, Object.entries(ref.indicators).map(([c, d]) => `${c}:n=${d.n}`).join(' '));
process.exit(0);
