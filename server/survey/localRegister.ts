/**
 * ثبت‌های محلی مستند (Local Registers) برای شاخص‌هایی که با پرسش از ساکنان سنجیده نمی‌شوند:
 *   S5 حل مسئلهٔ جمعی  = مسائل حل‌شده با مشارکت ÷ مسائل شناسایی‌شده ×۱۰۰
 *   G1 مشارکت در تصمیم = فرایندهای دارای مشارکت واقعی گروه‌های محلی ÷ کل فرایندها ×۱۰۰
 *   G5 یادگیری نهادی  = پروژه‌های استفاده‌کننده از ارزیابی قبلی ÷ کل پروژه‌ها ×۱۰۰
 *   G3 هماهنگی نهادی  = پیوندهای همکاری فعال ÷ پیوندهای ممکن ×۱۰۰ (چگالی شبکهٔ نهادها؛ ارزیابی خبره)
 *
 * هر پرونده یک سطر با عنوان، تاریخ، پاسخ بله/خیر و ارجاع سند است. فقط پرونده‌های سه سال اخیر شمرده می‌شوند.
 * مقدار فقط وقتی منتشر می‌شود که دست‌کم ۵ پرونده (یا ۴ نهاد برای G3) ثبت شده باشد.
 * کیفیت روش با سهم پرونده‌های دارای ارجاع سند افزایش می‌یابد (۰٫۵ تا ۱).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';

export type RegisterKind = 'problem' | 'process' | 'project';
export const REGISTER_KINDS: Record<RegisterKind, { indicator: string; label: string; item: string; flag: string; denominator: string }> = {
  problem: { indicator: 'S5', label: 'حل مسئلهٔ جمعی', item: 'مسئلهٔ شناسایی‌شدهٔ محله', flag: 'با مشارکت ساکنان/گروه‌های محلی حل شد', denominator: 'مسائل شناسایی‌شده' },
  process: { indicator: 'G1', label: 'مشارکت در تصمیم‌گیری', item: 'فرایند تصمیم‌گیری محله (طرح، بودجه، مصوبه)', flag: 'گروه‌های محلی مشارکت واقعی داشتند (نظرشان در تصمیم اثر گذاشت)', denominator: 'کل فرایندهای تصمیم' },
  project: { indicator: 'G5', label: 'یادگیری نهادی', item: 'پروژهٔ اجراشده در محله', flag: 'در طراحی از ارزیابی پروژه‌های قبلی استفاده شد', denominator: 'کل پروژه‌ها' },
};
export const MIN_RECORDS = 5;
export const MIN_ACTORS = 4;
const WINDOW_DAYS = 3 * 365;

export interface RegisterRecordInput { kind: RegisterKind; title: string; date: string; flag: boolean; evidenceRef?: string; recordedBy: string; note?: string }
export interface NetworkInput { actors: string[]; links: Array<[number, number]>; assessedBy: string; assessedAt?: string; note?: string }

type Line =
  | ({ type: 'record'; id: string; neighborhoodId: string; receivedAt: string } & RegisterRecordInput)
  | ({ type: 'network'; id: string; neighborhoodId: string; receivedAt: string } & NetworkInput)
  | { type: 'void'; id: string; targetId: string; receivedAt: string; by: string };

function file(neighborhoodId: string): string {
  const dir = path.join(serverDataDir(), 'local-register');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${neighborhoodId.replace(/[^\w.-]/g, '_')}.jsonl`);
}
function load(neighborhoodId: string): Line[] {
  const f = file(neighborhoodId);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : [];
}
function append(neighborhoodId: string, lines: Line[]): void {
  if (lines.length) fs.appendFileSync(file(neighborhoodId), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

const clean = (s: unknown, max = 200) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

export function validateRecord(r: RegisterRecordInput): string[] {
  const e: string[] = [];
  if (!(r?.kind in REGISTER_KINDS)) e.push('نوع ثبت نامعتبر است (problem | process | project)');
  if (!clean(r?.title)) e.push('عنوان پرونده لازم است');
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(String(r?.date ?? '')) || !Number.isFinite(Date.parse(r.date.length === 7 ? `${r.date}-01` : r.date))) e.push('تاریخ میلادی YYYY-MM-DD لازم است');
  else if (Date.parse(r.date.length === 7 ? `${r.date}-01` : r.date) > Date.now() + 86_400_000) e.push('تاریخ نمی‌تواند در آینده باشد');
  if (typeof r?.flag !== 'boolean') e.push('پاسخ بله/خیر لازم است');
  if (!clean(r?.recordedBy)) e.push('نام/کد ثبت‌کننده لازم است');
  return e;
}

export function validateNetwork(n: NetworkInput): string[] {
  const e: string[] = [];
  const actors = Array.isArray(n?.actors) ? n.actors.map((a) => clean(a, 80)).filter(Boolean) : [];
  if (actors.length < 2) e.push('دست‌کم دو نهاد لازم است');
  if (new Set(actors).size !== actors.length) e.push('نام نهادها تکراری است');
  if (!Array.isArray(n?.links)) e.push('فهرست پیوندها لازم است');
  else if (n.links.some((l) => !Array.isArray(l) || l.length !== 2 || !Number.isInteger(l[0]) || !Number.isInteger(l[1]) || l[0] === l[1] || l[0] < 0 || l[1] < 0 || l[0] >= actors.length || l[1] >= actors.length)) e.push('پیوند نامعتبر');
  if (!clean(n?.assessedBy)) e.push('نام/کد ارزیاب لازم است');
  return e;
}

export function addRecords(neighborhoodId: string, inputs: RegisterRecordInput[]) {
  const stored: Line[] = [];
  const errors: Array<{ index: number; errors: string[] }> = [];
  inputs.slice(0, 1000).forEach((r, index) => {
    const e = validateRecord(r);
    if (e.length) { errors.push({ index, errors: e }); return; }
    stored.push({ type: 'record', id: crypto.randomUUID(), neighborhoodId, receivedAt: new Date().toISOString(), kind: r.kind, title: clean(r.title), date: r.date, flag: r.flag, evidenceRef: clean(r.evidenceRef) || undefined, recordedBy: clean(r.recordedBy, 80), note: clean(r.note, 300) || undefined });
  });
  append(neighborhoodId, stored);
  return { stored: stored.length, ids: stored.map((s) => s.id), errors };
}

export function saveNetwork(neighborhoodId: string, input: NetworkInput) {
  const errors = validateNetwork(input);
  if (errors.length) return { stored: false, errors };
  const actors = input.actors.map((a) => clean(a, 80));
  const seen = new Set<string>();
  const links = input.links.map(([a, b]) => (a < b ? [a, b] : [b, a]) as [number, number]).filter(([a, b]) => { const k = `${a}-${b}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const line: Line = { type: 'network', id: crypto.randomUUID(), neighborhoodId, receivedAt: new Date().toISOString(), actors, links, assessedBy: clean(input.assessedBy, 80), assessedAt: input.assessedAt, note: clean(input.note, 300) || undefined };
  append(neighborhoodId, [line]);
  return { stored: true, id: line.id, errors: [] as string[] };
}

export function voidEntry(neighborhoodId: string, targetId: string, by: string): boolean {
  const exists = load(neighborhoodId).some((l) => l.type !== 'void' && l.id === targetId);
  if (!exists) return false;
  append(neighborhoodId, [{ type: 'void', id: crypto.randomUUID(), targetId, receivedAt: new Date().toISOString(), by: clean(by, 80) || 'unknown' }]);
  return true;
}

export interface RegisterIndicator { code: string; label: string; value: number; n: number; flagged: number; evidenceShare: number; methodQuality: number; latest: string | null; denominator: string }
export interface RegisterSummary {
  neighborhoodId: string;
  records: Array<{ id: string; kind: RegisterKind; title: string; date: string; flag: boolean; evidenceRef?: string; recordedBy: string; receivedAt: string; inWindow: boolean }>;
  byKind: Record<RegisterKind, { indicator: string; total: number; inWindow: number; flagged: number; withEvidence: number; required: number; value: number | null }>;
  network: null | { id: string; actors: string[]; links: Array<[number, number]>; density: number; possible: number; assessedBy: string; assessedAt: string; centrality: Array<{ actor: string; degree: number }> };
  indicators: RegisterIndicator[];
}

export function summarizeRegister(neighborhoodId: string, now = Date.now()): RegisterSummary {
  const lines = load(neighborhoodId);
  const voided = new Set(lines.filter((l) => l.type === 'void').map((l) => (l as { targetId: string }).targetId));
  const recs = lines.filter((l): l is Extract<Line, { type: 'record' }> => l.type === 'record' && !voided.has(l.id));
  const nets = lines.filter((l): l is Extract<Line, { type: 'network' }> => l.type === 'network' && !voided.has(l.id));
  const inWin = (d: string) => now - Date.parse(d.length === 7 ? `${d}-01` : d) <= WINDOW_DAYS * 86_400_000;
  const indicators: RegisterIndicator[] = [];
  const byKind = {} as RegisterSummary['byKind'];
  for (const [kind, def] of Object.entries(REGISTER_KINDS) as Array<[RegisterKind, typeof REGISTER_KINDS[RegisterKind]]>) {
    const all = recs.filter((r) => r.kind === kind);
    const win = all.filter((r) => inWin(r.date));
    const flagged = win.filter((r) => r.flag).length;
    const withEvidence = win.filter((r) => r.evidenceRef).length;
    const value = win.length >= MIN_RECORDS ? Math.round((flagged / win.length) * 1000) / 10 : null;
    byKind[kind] = { indicator: def.indicator, total: all.length, inWindow: win.length, flagged, withEvidence, required: MIN_RECORDS, value };
    if (value !== null) {
      const evidenceShare = withEvidence / win.length;
      indicators.push({ code: def.indicator, label: def.label, value, n: win.length, flagged, evidenceShare: Math.round(evidenceShare * 100) / 100, methodQuality: Math.round((0.5 + 0.5 * evidenceShare) * 100) / 100, latest: win.map((r) => r.date).sort().pop() ?? null, denominator: def.denominator });
    }
  }
  const latestNet = nets.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).pop();
  let network: RegisterSummary['network'] = null;
  if (latestNet) {
    const k = latestNet.actors.length;
    const possible = (k * (k - 1)) / 2;
    const density = possible ? Math.round((latestNet.links.length / possible) * 1000) / 10 : 0;
    const deg = latestNet.actors.map((actor, i) => ({ actor, degree: latestNet.links.filter(([a, b]) => a === i || b === i).length })).sort((a, b) => b.degree - a.degree);
    const assessedAt = latestNet.assessedAt ?? latestNet.receivedAt.slice(0, 10);
    network = { id: latestNet.id, actors: latestNet.actors, links: latestNet.links, density, possible, assessedBy: latestNet.assessedBy, assessedAt, centrality: deg };
    if (k >= MIN_ACTORS) indicators.push({ code: 'G3', label: 'هماهنگی نهادی', value: density, n: k, flagged: latestNet.links.length, evidenceShare: 0, methodQuality: 0.7, latest: assessedAt, denominator: 'پیوندهای ممکن میان نهادها' });
  }
  return {
    neighborhoodId,
    records: recs.slice(-300).reverse().map((r) => ({ id: r.id, kind: r.kind, title: r.title, date: r.date, flag: r.flag, evidenceRef: r.evidenceRef, recordedBy: r.recordedBy, receivedAt: r.receivedAt, inWindow: inWin(r.date) })),
    byKind, network, indicators,
  };
}
