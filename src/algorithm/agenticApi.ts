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
  tools: number; agents: number; activeAgents: number; llm?: { configured: boolean }; queue?: Record<string, number>; stats: { calls: number; errors: number; byTool: Record<string, { calls: number; errors: number; avgMs: number }> };
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

// ---------------- فاز ۵: میدان، پایش و یادگیری ----------------
export interface FieldSnapshot { at: string; analysisId: string; level: string; coverage: { scored: number; reliable: number; usable: number; total: number }; capitals: Record<string, number | null>; bottleneck: string | null; diagnosticType: string | null; surveyN: number; auditPoints: number }
export interface FieldOutcome { newlyScored: string[]; reliabilityGained: string[]; lost: string[]; levelBefore: string; levelAfter: string; coverageDelta: Record<string, number>; capitalDelta: Record<string, number | null>; bottleneckChanged: boolean | null; surveyVsPrior: Array<{ code: string; before: number; after: number; beforeTier: string; afterTier: string; diff: number }> }
export interface FieldCampaign {
  id: string; createdAt: string; createdBy: string; neighborhoodId: string; nameFa: string; status: 'draft' | 'fielding' | 'closed' | 'cancelled';
  approval: { status: 'pending' | 'approved' | 'rejected'; by: string | null; at: string | null; note: string | null }; startedAt: string | null; closedAt: string | null;
  plan: { targetN: number; quotas: Record<string, Record<string, number>>; quotaNote: string; auditPoints: number; questionnaires: Array<{ id: string; title: string; status: string }>; targetCodes: string[]; otherGaps: string[]; days: number };
  baseline: FieldSnapshot; after: FieldSnapshot | null; outcome: FieldOutcome | null;
}
export interface FieldProgress {
  status: FieldCampaign['status']; daysElapsed: number; daysPlanned: number;
  perceptual: { received: number; accepted: number; target: number; progress: number; rejectionRate: number; rejectedByReason: Record<string, number>; marginOfError: number | null; adequacy: string };
  quotas: Record<string, Record<string, { target: number; got: number; fill: number }>>;
  collectors: Array<{ collectorId: string; received: number; accepted: number; rejectionRate: number; flagged: boolean }>;
  custom: Array<{ questionnaireId: string; title: string; received: number; accepted: number }>;
  audits: { points: number; target: number; kappa: number | null }; warnings: string[]; readyToClose: boolean;
}
export interface FieldCycle { neighborhoodId: string; nameFa: string; stages: Array<{ key: string; title: string; done: boolean }>; complete: boolean; next: string; campaigns: Array<{ id: string; status: string; createdAt: string }>; monitoring: Array<{ id: string; name: string; dueDate: string }>; proposals: Array<{ id: string; kind: string; title: string; status: string }> }
export interface LibraryItem { id: string; name: string; capital: string; transition: string; targets: string[]; months: number; owner: string }
export type MonVerdict = 'improved' | 'worsened' | 'no_change' | 'insufficient_data';
export interface MonitoringRecord { id: string; neighborhoodId: string; nameFa: string; libraryId: string; name: string; targets: string[]; startDate: string; dueDate: string; evaluations: Array<{ at: string; due: boolean; perTarget: Array<{ code: string; before: number | null; after: number | null; delta: number | null; verdict: MonVerdict }>; overall: MonVerdict; note: string }> }
export interface CalibrationProposal { id: string; createdAt: string; kind: string; title: string; detail: string; suggestedChange: string; status: 'proposed' | 'approved' | 'rejected'; decidedBy: string | null; note: string | null }

// ---------------- پژوهش وب (A2) ----------------
export interface WebCandidate {
  idx: number; value: number | null; unit: string; period: string | null; spatialLevel: string; areaName: string; sourceUrl: string; sourceTitle: string; quote: string; isOfficial: boolean;
  check: { cited: boolean; grounding: 'page' | 'snippet' | 'quote_only' | 'none'; plausible: boolean; spatial: string; contractLevel: 'neighborhood' | 'district' | null; periodEnd: string | null; reasons: string[] };
  status: 'acceptable' | 'needs_review' | 'rejected'; decision: null | { decision: 'approved' | 'rejected'; by: string; at: string; note: string | null; batchId: string | null };
}
export interface WebFinding { code: string; name: string; definition: string; status: 'found' | 'not_found' | 'error'; notes: string; candidates: WebCandidate[]; sources: Array<{ url: string; title: string; snippets: string[] }>; sourceCards: string[]; effort: string; costUsd: number; cached: boolean; ms: number; error?: string }
export interface WebResearch { id: string; createdAt: string; finishedAt: string | null; status: 'running' | 'completed' | 'failed' | 'interrupted'; neighborhoodId: string; nameFa: string; cityFa: string; district: number | null; effort: string; codes: string[]; skipped: { surveyOnly: string[]; notInContract: string[] }; findings: WebFinding[]; summary: { acceptable: number; needsReview: number; rejected: number; notFound: number; costUsd: number }; error: string | null }
export interface AiHealth {
  version: string; configured: boolean; anyAvailable: boolean;
  providers: Array<{ id: string; labelFa: string; state: 'closed' | 'open' | 'half_open'; consecutiveFailures: number; calls: number; ok: number; failures: number; lastError: string | null; lastOkAt: string | null; lastLatencyMs: number | null; openedAt: string | null }>;
}
export interface StorageStatus {
  sync: { version: string; enabled: boolean; active: boolean; vector: boolean; tracked: number; pending: number; watching: boolean; hydrated: number; backfilled: number; failures: number; lastError: string | null; lastFlushAt: string | null };
  memory: { version: string; embedding: string; vectorStore: 'pgvector' | 'local'; chunks: number; items: number };
  collections: Array<{ collection: string; status: string | null; n: number; bytes: number }>;
}
export interface WebStatus { configured: boolean; usage: { day: string; research: number; search: number; contents: number; cacheHits: number; costUsd: number }; limits: { maxEffort: string; dailyResearch: number; dailySearch: number; dailyBudgetUsd: number } }

