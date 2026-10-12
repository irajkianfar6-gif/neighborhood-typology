/**
 * گراف وظایف استاندارد (GRAPH-v1) — اجرای کامل «از نام محله تا گزارش» با عامل‌های فعال و دروازه‌های کیفیت.
 * این اجراکننده قطعی است (بدون مدل زبانی) و همان قرارداد ابزارها را به کار می‌برد که عامل‌های مبتنی بر LLM
 * در فازهای بعد به کار خواهند برد؛ بنابراین خروجی آن مبنای مقایسه و آزمون عامل‌های هوشمند است.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';
import { callTool, type ToolCallResult } from './registry';

export const GRAPH_VERSION = 'GRAPH-v1';
export class CancelledError extends Error { constructor() { super('اجرا لغو شد'); } }

export interface RunStep { id: string; title: string; agentId: string; tool: string; status: 'done' | 'failed' | 'skipped'; startedAt: string; durationMs: number; summary: string; callId: string | null; error?: string }
export interface RunGate { id: 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6'; title: string; status: 'passed' | 'warning' | 'blocked' | 'pending'; detail: string }
export interface RunApproval { id: string; kind: 'neighborhood_choice' | 'official_publication' | 'prescription'; title: string; status: 'pending' | 'approved' | 'rejected'; decidedAt?: string; note?: string; payload?: unknown }
export interface AgenticRun {
  schema: 'ara.agentic-run.v1'; runId: string; graph: string; createdAt: string; finishedAt: string | null;
  input: { name?: string; city?: string; neighborhoodId?: string; offline?: boolean; useKernel?: boolean; purpose?: string };
  status: 'queued' | 'running' | 'completed' | 'needs_user' | 'blocked' | 'failed' | 'cancelled';
  jobId?: string | null;
  neighborhoodId: string | null; nameFa: string | null; analysisId: string | null; level: string | null;
  steps: RunStep[]; gates: RunGate[]; approvals: RunApproval[];
  outputs: { candidates?: unknown[]; findings?: Array<{ id: string; title: string; severity: string }>; critic?: unknown; report?: string; officialReport?: string | null; interventions?: unknown; bottleneck?: unknown; reproducibilityKey?: unknown };
}

function runsDir(): string { const d = path.join(serverDataDir(), 'agentic', 'runs'); fs.mkdirSync(d, { recursive: true }); return d; }
const runFile = (id: string) => path.join(runsDir(), `${id.replace(/[^\w-]/g, '_')}.json`);
export function saveRun(r: AgenticRun): void { fs.writeFileSync(runFile(r.runId), JSON.stringify(r, null, 1)); }
export function loadRun(id: string): AgenticRun | null { const f = runFile(id); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; }
export function listRuns(limit = 30): Array<Pick<AgenticRun, 'runId' | 'createdAt' | 'status' | 'neighborhoodId' | 'nameFa' | 'level'> & { pendingApprovals: number }> {
  return fs.readdirSync(runsDir()).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir(), f), 'utf8')) as AgenticRun; } catch { return null; } })
    .filter((r): r is AgenticRun => Boolean(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
    .map((r) => ({ runId: r.runId, createdAt: r.createdAt, status: r.status, neighborhoodId: r.neighborhoodId, nameFa: r.nameFa, level: r.level, pendingApprovals: r.approvals.filter((a) => a.status === 'pending').length }));
}

export function decideApproval(runId: string, approvalId: string, decision: 'approved' | 'rejected', note?: string): AgenticRun | null {
  const r = loadRun(runId);
  if (!r) return null;
  const a = r.approvals.find((x) => x.id === approvalId);
  if (!a || a.status !== 'pending') return r;
  a.status = decision; a.decidedAt = new Date().toISOString(); if (note) a.note = note.slice(0, 1000);
  if (a.kind === 'official_publication') { const g = r.gates.find((x) => x.id === 'G5'); if (g) { g.status = decision === 'approved' ? 'passed' : 'blocked'; g.detail += decision === 'approved' ? ' — انتشار رسمی تأیید شد' : ' — انتشار رسمی رد شد'; } }
  if (a.kind === 'prescription') { const g = r.gates.find((x) => x.id === 'G6'); if (g) { g.status = decision === 'approved' ? 'passed' : 'blocked'; g.detail = decision === 'approved' ? 'تجویز توسط کارشناس تصویب شد' : 'تجویز رد شد'; } }
  saveRun(r);
  return r;
}

export function newRunId(): string { return `run_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`; }

/** رکورد اجرای «در صف» برای اجرای ناهمگام (پیش از برداشتن توسط کارگر صف) */
export function createQueuedRun(input: AgenticRun['input'], jobId: string | null): AgenticRun {
  const run: AgenticRun = { schema: 'ara.agentic-run.v1', runId: newRunId(), graph: GRAPH_VERSION, createdAt: new Date().toISOString(), finishedAt: null, input, status: 'queued', jobId, neighborhoodId: input.neighborhoodId ?? null, nameFa: null, analysisId: null, level: null, steps: [], gates: [], approvals: [], outputs: {} };
  saveRun(run);
  return run;
}

