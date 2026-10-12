/** API فریمورک ایجنتیک — زیر /api/agentic نصب می‌شود (REST + MCP) */
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { AGENT_POLICY_VERSION, AGENTS } from './agents';
import { CRITIC_VERSION } from './critic';
import { EVIDENCE_PACKET_SCHEMA, EVIDENCE_PACKET_VERSION } from './evidencePacket';
import { mcpHandler, MCP_PROTOCOL_VERSIONS } from './mcp';
import { decideApproval, GRAPH_VERSION, listRuns, loadRun, runStandardGraph } from './pipeline';
import { callTool, describeTool, listTools } from './registry';
import { TOOLS_VERSION } from './tools';
import { listTrace, traceStats } from './trace';
import { cancelJob, enqueueBatch, enqueueCopilot, enqueueGraph, wireJobs } from './jobs';
import { batchCsv, listBatches, loadBatch } from './batch';
import { COPILOT_VERSION, listSessions, loadSession } from './copilot';
import { llmConfig } from '../ai/llm';
import { enqueueResearch } from './jobs';
import { listResearch, loadResearch, RESEARCH_VERSION } from './research/research';
import { ingestAndIndex, RESEARCH_VERSIONS } from './research/researchTools';
import { listDocuments, loadContent, loadDocument } from './research/documents';
import { draftContractBatch, inferColumns, type ColumnRole } from './research/columns';
import { matchUnits } from './research/spatialMatch';
import { memoryStats, searchMemoryAsync } from './research/memory';
import { PGSYNC_VERSION, pgCollectionSummary, pgSyncStatus, scan as pgScan } from '../db/pgSync';
import { decideCard, discoverSources, listCards, searchProvider, type CardStatus } from './research/discovery';
import { gapsFromCard } from './research/research';
import { decideCandidate, getWebResearch, listWebResearch, markInterrupted, runWebResearch, startWebResearch, WEBRESEARCH_VERSION } from './research/webResearch';
import { usageToday, webConfig } from './research/webClient';
import { analysisFor, invalidateNeighborhood } from './state';
import { SCENARIO_VERSION } from './scenario';
import { CRITIC_SUITE_VERSION } from './criticSuite';
import { DASHBOARD_VERSION } from './dashboard';
import { decideCampaign, FIELD_VERSION } from './field/campaign';
import { libraryItems, MONITORING_VERSION, registerMonitoring } from './field/monitoring';
import { decideProposal, LEARNING_VERSION } from './field/learning';

const asyncRoute = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const fail = (res: Response, status: number, code: string, message: string, details?: unknown) => res.status(status).json({ success: false, error: { code, message, details } });
const STATUS: Record<string, number> = { UNKNOWN_TOOL: 404, UNKNOWN_AGENT: 400, FORBIDDEN: 403, INVALID_INPUT: 400, NOT_FOUND: 404, ANALYSIS_EXPIRED: 409, TIMEOUT: 504, INVALID_OUTPUT: 500, TOOL_ERROR: 500, LLM_UNAVAILABLE: 503, NO_SURVEY_GAPS: 422, CAMPAIGN_OPEN: 409, INVALID_STATE: 409, NOT_READY: 409, WEB_NOT_CONFIGURED: 503, WEB_BUDGET: 429, WEB_UPSTREAM: 502, WEB_TIMEOUT: 504, WEB_INPUT: 400, NO_WEB_GAPS: 422 };

export function frameworkInfo() {
  return {
    versions: { tools: TOOLS_VERSION, agentPolicy: AGENT_POLICY_VERSION, evidenceContract: EVIDENCE_PACKET_VERSION, critic: CRITIC_VERSION, graph: GRAPH_VERSION, copilot: COPILOT_VERSION, research: RESEARCH_VERSION, ...RESEARCH_VERSIONS, scenario: SCENARIO_VERSION, criticSuite: CRITIC_SUITE_VERSION, dashboard: DASHBOARD_VERSION, field: FIELD_VERSION, monitoring: MONITORING_VERSION, learning: LEARNING_VERSION, webResearch: WEBRESEARCH_VERSION, storage: PGSYNC_VERSION },
    research: { searchProvider: searchProvider(), memory: memoryStats() },
    llm: (() => { const c = llmConfig(); return { configured: c.configured }; })(),
    mcp: { endpoint: '/api/agentic/mcp', transport: 'streamable-http (JSON-RPC 2.0, POST)', protocolVersions: MCP_PROTOCOL_VERSIONS, agentHeader: 'x-ara-agent' },
    tools: listTools().length, agents: AGENTS.length, activeAgents: AGENTS.filter((a) => a.status === 'active' && a.id !== 'operator').length,
  };
}

