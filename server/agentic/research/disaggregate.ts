/**
 * DISAGG-v1 — برآورد شفاف «منطقه → محله» برای متغیرهای شمارشی (جمعیت، خانوار).
 * هیچ عددی ساخته نمی‌شود که منشأ و روشش برچسب نخورد: هر برآورد از جمع منطقه و یک وزن مستند ساخته می‌شود،
 * جمع برآوردها دقیقاً برابر عدد منطقه است، بازهٔ عدم‌قطعیت دارد، و فقط پس از تأیید کارشناس (بازبینی دستهٔ قراردادی) به کار می‌رود.
 * روش‌ها به‌ترتیب اولویت:
 *   prior_share — سهم هر محله از همان شاخص در دورهٔ پیشین (دادهٔ تأییدشدهٔ سطح محله)
 *   covariate   — وزن کمکی بیرونی (مثلاً جمع WorldPop هر محله) که فراخواننده می‌دهد
 *   area        — مساحت مرز رسمی (ضعیف‌ترین؛ اگر مرزهای تقریبی زیاد باشد رد می‌شود)
 * نرخ‌ها و درصدها برآورد نمی‌شوند: بدون متغیر کمکی، تفاوت درون‌منطقه‌ای را نمی‌توان صادقانه ساخت.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../../paths';
import { neighborhoodsOfCity } from '../../neighborhood/gazetteer';
import { approvedValuesFor, CONTRACT_COLUMNS, createBatch } from '../../ingestion/contractData';
import { districtNumber } from './spatialMatch';

export const DISAGG_VERSION = 'DISAGG-v1';
export const ESTIMABLE_CODES = new Set(['POP', 'HOUSEHOLDS', 'POP_25PLUS', 'POP_15_64', 'POP_15PLUS', 'POP_MALE', 'POP_FEMALE', 'POP_AGE_18_29', 'POP_AGE_30_44', 'POP_AGE_45_64', 'POP_AGE_65PLUS']);
export type DisaggMethod = 'prior_share' | 'covariate' | 'area';
/** نیم‌پهنای نسبی بازهٔ عدم‌قطعیت هر روش (قراردادی و محافظه‌کارانه؛ برچسب، نه آماره) */
const BAND: Record<DisaggMethod, number> = { prior_share: 0.15, covariate: 0.3, area: 0.5 };
const RELIABILITY: Record<DisaggMethod, 'medium' | 'low' | 'very_low'> = { prior_share: 'medium', covariate: 'low', area: 'very_low' };
const MIN_COVERAGE = 0.8;
const MAX_PROXY_SHARE = 0.2;

export interface DisaggInput {
  city: string; district: number | string; code: string; value: number; periodEnd: string; sourceOrg: string;
  method?: DisaggMethod | 'auto'; covariate?: { name: string; weights: Record<string, number> }; dryRun?: boolean; uploadedBy?: string;
}
export interface DisaggEstimate { neighborhoodId: string; nameFa: string; weight: number; share: number; estimate: number; low: number; high: number }
export interface DisaggRecord {
  schema: 'ara.estimate.v1'; estimateId: string; version: string; createdAt: string; createdBy: string;
  city: string; district: number; code: string; districtValue: number; periodEnd: string; sourceOrg: string;
  method: DisaggMethod; weightSource: string; reliability: 'medium' | 'low' | 'very_low'; band: number; coverage: number;
  estimates: DisaggEstimate[]; tried: Array<{ method: DisaggMethod; ok: boolean; reason: string }>;
  label: string; status: 'DRY_RUN' | 'PENDING_EXPERT' ; batchId: string | null;
}

function dir(): string { const d = path.join(serverDataDir(), 'agentic', 'estimates'); fs.mkdirSync(d, { recursive: true }); return d; }

/** گرد کردن با «بزرگ‌ترین باقیمانده» تا جمع دقیقاً برابر عدد منطقه بماند */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error('جمع وزن‌ها صفر است');
  const exact = weights.map((w) => (w / sum) * total);
  const floor = exact.map(Math.floor);
  let rest = Math.round(total - floor.reduce((a, b) => a + b, 0));
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) { if (rest <= 0) break; floor[i]++; rest--; }
  return floor;
}

