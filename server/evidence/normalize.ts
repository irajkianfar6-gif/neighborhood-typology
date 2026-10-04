/**
 * نرمال‌سازی مقدار خام به امتیاز ۰..۱۰۰ (بالاتر = بهتر):
 *  ۱) شاخص دارای استاندارد هنجاری → خطی بین critical و target (threshold_registry_v2.json)
 *  ۲) شاخص بدون استاندارد → صدک در توزیع مرجع شهر (data/reference/<city>.json) پس از winsorize
 *  ۳) شاخص پیمایشی/ممیزی که خودش ۰..۱۰۰ است → همان مقدار
 *  در غیر این صورت امتیاز تهی می‌ماند و دلیل ثبت می‌شود (هرگز عدد ساختگی نمی‌سازیم).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../paths';
import type { DocumentedValue } from './types';
import { approvedCityDistribution } from '../ingestion/contractData';

interface ThresholdRegistry {
  version: string;
  calibrated: boolean;
  normative: Record<string, { unit: string; target: number; critical: number; basis: string }>;
  percentile: string[];
  percent_scale_passthrough: string[];
  winsorize: [number, number];
}
export interface ReferenceDistribution {
  version: string; citySlug: string; cityFa: string; builtAt: string; neighborhoods: number;
  indicators: Record<string, { n: number; values: number[]; unit: string; lowerIsBetter?: boolean; observedAt?: string | null }>;
}

let registry: ThresholdRegistry | null = null;
export function thresholdRegistry(): ThresholdRegistry {
  if (!registry) registry = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'kernel', 'registries', 'threshold_registry_v2.json'), 'utf8')) as ThresholdRegistry;
  return registry;
}

const refCache = new Map<string, { at: number; ref: ReferenceDistribution | null }>();
export function referenceDir(): string {
  return path.resolve(process.env.ARA_REFERENCE_DIR || path.join(PROJECT_ROOT, 'data', 'reference'));
}
export function loadReference(citySlug: string): ReferenceDistribution | null {
  const hit = refCache.get(citySlug);
  if (hit && Date.now() - hit.at < 60_000) return hit.ref;
  const file = path.join(referenceDir(), `reference_distribution_${citySlug}.json`);
  const ref = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as ReferenceDistribution : null;
  refCache.set(citySlug, { at: Date.now(), ref });
  return ref;
}

export function percentileOf(value: number, sorted: number[], winsor: [number, number]): number {
  if (!sorted.length) return NaN;
  const lo = sorted[Math.floor(winsor[0] * (sorted.length - 1))];
  const hi = sorted[Math.ceil(winsor[1] * (sorted.length - 1))];
  const v = Math.min(hi, Math.max(lo, value));
  let below = 0, equal = 0;
  for (const x of sorted) { if (x < v) below++; else if (x === v) equal++; }
  return ((below + 0.5 * equal) / sorted.length) * 100;
}

export function linearScore(value: number, target: number, critical: number): number {
  const s = ((value - critical) / (target - critical)) * 100;
  return Math.max(0, Math.min(100, s));
}

export interface ScoreResult {
  score: number | null;
  method: 'normative' | 'percentile' | 'contract_scale' | 'survey_scale' | 'none';
  ref?: string;
  percentile: number | null;
  reason?: string;
}

export function scoreValue(v: DocumentedValue, citySlug: string): ScoreResult {
  if (v.raw === null) return { score: null, method: 'none', percentile: null, reason: v.missingReason ?? 'NO_VALUE' };
  const reg = thresholdRegistry();
  const ref = loadReference(citySlug);
  let dist: { values: number[]; version?: string } | undefined = ref?.indicators[v.code];
  let distVersion = ref?.version;
  if ((!dist || dist.values.length < 20) && v.channel === 'contract') {
    const live = approvedCityDistribution(citySlug, v.code);
    if (live.values.length >= 20) { dist = { values: live.values }; distVersion = `contract-live-${citySlug}-${live.newest ?? 'na'}-n${live.neighborhoods}`; }
  }
  const pct = dist && dist.values.length >= 20 ? percentileOf(v.raw, dist.values, reg.winsorize) : null;
  const pctGood = pct === null ? null : (v.lowerIsBetter ? 100 - pct : pct);
  const round = (x: number) => Math.round(x * 10) / 10;
  if (reg.percent_scale_passthrough.includes(v.code)) {
    return { score: round(Math.max(0, Math.min(100, v.raw))), method: v.channel === 'survey' ? 'survey_scale' : 'contract_scale', ref: reg.version, percentile: pctGood === null ? null : round(pctGood) };
  }
  const norm = reg.normative[v.code];
  if (norm && (!v.unit || v.unit === norm.unit)) {
    return { score: round(linearScore(v.raw, norm.target, norm.critical)), method: 'normative', ref: `${reg.version}:${v.code}`, percentile: pctGood === null ? null : round(pctGood) };
  }
  if (pctGood !== null) {
    return { score: round(pctGood), method: 'percentile', ref: `${distVersion}:${v.code}`, percentile: round(pctGood) };
  }
  return { score: null, method: 'none', percentile: null, reason: dist ? 'REFERENCE_TOO_SMALL' : 'NO_REFERENCE_DISTRIBUTION' };
}
