/**
 * ساخت data/gazetteer/block_map.csv از لایهٔ بلوک‌های شهری (GeoJSON با ویژگی BLOCK_NO).
 * هر بلوک بر اساس نقطهٔ مرکزی‌اش به محلهٔ رسمی گزتیر (چندضلعی شهرداری) نسبت داده می‌شود.
 * shapefile «blockshp» را ابتدا در QGIS/ogr2ogr به GeoJSON با مختصات WGS84 تبدیل کنید:
 *   ogr2ogr -t_srs EPSG:4326 -f GeoJSON blocks.geojson blockshp/blocks.shp
 * اجرا:  npx tsx scripts/official/build_block_map.ts blocks.geojson [tehran]
 */
import fs from 'node:fs';
import path from 'node:path';
import { neighborhoodsOfCity } from '../../server/neighborhood/gazetteer';
import { centroidOf, pointInGeom, type AreaGeom } from '../../server/neighborhood/geo';

const [file, city = 'tehran'] = process.argv.slice(2);
if (!file) { console.error('usage: build_block_map.ts blocks.geojson [city]'); process.exit(1); }
const fc = JSON.parse(fs.readFileSync(file, 'utf8')) as { features: Array<{ properties: Record<string, unknown>; geometry: AreaGeom }> };
const hoods = neighborhoodsOfCity(city).filter((e) => !e.boundary.isProxy);
const out: string[] = ['block_id,neighborhood_id'];
let unmatched = 0;
for (const f of fc.features) {
  const id = f.properties.BLOCK_NO ?? f.properties.block_no;
  if (id === undefined || !f.geometry) continue;
  const c = centroidOf(f.geometry);
  const hit = hoods.find((e) => pointInGeom(c.lng, c.lat, e.boundary.geojson));
  if (hit) out.push(`${id},${hit.neighborhoodId}`); else unmatched++;
}
const target = path.join(process.cwd(), 'data', 'gazetteer', 'block_map.csv');
fs.writeFileSync(target, out.join('\n') + '\n');
console.log(`${out.length - 1} بلوک نگاشت شد؛ ${unmatched} بلوک بیرون از محلات رسمی → ${target}`);
