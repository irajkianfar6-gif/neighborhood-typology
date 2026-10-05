/**
 * ممیزی میدانی فضای عمومی (شاخص P3).
 * چک‌لیست ۰..۲ برای ۸ گویه؛ دست‌کم ۵ نقطه در هر محله؛ دو ممیز برای پایایی بین‌ارزیاب (κ ≥ ۰٫۶).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';

export const AUDIT_ITEMS = ['lighting', 'seating', 'shade', 'cleanliness', 'accessibility', 'safety', 'activity', 'maintenance'] as const;
export const AUDIT_ITEM_LABELS: Record<typeof AUDIT_ITEMS[number], string> = {
  lighting: 'روشنایی', seating: 'نیمکت/نشستن', shade: 'سایه', cleanliness: 'پاکیزگی', accessibility: 'دسترس‌پذیری',
  safety: 'ایمنی', activity: 'سرزندگی/فعالیت', maintenance: 'نگهداری',
};
export const MIN_POINTS = 5;

export interface AuditInput { auditorId: string; pointId: string; lat: number; lng: number; items: Record<string, number>; photoRef?: string; auditedAt?: string }
export interface StoredAudit extends AuditInput { auditId: string; neighborhoodId: string; receivedAt: string }

function file(neighborhoodId: string): string {
  const dir = path.join(serverDataDir(), 'field-audit');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${neighborhoodId.replace(/[^\w.-]/g, '_')}.jsonl`);
}

export function validateAudit(a: AuditInput): string[] {
  const errors: string[] = [];
  if (!a.auditorId || !a.pointId) errors.push('auditorId و pointId لازم است');
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) errors.push('مختصات GPS لازم است');
  for (const k of AUDIT_ITEMS) {
    const v = a.items?.[k];
    if (![0, 1, 2].includes(v as number)) errors.push(`گویهٔ ${k} باید ۰، ۱ یا ۲ باشد`);
  }
  return errors;
}

export function addAudits(neighborhoodId: string, audits: AuditInput[]): { stored: StoredAudit[]; errors: Array<{ index: number; errors: string[] }> } {
  const stored: StoredAudit[] = [];
  const errors: Array<{ index: number; errors: string[] }> = [];
  audits.forEach((a, index) => {
    const e = validateAudit(a);
    if (e.length) { errors.push({ index, errors: e }); return; }
    stored.push({ ...a, auditId: crypto.randomUUID(), neighborhoodId, receivedAt: new Date().toISOString() });
  });
  if (stored.length) fs.appendFileSync(file(neighborhoodId), stored.map((s) => JSON.stringify(s)).join('\n') + '\n');
  return { stored, errors };
}

export function loadAudits(neighborhoodId: string): StoredAudit[] {
  const f = file(neighborhoodId);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as StoredAudit) : [];
}

/** کاپای وزنی خطی کوهن برای مقیاس ترتیبی ۰..۲ */
function weightedKappa(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 8) return null;
  const k = 3;
  const obs = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const [a, b] of pairs) obs[a][b]++;
  const n = pairs.length;
  const rowM = obs.map((r) => r.reduce((x, y) => x + y, 0));
  const colM = Array.from({ length: k }, (_, j) => obs.reduce((x, r) => x + r[j], 0));
  let po = 0, pe = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const w = 1 - Math.abs(i - j) / (k - 1);
    po += (w * obs[i][j]) / n;
    pe += (w * rowM[i] * colM[j]) / (n * n);
  }
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

export interface FieldAuditSummary {
  neighborhoodId: string; points: number; audits: number; auditors: number;
  p3: number | null; kappa: number | null; adequacy: 'ADEQUATE' | 'INSUFFICIENT'; reasons: string[];
  itemMeans: Record<string, number>; latestAuditAt: string | null;
  pointList: Array<{ pointId: string; lat: number; lng: number; auditors: string[]; score: number; auditedAt: string }>;
}

export function summarizeAudits(neighborhoodId: string): FieldAuditSummary {
  const audits = loadAudits(neighborhoodId);
  const byPoint = new Map<string, StoredAudit[]>();
  for (const a of audits) byPoint.set(a.pointId, [...(byPoint.get(a.pointId) ?? []), a]);
  const pointScores: number[] = [];
  const pairs: Array<[number, number]> = [];
  const itemSums: Record<string, number> = {};
  for (const list of byPoint.values()) {
    const per = list.map((a) => AUDIT_ITEMS.reduce((s, k) => s + a.items[k], 0) / (AUDIT_ITEMS.length * 2));
    pointScores.push(per.reduce((a, b) => a + b, 0) / per.length);
    if (list.length >= 2) for (const k of AUDIT_ITEMS) pairs.push([list[0].items[k], list[1].items[k]]);
    for (const k of AUDIT_ITEMS) itemSums[k] = (itemSums[k] ?? 0) + list.reduce((s, a) => s + a.items[k], 0) / list.length;
  }
  const kappa = weightedKappa(pairs);
  const reasons: string[] = [];
  if (byPoint.size < MIN_POINTS) reasons.push(`حداقل ${MIN_POINTS.toLocaleString('fa-IR')} نقطه لازم است (${byPoint.size.toLocaleString('fa-IR')} ثبت شده)`);
  if (kappa === null) reasons.push('برای پایایی بین‌ارزیاب، دست‌کم یک نقطه با دو ممیز لازم است');
  else if (kappa < 0.6) reasons.push(`پایایی بین‌ارزیاب κ=${kappa.toFixed(2)} کمتر از ۰٫۶ است`);
  const p3 = pointScores.length ? Math.round((pointScores.reduce((a, b) => a + b, 0) / pointScores.length) * 1000) / 10 : null;
  const times = audits.map((a) => a.auditedAt ?? a.receivedAt).sort();
  return {
    neighborhoodId, points: byPoint.size, audits: audits.length, auditors: new Set(audits.map((a) => a.auditorId)).size,
    p3, kappa: kappa === null ? null : Math.round(kappa * 1000) / 1000,
    adequacy: reasons.length === 0 ? 'ADEQUATE' : 'INSUFFICIENT', reasons,
    itemMeans: Object.fromEntries(Object.entries(itemSums).map(([k, v]) => [k, Math.round((v / Math.max(1, byPoint.size)) * 100) / 100])),
    latestAuditAt: times[times.length - 1] ?? null,
    pointList: [...byPoint].map(([pointId, list]) => ({
      pointId, lat: list[0].lat, lng: list[0].lng, auditors: [...new Set(list.map((a) => a.auditorId))],
      score: Math.round((list.reduce((s, a) => s + AUDIT_ITEMS.reduce((x, k) => x + a.items[k], 0) / (AUDIT_ITEMS.length * 2), 0) / list.length) * 1000) / 10,
      auditedAt: list.map((a) => a.auditedAt ?? a.receivedAt).sort().pop() ?? '',
    })),
  };
}
