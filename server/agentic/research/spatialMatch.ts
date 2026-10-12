/**
 * A5 — تطبیق فضایی و هم‌سازی: واحدهای مکانی یک سند (نام، منطقه، مختصات) → شناسهٔ محله‌های گزتیر.
 * تعمیم همان منطق build_tehran_layers.py: تطبیق دقیق/نام جایگزین، نقطه در چندضلعی، واحد ترکیبی (چند محله)،
 * ارث‌بری از محلهٔ دربرگیرنده، فازی محدود به منطقه، جایگزینی سطح منطقه با برچسب روشن، و صف بازبینی برای موارد مبهم.
 */
import { type GazetteerEntry, neighborhoodsOfCity } from '../../neighborhood/gazetteer';
import { pointInGeom } from '../../neighborhood/geo';
import { jaroWinkler, matchKey } from '../../neighborhood/text';
import { latinDigits } from './numbers';
import { lamAlefFold } from './documents';

export const MATCHER_VERSION = 'SPM-v1';
export type MatchType = 'exact' | 'alias' | 'point_in_polygon' | 'composite_unit' | 'parent_inherited' | 'fuzzy' | 'district_fallback' | 'ambiguous' | 'unmatched';
export interface SpatialUnit { name: string; district?: string | number | null; lat?: number | null; lng?: number | null }
export interface UnitMatch {
  input: SpatialUnit; matchType: MatchType; targets: string[]; targetNames: string[]; district: number | null; confidence: number;
  needsReview: boolean; level: 'neighborhood' | 'district' | null; note: string; candidates?: Array<{ neighborhoodId: string; nameFa: string; score: number }>;
}

const DIRS = /\s*(شمالی|جنوبی|شرقی|غربی|مرکزی|بالا|پایین|یک|دو|سه|۱|۲|۳|1|2|3)$/;
const key = (s: string) => lamAlefFold(matchKey(s));
export function districtNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const m = /(\d{1,2})/.exec(latinDigits(String(v)));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 30 ? n : null;
}

interface Idx { entries: GazetteerEntry[]; byKey: Map<string, GazetteerEntry[]>; byAlt: Map<string, GazetteerEntry[]>; district: Map<string, number | null> }
const cache = new Map<string, Idx>();
function index(city: string): Idx {
  const hit = cache.get(city); if (hit) return hit;
  const entries = neighborhoodsOfCity(city);
  const byKey = new Map<string, GazetteerEntry[]>(), byAlt = new Map<string, GazetteerEntry[]>(), district = new Map<string, number | null>();
  const push = (m: Map<string, GazetteerEntry[]>, k: string, e: GazetteerEntry) => { if (!k) return; const a = m.get(k) ?? []; if (!a.includes(e)) a.push(e); m.set(k, a); };
  for (const e of entries) {
    push(byKey, key(e.nameFa), e);
    for (const a of e.nameAlt) push(byAlt, key(a), e);
    // «المهدی - سیمون بولیوار» → هر دو بخش هم نام جایگزین
    for (const part of e.nameFa.split(/\s+[-–—و]\s+|\s*[-–—،]\s*/)) if (part.trim() && part.trim() !== e.nameFa) push(byAlt, key(part), e);
    district.set(e.neighborhoodId, districtNumber(e.districtFa));
  }
  const idx = { entries, byKey, byAlt, district };
  cache.set(city, idx);
  return idx;
}

