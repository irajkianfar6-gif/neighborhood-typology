/**
 * Resolver نام محله → نامزدها با اطمینان.
 * مراحل: تطبیق دقیق ← نام جایگزین ← شامل‌بودن ← فازی (Jaro-Winkler).
 * اگر بیش از یک نامزد قوی (≥۰٫۸) باشد یا بهترین زیر ۰٫۹ باشد، انتخاب کاربر لازم است.
 */
import { type GazetteerEntry, loadGazetteer } from './gazetteer';
import { citySlug, jaroWinkler, matchKey, normalizeFa } from './text';

export interface ResolveCandidate { entry: GazetteerEntry; confidence: number; matchedOn: string }
export interface ResolveResult {
  query: string;
  best?: ResolveCandidate;
  candidates: ResolveCandidate[];
  requiresUserChoice: boolean;
  reason?: string;
}

/** «یوسف آباد، تهران» یا «یوسف‌آباد تهران» → نام و شهر */
export function splitNameAndCity(raw: string, cityHint?: string): { name: string; city?: string } {
  if (cityHint) return { name: raw, city: cityHint };
  const parts = raw.split(/[،,]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { name: parts[0], city: parts[parts.length - 1] };
  return { name: raw };
}

export function resolveNeighborhood(rawName: string, cityHint?: string, limit = 8): ResolveResult {
  const { name, city } = splitNameAndCity(rawName, cityHint);
  const key = matchKey(name);
  const { entries } = loadGazetteer();
  if (!key) return { query: rawName, candidates: [], requiresUserChoice: false, reason: 'EMPTY_QUERY' };
  const slug = city ? citySlug(city) : undefined;
  const pool = slug ? entries.filter((e) => e.citySlug === slug) : entries;
  // اگر شهر در انتهای نام آمده بود (بدون ویرگول) آن را جدا کنیم
  const scored: ResolveCandidate[] = [];
  for (const e of pool.length ? pool : entries) {
    let best = 0;
    let on = '';
    e.keys.forEach((k, i) => {
      let s = 0;
      if (k === key) s = i === 0 ? 1 : 0.97;
      else if (k.length >= 3 && key.length >= 3 && (k.includes(key) || key.includes(k))) {
        s = 0.8 + 0.1 * (Math.min(k.length, key.length) / Math.max(k.length, key.length));
      } else s = jaroWinkler(k, key) * 0.95;
      if (s > best) { best = s; on = i === 0 ? 'name_fa' : 'alt'; }
    });
    if (best >= 0.75) scored.push({ entry: e, confidence: best, matchedOn: on });
  }
  scored.sort((a, b) => b.confidence - a.confidence || a.entry.nameFa.localeCompare(b.entry.nameFa, 'fa'));
  const candidates = scored.slice(0, limit);
  const best = candidates[0];
  const strong = candidates.filter((c) => c.confidence >= 0.8);
  const exactDupes = candidates.filter((c) => c.confidence >= 0.97);
  let requiresUserChoice = false;
  let reason: string | undefined;
  if (!best) reason = 'NOT_FOUND';
  else if (exactDupes.length > 1) { requiresUserChoice = true; reason = 'DUPLICATE_NAME'; }
  else if (best.confidence < 0.9) { requiresUserChoice = true; reason = 'LOW_CONFIDENCE'; }
  else if (best.confidence < 1 && strong.filter((c) => c !== best && c.confidence >= 0.85).length > 0) { requiresUserChoice = true; reason = 'MULTIPLE_STRONG_MATCHES'; }
  return { query: rawName, best, candidates, requiresUserChoice, reason };
}

export { normalizeFa };
