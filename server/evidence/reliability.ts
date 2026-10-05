/**
 * امتیاز اعتماد هر مقدار مستند (۰..۱):
 *   reliability = wT·T + wS·S + wF·F + wN·N + wC·C
 * T سطح منبع × کیفیت روش، S سطح مکانی، F تازگی، N کفایت نمونه/پوشش، C همگرایی منابع مستقل.
 * وزن‌ها از kernel/registries/reliability_weights_v1.json (نسخه‌دار) خوانده می‌شوند.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../paths';
import type { DocumentedValue, EvidenceTier, GeographyLevel } from './types';

export const TIER_SCORE: Record<EvidenceTier, number> = {
  official: 1, contract: 1, open_measured: 0.8, survey: 0.8, field: 0.8, open_model: 0.6, expert: 0.5, proxy: 0.3,
};
export const SPATIAL_SCORE: Record<GeographyLevel, number> = {
  block: 1, neighborhood: 1, district: 0.6, city: 0.3, province: 0, national: 0,
};
/** حداکثر سن معتبر (روز) بر اساس آهنگ به‌روزرسانی */
export const MAX_AGE_DAYS: Record<DocumentedValue['cadence'], number> = {
  realtime: 2, hourly: 7, daily: 30, monthly: 180, quarterly: 365, annual: 3 * 365, census: 10 * 365, static: 10 * 365,
};

export interface ReliabilityWeights { version: string; T: number; S: number; F: number; N: number; C: number }
let weights: ReliabilityWeights | null = null;
export function reliabilityWeights(): ReliabilityWeights {
  if (weights) return weights;
  const file = path.join(PROJECT_ROOT, 'kernel', 'registries', 'reliability_weights_v1.json');
  try {
    weights = JSON.parse(fs.readFileSync(file, 'utf8')) as ReliabilityWeights;
  } catch {
    weights = { version: 'RW-v1-default', T: 0.3, S: 0.25, F: 0.2, N: 0.15, C: 0.1 };
  }
  return weights;
}

export function freshness(v: Pick<DocumentedValue, 'observedAt' | 'observedAtUnknown' | 'cadence'>, now = Date.now()): number {
  if (!v.observedAt || v.observedAtUnknown) return 0;
  const ageDays = (now - Date.parse(v.observedAt)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return 0;
  return Math.max(0, Math.min(1, 1 - Math.max(0, ageDays) / MAX_AGE_DAYS[v.cadence]));
}

/** C: ۱ اگر ≥۲ منبع مستقل همسو (اختلاف ≤ ۱۰ امتیاز)، ۰٫۵ یک منبع، ۰ تعارض */
export function convergence(scores: Array<number | null>): { C: number; conflict: boolean } {
  const s = scores.filter((x): x is number => typeof x === 'number');
  if (s.length < 2) return { C: 0.5, conflict: false };
  const spread = Math.max(...s) - Math.min(...s);
  if (spread <= 10) return { C: 1, conflict: false };
  if (spread > 15) return { C: 0, conflict: true };
  return { C: 0.5, conflict: false };
}

export function computeReliability(v: DocumentedValue, C = 0.5, now = Date.now()): { reliability: number; parts: { T: number; S: number; F: number; N: number; C: number } } {
  if (v.raw === null) return { reliability: 0, parts: { T: 0, S: 0, F: 0, N: 0, C: 0 } };
  const w = reliabilityWeights();
  const parts = {
    T: TIER_SCORE[v.tier] * Math.max(0, Math.min(1, v.methodQuality)),
    S: SPATIAL_SCORE[v.geographyLevel],
    F: freshness(v, now),
    N: Math.max(0, Math.min(1, v.sampleAdequacy)),
    C,
  };
  // دادهٔ استانی/ملی هرگز وارد امتیاز محله نمی‌شود
  if (parts.S === 0) return { reliability: 0, parts };
  const r = w.T * parts.T + w.S * parts.S + w.F * parts.F + w.N * parts.N + w.C * parts.C;
  return { reliability: Math.round(r * 1000) / 1000, parts: Object.fromEntries(Object.entries(parts).map(([k, x]) => [k, Math.round(x * 1000) / 1000])) as typeof parts };
}
