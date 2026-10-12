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

export interface AgenticJob { jobId: string; kind: 'graph' | 'batch' | 'copilot' | 'research'; status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; createdAt: string; startedAt: string | null; finishedAt: string | null; attempts: number; maxAttempts: number; ref: Record<string, string>; error: string | null; label: string }
export interface BatchItem { neighborhoodId: string; nameFa: string; status: 'pending' | 'done' | 'failed'; runId: string | null; runStatus: string | null; level: string | null; verdict: string | null; bottleneck: string | null; findings: string[]; pendingApprovals: number; durationMs: number; error: string | null }
export interface BatchSummary { byLevel: Record<string, number>; byRunStatus: Record<string, number>; byVerdict: Record<string, number>; bottlenecks: Record<string, number>; findings: Record<string, number>; avgDurationMs: number }
export interface BatchRecord { batchId: string; jobId: string | null; city: string; offline: boolean; createdAt: string; finishedAt: string | null; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; total: number; done: number; failed: number; items?: BatchItem[]; summary: BatchSummary }
export interface CopilotStep { i: number; thought: string; agent: string | null; tool: string | null; ok: boolean; summary: string; callId: string | null; error?: string }
export interface CopilotSession { sessionId: string; jobId: string | null; question: string; offline: boolean; createdAt: string; finishedAt: string | null; mode: 'llm' | 'deterministic_fallback'; model: string | null; status: 'queued' | 'running' | 'answered' | 'answered_with_warnings' | 'failed' | 'cancelled'; steps: CopilotStep[]; answer: string | null; usedCalls: string[]; grounding: { checked: number; ungrounded: string[]; revised: boolean } | null; runId: string | null; error: string | null }

// ---------- فاز ۳: پژوهش خودکار ----------
export type SourceCardStatus = 'proposed' | 'verified' | 'unreachable' | 'blocked_by_robots' | 'approved' | 'rejected';
export interface SourceCard { cardId: string; url: string; domain: string; title: string; publisher: string | null; description: string; indicators: string[]; role: string; spatialLevel: string; resolution: string | null; license: string | null; commercial: boolean | null; access: string; domestic: boolean; origin: 'catalog' | 'search' | 'llm'; verification: { checkedAt: string | null; reachable: boolean | null; httpStatus: number | null; robotsAllowed: boolean | null; pageTitle: string | null; error: string | null }; trust: { score: number; components: Record<string, number> }; status: SourceCardStatus; review: { by: string; at: string; decision: string; note?: string } | null }
export interface GapBrief { code: string; name: string; reason: 'no_score' | 'low_reliability'; candidates: Array<{ cardId: string; title: string; url: string; status: SourceCardStatus; trust: number; spatialLevel: string; domestic: boolean }>; documents: Array<{ refId: string; title: string; page: number; snippet: string }>; nextAction: string }
export interface ResearchRecord { researchId: string; jobId: string | null; createdAt: string; finishedAt: string | null; status: 'queued' | 'running' | 'done' | 'needs_user_choice' | 'failed' | 'cancelled'; neighborhood: { id: string; nameFa: string; city: string } | null; candidates?: Array<{ id: string; nameFa: string }>; analysisId: string | null; level: string | null; steps: Array<{ name: string; agent: string; status: string; summary: string; ms: number }>; briefs: GapBrief[]; summary: { gaps: number; covered: number; uncovered: number; verifiedSources: number; candidateSources: number } | null; error: string | null }
export interface DocRecord { docId: string; filename: string; kind: string; bytes: number; createdAt: string; title: string; period: { year: number; calendar: string; periodEnd: string } | null; extractor: string; tables: Array<{ tableId: string; origin: string; columns: number; rows: number; header: string[] }>; pages: number; verification: { method: string; numericCells: number; agreed: number; agreement: number | null; note: string }; warnings: string[] }
export interface ColumnRole { column: number; header: string; role: 'name' | 'district' | 'indicator' | 'ignore'; code?: string; percent?: boolean; confidence: number; method: string; reason: string }
export interface DocTablePreview { tableId: string; origin: string; header: string[]; totalRows: number; rows: string[][]; roles: ColumnRole[] }
export interface DraftResult { docId: string; tableId: string; roles: ColumnRole[]; periodEnd: string | null; matches: Array<{ row: number; name: string; matchType: string; targets: string[]; confidence: number; needsReview: boolean; note: string }>; rows: number; skipped: Array<{ row: number; reason: string }>; batch: { batchId: string; status: string; accepted: number; rejected: number; issues: number } | null; csvPreview: string }
export interface MemoryHit { chunkId: string; kind: string; refId: string; page: number; title: string; score: number; snippet: string }

