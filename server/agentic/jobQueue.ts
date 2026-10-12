/**
 * صف کار پایدار (فایل‌محور، بدون وابستگی به Redis): اجراهای طولانی (گراف، دسته‌ای، دستیار LLM) در پس‌زمینه
 * با سقف هم‌زمانی، تلاش دوباره، لغو و بازیابی پس از راه‌اندازی دوبارهٔ سرور اجرا می‌شوند.
 * هر کار یک فایل JSON در server-data/agentic/jobs است؛ کار «در حال اجرا» پس از قطعی دوباره در صف قرار می‌گیرد.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';

export type JobKind = 'graph' | 'batch' | 'copilot' | 'research';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface Job {
  jobId: string; kind: JobKind; status: JobStatus; createdAt: string; startedAt: string | null; finishedAt: string | null;
  attempts: number; maxAttempts: number; payload: Record<string, unknown>; ref: Record<string, string>;
  cancelRequested: boolean; error: string | null; label: string;
}
export interface JobControl { isCancelled: () => boolean; update: (ref: Record<string, string>) => void }
export type JobHandler = (job: Job, ctl: JobControl) => Promise<Record<string, string> | void>;

function jobsDir(): string { const d = path.join(serverDataDir(), 'agentic', 'jobs'); fs.mkdirSync(d, { recursive: true }); return d; }

export class JobQueue {
  private handlers = new Map<JobKind, JobHandler>();
  private running = new Set<string>();
  private recovered = false;
  constructor(public concurrency = Math.max(1, Number(process.env.ARA_AGENTIC_CONCURRENCY || 2))) {}

  register(kind: JobKind, handler: JobHandler): void { this.handlers.set(kind, handler); }

  private file(id: string) { return path.join(jobsDir(), `${id.replace(/[^\w-]/g, '_')}.json`); }
  save(j: Job): void { fs.writeFileSync(this.file(j.jobId), JSON.stringify(j)); }
  get(id: string): Job | null { const f = this.file(id); try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch { return null; } }
  list(filter: { kind?: JobKind; limit?: number } = {}): Job[] {
    return fs.readdirSync(jobsDir()).filter((f) => f.endsWith('.json')).map((f) => this.get(f.slice(0, -5))).filter((j): j is Job => Boolean(j))
      .filter((j) => !filter.kind || j.kind === filter.kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, filter.limit ?? 50);
  }
  stats(): Record<JobStatus, number> & { concurrency: number } {
    const s = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, concurrency: this.concurrency };
    for (const j of this.list({ limit: 10_000 })) s[j.status] += 1;
    return s;
  }

  enqueue(kind: JobKind, payload: Record<string, unknown>, opts: { label?: string; maxAttempts?: number; ref?: Record<string, string>; jobId?: string } = {}): Job {
    const j: Job = { jobId: opts.jobId ?? `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, kind, status: 'queued', createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, attempts: 0, maxAttempts: opts.maxAttempts ?? 2, payload, ref: opts.ref ?? {}, cancelRequested: false, error: null, label: opts.label ?? kind };
    this.save(j);
    setImmediate(() => this.pump());
    return j;
  }

  cancel(id: string): Job | null {
    const j = this.get(id);
    if (!j) return null;
    if (j.status === 'queued') { j.status = 'cancelled'; j.finishedAt = new Date().toISOString(); }
    else if (j.status === 'running') j.cancelRequested = true;
    this.save(j);
    return j;
  }

  /** کارهای نیمه‌کاره پس از راه‌اندازی دوباره به صف برمی‌گردند */
  recover(): number {
    if (this.recovered) return 0;
    this.recovered = true;
    let n = 0;
    for (const j of this.list({ limit: 10_000 })) if (j.status === 'running' && !this.running.has(j.jobId)) { j.status = 'queued'; j.error = 'بازیابی پس از راه‌اندازی دوبارهٔ سرور'; this.save(j); n += 1; }
    setImmediate(() => this.pump());
    return n;
  }

  pump(): void {
    if (this.running.size >= this.concurrency) return;
    const queued = this.list({ limit: 10_000 }).filter((j) => j.status === 'queued' && this.handlers.has(j.kind) && !this.running.has(j.jobId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const j of queued) {
      if (this.running.size >= this.concurrency) break;
      void this.execute(j.jobId);
    }
  }

  private async execute(id: string): Promise<void> {
    const j = this.get(id);
    if (!j || j.status !== 'queued') return;
    this.running.add(id);
    j.status = 'running'; j.startedAt = new Date().toISOString(); j.attempts += 1; this.save(j);
    const ctl: JobControl = {
      isCancelled: () => Boolean(this.get(id)?.cancelRequested),
      update: (ref) => { const cur = this.get(id); if (cur) { cur.ref = { ...cur.ref, ...ref }; this.save(cur); } },
    };
    try {
      const ref = await this.handlers.get(j.kind)!(j, ctl);
      const cur = this.get(id)!;
      cur.ref = { ...cur.ref, ...(ref ?? {}) };
      cur.status = cur.cancelRequested ? 'cancelled' : 'done'; cur.finishedAt = new Date().toISOString(); cur.error = null;
      this.save(cur);
    } catch (e) {
      const cur = this.get(id)!;
      cur.error = e instanceof Error ? e.message : String(e);
      if (cur.cancelRequested) cur.status = 'cancelled';
      else cur.status = cur.attempts < cur.maxAttempts ? 'queued' : 'failed';
      if (cur.status !== 'queued') cur.finishedAt = new Date().toISOString();
      this.save(cur);
    } finally {
      this.running.delete(id);
      setImmediate(() => this.pump());
    }
  }

  /** انتظار تا پایان یک کار (برای آزمون و فراخوانی همگام) */
  async waitFor(id: string, timeoutMs = 600_000): Promise<Job | null> {
    const t0 = Date.now();
    for (;;) {
      const j = this.get(id);
      if (!j || ['done', 'failed', 'cancelled'].includes(j.status)) return j;
      if (Date.now() - t0 > timeoutMs) return j;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

let singleton: JobQueue | null = null;
export function getJobQueue(): JobQueue { return (singleton ??= new JobQueue()); }
export function _resetJobQueue(): void { singleton = null; }
