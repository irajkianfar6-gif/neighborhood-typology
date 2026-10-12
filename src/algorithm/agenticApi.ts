/** کلاینت API فریمورک ایجنتیک (/api/agentic): ابزارها، عامل‌ها، گراف استاندارد، تأییدها و مسیر اجرا */
import { apiUrl } from './realDataConnectors';

export interface AgenticToolInfo {
  name: string; title: string; description: string; category: string; timeoutMs: number;
  inputSchema: { properties?: Record<string, { type?: string | string[]; description?: string; enum?: unknown[]; default?: unknown }>; required?: string[] };
  annotations: { readOnlyHint: boolean; openWorldHint: boolean; idempotentHint: boolean };
}
export interface AgenticAgent { id: string; nameFa: string; mission: string; status: 'active' | 'planned'; autonomy: string; tools: string[]; humanApproval: string[]; phase: number }
export interface AgenticInfo {
  versions: Record<string, string>; mcp: { endpoint: string; transport: string; protocolVersions: string[]; agentHeader: string };
  tools: number; agents: number; activeAgents: number; llm?: { configured: boolean; model: string | null }; queue?: Record<string, number>; stats: { calls: number; errors: number; byTool: Record<string, { calls: number; errors: number; avgMs: number }> };
}
export interface AgenticRunStep { id: string; title: string; agentId: string; tool: string; status: 'done' | 'failed' | 'skipped'; durationMs: number; summary: string; error?: string }
export interface AgenticRunGate { id: string; title: string; status: 'passed' | 'warning' | 'blocked' | 'pending'; detail: string }
export interface AgenticRunApproval { id: string; kind: string; title: string; status: 'pending' | 'approved' | 'rejected'; decidedAt?: string; note?: string; payload?: unknown }
export interface AgenticRun {
  runId: string; graph: string; createdAt: string; finishedAt: string | null; status: 'queued' | 'running' | 'completed' | 'needs_user' | 'blocked' | 'failed' | 'cancelled';
  neighborhoodId: string | null; nameFa: string | null; analysisId: string | null; level: string | null;
  steps: AgenticRunStep[]; gates: AgenticRunGate[]; approvals: AgenticRunApproval[];
  outputs: { candidates?: Array<{ neighborhoodId: string; nameFa: string; cityFa: string; districtFa?: string; confidence?: number }>; critic?: { verdict: string; checks: Array<{ id: string; title: string; status: string; detail: string }> }; report?: string; officialReport?: string | null; reproducibilityKey?: Record<string, string> };
}
export interface AgenticRunSummary { runId: string; createdAt: string; status: AgenticRun['status']; neighborhoodId: string | null; nameFa: string | null; level: string | null; pendingApprovals: number }
export interface ToolCallResponse { ok: boolean; callId: string; durationMs: number; summary: string; output?: unknown; error?: { code: string; message: string; details?: unknown } }

export interface AgenticJob { jobId: string; kind: 'graph' | 'batch' | 'copilot'; status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; createdAt: string; startedAt: string | null; finishedAt: string | null; attempts: number; maxAttempts: number; ref: Record<string, string>; error: string | null; label: string }
export interface BatchItem { neighborhoodId: string; nameFa: string; status: 'pending' | 'done' | 'failed'; runId: string | null; runStatus: string | null; level: string | null; verdict: string | null; bottleneck: string | null; findings: string[]; pendingApprovals: number; durationMs: number; error: string | null }
export interface BatchSummary { byLevel: Record<string, number>; byRunStatus: Record<string, number>; byVerdict: Record<string, number>; bottlenecks: Record<string, number>; findings: Record<string, number>; avgDurationMs: number }
export interface BatchRecord { batchId: string; jobId: string | null; city: string; offline: boolean; createdAt: string; finishedAt: string | null; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; total: number; done: number; failed: number; items?: BatchItem[]; summary: BatchSummary }
export interface CopilotStep { i: number; thought: string; agent: string | null; tool: string | null; ok: boolean; summary: string; callId: string | null; error?: string }
export interface CopilotSession { sessionId: string; jobId: string | null; question: string; offline: boolean; createdAt: string; finishedAt: string | null; mode: 'llm' | 'deterministic_fallback'; model: string | null; status: 'queued' | 'running' | 'answered' | 'answered_with_warnings' | 'failed' | 'cancelled'; steps: CopilotStep[]; answer: string | null; usedCalls: string[]; grounding: { checked: number; ungrounded: string[]; revised: boolean } | null; runId: string | null; error: string | null }

async function call<T>(path: string, init?: RequestInit, timeoutMs = 300_000): Promise<T> {
  const response = await fetch(apiUrl(path), { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!response.ok || !payload?.success) {
    const e = new Error(payload?.error?.message ?? `درخواست با کد ${response.status} ناموفق بود.`) as Error & { details?: unknown; code?: string };
    e.details = payload?.error?.details; e.code = payload?.error?.code;
    throw e;
  }
  return payload.data as T;
}

export const agenticApi = {
  info: () => call<AgenticInfo>('/api/agentic/info'),
  tools: () => call<AgenticToolInfo[]>('/api/agentic/tools'),
  agents: () => call<AgenticAgent[]>('/api/agentic/agents'),
  runs: () => call<AgenticRunSummary[]>('/api/agentic/runs'),
  run: (id: string) => call<AgenticRun>(`/api/agentic/runs/${encodeURIComponent(id)}`),
  start: (input: { name?: string; city?: string; neighborhoodId?: string; offline?: boolean }) => call<AgenticRun>('/api/agentic/runs', { method: 'POST', body: JSON.stringify(input) }),
  decide: (runId: string, approvalId: string, decision: 'approved' | 'rejected', note?: string) => call<AgenticRun>(`/api/agentic/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`, { method: 'POST', body: JSON.stringify({ decision, note }) }),
  job: (id: string) => call<AgenticJob>(`/api/agentic/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) => call<AgenticJob>(`/api/agentic/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  startBatch: (input: { city: string; offline?: boolean; limit?: number }) => call<{ jobId: string; batchId: string; total: number }>('/api/agentic/batches', { method: 'POST', body: JSON.stringify(input) }),
  batches: () => call<BatchRecord[]>('/api/agentic/batches'),
  batch: (id: string) => call<BatchRecord>(`/api/agentic/batches/${encodeURIComponent(id)}`),
  batchCsvUrl: (id: string) => apiUrl(`/api/agentic/batches/${encodeURIComponent(id)}/csv`),
  ask: (question: string, offline: boolean) => call<{ jobId: string; sessionId: string }>('/api/agentic/copilot', { method: 'POST', body: JSON.stringify({ question, offline }) }),
  sessions: () => call<Array<Pick<CopilotSession, 'sessionId' | 'question' | 'status' | 'mode' | 'createdAt'>>>('/api/agentic/copilot'),
  session: (id: string) => call<CopilotSession>(`/api/agentic/copilot/${encodeURIComponent(id)}`),
  callTool: (name: string, agentId: string, input: unknown) => call<ToolCallResponse>(`/api/agentic/tools/${encodeURIComponent(name)}/call`, { method: 'POST', body: JSON.stringify({ agentId, input }) }),
};