export interface ScenarioEval { covered: boolean; missingCapitals: string[]; capitals: Record<string, number> | null; Q: number | null; T: number | null; R: number | null; diagnosticType: string | null; bottleneck: { capital: string; transition: [string, string] } | null }
export interface ScenarioResult { version: string; label: 'scenario'; publishable: false; neighborhoodId: string; analysisId: string; overrides: Record<string, number>; hypotheticalCodes: string[]; measuredCodes: string[]; baseScores: Record<string, number>; base: ScenarioEval; scenario: ScenarioEval; changes: { bottleneckChanged: boolean | null; typeChanged: boolean | null; capitalDelta: Record<string, number> | null }; note: string }
export interface SensitivityResult { version: string; perturbation: number; reliabilityBelow: number; evaluated: boolean; reason: string | null; base: ScenarioEval | null; tested: Array<{ code: string; reliability: number; down: { bottleneckSame: boolean; typeSame: boolean }; up: { bottleneckSame: boolean; typeSame: boolean } }>; stability: number | null; fragileCodes: string[]; verdict: 'stable' | 'fragile' | 'not_evaluated' }
export interface CriticSuiteResult { version: string; critic: string; total: number; detected: number; detectionRate: number; passed: boolean; baselineVerdict: string; cases: Array<{ id: string; title: string; expect: string; status: string; detected: boolean; verdict: string; detail: string }> }
export interface LlmReviewResult { used: boolean; model: string | null; issues: Array<{ severity: 'high' | 'medium' | 'low'; indicator: string | null; problem: string }>; rejected: number; error: string | null }
export interface DashMetric { calls: number; errors: number; errorRate: number; avgMs: number; p95Ms: number; lastAt: string | null }
export interface AgentDashboard { version: string; generatedAt: string; window: number; totals: DashMetric; agents: Array<DashMetric & { id: string; nameFa: string; status: string; autonomy: string; tools: number }>; tools: Array<DashMetric & { tool: string; topErrors: Array<{ code: string; n: number }> }>; recentErrors: Array<{ at: string; agentId: string; tool: string; errorCode: string | null; summary: string }>; jobs: Record<string, number>; assets: { research: number; researchDone: number; sourceCards: number; sourceCardsByStatus: Record<string, number>; documents: number; memory: { chunks: number; items: number } | null } }
export interface SurveyStatus { neighborhoodId: string; name: string; perceptual: { nAccepted: number; nReceived: number; adequacy: string; marginOfError: number | null; alpha: number | null; indicators: Array<{ code: string; score: number; n: number }>; latestResponseAt: string | null }; custom: Array<{ questionnaireId: string; title: string; status: string; version: number; nAccepted: number; nReceived: number; indicators: Array<{ code: string; score: number | null; n: number; publishable: boolean }> }>; drafts: Array<{ questionnaireId: string; title: string; items: number }>; audits: { points: number }; register: { records: number }; plan: { overall: number; recommendedN: number }; surveyFillableGaps: string[]; otherGaps: string[] }

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
  startResearch: (input: { name?: string; city?: string; neighborhoodId?: string; offline?: boolean; useLlm?: boolean; useSearch?: boolean; verify?: boolean }) => call<{ jobId: string; researchId: string }>('/api/agentic/research', { method: 'POST', body: JSON.stringify(input) }),
  research: (id: string) => call<ResearchRecord>(`/api/agentic/research/${encodeURIComponent(id)}`),
  sourceCards: () => call<SourceCard[]>('/api/agentic/sources'),
  decideSource: (id: string, decision: 'approved' | 'rejected', note?: string) => call<SourceCard>(`/api/agentic/sources/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision, note }) }),
  uploadDocument: (filename: string, contentBase64: string, sourceUrl?: string) => call<DocRecord>('/api/agentic/documents', { method: 'POST', body: JSON.stringify({ filename, contentBase64, sourceUrl }) }),
  documents: () => call<DocRecord[]>('/api/agentic/documents'),
  document: (id: string, city: string) => call<{ document: DocRecord; tables: DocTablePreview[] }>(`/api/agentic/documents/${encodeURIComponent(id)}?city=${encodeURIComponent(city)}`),
  draftBatch: (docId: string, tableId: string, body: { city: string; sourceOrg: string; periodEnd?: string; roles?: ColumnRole[]; includeReview?: boolean; dryRun?: boolean }) => call<DraftResult>(`/api/agentic/documents/${encodeURIComponent(docId)}/tables/${encodeURIComponent(tableId)}/draft`, { method: 'POST', body: JSON.stringify(body) }),
  searchMemory: (q: string) => call<{ stats: { chunks: number; items: number }; hits: MemoryHit[] }>(`/api/agentic/memory/search?q=${encodeURIComponent(q)}`),
  callTool: (name: string, agentId: string, input: unknown) => call<ToolCallResponse>(`/api/agentic/tools/${encodeURIComponent(name)}/call`, { method: 'POST', body: JSON.stringify({ agentId, input }) }),
  scenario: (body: { neighborhoodId: string; overrides: Record<string, number>; offline?: boolean }) => call<ScenarioResult>('/api/agentic/scenario', { method: 'POST', body: JSON.stringify(body) }),
  sensitivity: (body: { neighborhoodId: string; scores?: Record<string, number>; perturbation?: number; offline?: boolean }) => call<SensitivityResult>('/api/agentic/sensitivity', { method: 'POST', body: JSON.stringify(body) }),
  criticSelfTest: (body: { neighborhoodId: string; offline?: boolean }) => call<CriticSuiteResult>('/api/agentic/critic/self-test', { method: 'POST', body: JSON.stringify(body) }),
  llmReview: (body: { neighborhoodId: string; offline?: boolean }) => call<LlmReviewResult>('/api/agentic/critic/llm-review', { method: 'POST', body: JSON.stringify(body) }),
  dashboard: () => call<AgentDashboard>('/api/agentic/dashboard'),
  surveyStatus: (nb: string) => call<SurveyStatus>(`/api/agentic/survey/${encodeURIComponent(nb)}/status`),
  draftGapQuestionnaire: (nb: string, nItems = 12) => call<{ questionnaireId: string; title: string; items: number; indicators: string[]; next: string }>(`/api/agentic/survey/${encodeURIComponent(nb)}/draft-questionnaire`, { method: 'POST', body: JSON.stringify({ nItems }) }),
  invalidateCache: (neighborhoodId: string) => call<{ cleared: number }>('/api/agentic/cache/invalidate', { method: 'POST', body: JSON.stringify({ neighborhoodId }) }),
};
