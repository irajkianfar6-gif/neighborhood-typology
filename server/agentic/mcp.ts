/**
 * سرور MCP داخلی (Model Context Protocol، انتقال HTTP با JSON-RPC 2.0).
 * کلاینت‌های MCP (عامل‌های LLM، Claude/Cursor/…) ابزارهای پلتفرم را با همان قرارداد و سیاست دسترسی می‌بینند.
 * هویت عامل از سرآیند x-ara-agent (پیش‌فرض operator) خوانده می‌شود.
 */
import type { Request, Response } from 'express';
import { getAgent } from './agents';
import { EVIDENCE_PACKET_VERSION } from './evidencePacket';
import { callTool, describeTool, listTools } from './registry';
import { TOOLS_VERSION } from './tools';
import { canUse } from './agents';

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'ara-neighborhood-tools', title: 'ابزارهای تصمیم‌یار جامع محله', version: TOOLS_VERSION };
const INSTRUCTIONS = [
  'ابزارهای قطعی «تصمیم‌یار جامع محله». ترتیب معمول: resolve_neighborhood → run_analysis → locate_bottleneck / test_hypotheses / map_interventions → verify_analysis → render_report.',
  'هیچ عددی را خودتان تولید نکنید؛ فقط خروجی ابزارها را گزارش کنید. شواهد در قالب ' + EVIDENCE_PACKET_VERSION + ' با منشأ کامل‌اند.',
  'اگر resolve_neighborhood مقدار requiresUserChoice=true برگرداند، از کاربر بپرسید. تجویز و انتشار رسمی نیازمند تأیید انسانی است.',
].join('\n');

interface RpcRequest { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const rpcError = (id: RpcRequest['id'], code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const rpcResult = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });

async function handleOne(msg: RpcRequest, agentId: string): Promise<unknown | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid Request');
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '');
      return rpcResult(msg.id, { protocolVersion: MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list': {
      const tools = listTools().filter((t) => canUse(agentId, t.name)).map((t) => { const d = describeTool(t); return { name: d.name, title: d.title, description: d.description, inputSchema: d.inputSchema, outputSchema: d.outputSchema, annotations: d.annotations }; });
      return rpcResult(msg.id, { tools });
    }
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const r = await callTool(name, msg.params?.arguments ?? {}, { agentId, via: 'mcp' });
      if (!r.ok && (r.error?.code === 'UNKNOWN_TOOL')) return rpcError(msg.id, -32602, r.error.message);
      const payload = r.ok ? r.output : { error: r.error, callId: r.callId };
      return rpcResult(msg.id, { content: [{ type: 'text', text: JSON.stringify(payload) }], ...(r.ok ? { structuredContent: r.output } : {}), isError: !r.ok, _meta: { callId: r.callId, durationMs: r.durationMs, summary: r.summary } });
    }
    default:
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function mcpHandler(req: Request, res: Response): Promise<void> {
  const agentId = String(req.header('x-ara-agent') ?? 'operator');
  if (!getAgent(agentId)) { res.status(403).json(rpcError(null, -32001, `عامل ناشناخته: ${agentId}`)); return; }
  const body = req.body as RpcRequest | RpcRequest[] | undefined;
  if (!body || (typeof body !== 'object')) { res.status(400).json(rpcError(null, -32700, 'Parse error')); return; }
  res.setHeader('MCP-Protocol-Version', String(req.header('mcp-protocol-version') ?? MCP_PROTOCOL_VERSIONS[0]));
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(m, agentId)))).filter((x) => x !== null);
    if (!out.length) { res.status(202).end(); return; }
    res.json(out); return;
  }
  const out = await handleOne(body, agentId);
  if (out === null) { res.status(202).end(); return; }
  res.json(out);
}