export const agenticApi = {
  info: () => call<AgenticInfo>('/api/agentic/info'),
  storage: () => call<StorageStatus>('/api/agentic/system/storage'),
  aiHealth: () => call<AiHealth>('/api/agentic/system/ai'),
  aiProbe: () => call<{ results: Array<{ id: string; labelFa: string; ok: boolean; ms: number; error?: string }>; health: AiHealth }>('/api/agentic/system/ai/probe', { method: 'POST', body: '{}' }),
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
  aiReview: (body: { neighborhoodId: string; offline?: boolean }) => call<LlmReviewResult>('/api/agentic/critic/ai-review', { method: 'POST', body: JSON.stringify(body) }),
  dashboard: () => call<AgentDashboard>('/api/agentic/dashboard'),
  surveyStatus: (nb: string) => call<SurveyStatus>(`/api/agentic/survey/${encodeURIComponent(nb)}/status`),
  draftGapQuestionnaire: (nb: string, nItems = 12) => call<{ questionnaireId: string; title: string; items: number; indicators: string[]; next: string }>(`/api/agentic/survey/${encodeURIComponent(nb)}/draft-questionnaire`, { method: 'POST', body: JSON.stringify({ nItems }) }),
  createCampaign: (body: { neighborhoodId: string; offline?: boolean; days?: number }) => call<FieldCampaign>('/api/agentic/field/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  campaign: (id: string) => call<{ campaign: FieldCampaign; progress: FieldProgress }>(`/api/agentic/field/campaigns/${encodeURIComponent(id)}`),
  decideCampaign: (id: string, decision: 'approved' | 'rejected', note?: string) => call<FieldCampaign>(`/api/agentic/field/campaigns/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision, note }) }),
  closeCampaign: (id: string, force = false) => call<FieldCampaign>(`/api/agentic/field/campaigns/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({ force }) }),
  fieldCycle: (nb: string) => call<FieldCycle>(`/api/agentic/field/cycle/${encodeURIComponent(nb)}`),
  library: () => call<LibraryItem[]>('/api/agentic/library'),
  registerMonitoring: (body: { neighborhoodId: string; libraryId: string; startDate?: string; note?: string; offline?: boolean }) => call<MonitoringRecord>('/api/agentic/monitoring', { method: 'POST', body: JSON.stringify(body) }),
  monitoring: (nb?: string) => call<{ items: MonitoringRecord[] }>(`/api/agentic/monitoring${nb ? `?nb=${encodeURIComponent(nb)}` : ''}`),
  evaluateMonitoring: (id: string) => call<MonitoringRecord>(`/api/agentic/monitoring/${encodeURIComponent(id)}/evaluate`, { method: 'POST' }),
  generateProposals: () => call<{ created: CalibrationProposal[]; total: number }>('/api/agentic/learning/proposals/generate', { method: 'POST' }),
  proposals: () => call<{ items: CalibrationProposal[] }>('/api/agentic/learning/proposals'),
  decideProposal: (id: string, decision: 'approved' | 'rejected', note?: string) => call<CalibrationProposal>(`/api/agentic/learning/proposals/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision, note }) }),
  webStatus: () => call<WebStatus>('/api/agentic/web/status'),
  startWebResearch: (body: { neighborhoodId: string; codes?: string[]; effort?: string; maxIndicators?: number; offline?: boolean }) => call<WebResearch>('/api/agentic/web/research', { method: 'POST', body: JSON.stringify(body) }),
  webResearch: (id: string) => call<WebResearch>(`/api/agentic/web/research/${encodeURIComponent(id)}`),
  webResearchList: (nb?: string) => call<WebResearch[]>(`/api/agentic/web/research${nb ? `?nb=${encodeURIComponent(nb)}` : ''}`),
  decideWebCandidate: (id: string, code: string, idx: number, decision: 'approved' | 'rejected', extra: { note?: string; periodEnd?: string } = {}) => call<{ decision: WebCandidate['decision'] }>(`/api/agentic/web/research/${encodeURIComponent(id)}/candidates/${encodeURIComponent(code)}/${idx}/decision`, { method: 'POST', body: JSON.stringify({ decision, ...extra }) }),
  fetchWebPages: (urls: string[], ingest = true) => call<{ pages: Array<{ url: string; title: string | null; chars: number; excerpt: string; docId: string | null; tables: number }>; missing: string[] }>('/api/agentic/web/contents', { method: 'POST', body: JSON.stringify({ urls, ingest }) }),
  invalidateCache: (neighborhoodId: string) => call<{ cleared: number }>('/api/agentic/cache/invalidate', { method: 'POST', body: JSON.stringify({ neighborhoodId }) }),
};