export function matchUnit(u: SpatialUnit, city: string): UnitMatch {
  const idx = index(city);
  if (!idx.entries.length) throw new Error(`شهر «${city}» در گزتیر نیست`);
  const name = String(u.name ?? '').trim();
  const dn = districtNumber(u.district) ?? (/^\s*(منطقه|ناحیه)\s*[\d۰-۹]+\s*$/.test(name) ? districtNumber(name) : null);
  const inDistrict = (es: GazetteerEntry[]) => (dn === null ? es : es.filter((e) => idx.district.get(e.neighborhoodId) === dn));
  const out = (matchType: MatchType, es: GazetteerEntry[], confidence: number, note: string, extra: Partial<UnitMatch> = {}): UnitMatch => ({
    input: u, matchType, targets: es.map((e) => e.neighborhoodId), targetNames: es.map((e) => e.nameFa), district: dn, confidence: Math.round(confidence * 1000) / 1000,
    needsReview: ['ambiguous', 'unmatched', 'fuzzy', 'parent_inherited', 'composite_unit'].includes(matchType) && !(matchType === 'fuzzy' && confidence >= 0.95),
    level: es.length ? (matchType === 'district_fallback' ? 'district' : 'neighborhood') : null, note, ...extra,
  });

  // ۱) مختصات
  if (Number.isFinite(u.lat) && Number.isFinite(u.lng)) {
    const hit = idx.entries.filter((e) => pointInGeom(Number(u.lng), Number(u.lat), e.boundary.geojson));
    if (hit.length === 1) return out('point_in_polygon', hit, 0.98, 'نقطه درون مرز رسمی محله است');
  }
  // ۲) فقط منطقه
  if (!name || /^\s*(منطقه|ناحیه)\s*[\d۰-۹]+\s*$/.test(name)) {
    if (dn === null) return out('unmatched', [], 0, 'نه نام و نه منطقه');
    const members = idx.entries.filter((e) => idx.district.get(e.neighborhoodId) === dn);
    return out(members.length ? 'district_fallback' : 'unmatched', members, members.length ? 0.5 : 0, `دادهٔ سطح منطقهٔ ${dn}؛ روی ${members.length} محله با برچسب «سطح منطقه» گسترده می‌شود`);
  }
  const k = key(name);
  // ۳) دقیق و نام جایگزین
  for (const [m, type, conf] of [[idx.byKey, 'exact', 1], [idx.byAlt, 'alias', 0.97]] as const) {
    const all = m.get(k) ?? [];
    const es = inDistrict(all);
    if (es.length === 1) return out(type, es, conf, type === 'exact' ? 'نام یکسان' : 'نام جایگزین/بخشی از نام رسمی');
    if (es.length > 1) return out('ambiguous', [], 0.4, `${es.length} محلهٔ هم‌نام؛ منطقه را مشخص کنید`, { candidates: es.map((e) => ({ neighborhoodId: e.neighborhoodId, nameFa: e.nameFa, score: conf })) });
    if (all.length && dn !== null) return out('ambiguous', [], 0.3, `نام «${name}» هست ولی نه در منطقهٔ ${dn}`, { candidates: all.map((e) => ({ neighborhoodId: e.neighborhoodId, nameFa: e.nameFa, score: conf })) });
  }
  // ۴) واحد ترکیبی: «الف و ب»، «الف - ب»
  const parts = name.split(/\s+و\s+|\s*[-–—،,/]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const subs = parts.map((p) => matchUnit({ name: p, district: u.district }, city));
    if (subs.every((s) => ['exact', 'alias'].includes(s.matchType) && s.targets.length === 1)) {
      const es = subs.map((s) => idx.entries.find((e) => e.neighborhoodId === s.targets[0])!);
      return out('composite_unit', [...new Set(es)], 0.85, `واحد سند ${es.length} محلهٔ گزتیر را در بر می‌گیرد`);
    }
  }
  // ۵) نام جهت‌دار: سند «الف»، گزتیر «الف شمالی/جنوبی» (ترکیبی)؛ یا سند «الف شمالی»، گزتیر «الف» (ارث‌بری)
  const children = inDistrict(idx.entries.filter((e) => { const ek = key(e.nameFa); return ek !== k && ek.startsWith(k) && DIRS.test(matchKey(e.nameFa).slice(k.length) ? e.nameFa : ''); }));
  if (children.length >= 2) return out('composite_unit', children, 0.8, `«${name}» در گزتیر به ${children.length} محله تقسیم شده است`);
  const base = name.replace(DIRS, '').trim();
  if (base && base !== name) {
    const parent = inDistrict(idx.byKey.get(key(base)) ?? []);
    if (parent.length === 1) return out('parent_inherited', parent, 0.75, `«${name}» بخشی از محلهٔ «${parent[0].nameFa}» است؛ مقدار به محلهٔ دربرگیرنده نسبت داده می‌شود`);
  }
  // ۶) فازی (Jaro-Winkler) محدود به منطقه
  const pool = dn === null ? idx.entries : inDistrict(idx.entries);
  const scored = pool.map((e) => ({ e, s: Math.max(jaroWinkler(k, key(e.nameFa)), ...e.nameAlt.map((a) => jaroWinkler(k, key(a)))) })).sort((a, b) => b.s - a.s);
  const [b1, b2] = scored;
  if (b1 && b1.s >= 0.9 && (!b2 || b1.s - b2.s >= 0.03)) return out('fuzzy', [b1.e], b1.s * (dn === null ? 0.95 : 1), `شباهت نوشتاری ${Math.round(b1.s * 100)}٪${dn === null ? ' (بدون منطقه)' : ''}`, { candidates: scored.slice(0, 3).map((x) => ({ neighborhoodId: x.e.neighborhoodId, nameFa: x.e.nameFa, score: Math.round(x.s * 1000) / 1000 })) });
  if (b1 && b1.s >= 0.85) return out('ambiguous', [], 0.4, 'چند نامزد نزدیک؛ بازبینی لازم است', { candidates: scored.slice(0, 3).map((x) => ({ neighborhoodId: x.e.neighborhoodId, nameFa: x.e.nameFa, score: Math.round(x.s * 1000) / 1000 })) });
  // ۷) جایگزینی منطقه
  if (dn !== null) {
    const members = idx.entries.filter((e) => idx.district.get(e.neighborhoodId) === dn);
    if (members.length) return out('district_fallback', members, 0.45, `نام «${name}» یافت نشد؛ فقط سطح منطقهٔ ${dn} قابل استفاده است`, { needsReview: true });
  }
  return out('unmatched', [], 0, `نام «${name}» در گزتیر ${city} یافت نشد`, { candidates: scored.slice(0, 3).map((x) => ({ neighborhoodId: x.e.neighborhoodId, nameFa: x.e.nameFa, score: Math.round(x.s * 1000) / 1000 })) });
}

export function matchUnits(units: SpatialUnit[], city: string) {
  const matches = units.map((u) => matchUnit(u, city));
  const byType: Record<string, number> = {};
  for (const m of matches) byType[m.matchType] = (byType[m.matchType] ?? 0) + 1;
  const auto = matches.filter((m) => !m.needsReview && m.targets.length).length;
  return { version: MATCHER_VERSION, city, total: matches.length, autoMatched: auto, needsReview: matches.filter((m) => m.needsReview).length, byType, matches };
}
export function _resetMatcherCache(): void { cache.clear(); }
