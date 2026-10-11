/**
 * اجراکنندهٔ ابزارها: مجوز عامل (حداقل دسترسی) → اعتبارسنجی ورودی → سقف زمان → اجرا → اعتبارسنجی خروجی → ثبت مسیر.
 * همهٔ مسیرها (REST، MCP، گراف استاندارد) از همین نقطه عبور می‌کنند تا رفتار یکسان و قابل ممیزی باشد.
 */
import crypto from 'node:crypto';
import { canUse, getAgent } from './agents';
import { canonicalJson, validate, withDefaults } from './schema';
import { ToolInputError } from './state';
import { recordTrace, type TraceEntry } from './trace';
import { TOOLS, type ToolDef } from './tools';

export type ToolErrorCode = 'UNKNOWN_TOOL' | 'UNKNOWN_AGENT' | 'FORBIDDEN' | 'INVALID_INPUT' | 'TIMEOUT' | 'TOOL_ERROR' | 'INVALID_OUTPUT' | 'NOT_FOUND' | 'ANALYSIS_EXPIRED';
export interface ToolCallResult {
  ok: boolean; callId: string; tool: string; agentId: string; runId: string | null; durationMs: number;
  inputHash: string; outputHash: string | null; summary: string;
  output?: Record<string, unknown>;
  error?: { code: ToolErrorCode | string; message: string; details?: unknown };
}

const sha = (v: unknown) => `sha256:${crypto.createHash('sha256').update(canonicalJson(v)).digest('hex')}`;
const byName = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDef | undefined { return byName.get(name); }
export function listTools(): ToolDef[] { return TOOLS; }

/** توصیف عمومی ابزار (برای REST و MCP) */
export function describeTool(t: ToolDef) {
  return {
    name: t.name, title: t.title, description: t.description, category: t.category, timeoutMs: t.timeoutMs,
    inputSchema: t.inputSchema, outputSchema: t.outputSchema,
    annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.idempotent, openWorldHint: t.openWorld },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ToolInputError('TIMEOUT', `ابزار بیش از ${ms / 1000} ثانیه طول کشید`)), ms); })]).finally(() => clearTimeout(timer));
}

export async function callTool(name: string, rawInput: unknown, opts: { agentId?: string; runId?: string | null; via?: TraceEntry['via'] } = {}): Promise<ToolCallResult> {
  const callId = `call_${crypto.randomUUID()}`;
  const agentId = opts.agentId ?? 'operator';
  const runId = opts.runId ?? null;
  const started = Date.now();
  const input = (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {}) as Record<string, unknown>;
  const inputHash = sha({ name, input });
  const finish = (r: Omit<ToolCallResult, 'callId' | 'tool' | 'agentId' | 'runId' | 'durationMs' | 'inputHash'>): ToolCallResult => {
    const res: ToolCallResult = { callId, tool: name, agentId, runId, durationMs: Date.now() - started, inputHash, ...r };
    recordTrace({ callId, at: new Date(started).toISOString(), runId, agentId, tool: name, via: opts.via ?? 'internal', ok: res.ok, errorCode: res.error?.code ?? null, durationMs: res.durationMs, inputHash, outputHash: res.outputHash, summary: res.summary });
    return res;
  };
  const fail = (code: string, message: string, details?: unknown) => finish({ ok: false, outputHash: null, summary: `خطا: ${message}`, error: { code, message, details } });

  const tool = byName.get(name);
  if (!tool) return fail('UNKNOWN_TOOL', `ابزار «${name}» وجود ندارد`);
  if (!getAgent(agentId)) return fail('UNKNOWN_AGENT', `عامل «${agentId}» تعریف نشده است`);
  if (!canUse(agentId, name)) return fail('FORBIDDEN', `عامل ${agentId} مجوز ابزار ${name} را ندارد (سیاست حداقل دسترسی)`);
  if (rawInput !== undefined && rawInput !== null && (typeof rawInput !== 'object' || Array.isArray(rawInput))) return fail('INVALID_INPUT', 'ورودی باید شیء JSON باشد');
  const inErrors = validate(tool.inputSchema, input);
  if (inErrors.length) return fail('INVALID_INPUT', 'ورودی با طرح‌وارهٔ ابزار نمی‌خواند', inErrors);
  try {
    const output = await withTimeout(tool.handler(withDefaults(tool.inputSchema, input), { agentId, runId }), tool.timeoutMs);
    const outErrors = validate(tool.outputSchema, output);
    if (outErrors.length) return fail('INVALID_OUTPUT', 'خروجی ابزار با قرارداد نمی‌خواند', outErrors);
    let summary = '';
    try { summary = tool.summarize?.(output) ?? 'انجام شد'; } catch { summary = 'انجام شد'; }
    return finish({ ok: true, output, outputHash: sha(output), summary });
  } catch (error) {
    if (error instanceof ToolInputError) return fail(error.code, error.message);
    return fail('TOOL_ERROR', error instanceof Error ? error.message : String(error));
  }
}
