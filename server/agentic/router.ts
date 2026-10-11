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

const asyncRoute = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const fail = (res: Response, status: number, code: string, message: string, details?: unknown) => res.status(status).json({ success: false, error: { code, message, details } });
const STATUS: Record<string, number> = { UNKNOWN_TOOL: 404, UNKNOWN_AGENT: 400, FORBIDDEN: 403, INVALID_INPUT: 400, NOT_FOUND: 404, ANALYSIS_EXPIRED: 409, TIMEOUT: 504, INVALID_OUTPUT: 500, TOOL_ERROR: 500 };

export function frameworkInfo() {
  return {
    versions: { tools: TOOLS_VERSION, agentPolicy: AGENT_POLICY_VERSION, evidenceContract: EVIDENCE_PACKET_VERSION, critic: CRITIC_VERSION, graph: GRAPH_VERSION },
    mcp: { endpoint: '/api/agentic/mcp', transport: 'streamable-http (JSON-RPC 2.0, POST)', protocolVersions: MCP_PROTOCOL_VERSIONS, agentHeader: 'x-ara-agent' },
    tools: listTools().length, agents: AGENTS.length, activeAgents: AGENTS.filter((a) => a.status === 'active' && a.id !== 'operator').length,
  };
}

export function createAgenticRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: '2mb' }));

  router.get('/info', (_req, res) => { ok(res, { ...frameworkInfo(), stats: traceStats() }); });
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
    const run = await runStandardGraph({ name: b.name?.slice(0, 120), city: b.city?.slice(0, 60), neighborhoodId: b.neighborhoodId, offline: Boolean(b.offline), useKernel: b.useKernel === true, purpose: b.purpose });
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

  router.post('/mcp', asyncRoute(mcpHandler));
  router.get('/mcp', (_req, res) => { res.status(405).set('Allow', 'POST').json({ error: 'این سرور MCP فقط POST (JSON-RPC) را می‌پذیرد؛ جریان SSE پشتیبانی نمی‌شود' }); });
  return router;
}
