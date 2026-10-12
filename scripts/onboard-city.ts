/**
 * ورود شهر تازه (CITY-v1).
 *   npx tsx scripts/onboard-city.ts --city "شیراز" --province "فارس" --from mahalat.geojson [--official] [--source "عنوان منبع"] [--domains shiraz.ir,ostan-fr.ir]
 *   npx tsx scripts/onboard-city.ts --city "شیراز" --overpass        (فقط نقطه‌ها؛ مرزها تقریبی می‌مانند)
 * خروجی: data/gazetteer/<slug>.geojson و data/cities/<slug>.json ؛ سپس گزارش آمادگی چاپ می‌شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeCityGeojson, overpassQuery, overpassToGeojson } from '../server/agentic/cityOnboard';
import { citySlug } from '../server/neighborhood/text';

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k: string) => args.includes(`--${k}`);
const city = arg('city');
if (!city) { console.error('--city لازم است'); process.exit(1); }
const slug = citySlug(city);
const root = path.resolve(import.meta.dirname, '..');
let raw: { features?: unknown[] };
if (arg('from')) raw = JSON.parse(fs.readFileSync(arg('from')!, 'utf8').replace(/^\uFEFF/, ''));
else if (flag('overpass')) {
  const url = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
  const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(city) }), headers: { 'user-agent': 'ara-city-onboard/1' } });
  if (!r.ok) { console.error(`Overpass ${r.status}`); process.exit(1); }
  raw = overpassToGeojson(await r.json());
} else { console.error('--from <file.geojson> یا --overpass لازم است'); process.exit(1); }
const res = normalizeCityGeojson(raw as never, { cityFa: city, provinceFa: arg('province'), official: flag('official'), sourceLabel: arg('source') ?? (flag('overpass') ? 'OSM Overpass' : undefined) });
if (!res.features.length) { console.error('هیچ محلهٔ معتبری یافت نشد', res.skipped.slice(0, 10)); process.exit(1); }
const gz = path.join(root, 'data', 'gazetteer', `${slug}.geojson`);
fs.writeFileSync(gz, JSON.stringify({ type: 'FeatureCollection', features: res.features }));
const prof = path.join(root, 'data', 'cities', `${slug}.json`);
const prev = fs.existsSync(prof) ? JSON.parse(fs.readFileSync(prof, 'utf8')) : {};
fs.mkdirSync(path.dirname(prof), { recursive: true });
fs.writeFileSync(prof, JSON.stringify({ cityFa: city, provinceFa: arg('province') ?? prev.provinceFa, officialDomains: [...new Set([...(prev.officialDomains ?? []), ...(arg('domains')?.split(',').map((d) => d.trim()).filter(Boolean) ?? [])])], sources: prev.sources ?? [], notes: prev.notes }, null, 1));
const { cityReadiness } = await import('../server/agentic/cities');
console.log(JSON.stringify({ gazetteer: path.relative(root, gz), profile: path.relative(root, prof), stats: res.stats, skipped: res.skipped.length, readiness: cityReadiness(city) }, null, 1));
process.exit(0);
