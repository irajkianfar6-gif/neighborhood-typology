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
  tools: number; agents: number; activeAgents: number; stats: { calls: number; errors: number; byTool: Record<string, { calls: number; errors: number; avgMs: number }> };
}
export interface AgenticRunStep { id: string; title: string; agentId: string; tool: string; status: 'done' | 'failed' | 'skipped'; durationMs: number; summary: string; error?: string }
export interface AgenticRunGate { id: string; title: string; status: 'passed' | 'warning' | 'blocked' | 'pending'; detail: string }
export interface AgenticRunApproval { id: string; kind: string; title: string; status: 'pending' | 'approved' | 'rejected'; decidedAt?: string; note?: string; payload?: unknown }
export interface AgenticRun {
  runId: string; graph: string; createdAt: string; finishedAt: string | null; status: 'running' | 'completed' | 'needs_user' | 'blocked' | 'failed';
  neighborhoodId: string | null; nameFa: string | null; analysisId: string | null; level: string | null;
  steps: AgenticRunStep[]; gates: AgenticRunGate[]; approvals: AgenticRunApproval[];
  outputs: { candidates?: Array<{ neighborhoodId: string; nameFa: string; cityFa: string; districtFa?: string; confidence?: number }>; critic?: { verdict: string; checks: Array<{ id: string; title: string; status: string; detail: string }> }; report?: string; officialReport?: string | null; reproducibilityKey?: Record<string, string> };
}
export interface AgenticRunSummary { runId: string; createdAt: string; status: AgenticRun['status']; neighborhoodId: string | null; nameFa: string | null; level: string | null; pendingApprovals: number }
export interface ToolCallResponse { ok: boolean; callId: string; durationMs: number; summary: string; output?: unknown; error?: { code: string; message: string; details?: unknown } }

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
  callTool: (name: string, agentId: string, input: unknown) => call<ToolCallResponse>(`/api/agentic/tools/${encodeURIComponent(name)}/call`, { method: 'POST', body: JSON.stringify({ agentId, input }) }),
};
