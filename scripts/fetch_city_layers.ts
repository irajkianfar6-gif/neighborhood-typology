/**
 * واکشی/تازه‌سازی لایه‌های OSM شهر در کش (server/data/osm-cache/<city>/).
 *   npx tsx scripts/fetch_city_layers.ts tehran [--force]
 */
import { cityBBox, listCities } from '../server/neighborhood/gazetteer';
import { ALL_CATEGORIES, getCityLayer } from '../server/neighborhood/osmLayers';

const slug = process.argv[2];
const force = process.argv.includes('--force');
if (!slug) {
  console.log('cities:', listCities().map((c) => `${c.citySlug} (${c.cityFa}, ${c.count})`).join(', '));
  process.exit(1);
}
const bbox = cityBBox(slug);
if (!bbox) { console.error('unknown city', slug); process.exit(1); }
for (const cat of ALL_CATEGORIES) {
  const t = Date.now();
  const r = await getCityLayer(slug, cat, bbox, { forceRefresh: force });
  console.log(cat, r.cache, r.layer ? `points=${r.layer.points.length} areas=${r.layer.areas.length} osm_base=${r.layer.observedAt}` : '', r.error ?? '', `${Date.now() - t}ms`);
}
