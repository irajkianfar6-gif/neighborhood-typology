/**
 * CITY-v1 — تعمیم به شهرهای دیگر: نمایهٔ هر شهر (دامنه‌های رسمی، منابع بومی) و سنجش آمادگی.
 * نمایه‌ها از data/cities/<slug>.json خوانده می‌شوند (و ARA_CITY_DIRS)؛ تهران و کرج نمایهٔ داخلی دارند.
 * آمادگی یک شهر بر پایهٔ واقعیت‌های گزتیر و دادهٔ تأییدشده است، نه ادعا: تعداد محله، سطح مرز، پوشش منطقه، دادهٔ قراردادی.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../paths';
import { listCities, neighborhoodsOfCity } from '../neighborhood/gazetteer';
import { citySlug, normalizeFa } from '../neighborhood/text';
import { approvedValuesFor } from '../ingestion/contractData';
import { districtNumber } from './research/spatialMatch';

export const CITY_VERSION = 'CITY-v1';
export interface CitySource { title: string; url: string; publisher: string; indicators: string[]; spatialLevel: string }
export interface CityProfile { cityFa: string; slug: string; provinceFa?: string; aliases?: string[]; officialDomains: string[]; sources: CitySource[]; notes?: string }

const BUILTIN: CityProfile[] = [
  { cityFa: 'تهران', slug: 'tehran', provinceFa: 'تهران', officialDomains: ['tehran.ir', 'amar.org.ir', 'mporg.ir'], sources: [] },
  { cityFa: 'کرج', slug: 'karaj', provinceFa: 'البرز', officialDomains: ['karaj.ir', 'amar.org.ir', 'ostan-al.ir'], sources: [] },
];
export function cityDirs(): string[] {
  return [path.join(PROJECT_ROOT, 'data', 'cities'), ...(process.env.ARA_CITY_DIRS?.split(path.delimiter).filter(Boolean) ?? [])];
}
const clean = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
export function cityProfiles(): CityProfile[] {
  const out = new Map<string, CityProfile>(BUILTIN.map((p) => [p.slug, { ...p }]));
  for (const dir of cityDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Partial<CityProfile>;
        if (!p.cityFa) continue;
        // شناسهٔ شهر همیشه از نام فارسی ساخته می‌شود تا با شناسهٔ محله‌های گزتیر یکی بماند
        const slug = citySlug(p.cityFa);
        const prev = out.get(slug);
        out.set(slug, {
          cityFa: normalizeFa(p.cityFa), slug, provinceFa: p.provinceFa ?? prev?.provinceFa, aliases: p.aliases ?? prev?.aliases,
          officialDomains: [...new Set([...(prev?.officialDomains ?? []), ...(p.officialDomains ?? []).map(clean).filter(Boolean)])],
          sources: [...(prev?.sources ?? []), ...(Array.isArray(p.sources) ? p.sources.filter((s) => s && s.url && s.title) : [])], notes: p.notes ?? prev?.notes,
        });
      } catch { /* فایل خراب نادیده گرفته می‌شود */ }
    }
  }
  // شهرهای گزتیر بدون نمایه هم دیده می‌شوند
  for (const c of listCities()) if (!out.has(c.citySlug)) out.set(c.citySlug, { cityFa: c.cityFa, slug: c.citySlug, officialDomains: [], sources: [] });
  return [...out.values()];
}
export function cityProfile(city: string): CityProfile | null {
  const n = normalizeFa(city); const slug = /^[a-z0-9]+$/.test(city) ? city : citySlug(city);
  return cityProfiles().find((p) => p.slug === slug || p.cityFa === n || (p.aliases ?? []).some((a) => normalizeFa(a) === n)) ?? null;
}
/** همهٔ دامنه‌های رسمی شناخته‌شده (برای اولویت جست‌وجوی وب) */
export function allOfficialDomains(): string[] { return [...new Set(cityProfiles().flatMap((p) => p.officialDomains))]; }
/** نام‌های شهر برای تشخیص در پرسش آزاد */
export function knownCityNames(): string[] { return [...new Set(cityProfiles().filter((p) => neighborhoodsOfCity(p.slug).length).flatMap((p) => [p.cityFa, ...(p.aliases ?? [])]))].sort((a, b) => b.length - a.length); }

export type ReadinessLevel = 'ready' | 'partial' | 'gazetteer_only' | 'not_onboarded';
export interface CityReadiness {
  version: string; cityFa: string; slug: string; level: ReadinessLevel; neighborhoods: number;
  boundaries: { official: number; osm_admin: number; derived: number; proxyShare: number }; districtCoverage: number; districts: number;
  withApprovedData: number; officialDomains: number; localSources: number; nextSteps: string[];
}
export function cityReadiness(city: string): CityReadiness {
  const p = cityProfile(city);
  const slug = p?.slug ?? citySlug(city);
  const es = neighborhoodsOfCity(slug);
  const tiers = { official: 0, osm_admin: 0, derived: 0 } as Record<'official' | 'osm_admin' | 'derived', number>;
  for (const e of es) tiers[e.boundary.tier]++;
  const proxy = es.filter((e) => e.boundary.isProxy).length;
  const dn = es.map((e) => districtNumber(e.districtFa)).filter((x): x is number => x !== null);
  const withData = es.filter((e) => approvedValuesFor(e.neighborhoodId).length > 0).length;
  const proxyShare = es.length ? proxy / es.length : 0, districtCoverage = es.length ? dn.length / es.length : 0;
  const next: string[] = [];
  if (!es.length) next.push('لایهٔ محلات شهر را با scripts/onboard-city.ts از GeoJSON رسمی یا OSM بسازید');
  if (es.length && proxyShare > 0.2) next.push(`${proxy} محله فقط نقطه دارد (مرز تقریبی)؛ مرز رسمی شهرداری را بارگذاری کنید`);
  if (es.length && districtCoverage < 0.8) next.push('شمارهٔ منطقهٔ شهرداری برای همهٔ محله‌ها ثبت نشده؛ تطبیق داده‌های سطح منطقه ممکن نیست');
  if (!(p?.officialDomains.length)) next.push(`نمایهٔ شهر (data/cities/${slug}.json) با دامنه‌های رسمی شهرداری و استانداری بسازید`);
  if (es.length && !withData) next.push('هنوز دادهٔ تأییدشده‌ای برای محله‌های این شهر نیست؛ از پژوهش خودکار یا قرارداد داده شروع کنید');
  const level: ReadinessLevel = !es.length ? 'not_onboarded' : withData > 0 && proxyShare <= 0.2 && districtCoverage >= 0.8 ? 'ready' : proxyShare <= 0.2 || withData > 0 ? 'partial' : 'gazetteer_only';
  return {
    version: CITY_VERSION, cityFa: p?.cityFa ?? normalizeFa(city), slug, level, neighborhoods: es.length,
    boundaries: { ...tiers, proxyShare: Math.round(proxyShare * 1000) / 1000 }, districtCoverage: Math.round(districtCoverage * 1000) / 1000, districts: new Set(dn).size,
    withApprovedData: withData, officialDomains: p?.officialDomains.length ?? 0, localSources: p?.sources.length ?? 0, nextSteps: next,
  };
}
export function allCityReadiness(): CityReadiness[] { return cityProfiles().map((p) => cityReadiness(p.slug)).sort((a, b) => b.neighborhoods - a.neighborhoods); }
