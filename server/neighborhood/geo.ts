/**
 * هندسهٔ سبک بدون وابستگی: مساحت ژئودزیک، نقطه‌در‌چندضلعی، فاصله تا چندضلعی،
 * ساده‌سازی Douglas-Peucker، شبکهٔ مبدأ و رشتهٔ poly برای Overpass.
 * مختصات همه GeoJSON [lng, lat] در WGS84 است.
 */
export type Position = [number, number];
export type Ring = Position[];
export interface PolygonGeom { type: 'Polygon'; coordinates: Ring[] }
export interface MultiPolygonGeom { type: 'MultiPolygon'; coordinates: Ring[][] }
export type AreaGeom = PolygonGeom | MultiPolygonGeom;
export type BBox = [number, number, number, number]; // west, south, east, north

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function polygonsOf(geom: AreaGeom): Ring[][] {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** مساحت ژئودزیک حلقه (m²) — روش Chamberlain & Duquette */
function ringArea(ring: Ring): number {
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    total += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((total * R * R) / 2);
}

export function areaM2(geom: AreaGeom): number {
  let sum = 0;
  for (const poly of polygonsOf(geom)) {
    poly.forEach((ring, idx) => { sum += idx === 0 ? ringArea(ring) : -ringArea(ring); });
  }
  return Math.max(0, sum);
}

export function bboxOf(geom: AreaGeom): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of polygonsOf(geom)) for (const [x, y] of poly[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

export function expandBBox(b: BBox, meters: number): BBox {
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos(rad((b[1] + b[3]) / 2)));
  return [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat];
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeom(lng: number, lat: number, geom: AreaGeom): boolean {
  for (const poly of polygonsOf(geom)) {
    if (!inRing(lng, lat, poly[0])) continue;
    if (poly.slice(1).some((hole) => inRing(lng, lat, hole))) continue;
    return true;
  }
  return false;
}

/** فاصلهٔ نقطه تا پاره‌خط در صفحهٔ محلی متریک */
function segDistM(p: Position, a: Position, b: Position, kx: number, ky: number): number {
  const px = p[0] * kx, py = p[1] * ky, ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** فاصله (متر) نقطه تا مرز/درون چندضلعی؛ درون = ۰ */
export function distanceToGeomM(lng: number, lat: number, geom: AreaGeom): number {
  if (pointInGeom(lng, lat, geom)) return 0;
  const ky = 111_320;
  const kx = 111_320 * Math.cos(rad(lat));
  let best = Infinity;
  for (const poly of polygonsOf(geom)) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const d = segDistM([lng, lat], ring[i], ring[i + 1], kx, ky);
      if (d < best) best = d;
    }
  }
  return best;
}

export function centroidOf(geom: AreaGeom): { lat: number; lng: number } {
  // مرکز ثقل وزنی حلقه‌های بیرونی
  let ax = 0, ay = 0, aa = 0;
  for (const poly of polygonsOf(geom)) {
    const ring = poly[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    if (a === 0) continue;
    ax += cx / 3; ay += cy / 3; aa += a;
  }
  if (aa === 0) {
    const b = bboxOf(geom);
    return { lng: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 };
  }
  return { lng: ax / aa, lat: ay / aa };
}

/** Douglas-Peucker روی حلقه (tolerance به درجه) */
function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1; keep[ring.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    const [ax, ay] = ring[s];
    const [bx, by] = ring[e];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

/** ساده‌سازی تا حداکثر maxVertices رأس در هر حلقهٔ بیرونی */
export function simplifyGeom(geom: AreaGeom, maxVertices = 200): AreaGeom {
  const polys = polygonsOf(geom).map((poly) => {
    let tol = 0.00002;
    let outer = poly[0];
    while (outer.length > maxVertices && tol < 0.01) { outer = simplifyRing(poly[0], tol); tol *= 2; }
    return [outer];
  });
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

/** رشتهٔ poly:"lat lon ..." برای Overpass (فقط بزرگ‌ترین حلقهٔ بیرونی) */
export function overpassPoly(geom: AreaGeom, maxVertices = 200): string {
  const simple = simplifyGeom(geom, maxVertices);
  const largest = polygonsOf(simple).map((p) => p[0]).sort((a, b) => ringArea(b) - ringArea(a))[0];
  return largest.slice(0, -1).map(([x, y]) => `${y.toFixed(6)} ${x.toFixed(6)}`).join(' ');
}

export interface GridCell { lat: number; lng: number; weight: number; id: string }

/** مراکز سلول‌های شبکهٔ منظم (متر) درون چندضلعی؛ دست‌کم یک سلول (مرکز ثقل) */
export function gridInside(geom: AreaGeom, cellM: number): GridCell[] {
  const b = bboxOf(geom);
  const midLat = (b[1] + b[3]) / 2;
  const dLat = cellM / 111_320;
  const dLng = cellM / (111_320 * Math.cos(rad(midLat)));
  const cells: GridCell[] = [];
  let row = 0;
  for (let lat = b[1] + dLat / 2; lat < b[3]; lat += dLat, row++) {
    let col = 0;
    for (let lng = b[0] + dLng / 2; lng < b[2]; lng += dLng, col++) {
      if (pointInGeom(lng, lat, geom)) cells.push({ lat, lng, weight: 1, id: `r${row}c${col}` });
    }
  }
  if (cells.length === 0) {
    const c = centroidOf(geom);
    cells.push({ ...c, weight: 1, id: 'centroid' });
  }
  return cells;
}

/** شاخص فضایی سادهٔ سطلی برای جست‌وجوی نزدیک‌ترین نقطه */
export class PointIndex<T extends { lat: number; lng: number }> {
  private buckets = new Map<string, T[]>();
  constructor(public readonly points: T[], private readonly cellDeg = 0.01) {
    for (const p of points) {
      const k = this.key(p.lat, p.lng);
      const arr = this.buckets.get(k);
      if (arr) arr.push(p); else this.buckets.set(k, [p]);
    }
  }
  private key(lat: number, lng: number) { return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lng / this.cellDeg)}`; }
  /** نزدیک‌ترین نقطه تا شعاع maxM (متر) */
  nearest(origin: { lat: number; lng: number }, maxM = 5000): { point: T; distanceM: number } | null {
    const rings = Math.ceil(maxM / (this.cellDeg * 111_320 * Math.cos(rad(origin.lat)))) + 1;
    const r0 = Math.floor(origin.lat / this.cellDeg);
    const c0 = Math.floor(origin.lng / this.cellDeg);
    let best: { point: T; distanceM: number } | null = null;
    for (let ring = 0; ring <= rings; ring++) {
      for (let dr = -ring; dr <= ring; dr++) for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        for (const p of this.buckets.get(`${r0 + dr}:${c0 + dc}`) ?? []) {
          const d = haversineM(origin, p);
          if (d <= maxM && (!best || d < best.distanceM)) best = { point: p, distanceM: d };
        }
      }
      // وقتی بهترین یافته از فاصلهٔ حلقهٔ بعدی کمتر است، جست‌وجو کافی است
      if (best && best.distanceM < ring * this.cellDeg * 111_320 * Math.cos(rad(origin.lat))) break;
    }
    return best;
  }
}

/** میانهٔ وزنی */
export function weightedMedian(values: Array<{ value: number; weight: number }>): number | null {
  const v = values.filter((x) => Number.isFinite(x.value) && x.weight > 0).sort((a, b) => a.value - b.value);
  const total = v.reduce((s, x) => s + x.weight, 0);
  if (!total) return null;
  let acc = 0;
  for (const x of v) { acc += x.weight; if (acc >= total / 2) return x.value; }
  return v[v.length - 1].value;
}
