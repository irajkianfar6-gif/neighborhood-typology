/**
 * داشبورد عامل‌ها (A14) — DASH-v1: معیارهای عملیاتی هر عامل و هر ابزار از ردگیری اجرا،
 * وضعیت صف کار و شمار دارایی‌های پژوهشی (پژوهش، کارت منبع، سند، حافظه). فقط‌خواندنی.
 */
import { listTrace, type TraceEntry } from './trace';
import { AGENTS } from './agents';
import { getJobQueue } from './jobQueue';
import { listResearch } from './research/research';
import { listCards } from './research/discovery';
import { listDocuments } from './research/documents';
import { memoryStats } from './research/memory';

export const DASHBOARD_VERSION = 'DASH-v1';
export interface Metric { calls: number; errors: number; errorRate: number; avgMs: number; p95Ms: number; lastAt: string | null }

function metric(es: TraceEntry[]): Metric {
  const ms = es.map((e) => e.durationMs).sort((a, b) => a - b);
  const errors = es.filter((e) => !e.ok).length;
  return {
    calls: es.length, errors, errorRate: es.length ? Math.round((errors / es.length) * 1000) / 1000 : 0,
    avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0,
    p95Ms: ms.length ? ms[Math.min(ms.length - 1, Math.ceil(ms.length * 0.95) - 1)] : 0,
    lastAt: es.reduce<string | null>((m, e) => (!m || e.at > m ? e.at : m), null),
  };
}
const group = (es: TraceEntry[], k: (e: TraceEntry) => string) => { const m = new Map<string, TraceEntry[]>(); for (const e of es) { const g = m.get(k(e)) ?? []; g.push(e); m.set(k(e), g); } return m; };
const safe = <T>(f: () => T, d: T): T => { try { return f(); } catch { return d; } };

export function agentDashboard(opts: { limit?: number } = {}) {
  const es = listTrace({ limit: Math.max(1, Math.min(500, opts.limit ?? 500)) });
  const byAgent = group(es, (e) => e.agentId); const byTool = group(es, (e) => e.tool);
  const agents = AGENTS.map((a) => ({ id: a.id, nameFa: a.nameFa, status: a.status, autonomy: a.autonomy, tools: a.tools.length, ...metric(byAgent.get(a.id) ?? []) }));
  const tools = [...byTool].map(([tool, g]) => ({ tool, ...metric(g), topErrors: Object.entries(group(g.filter((e) => !e.ok), (e) => e.errorCode ?? 'ERROR')).map(([code, x]) => ({ code, n: x.length })).sort((a, b) => b.n - a.n).slice(0, 3) }))
    .sort((a, b) => b.calls - a.calls);
  const research = safe(() => listResearch(200), []);
  const cards = safe(() => listCards(), []);
  return {
    version: DASHBOARD_VERSION, generatedAt: new Date().toISOString(), window: es.length,
    totals: metric(es), agents, tools,
    recentErrors: es.filter((e) => !e.ok).slice(0, 10).map((e) => ({ at: e.at, agentId: e.agentId, tool: e.tool, errorCode: e.errorCode, summary: e.summary })),
    jobs: safe(() => getJobQueue().stats() as Record<string, number>, {}),
    assets: {
      research: research.length, researchDone: research.filter((r) => r.status === 'done').length,
      sourceCards: cards.length, sourceCardsByStatus: cards.reduce<Record<string, number>>((m, c) => { m[c.status] = (m[c.status] ?? 0) + 1; return m; }, {}),
      documents: safe(() => listDocuments(1000).length, 0), memory: safe(() => memoryStats(), null),
    },
  };
}