export function estimateFromDistrict(input: DisaggInput): DisaggRecord {
  const code = String(input.code).toUpperCase();
  if (!ESTIMABLE_CODES.has(code)) throw new Error(`${code} شمارشی نیست؛ نرخ و درصد منطقه بدون متغیر کمکی به محله‌ها برآورد نمی‌شود (همان مقدار منطقه با برچسب «سطح منطقه» به کار می‌رود)`);
  const dn = districtNumber(input.district);
  if (dn === null) throw new Error('شمارهٔ منطقه نامعتبر است');
  if (!(Number.isFinite(input.value) && input.value > 0)) throw new Error('عدد منطقه باید مثبت باشد');
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(input.periodEnd)) throw new Error('periodEnd باید YYYY-MM باشد');
  const members = neighborhoodsOfCity(input.city).filter((e) => districtNumber(e.districtFa) === dn);
  if (!members.length) throw new Error(`محله‌ای برای منطقهٔ ${dn} در ${input.city} یافت نشد`);
  const tried: DisaggRecord['tried'] = [];
  const want = input.method && input.method !== 'auto' ? [input.method] : (['prior_share', 'covariate', 'area'] as DisaggMethod[]);
  let chosen: { method: DisaggMethod; weights: number[]; source: string; coverage: number } | null = null;
  for (const m of want) {
    if (m === 'prior_share') {
      const prior = members.map((e) => approvedValuesFor(e.neighborhoodId, input.periodEnd).find((v) => v.indicator_code === code && !v.group_key && v.geography_level !== 'estimated' && v.geography_level !== 'district' && v.period_end < input.periodEnd));
      const have = prior.filter(Boolean).length; const cov = have / members.length;
      if (cov < MIN_COVERAGE) { tried.push({ method: m, ok: false, reason: `دادهٔ دورهٔ پیشین فقط برای ${have} از ${members.length} محله هست` }); continue; }
      // محله‌های بی‌داده با میانگین سهم بقیه پر می‌شوند و این در برچسب می‌آید
      const vals = prior.map((p) => p?.value ?? null); const avg = vals.filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) / have;
      const periods = [...new Set(prior.filter(Boolean).map((p) => p!.period_end))].sort();
      chosen = { method: m, weights: vals.map((v) => v ?? avg), source: `سهم هر محله از ${code} تأییدشده در دورهٔ ${periods.join('، ')}${have < members.length ? ` (${members.length - have} محلهٔ بی‌داده با میانگین)` : ''}`, coverage: cov };
      break;
    }
    if (m === 'covariate') {
      const w = input.covariate?.weights;
      if (!w) { tried.push({ method: m, ok: false, reason: 'متغیر کمکی داده نشده است' }); continue; }
      const vals = members.map((e) => (Number.isFinite(w[e.neighborhoodId]) && w[e.neighborhoodId] >= 0 ? w[e.neighborhoodId] : null));
      const have = vals.filter((v) => v !== null).length; const cov = have / members.length;
      if (cov < MIN_COVERAGE) { tried.push({ method: m, ok: false, reason: `متغیر کمکی فقط برای ${have} از ${members.length} محله هست` }); continue; }
      const avg = vals.filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) / have;
      chosen = { method: m, weights: vals.map((v) => v ?? avg), source: `متغیر کمکی «${String(input.covariate!.name).slice(0, 80)}»`, coverage: cov };
      break;
    }
    if (m === 'area') {
      const proxies = members.filter((e) => e.boundary.isProxy).length;
      if (proxies / members.length > MAX_PROXY_SHARE) { tried.push({ method: m, ok: false, reason: `${proxies} از ${members.length} مرز تقریبی است؛ مساحت وزن معتبری نیست` }); continue; }
      chosen = { method: m, weights: members.map((e) => Math.max(0, e.boundary.areaKm2)), source: 'مساحت مرز محله (فرض تراکم یکسان در منطقه)', coverage: 1 };
      break;
    }
  }
  if (!chosen) throw new Error(`برآورد ممکن نشد: ${tried.map((t) => t.reason).join('؛ ')}`);
  const total = Math.round(input.value);
  const est = apportion(total, chosen.weights);
  const wsum = chosen.weights.reduce((a, b) => a + b, 0);
  const band = BAND[chosen.method];
  const estimates = members.map((e, i) => ({ neighborhoodId: e.neighborhoodId, nameFa: e.nameFa, weight: Math.round(chosen!.weights[i] * 1000) / 1000, share: Math.round((chosen!.weights[i] / wsum) * 10000) / 10000, estimate: est[i], low: Math.round(est[i] * (1 - band)), high: Math.round(est[i] * (1 + band)) }));
  const estimateId = `est_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const label = `برآورد مدل‌محور (${DISAGG_VERSION}، روش ${chosen.method}): عدد منطقهٔ ${dn} بر پایهٔ ${chosen.source} میان ${members.length} محله پخش شد؛ اعتبار ${RELIABILITY[chosen.method] === 'medium' ? 'متوسط' : RELIABILITY[chosen.method] === 'low' ? 'پایین' : 'بسیار پایین'}، بازهٔ ±${Math.round(band * 100)}٪؛ دادهٔ سرشماری محله نیست`;
  const rec: DisaggRecord = {
    schema: 'ara.estimate.v1', estimateId, version: DISAGG_VERSION, createdAt: new Date().toISOString(), createdBy: input.uploadedBy ?? 'operator',
    city: input.city, district: dn, code, districtValue: total, periodEnd: input.periodEnd, sourceOrg: input.sourceOrg, method: chosen.method, weightSource: chosen.source,
    reliability: RELIABILITY[chosen.method], band, coverage: Math.round(chosen.coverage * 1000) / 1000, estimates, tried, label, status: 'DRY_RUN', batchId: null,
  };
  if (input.dryRun !== false) return rec;
  // تأیید کارشناس: دستهٔ قراردادی در وضعیت «در انتظار بازبینی» ساخته می‌شود؛ تا تأیید نشود هیچ جا به کار نمی‌رود
  const lines = estimates.map((x) => CONTRACT_COLUMNS.map((k) => ({ indicator_code: code, neighborhood_id: x.neighborhoodId, value: String(x.estimate), unit: 'count', period_end: input.periodEnd.slice(0, 7), source_org: `${input.sourceOrg} + ${DISAGG_VERSION}`.slice(0, 120), dataset_id: `estimate:${DISAGG_VERSION}:${chosen!.method}:${estimateId}`, extraction_date: rec.createdAt.slice(0, 10) } as Record<string, string>)[k] ?? ''));
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [CONTRACT_COLUMNS.join(','), ...lines.map((l) => l.map(esc).join(','))].join('\n') + '\n';
  const b = createBatch(csv, 'agentic-estimate', input.uploadedBy ?? 'agent:A5');
  rec.status = 'PENDING_EXPERT'; rec.batchId = b.batchId;
  fs.writeFileSync(path.join(dir(), `${estimateId}.json`), JSON.stringify(rec, null, 1));
  return rec;
}

export function listEstimates(limit = 30): DisaggRecord[] {
  return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) as DisaggRecord; } catch { return null; } }).filter((x): x is DisaggRecord => Boolean(x)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
/** روش برآورد از dataset_id یک ردیف قراردادی (estimate:DISAGG-v1:<method>:<id>) */
export function estimateMethodOf(datasetId?: string): DisaggMethod | null {
  const m = /^estimate:[^:]+:(prior_share|covariate|area):/.exec(datasetId ?? '');
  return m ? (m[1] as DisaggMethod) : null;
}

/** وزن کمکی WorldPop (اگر رستر روی سرور تنظیم شده باشد): جمع پیکسل‌های جمعیت درون مرز هر محلهٔ منطقه */
export async function worldpopWeights(city: string, district: number | string): Promise<{ name: string; weights: Record<string, number> } | null> {
  if (!process.env.WORLDPOP_COG_PATH) return null;
  const dn = districtNumber(district);
  const members = neighborhoodsOfCity(city).filter((e) => districtNumber(e.districtFa) === dn && !e.boundary.isProxy);
  if (!members.length) return null;
  const { kernelClient } = await import('../../kernelClient');
  const weights: Record<string, number> = {};
  for (const e of members) {
    try { const { status, payload } = await kernelClient.zonalStats({ raster_id: 'worldpop', geometry: e.boundary.geojson }); if (status === 200 && payload.result?.sum != null) weights[e.neighborhoodId] = payload.result.sum; } catch { /* محلهٔ بی‌وزن */ }
  }
  return Object.keys(weights).length ? { name: `WorldPop (${path.basename(process.env.WORLDPOP_COG_PATH)})`, weights } : null;
}