export function createAgenticRouter(): Router {
  const router = Router();
  wireJobs();
  router.use('/documents', express.json({ limit: '40mb' }));
  router.use(express.json({ limit: '2mb' }));

  router.get('/info', (_req, res) => { ok(res, { ...frameworkInfo(), stats: traceStats(), queue: wireJobs().stats() }); });
  router.get('/tools', (_req, res) => { ok(res, listTools().map(describeTool)); });
  router.get('/agents', (_req, res) => { ok(res, AGENTS); });
  router.get('/evidence-schema', (_req, res) => { ok(res, { version: EVIDENCE_PACKET_VERSION, schema: EVIDENCE_PACKET_SCHEMA }); });
  router.get('/trace', (req, res) => {
    ok(res, listTrace({ runId: req.query.runId ? String(req.query.runId) : undefined, agentId: req.query.agentId ? String(req.query.agentId) : undefined, tool: req.query.tool ? String(req.query.tool) : undefined, limit: Number(req.query.limit ?? 100) }));
  });

  router.post('/tools/:name/call', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as { agentId?: string; input?: unknown };
    const r = await callTool(req.params.name, body.input ?? {}, { agentId: body.agentId ?? String(req.header('x-ara-agent') ?? 'operator'), via: 'rest' });
    if (!r.ok) { res.status(STATUS[r.error!.code] ?? 500).json({ success: false, error: r.error, data: { callId: r.callId, durationMs: r.durationMs } }); return; }
    ok(res, r);
  }));

  router.post('/runs', asyncRoute(async (req, res) => {
    const b = (req.body ?? {}) as { name?: string; city?: string; neighborhoodId?: string; offline?: boolean; useKernel?: boolean; purpose?: string };
    if (!b.name && !b.neighborhoodId) { fail(res, 400, 'INVALID_INPUT', 'name یا neighborhoodId لازم است'); return; }
    const input = { name: b.name?.slice(0, 120), city: b.city?.slice(0, 60), neighborhoodId: b.neighborhoodId, offline: Boolean(b.offline), useKernel: b.useKernel === true, purpose: b.purpose };
    if ((req.body as { async?: boolean }).async === true) { ok(res, enqueueGraph(input), 202); return; }
    const run = await runStandardGraph(input);
    ok(res, run, 201);
  }));
  router.get('/runs', (req, res) => { ok(res, listRuns(Number(req.query.limit ?? 30))); });
  router.get('/runs/:id', (req, res) => { const r = loadRun(req.params.id); if (!r) { fail(res, 404, 'NOT_FOUND', 'اجرا یافت نشد'); return; } ok(res, r); });
  router.post('/runs/:id/approvals/:approvalId', (req, res) => {
    const b = (req.body ?? {}) as { decision?: string; note?: string };
    if (b.decision !== 'approved' && b.decision !== 'rejected') { fail(res, 400, 'INVALID_INPUT', 'decision باید approved یا rejected باشد'); return; }
    const r = decideApproval(req.params.id, req.params.approvalId, b.decision, b.note);
    if (!r) { fail(res, 404, 'NOT_FOUND', 'اجرا یافت نشد'); return; }
    ok(res, r);
  });

  // ---------- فاز ۲: صف کار، اجرای دسته‌ای، دستیار عامل‌محور ----------
  router.get('/jobs', (req, res) => { ok(res, wireJobs().list({ kind: req.query.kind as never, limit: Number(req.query.limit ?? 50) })); });
  router.get('/jobs/:id', (req, res) => { const j = wireJobs().get(req.params.id); if (!j) { fail(res, 404, 'NOT_FOUND', 'کار یافت نشد'); return; } ok(res, j); });
  router.post('/jobs/:id/cancel', (req, res) => { const j = cancelJob(req.params.id); if (!j) { fail(res, 404, 'NOT_FOUND', 'کار یافت نشد'); return; } ok(res, j); });

  router.post('/batches', (req, res) => {
    const b = (req.body ?? {}) as { city?: string; offline?: boolean; limit?: number };
    if (!b.city) { fail(res, 400, 'INVALID_INPUT', 'city لازم است'); return; }
    try { ok(res, enqueueBatch(String(b.city).slice(0, 60), { offline: Boolean(b.offline), limit: b.limit ? Math.max(1, Math.floor(Number(b.limit))) : undefined }), 202); }
    catch (e) { fail(res, 400, 'INVALID_INPUT', e instanceof Error ? e.message : String(e)); }
  });
  router.get('/batches', (req, res) => { ok(res, listBatches(Number(req.query.limit ?? 20))); });
  router.get('/batches/:id', (req, res) => { const b = loadBatch(req.params.id); if (!b) { fail(res, 404, 'NOT_FOUND', 'دسته یافت نشد'); return; } ok(res, b); });
  router.get('/batches/:id/csv', (req, res) => {
    const b = loadBatch(req.params.id); if (!b) { fail(res, 404, 'NOT_FOUND', 'دسته یافت نشد'); return; }
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${b.batchId}.csv"`).send(batchCsv(b));
  });

  router.post('/copilot', (req, res) => {
    const b = (req.body ?? {}) as { question?: string; offline?: boolean };
    const question = String(b.question ?? '').trim();
    if (question.length < 3) { fail(res, 400, 'INVALID_INPUT', 'پرسش لازم است'); return; }
    ok(res, enqueueCopilot(question, Boolean(b.offline)), 202);
  });
  router.get('/copilot', (req, res) => { ok(res, listSessions(Number(req.query.limit ?? 20))); });
  router.get('/copilot/:id', (req, res) => { const s = loadSession(req.params.id); if (!s) { fail(res, 404, 'NOT_FOUND', 'نشست یافت نشد'); return; } ok(res, s); });

  // ---------- فاز ۳: پژوهش خودکار ----------
  router.post('/documents', (req, res) => {
    const b = (req.body ?? {}) as { filename?: string; contentBase64?: string; sourceUrl?: string; sourceCardId?: string };
    if (!b.filename || !b.contentBase64) { fail(res, 400, 'INVALID_INPUT', 'filename و contentBase64 لازم است'); return; }
    try { ok(res, ingestAndIndex({ filename: String(b.filename), content: Buffer.from(String(b.contentBase64), 'base64'), sourceUrl: b.sourceUrl ?? null, sourceCardId: b.sourceCardId ?? null, uploadedBy: String(req.header('x-ara-agent') ?? 'operator') }), 201); }
    catch (e) { fail(res, 400, 'INVALID_INPUT', e instanceof Error ? e.message : String(e)); }
  });
  router.get('/documents', (req, res) => { ok(res, listDocuments(Number(req.query.limit ?? 30))); });
  router.get('/documents/:id', (req, res) => {
    const d = loadDocument(req.params.id); if (!d) { fail(res, 404, 'NOT_FOUND', 'سند یافت نشد'); return; }
    const c = loadContent(d.docId); const city = String(req.query.city ?? 'تهران');
    ok(res, { document: d, tables: (c?.tables ?? []).map((t) => ({ tableId: t.tableId, origin: t.origin, header: t.header, totalRows: t.rows.length, rows: t.rows.slice(0, 15).map((r) => r.map((x) => x.text)), roles: inferColumns(t, city) })) });
  });
  router.post('/documents/:id/tables/:tableId/draft', asyncRoute(async (req, res) => {
    const b = (req.body ?? {}) as { city?: string; sourceOrg?: string; periodEnd?: string; roles?: ColumnRole[]; includeReview?: boolean; useLlm?: boolean; dryRun?: boolean };
    if (!b.city || !b.sourceOrg) { fail(res, 400, 'INVALID_INPUT', 'city و sourceOrg لازم است'); return; }
    if (b.periodEnd && !/^\d{4}-\d{2}$/.test(b.periodEnd)) { fail(res, 400, 'INVALID_INPUT', 'periodEnd باید YYYY-MM باشد'); return; }
    try {
      const roles = Array.isArray(b.roles) ? b.roles.map((r) => ({ ...r, header: r.header ?? '', confidence: 1, method: 'manual' as const, reason: 'تعیین کارشناس' })) : undefined;
      ok(res, await draftContractBatch(req.params.id, req.params.tableId, { city: String(b.city), sourceOrg: String(b.sourceOrg).slice(0, 120), periodEnd: b.periodEnd, roles, includeReview: b.includeReview === true, useLlm: b.useLlm === true, dryRun: b.dryRun !== false, uploadedBy: String(req.header('x-ara-agent') ?? 'operator') }), b.dryRun === false ? 201 : 200);
    } catch (e) { fail(res, 400, 'INVALID_INPUT', e instanceof Error ? e.message : String(e)); }
  }));
  router.post('/spatial-match', (req, res) => {
    const b = (req.body ?? {}) as { city?: string; units?: unknown[] };
    if (!b.city || !Array.isArray(b.units) || !b.units.length || b.units.length > 2000) { fail(res, 400, 'INVALID_INPUT', 'city و units (۱ تا ۲۰۰۰) لازم است'); return; }
    ok(res, matchUnits(b.units as never, String(b.city)));
  });
  // وضعیت ذخیره‌سازی پایدار (PostgreSQL) و خلاصهٔ مجموعه‌ها
  router.get('/system/storage', asyncRoute(async (_req, res) => { ok(res, { sync: pgSyncStatus(), memory: memoryStats(), collections: await pgCollectionSummary() }); }));
  router.post('/system/storage/sync', asyncRoute(async (_req, res) => { const n = await pgScan(); ok(res, { changed: n, sync: pgSyncStatus() }); }));
  router.get('/memory/search', (req, res) => {
    const q = String(req.query.q ?? '').trim(); if (q.length < 2) { fail(res, 400, 'INVALID_INPUT', 'q لازم است'); return; }
    void searchMemoryAsync(q, { limit: Number(req.query.limit ?? 10), kind: req.query.kind as never }).then((r) => ok(res, { stats: memoryStats(), engine: r.engine, hits: r.hits }));
  });
  router.post('/sources/discover', asyncRoute(async (req, res) => {
    const b = (req.body ?? {}) as { neighborhoodId?: string; indicators?: string[]; city?: string; neighborhoodName?: string; verify?: boolean; useSearch?: boolean; useLlm?: boolean; offline?: boolean };
    let indicators = Array.isArray(b.indicators) ? b.indicators.map(String).slice(0, 42) : [];
    let gaps: unknown[] = [];
    if (!indicators.length && b.neighborhoodId) {
      try { const r = await analysisFor({ neighborhoodId: b.neighborhoodId, offline: b.offline !== false }); const g = gapsFromCard(r); gaps = g; indicators = g.map((x) => x.code); }
      catch (e) { fail(res, 400, 'INVALID_INPUT', e instanceof Error ? e.message : String(e)); return; }
    }
    if (!indicators.length) { fail(res, 400, 'INVALID_INPUT', 'indicators یا neighborhoodId لازم است'); return; }
    const d = await discoverSources({ indicators, city: b.city, neighborhoodName: b.neighborhoodName, verify: b.verify !== false, useSearch: b.useSearch === true, useLlm: b.useLlm === true });
    ok(res, { ...d, gaps });
  }));
  router.get('/sources', (req, res) => { ok(res, listCards({ status: req.query.status as CardStatus | undefined, indicator: req.query.indicator ? String(req.query.indicator) : undefined })); });
  router.post('/sources/:id/decision', (req, res) => {
    const b = (req.body ?? {}) as { decision?: string; note?: string };
    if (b.decision !== 'approved' && b.decision !== 'rejected') { fail(res, 400, 'INVALID_INPUT', 'decision باید approved یا rejected باشد'); return; }
    const c = decideCard(req.params.id, b.decision, String(req.header('x-ara-agent') ?? 'operator'), b.note ? String(b.note).slice(0, 500) : undefined);
    if (!c) { fail(res, 404, 'NOT_FOUND', 'کارت منبع یافت نشد'); return; }
    ok(res, c);
  });
  router.post('/research', (req, res) => {
    const b = (req.body ?? {}) as { neighborhoodId?: string; name?: string; city?: string; offline?: boolean; useLlm?: boolean; useSearch?: boolean; verify?: boolean };
    if (!b.neighborhoodId && !b.name) { fail(res, 400, 'INVALID_INPUT', 'name یا neighborhoodId لازم است'); return; }
    ok(res, enqueueResearch({ neighborhoodId: b.neighborhoodId, name: b.name?.slice(0, 120), city: b.city?.slice(0, 60), offline: Boolean(b.offline), useLlm: b.useLlm === true, useSearch: b.useSearch === true, verify: typeof b.verify === 'boolean' ? b.verify : undefined }), 202);
  });
  router.get('/research', (req, res) => { ok(res, listResearch(Number(req.query.limit ?? 20))); });
  router.get('/research/:id', (req, res) => { const r = loadResearch(req.params.id); if (!r) { fail(res, 404, 'NOT_FOUND', 'پژوهش یافت نشد'); return; } ok(res, r); });

  // ---------------- فاز ۴: سناریو، نقاد، پیمایش، داشبورد (همه از مسیر ابزار و با ردگیری) ----------------
  const viaTool = (tool: string, agentId: string, input: (req: Request) => Record<string, unknown>) => asyncRoute(async (req, res) => {
    const r = await callTool(tool, input(req), { agentId, via: 'rest' });
    if (!r.ok) { res.status(STATUS[r.error!.code] ?? 500).json({ success: false, error: r.error }); return; }
    ok(res, r.output);
  });
  const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;
  router.post('/scenario', viaTool('simulate_scenario', 'A11', (req) => ({ overrides: {}, ...body(req) })));
  router.post('/sensitivity', viaTool('sensitivity_analysis', 'A11', body));
  router.post('/critic/self-test', viaTool('critic_self_test', 'A12', body));
  router.post(['/critic/ai-review', '/critic/llm-review'], viaTool('ai_review', 'A12', body));
  router.get('/dashboard', viaTool('get_agent_dashboard', 'A14', (req) => (req.query.limit ? { limit: Number(req.query.limit) } : {})));
  router.get('/survey/:nb/status', viaTool('get_survey_status', 'A8', (req) => ({ neighborhoodId: req.params.nb })));
  router.post('/survey/:nb/draft-questionnaire', viaTool('draft_gap_questionnaire', 'A8', (req) => ({ ...body(req), neighborhoodId: req.params.nb })));
  router.post('/cache/invalidate', (req, res) => {
    const id = String(body(req).neighborhoodId ?? '');
    if (!/^[a-z0-9_-]+:[A-Za-z0-9_.-]+$/.test(id)) { fail(res, 400, 'INVALID_INPUT', 'neighborhoodId معتبر لازم است'); return; }
    ok(res, { neighborhoodId: id, cleared: invalidateNeighborhood(id) });
  });

  // ---------------- فاز ۵: میدان و یادگیری ----------------
  const by = (req: Request) => String(body(req).by ?? req.header('x-ara-user') ?? 'operator').slice(0, 80);
  const human = (fn: (req: Request) => Promise<unknown> | unknown) => asyncRoute(async (req, res) => {
    try { ok(res, await fn(req)); } catch (e) { const code = (e as { code?: string }).code ?? 'ERROR'; fail(res, STATUS[code] ?? 400, code, e instanceof Error ? e.message : String(e)); }
  });
  // پژوهش وب (A2): اجرای پس‌زمینه، تأیید نامزد فقط با کارشناس
  try { markInterrupted(); } catch { /* */ }
  router.get('/web/status', (_req, res) => { const u = usageToday(); ok(res, { configured: webConfig().configured, usage: { day: u.day, research: u.research, search: u.search, contents: u.contents, cacheHits: u.cacheHits, costUsd: u.costUsd }, limits: { maxEffort: u.limits.maxEffort, dailyResearch: u.limits.dailyResearch, dailySearch: u.limits.dailySearch, dailyBudgetUsd: u.limits.dailyBudgetUsd } }); });
  router.post('/web/search', viaTool('web_search', 'A2', body));
  router.post('/web/contents', viaTool('fetch_web_contents', 'A2', body));
  router.post('/web/research', human(async (req) => {
    const b = body(req);
    const rec = await startWebResearch({ neighborhoodId: String(b.neighborhoodId ?? ''), codes: Array.isArray(b.codes) ? (b.codes as string[]).slice(0, 10).map(String) : undefined, effort: b.effort as never, maxIndicators: Number(b.maxIndicators ?? 5), offline: b.offline !== false, createdBy: by(req) });
    void runWebResearch(rec.id, { verifySources: b.verifySources === true }).catch(() => undefined);
    return rec;
  }));
  router.get('/web/research', (req, res) => { ok(res, listWebResearch(req.query.nb ? String(req.query.nb) : undefined)); });
  router.get('/web/research/:id', (req, res) => { const r = getWebResearch(req.params.id); if (!r) { fail(res, 404, 'NOT_FOUND', 'پژوهش وب یافت نشد'); return; } ok(res, r); });
  router.post('/web/research/:id/candidates/:code/:idx/decision', human((req) => { const b = body(req); const d = String(b.decision); if (d !== 'approved' && d !== 'rejected') throw Object.assign(new Error('decision باید approved یا rejected باشد'), { code: 'INVALID_INPUT' }); return decideCandidate(req.params.id, req.params.code.toUpperCase(), Number(req.params.idx), d, by(req), { note: b.note as string | undefined, periodEnd: b.periodEnd as string | undefined }); }));
  router.post('/field/campaigns', viaTool('create_field_campaign', 'A8', body));
  router.get('/field/campaigns', viaTool('list_field_campaigns', 'A8', (req) => (req.query.nb ? { neighborhoodId: String(req.query.nb) } : {})));
  router.get('/field/campaigns/:id', viaTool('get_field_campaign', 'A8', (req) => ({ campaignId: req.params.id })));
  router.post('/field/campaigns/:id/decision', human((req) => { const d = String(body(req).decision); if (d !== 'approved' && d !== 'rejected') throw Object.assign(new Error('decision باید approved یا rejected باشد'), { code: 'INVALID_INPUT' }); return decideCampaign(req.params.id, d, by(req), body(req).note as string | undefined); }));
  router.post('/field/campaigns/:id/close', viaTool('close_field_campaign', 'A8', (req) => ({ campaignId: req.params.id, force: body(req).force === true })));
  router.get('/field/cycle/:nb', viaTool('get_field_cycle', 'A14', (req) => ({ neighborhoodId: req.params.nb })));
  router.get('/library', (_req, res) => { ok(res, libraryItems()); });
  router.post('/monitoring', human((req) => { const b = body(req); return registerMonitoring({ neighborhoodId: String(b.neighborhoodId ?? ''), libraryId: String(b.libraryId ?? ''), startDate: b.startDate as string | undefined, note: b.note as string | undefined, offline: b.offline === true, registeredBy: by(req) }); }));
  router.get('/monitoring', viaTool('list_monitoring', 'A14', (req) => (req.query.nb ? { neighborhoodId: String(req.query.nb) } : {})));
  router.get('/monitoring/:id', viaTool('list_monitoring', 'A14', (req) => ({ monitoringId: req.params.id })));
  router.post('/monitoring/:id/evaluate', viaTool('evaluate_monitoring', 'A14', (req) => ({ monitoringId: req.params.id })));
  router.post('/learning/proposals/generate', viaTool('generate_calibration_proposals', 'A14', () => ({})));
  router.get('/learning/proposals', viaTool('list_calibration_proposals', 'A14', (req) => (req.query.status ? { status: String(req.query.status) } : {})));
  router.post('/learning/proposals/:id/decision', human((req) => { const d = String(body(req).decision); if (d !== 'approved' && d !== 'rejected') throw Object.assign(new Error('decision باید approved یا rejected باشد'), { code: 'INVALID_INPUT' }); const p = decideProposal(req.params.id, d, by(req), body(req).note as string | undefined); if (!p) throw Object.assign(new Error('پیشنهاد یافت نشد'), { code: 'NOT_FOUND' }); return p; }));

  router.post('/mcp', asyncRoute(mcpHandler));
  router.get('/mcp', (_req, res) => { res.status(405).set('Allow', 'POST').json({ error: 'این سرور MCP فقط POST (JSON-RPC) را می‌پذیرد؛ جریان SSE پشتیبانی نمی‌شود' }); });
  return router;
}
