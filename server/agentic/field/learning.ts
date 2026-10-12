/**
 * یادگیری و واسنجی (A14، فقط پیشنهاد) — LEARN-v1.
 * از نتایج کارزارهای میدانی، پایش مداخله‌ها و معیارهای عملیاتی، «پیشنهاد واسنجی» می‌سازد.
 * هیچ پیشنهادی خودکار اعمال نمی‌شود: تغییر قواعد، وزن‌ها یا کتابخانه فقط با تصمیم کارشناس و نسخهٔ تازهٔ قواعد.
 */
import { listCampaigns, campaignProgress } from './campaign';
import { listMonitoring } from './monitoring';
import { agentDashboard } from '../dashboard';
import { list, load, newId, save } from './store';

export const LEARNING_VERSION = 'LEARN-v1';
export const CALIBRATION_GAP = 15;
export type ProposalKind = 'tier_calibration' | 'collector_qc' | 'intervention_evidence' | 'tool_reliability';
export interface Proposal {
  id: string; version: string; createdAt: string; kind: ProposalKind; dedupeKey: string; title: string; detail: string;
  evidence: Record<string, unknown>; suggestedChange: string; status: 'proposed' | 'approved' | 'rejected';
  decidedBy: string | null; decidedAt: string | null; note: string | null;
}
type Draft = Omit<Proposal, 'id' | 'version' | 'createdAt' | 'status' | 'decidedBy' | 'decidedAt' | 'note'>;

export async function draftProposals(): Promise<Draft[]> {
  const out: Draft[] = [];
  // ۱) برآورد غیرمیدانی در برابر سنجش میدانی (تجمیع روی همهٔ کارزارهای بسته)
  const agg = new Map<string, { code: string; tier: string; diffs: number[]; nbs: string[] }>();
  for (const c of listCampaigns().filter((x) => x.status === 'closed' && x.outcome)) {
    for (const s of c.outcome!.surveyVsPrior) { const k = `${s.code}|${s.beforeTier}`; const v = agg.get(k) ?? { code: s.code, tier: s.beforeTier, diffs: [], nbs: [] }; v.diffs.push(s.diff); v.nbs.push(c.neighborhoodId); agg.set(k, v); }
  }
  for (const v of agg.values()) {
    const mean = v.diffs.reduce((a, b) => a + b, 0) / v.diffs.length;
    if (Math.abs(mean) < CALIBRATION_GAP) continue;
    out.push({ kind: 'tier_calibration', dedupeKey: `tier:${v.code}:${v.tier}:${v.diffs.length}`, title: `واسنجی برآورد ${v.code} (سطح ${v.tier})`,
      detail: `در ${v.diffs.length} محله، برآورد پیشین ${v.code} با سنجش میدانی به‌طور میانگین ${Math.round(mean * 10) / 10} امتیاز فاصله داشت.`,
      evidence: { code: v.code, tier: v.tier, diffs: v.diffs, neighborhoods: v.nbs, meanDiff: Math.round(mean * 10) / 10 },
      suggestedChange: v.diffs.length >= 3 ? `کاهش اعتبار سطح ${v.tier} برای ${v.code} یا بازبینی روش برآورد آن` : `پایش بیشتر: پیش از تغییر قاعده، دست‌کم ۳ محله لازم است` });
  }
  // ۲) پرسشگران با نرخ رد بالا در کارزارهای در حال اجرا یا بسته‌شده
  for (const c of listCampaigns().filter((x) => x.status === 'fielding' || x.status === 'closed')) {
    try { for (const col of (await campaignProgress(c.id)).collectors.filter((x) => x.flagged)) out.push({ kind: 'collector_qc', dedupeKey: `col:${c.id}:${col.collectorId}`, title: `بازبینی پرسشگر ${col.collectorId}`, detail: `نرخ رد ${Math.round(col.rejectionRate * 100)}٪ از ${col.received} پاسخ در کارزار ${c.nameFa}.`, evidence: { campaignId: c.id, ...col }, suggestedChange: 'بازآموزی پرسشگر یا بازبینی پاسخ‌های او پیش از بستن کارزار' }); } catch { /* محلهٔ حذف‌شده */ }
  }
  // ۳) مداخله‌هایی که پس از موعد اثر نشان نداده‌اند
  for (const m of listMonitoring()) {
    const ev = [...m.evaluations].reverse().find((x) => x.due);
    if (ev && (ev.overall === 'no_change' || ev.overall === 'worsened')) out.push({ kind: 'intervention_evidence', dedupeKey: `int:${m.id}:${ev.at}`, title: `بازبینی شواهد مداخلهٔ ${m.libraryId}`, detail: `«${m.name}» در ${m.nameFa} پس از موعد، شاخص‌های هدف را ${ev.overall === 'worsened' ? 'بدتر' : 'بدون تغییر'} نشان داد.`, evidence: { monitoringId: m.id, perTarget: ev.perTarget }, suggestedChange: 'بازبینی پیش‌نیازها و شواهد این مداخله در کتابخانه (نسخهٔ تازهٔ IL) یا بررسی کیفیت اجرا' });
  }
  // ۴) ابزارهای پرخطا
  for (const t of agentDashboard().tools.filter((x) => x.calls >= 5 && x.errorRate > 0.2)) out.push({ kind: 'tool_reliability', dedupeKey: `tool:${t.tool}:${t.calls}`, title: `پایداری ابزار ${t.tool}`, detail: `نرخ خطا ${Math.round(t.errorRate * 100)}٪ در ${t.calls} فراخوانی اخیر.`, evidence: { ...t }, suggestedChange: 'بررسی منبع داده یا ورودی‌های رایج خطا' });
  return out;
}

/** پیشنهادهای تازه را (بدون تکرار) ثبت می‌کند */
export async function generateProposals(): Promise<{ created: Proposal[]; total: number }> {
  const existing = new Set(list<Proposal>('proposals').map((p) => p.dedupeKey));
  const created: Proposal[] = [];
  for (const d of await draftProposals()) {
    if (existing.has(d.dedupeKey)) continue;
    created.push(save('proposals', { ...d, id: newId('cal'), version: LEARNING_VERSION, createdAt: new Date().toISOString(), status: 'proposed', decidedBy: null, decidedAt: null, note: null }));
    existing.add(d.dedupeKey);
  }
  return { created, total: list<Proposal>('proposals').length };
}
export const listProposals = (status?: Proposal['status']) => list<Proposal>('proposals', (p) => !status || p.status === status);
export function decideProposal(id: string, decision: 'approved' | 'rejected', by: string, note?: string): Proposal | null {
  const p = load<Proposal>('proposals', id); if (!p) return null;
  p.status = decision; p.decidedBy = by; p.decidedAt = new Date().toISOString(); p.note = note?.slice(0, 500) ?? null;
  return save('proposals', p);
}
