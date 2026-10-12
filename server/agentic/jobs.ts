/** ثبت گردانندهٔ کارهای صف: گراف تک‌محله، دستهٔ شهری و دستیار عامل‌محور */
import crypto from 'node:crypto';
import { getJobQueue, type JobQueue } from './jobQueue';
import { createQueuedRun, loadRun, runStandardGraph, saveRun, type AgenticRun } from './pipeline';
import { createBatch, loadBatch, runBatch, saveBatch } from './batch';
import { createSession, loadSession, runCopilot, saveSession } from './copilot';
import { createResearch, loadResearch, runResearch, saveResearch, type ResearchRecord } from './research/research';

let wired = false;
export function wireJobs(q: JobQueue = getJobQueue()): JobQueue {
  if (wired) return q;
  wired = true;
  q.register('graph', async (job, ctl) => {
    const runId = job.ref.runId;
    const r = await runStandardGraph(job.payload as AgenticRun['input'], { runId, jobId: job.jobId, isCancelled: ctl.isCancelled });
    if (r.status === 'failed') throw new Error(r.steps.find((s) => s.status === 'failed')?.error ?? 'اجرای گراف ناموفق بود');
    return { runId: r.runId };
  });
  q.register('batch', async (job, ctl) => {
    const b = await runBatch(job.ref.batchId, ctl.isCancelled);
    if (b.status === 'failed') throw new Error('اجرای دسته ناموفق بود');
    return { batchId: b.batchId };
  });
  q.register('copilot', async (job, ctl) => {
    const s = await runCopilot(job.ref.sessionId, { isCancelled: ctl.isCancelled });
    if (s.status === 'failed') throw new Error(s.error ?? 'دستیار ناموفق بود');
    return { sessionId: s.sessionId };
  });
  q.register('research', async (job, ctl) => {
    const r = await runResearch(job.ref.researchId, { isCancelled: ctl.isCancelled });
    if (r.status === 'failed') throw new Error(r.error ?? 'پژوهش ناموفق بود');
    return { researchId: r.researchId };
  });
  q.recover();
  return q;
}

const newJobId = () => `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

/** گراف تک‌محله به‌صورت ناهمگام: رکورد «در صف» بلافاصله ساخته می‌شود */
export function enqueueGraph(input: AgenticRun['input']): { jobId: string; runId: string } {
  const q = wireJobs();
  const jobId = newJobId();
  const run = createQueuedRun(input, jobId);
  q.enqueue('graph', input as Record<string, unknown>, { jobId, ref: { runId: run.runId }, label: `تحلیل ${input.name ?? input.neighborhoodId ?? ''}`.trim(), maxAttempts: 1 });
  return { jobId, runId: run.runId };
}

export function enqueueBatch(city: string, opts: { offline?: boolean; limit?: number } = {}): { jobId: string; batchId: string; total: number } {
  const q = wireJobs();
  const jobId = newJobId();
  const b = createBatch(city, { ...opts, jobId });
  q.enqueue('batch', { city, ...opts }, { jobId, ref: { batchId: b.batchId }, label: `دستهٔ ${b.city} (${b.total})`, maxAttempts: 3 });
  return { jobId, batchId: b.batchId, total: b.total };
}

export function enqueueCopilot(question: string, offline: boolean): { jobId: string; sessionId: string } {
  const q = wireJobs();
  const jobId = newJobId();
  const s = createSession(question, offline, jobId);
  q.enqueue('copilot', { question: s.question, offline }, { jobId, ref: { sessionId: s.sessionId }, label: `دستیار: ${s.question.slice(0, 40)}`, maxAttempts: 1 });
  return { jobId, sessionId: s.sessionId };
}

/** پژوهش خودکار (فاز ۳): شکاف داده → کشف منبع → حافظهٔ اسناد */
export function enqueueResearch(input: ResearchRecord['input']): { jobId: string; researchId: string } {
  const q = wireJobs();
  const jobId = newJobId();
  const r = createResearch(input, jobId);
  q.enqueue('research', input as Record<string, unknown>, { jobId, ref: { researchId: r.researchId }, label: `پژوهش ${input.name ?? input.neighborhoodId ?? ''}`.trim(), maxAttempts: 1 });
  return { jobId, researchId: r.researchId };
}

/** لغو کار و هم‌گام‌سازی وضعیت رکورد وابسته وقتی هنوز در صف بوده */
export function cancelJob(jobId: string) {
  const q = wireJobs();
  const j = q.cancel(jobId);
  if (j && j.status === 'cancelled') {
    if (j.ref.runId) { const r = loadRun(j.ref.runId); if (r && r.status === 'queued') { r.status = 'cancelled'; saveRun(r); } }
    if (j.ref.batchId) { const b = loadBatch(j.ref.batchId); if (b && b.status === 'queued') { b.status = 'cancelled'; saveBatch(b); } }
    if (j.ref.researchId) { const r = loadResearch(j.ref.researchId); if (r && r.status === 'queued') { r.status = 'cancelled'; saveResearch(r); } }
    if (j.ref.sessionId) { const s = loadSession(j.ref.sessionId); if (s && s.status === 'queued') { s.status = 'cancelled'; saveSession(s); } }
  }
  return j;
}

/** فقط برای آزمون */
export function _resetWiring(): void { wired = false; }
