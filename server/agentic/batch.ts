/**
 * اجرای دسته‌ای گراف استاندارد برای همهٔ محله‌های یک شهر (معیار پذیرش فاز ۲: ۳۹۱ محلهٔ تهران).
 * قابل ادامه: محله‌های انجام‌شده پس از قطعی یا تلاش دوباره تکرار نمی‌شوند. خلاصهٔ شهری و CSV تولید می‌شود.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';
import { neighborhoodsOfCity } from '../neighborhood/gazetteer';
import { CancelledError, runStandardGraph } from './pipeline';

export interface BatchItem {
  neighborhoodId: string; nameFa: string; status: 'pending' | 'done' | 'failed'; runId: string | null; runStatus: string | null;
  level: string | null; verdict: string | null; bottleneck: string | null; findings: string[]; pendingApprovals: number; durationMs: number; error: string | null;
}
export interface BatchRecord {
  schema: 'ara.agentic-batch.v1'; batchId: string; jobId: string | null; city: string; offline: boolean; createdAt: string; finishedAt: string | null;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; total: number; done: number; failed: number; items: BatchItem[];
  summary: { byLevel: Record<string, number>; byRunStatus: Record<string, number>; byVerdict: Record<string, number>; bottlenecks: Record<string, number>; findings: Record<string, number>; avgDurationMs: number };
}

function dir(): string { const d = path.join(serverDataDir(), 'agentic', 'batches'); fs.mkdirSync(d, { recursive: true }); return d; }
const file = (id: string) => path.join(dir(), `${id.replace(/[^\w-]/g, '_')}.json`);
export function saveBatch(b: BatchRecord): void { fs.writeFileSync(file(b.batchId), JSON.stringify(b)); }
export function loadBatch(id: string): BatchRecord | null { const f = file(id); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; }
export function listBatches(limit = 20): Array<Omit<BatchRecord, 'items'>> {
  return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => { try { const { items: _i, ...rest } = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) as BatchRecord; return rest; } catch { return null; } })
    .filter((x): x is Omit<BatchRecord, 'items'> => Boolean(x)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export function summarize(items: BatchItem[]): BatchRecord['summary'] {
  const inc = (m: Record<string, number>, k: string | null) => { if (k) m[k] = (m[k] ?? 0) + 1; };
  const s: BatchRecord['summary'] = { byLevel: {}, byRunStatus: {}, byVerdict: {}, bottlenecks: {}, findings: {}, avgDurationMs: 0 };
  const done = items.filter((i) => i.status === 'done');
  for (const i of done) { inc(s.byLevel, i.level); inc(s.byRunStatus, i.runStatus); inc(s.byVerdict, i.verdict); inc(s.bottlenecks, i.bottleneck); i.findings.forEach((f) => inc(s.findings, f)); }
  s.avgDurationMs = done.length ? Math.round(done.reduce((a, i) => a + i.durationMs, 0) / done.length) : 0;
  return s;
}

/** ایجاد رکورد دسته (محله‌های شهر از گزتیر) */
export function createBatch(city: string, opts: { offline?: boolean; limit?: number; jobId?: string | null } = {}): BatchRecord {
  const entries = neighborhoodsOfCity(city);
  if (!entries.length) throw new Error(`شهر «${city}» در گزتیر محله‌ای ندارد`);
  const list = opts.limit ? entries.slice(0, opts.limit) : entries;
  const b: BatchRecord = {
    schema: 'ara.agentic-batch.v1', batchId: `batch_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, jobId: opts.jobId ?? null, city: entries[0].cityFa, offline: Boolean(opts.offline),
    createdAt: new Date().toISOString(), finishedAt: null, status: 'queued', total: list.length, done: 0, failed: 0,
    items: list.map((e) => ({ neighborhoodId: e.neighborhoodId, nameFa: e.nameFa, status: 'pending', runId: null, runStatus: null, level: null, verdict: null, bottleneck: null, findings: [], pendingApprovals: 0, durationMs: 0, error: null })),
    summary: summarize([]),
  };
  saveBatch(b);
  return b;
}

/** اجرای دسته (ادامه از محله‌های باقی‌مانده) */
export async function runBatch(batchId: string, isCancelled: () => boolean = () => false, concurrency = Math.max(1, Number(process.env.ARA_AGENTIC_BATCH_CONCURRENCY || 2))): Promise<BatchRecord> {
  const b = loadBatch(batchId);
  if (!b) throw new Error('دسته یافت نشد');
  b.status = 'running'; saveBatch(b);
  const pending = b.items.filter((i) => i.status !== 'done');
  let cursor = 0;
  let lastSave = 0;
  const flush = (force = false) => {
    b.done = b.items.filter((i) => i.status === 'done').length; b.failed = b.items.filter((i) => i.status === 'failed').length;
    if (force || Date.now() - lastSave > 1000) { b.summary = summarize(b.items); saveBatch(b); lastSave = Date.now(); }
  };
  const worker = async () => {
    while (cursor < pending.length) {
      if (isCancelled()) throw new CancelledError();
      const item = pending[cursor++];
      const t0 = Date.now();
      try {
        const run = await runStandardGraph({ neighborhoodId: item.neighborhoodId, offline: b.offline });
        const critic = run.outputs.critic as { verdict?: string } | undefined;
        const bn = run.outputs.bottleneck as { available?: boolean; bottleneck?: { capital: string; transition: string[] } } | undefined;
        Object.assign(item, {
          status: run.status === 'failed' ? 'failed' : 'done', runId: run.runId, runStatus: run.status, level: run.level, verdict: critic?.verdict ?? null,
          bottleneck: bn?.available && bn.bottleneck ? `${bn.bottleneck.capital}:${bn.bottleneck.transition.join('>')}` : null,
          findings: (run.outputs.findings ?? []).map((f) => f.id), pendingApprovals: run.approvals.filter((a) => a.status === 'pending').length,
          durationMs: Date.now() - t0, error: run.status === 'failed' ? run.steps.find((s) => s.status === 'failed')?.error ?? 'ناموفق' : null,
        } satisfies Partial<BatchItem>);
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        Object.assign(item, { status: 'failed', durationMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
      }
      flush();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length || 1) }, worker));
    b.status = 'completed';
  } catch (e) {
    b.status = e instanceof CancelledError ? 'cancelled' : 'failed';
  }
  b.finishedAt = new Date().toISOString();
  flush(true);
  return b;
}

export function batchCsv(b: BatchRecord): string {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['neighborhoodId', 'nameFa', 'status', 'runStatus', 'level', 'criticVerdict', 'bottleneck', 'findings', 'pendingApprovals', 'durationMs', 'runId', 'error'];
  const rows = b.items.map((i) => [i.neighborhoodId, i.nameFa, i.status, i.runStatus, i.level, i.verdict, i.bottleneck, i.findings.join(' '), i.pendingApprovals, i.durationMs, i.runId, i.error].map(esc).join(','));
  return `\uFEFF${head.join(',')}\n${rows.join('\n')}\n`;
}
