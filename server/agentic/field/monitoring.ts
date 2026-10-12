/**
 * پایش پس از مداخله (A14) — MON-v1.
 * کارشناس مداخلهٔ اجراشده را ثبت می‌کند؛ خط پایهٔ شاخص‌های هدف (از کتابخانهٔ مداخلات) ثبت می‌شود
 * و در هر ارزیابی، محله دوباره سنجیده و تغییر شاخص‌های هدف با قاعدهٔ شفاف داوری می‌شود.
 * داوری فقط «همبستگی زمانی» است، نه اثبات علّی.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../../paths';
import { requireEntry, runAnalysis, ToolInputError, invalidateNeighborhood } from '../state';
import { loadRuns } from '../../neighborhood/history';
import { load, list, newId, save } from './store';

export const MONITORING_VERSION = 'MON-v1';
export const MIN_DELTA = 5; export const MIN_REL = 0.6;
interface LibItem { id: string; name: string; capital: string; transition: string; targets: string[]; months: number; owner: string }
export function libraryItems(): LibItem[] {
  try { return (JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'kernel', 'registries', 'intervention_library_v1.json'), 'utf8')) as { items: LibItem[] }).items; } catch { return []; }
}
type Verdict = 'improved' | 'worsened' | 'no_change' | 'insufficient_data';
export interface Monitoring {
  id: string; version: string; createdAt: string; registeredBy: string; neighborhoodId: string; nameFa: string; offline: boolean;
  libraryId: string; name: string; capital: string; transition: string; targets: string[]; startDate: string; dueDate: string; note: string | null;
  baseline: { analysisId: string; at: string; values: Record<string, { score: number | null; reliability: number; tier: string }> };
  evaluations: Array<{ at: string; analysisId: string; due: boolean; perTarget: Array<{ code: string; before: number | null; after: number | null; delta: number | null; verdict: Verdict }>; overall: Verdict; note: string }>;
}
const addMonths = (d: string, m: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };

export async function registerMonitoring(input: { neighborhoodId: string; libraryId: string; startDate?: string; registeredBy: string; note?: string; offline?: boolean }): Promise<Monitoring> {
  const e = requireEntry(input.neighborhoodId);
  const it = libraryItems().find((x) => x.id === input.libraryId);
  if (!it) throw new ToolInputError('NOT_FOUND', `مداخلهٔ «${input.libraryId}» در کتابخانه نیست`);
  const start = input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : new Date().toISOString().slice(0, 10);
  const r = await runAnalysis(e, { offline: input.offline ?? false });
  const values: Monitoring['baseline']['values'] = {};
  for (const c of it.targets) { const i = r.card.indicators.find((x) => x.code === c); values[c] = { score: i?.score ?? null, reliability: i?.reliability ?? 0, tier: i?.tier ?? 'none' }; }
  return save('monitoring', {
    id: newId('mon'), version: MONITORING_VERSION, createdAt: new Date().toISOString(), registeredBy: input.registeredBy, neighborhoodId: e.neighborhoodId, nameFa: `${e.nameFa}، ${e.cityFa}`, offline: input.offline ?? false,
    libraryId: it.id, name: it.name, capital: it.capital, transition: it.transition, targets: it.targets, startDate: start, dueDate: addMonths(start, Math.max(1, it.months || 6)), note: input.note?.slice(0, 500) ?? null,
    baseline: { analysisId: r.card.fingerprint, at: r.card.generatedAt, values }, evaluations: [],
  } satisfies Monitoring);
}
export const getMonitoring = (id: string) => load<Monitoring>('monitoring', id);
export const listMonitoring = (nb?: string) => list<Monitoring>('monitoring', (m) => !nb || m.neighborhoodId === nb);

export function judge(before: { score: number | null; reliability: number } | undefined, after: { score: number | null; reliability: number } | undefined): { delta: number | null; verdict: Verdict } {
  if (!before || !after || before.score === null || after.score === null || before.reliability < MIN_REL || after.reliability < MIN_REL) return { delta: before?.score != null && after?.score != null ? Math.round((after.score - before.score) * 10) / 10 : null, verdict: 'insufficient_data' };
  const d = Math.round((after.score - before.score) * 10) / 10;
  return { delta: d, verdict: d >= MIN_DELTA ? 'improved' : d <= -MIN_DELTA ? 'worsened' : 'no_change' };
}

export async function evaluateMonitoring(id: string): Promise<Monitoring> {
  const m = getMonitoring(id); if (!m) throw new ToolInputError('NOT_FOUND', 'پایش یافت نشد');
  invalidateNeighborhood(m.neighborhoodId);
  const r = await runAnalysis(requireEntry(m.neighborhoodId), { offline: m.offline, force: true });
  const perTarget = m.targets.map((code) => { const i = r.card.indicators.find((x) => x.code === code); const j = judge(m.baseline.values[code], i ? { score: i.score, reliability: i.reliability } : undefined); return { code, before: m.baseline.values[code]?.score ?? null, after: i?.score ?? null, ...j }; });
  const counted = perTarget.filter((x) => x.verdict !== 'insufficient_data');
  const tally = (v: Verdict) => counted.filter((x) => x.verdict === v).length;
  const overall: Verdict = !counted.length ? 'insufficient_data' : tally('worsened') > tally('improved') ? 'worsened' : tally('improved') > counted.length / 2 ? 'improved' : 'no_change';
  const due = new Date().toISOString().slice(0, 10) >= m.dueDate;
  const note = [!due ? `پیش از موعد ارزیابی (${m.dueDate})؛ اثر مداخله ممکن است هنوز ظاهر نشده باشد.` : '', counted.length < perTarget.length ? 'برای برخی شاخص‌های هدف دادهٔ معتبر (اعتبار ≥ ۰٫۶) نیست؛ پیمایش یا ممیزی میدانی لازم است.' : '', 'تغییر هم‌زمان با مداخله اثبات علّی نیست.'].filter(Boolean).join(' ');
  m.evaluations.push({ at: new Date().toISOString(), analysisId: r.card.fingerprint, due, perTarget, overall, note });
  return save('monitoring', m);
}

/** سری زمانی امتیاز شاخص‌های هدف از تاریخچهٔ اجراها */
export function targetSeries(m: Monitoring) {
  return loadRuns(m.neighborhoodId, 100).map((x) => ({ at: x.runAt, values: Object.fromEntries(m.targets.map((c) => [c, x.scores[c]?.score ?? null])) }));
}