export interface GraphControl { runId?: string; jobId?: string | null; isCancelled?: () => boolean }

export async function runStandardGraph(input: AgenticRun['input'], control: GraphControl = {}): Promise<AgenticRun> {
  const prior = control.runId ? loadRun(control.runId) : null;
  const run: AgenticRun = {
    schema: 'ara.agentic-run.v1', runId: control.runId ?? newRunId(), graph: GRAPH_VERSION, jobId: control.jobId ?? null,
    createdAt: prior?.createdAt ?? new Date().toISOString(), finishedAt: null, input, status: 'running', neighborhoodId: input.neighborhoodId ?? null, nameFa: null, analysisId: null, level: null,
    steps: [], gates: [], approvals: [], outputs: {},
  };
  const opts = { offline: Boolean(input.offline), useKernel: input.useKernel === true };
  const step = async (id: string, title: string, agentId: string, tool: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    if (control.isCancelled?.()) throw new CancelledError();
    const startedAt = new Date().toISOString();
    const r = await callTool(tool, args, { agentId, runId: run.runId, via: 'pipeline' });
    run.steps.push({ id, title, agentId, tool, status: r.ok ? 'done' : 'failed', startedAt, durationMs: r.durationMs, summary: r.summary, callId: r.callId, ...(r.ok ? {} : { error: `${r.error?.code}: ${r.error?.message}` }) });
    saveRun(run);
    return r;
  };
  const end = (status: AgenticRun['status']) => { run.gates.sort((a, b) => a.id.localeCompare(b.id)); run.status = status; run.finishedAt = new Date().toISOString(); saveRun(run); return run; };
  saveRun(run);

  try {
    // ۱) A1 — شناسایی (G1)
    if (!run.neighborhoodId) {
      const r = await step('S1', 'شناسایی محله از نام', 'A1', 'resolve_neighborhood', { name: input.name ?? '', ...(input.city ? { city: input.city } : {}) });
      if (!r.ok) { run.gates.push({ id: 'G1', title: 'هویت محله', status: 'blocked', detail: r.error?.message ?? '' }); return end('failed'); }
      const o = r.output as { best: { neighborhoodId: string; nameFa: string; confidence?: number } | null; requiresUserChoice: boolean; candidates: unknown[]; reason: string | null };
      if (!o.best || o.requiresUserChoice) {
        run.gates.push({ id: 'G1', title: 'هویت محله', status: 'blocked', detail: o.best ? 'نام مبهم است یا اطمینان کم؛ انتخاب کاربر لازم است' : `محله یافت نشد (${o.reason ?? ''})` });
        run.outputs.candidates = o.candidates;
        if (o.best) run.approvals.push({ id: 'AP-G1', kind: 'neighborhood_choice', title: 'انتخاب محلهٔ درست از میان نامزدها', status: 'pending', payload: o.candidates });
        return end(o.best ? 'needs_user' : 'failed');
      }
      run.neighborhoodId = o.best.neighborhoodId;
      run.gates.push({ id: 'G1', title: 'هویت محله', status: 'passed', detail: `${o.best.nameFa} — اطمینان ${o.best.confidence ?? '—'}` });
    } else {
      run.gates.push({ id: 'G1', title: 'هویت محله', status: 'passed', detail: 'شناسهٔ محله مستقیم داده شد' });
    }
    const nb = run.neighborhoodId!;
    const prof = await step('S2', 'شناسنامه و مرز رسمی', 'A1', 'get_neighborhood_profile', { neighborhoodId: nb });
    if (!prof.ok) { run.gates[0].status = 'blocked'; run.gates[0].detail = prof.error?.message ?? ''; return end('failed'); }
    run.nameFa = (prof.output!.neighborhood as { nameFa: string }).nameFa;
    await step('S3', 'بافت جمعیتی و مکانی', 'A1', 'build_context', { neighborhoodId: nb, ...opts });

    // ۲) A3 — گردآوری ؛ A6 — کیفیت (G2/G3)
    const col = await step('S4', 'گردآوری شواهد از همهٔ کانال‌ها', 'A3', 'collect_evidence', { neighborhoodId: nb, ...opts });
    const qa = await step('S5', 'ارزیابی کیفیت، منشأ و استقلال', 'A6', 'assess_evidence', { neighborhoodId: nb, ...opts });
    if (col.ok && qa.ok) {
      const q = qa.output as { scored: number; reliable: number; usable: number; conflicts: unknown[]; independence: { sharedGroups: Array<{ group: string; indicators: string[] }> } };
      run.gates.push({ id: 'G2', title: 'پوشش شواهد', status: q.reliable > 0 ? 'passed' : q.usable > 0 ? 'warning' : 'blocked', detail: `${q.scored} شاخص امتیازدار؛ ${q.reliable} قابل اتکا؛ ${q.usable} قابل استفاده` });
      const shared = q.independence.sharedGroups.map((g) => `${g.indicators.join('،')} (${g.group})`);
      run.gates.push({ id: 'G3', title: 'کیفیت و استقلال', status: q.conflicts.length || shared.length ? 'warning' : 'passed', detail: [q.conflicts.length ? `${q.conflicts.length} تضاد منبع` : 'بدون تضاد', shared.length ? `شواهد وابسته: ${shared.join('؛ ')}` : 'شواهد مستقل'].join(' · ') });
    } else {
      run.gates.push({ id: 'G2', title: 'پوشش شواهد', status: 'blocked', detail: col.error?.message ?? qa.error?.message ?? 'گردآوری ناموفق' });
    }

    // ۳) A7 — سنجهٔ قطعی
    const an = await step('S6', 'اجرای موتور سنجه (قطعی)', 'A7', 'run_analysis', { neighborhoodId: nb, ...opts, purpose: input.purpose ?? 'baseline' });
    if (!an.ok) return end('failed');
    const analysisId = String(an.output!.analysisId);
    run.analysisId = analysisId; run.level = String(an.output!.level);
    run.outputs.reproducibilityKey = an.output!.reproducibilityKey;
    const g2 = run.gates.find((g) => g.id === 'G2');
    if (g2) { g2.detail += ` · سطح کارت: ${run.level}`; if (run.level === 'INSUFFICIENT') g2.status = 'blocked'; else if (run.level === 'PROVISIONAL' && g2.status === 'passed') g2.status = 'warning'; }
    const ref = { analysisId, neighborhoodId: nb, ...opts };

    // ۴) A9 — تشخیص (موازی)
    const [bn, , ll] = await Promise.all([
      step('S7', 'مکان‌یابی گلوگاه', 'A9', 'locate_bottleneck', ref),
      step('S8', 'آزمون فرضیه‌های علّی', 'A9', 'test_hypotheses', ref),
      step('S9', 'لایه‌های محله‌ای و یافته‌ها', 'A9', 'assess_local_layers', { analysisId, neighborhoodId: nb }),
    ]);
    if (bn.ok) run.outputs.bottleneck = bn.output;
    if (ll.ok && ll.output!.assessment) run.outputs.findings = ((ll.output!.assessment as { findings: Array<{ id: string; title: string; severity: string }> }).findings).map((f) => ({ id: f.id, title: f.title, severity: f.severity }));

    // ۵) A10 — تجویز (G6: تصویب انسانی)
    const mi = await step('S10', 'نگاشت به کتابخانهٔ مداخلات', 'A10', 'map_interventions', ref);
    if (mi.ok) {
      run.outputs.interventions = mi.output;
      const n = (mi.output!.engineInterventions as unknown[]).length + (mi.output!.layerPrescriptions as unknown[]).length;
      if (n) {
        run.approvals.push({ id: 'AP-G6', kind: 'prescription', title: `تصویب ${n} تجویز پیشنهادی`, status: 'pending' });
        run.gates.push({ id: 'G6', title: 'تصویب تجویز', status: 'pending', detail: 'تجویزها پیشنهادند و تا تصویب کارشناس اجرایی نمی‌شوند' });
      }
    }

    // ۶) A12 — نقاد (G4/G5)
    const cr = await step('S11', 'بازبینی نقاد', 'A12', 'verify_analysis', ref);
    let officialAllowed = false;
    if (cr.ok) {
      const c = cr.output as { verdict: string; checks: Array<{ id: string; status: string; title: string; detail: string }>; officialPublicationAllowed: boolean };
      run.outputs.critic = c;
      const fails = c.checks.filter((x) => x.status === 'fail');
      run.gates.push({ id: 'G4', title: 'سازگاری تشخیص با قواعد', status: fails.length ? 'blocked' : c.verdict === 'pass' ? 'passed' : 'warning', detail: fails.length ? fails.map((x) => `${x.id} ${x.title}`).join('؛ ') : `حکم نقاد: ${c.verdict}` });
      officialAllowed = c.officialPublicationAllowed;
      run.gates.push({ id: 'G5', title: 'انتشار رسمی', status: officialAllowed ? 'pending' : 'blocked', detail: officialAllowed ? 'کارت قابل انتشار و نقاد مجاز کرد؛ منتظر تأیید انسانی' : `فقط لایهٔ تحلیلی (سطح ${run.level}${fails.length ? '، نقاد رد کرد' : ''})` });
      if (officialAllowed) run.approvals.push({ id: 'AP-G5', kind: 'official_publication', title: 'تأیید انتشار رسمی گزارش', status: 'pending' });
    }

    // ۷) A13 — گزارش
    const rep = await step('S12', 'گزارش تحلیلی', 'A13', 'render_report', { ...ref, layer: 'analytical' });
    if (rep.ok) run.outputs.report = String(rep.output!.markdown);
    if (officialAllowed) {
      const off = await step('S13', 'گزارش رسمی (پیش‌نویس منتظر تأیید)', 'A13', 'render_report', { ...ref, layer: 'official' });
      run.outputs.officialReport = off.ok && off.output!.allowed ? String(off.output!.markdown) : null;
    }
    const blocked = run.gates.some((g) => g.id === 'G4' && g.status === 'blocked');
    return end(blocked ? 'blocked' : 'completed');
  } catch (error) {
    if (error instanceof CancelledError) return end('cancelled');
    run.steps.push({ id: 'SX', title: 'خطای پیش‌بینی‌نشده', agentId: 'A0', tool: '-', status: 'failed', startedAt: new Date().toISOString(), durationMs: 0, summary: '', callId: null, error: error instanceof Error ? error.message : String(error) });
    return end('failed');
  }
}
