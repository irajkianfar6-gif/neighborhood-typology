/** ثبت مسیر اجرا: هر فراخوانی ابزار با عامل، هش ورودی/خروجی، زمان و نتیجه (برای ممیزی و بازتولید) */
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';

export interface TraceEntry {
  callId: string; at: string; runId: string | null; agentId: string; tool: string; via: 'rest' | 'mcp' | 'pipeline' | 'internal';
  ok: boolean; errorCode: string | null; durationMs: number; inputHash: string; outputHash: string | null; summary: string;
}

const RING: TraceEntry[] = [];
const RING_MAX = 1000;

function traceFile(): string {
  const dir = path.join(serverDataDir(), 'agentic');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'trace.jsonl');
}

export function recordTrace(e: TraceEntry): void {
  RING.push(e);
  if (RING.length > RING_MAX) RING.splice(0, RING.length - RING_MAX);
  try { fs.appendFileSync(traceFile(), `${JSON.stringify(e)}\n`); } catch { /* ثبت فایل اختیاری است */ }
}

export function listTrace(filter: { runId?: string; agentId?: string; tool?: string; limit?: number } = {}): TraceEntry[] {
  const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
  return RING.filter((e) => (!filter.runId || e.runId === filter.runId) && (!filter.agentId || e.agentId === filter.agentId) && (!filter.tool || e.tool === filter.tool)).slice(-limit).reverse();
}

export function traceStats(): { calls: number; errors: number; byTool: Record<string, { calls: number; errors: number; avgMs: number }> } {
  const byTool: Record<string, { calls: number; errors: number; avgMs: number }> = {};
  for (const e of RING) {
    const t = (byTool[e.tool] ??= { calls: 0, errors: 0, avgMs: 0 });
    t.avgMs = Math.round((t.avgMs * t.calls + e.durationMs) / (t.calls + 1));
    t.calls += 1; if (!e.ok) t.errors += 1;
  }
  return { calls: RING.length, errors: RING.filter((e) => !e.ok).length, byTool };
}

export function _resetTrace(): void { RING.length = 0; }
