/**
 * عملیات (OPS-v1): دفتر مصرف هوش مصنوعی، گزارش هزینه، ثبت خطا و هشدار.
 *  - مصرف هوش مصنوعی روزانه به تفکیک سرویس (فراخوانی، موفق، شکست، توکن ورودی/خروجی؛ برآورد هزینه با
 *    ARA_AI_PRICE_IN_PER_MTOK و ARA_AI_PRICE_OUT_PER_MTOK دلار به‌ازای یک میلیون توکن).
 *  - خطاهای سرور (۵xx) در حلقهٔ حافظه + فایل؛ هشدار به ARA_ALERT_WEBHOOK_URL (بدنهٔ JSON با فیلد text؛ سازگار با Slack/Teams/Mattermost)
 *    با جلوگیری از تکرار (ARA_ALERT_DEBOUNCE_MIN، پیش‌فرض ۳۰ دقیقه برای هر کلید).
 */
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';

export const OPS_VERSION = 'OPS-v1';
const opsDir = () => { const d = path.join(serverDataDir(), 'agentic', 'ops'); fs.mkdirSync(d, { recursive: true }); return d; };
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const readJson = <T>(f: string, dflt: T): T => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T; } catch { return dflt; } };

// ---------------- مصرف هوش مصنوعی ----------------
export interface AiDay { calls: number; ok: number; failures: number; inputTokens: number; outputTokens: number }
type AiLedger = Record<string, Record<string, AiDay>>; // day → provider → usage
const aiFile = () => path.join(opsDir(), 'ai-usage.json');
export function recordAiUsage(provider: string, ok: boolean, usage?: unknown) {
  try {
    const all = readJson<AiLedger>(aiFile(), {}); const d = day();
    const u = ((all[d] ??= {})[provider] ??= { calls: 0, ok: 0, failures: 0, inputTokens: 0, outputTokens: 0 });
    u.calls++; if (ok) u.ok++; else u.failures++;
    const x = (usage ?? {}) as { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
    u.inputTokens += Number(x.input_tokens ?? x.prompt_tokens ?? 0) || 0; u.outputTokens += Number(x.output_tokens ?? x.completion_tokens ?? 0) || 0;
    // نگه‌داری ۱۸۰ روز
    for (const k of Object.keys(all).sort().slice(0, Math.max(0, Object.keys(all).length - 180))) delete all[k];
    fs.writeFileSync(aiFile(), JSON.stringify(all, null, 1));
  } catch { /* دفتر مصرف اختیاری است */ }
}

/** گزارش هزینهٔ روزانه (پژوهش وب + هوش مصنوعی) برای n روز اخیر */
export function costReport(days = 30) {
  const n = Math.max(1, Math.min(180, days));
  const web = readJson<Record<string, { research: number; search: number; contents: number; costUsd: number; cacheHits: number }>>(path.join(serverDataDir(), 'agentic', 'webresearch', 'usage.json'), {});
  const ai = readJson<AiLedger>(aiFile(), {});
  const pin = Number(process.env.ARA_AI_PRICE_IN_PER_MTOK || 0); const pout = Number(process.env.ARA_AI_PRICE_OUT_PER_MTOK || 0);
  const priced = pin > 0 || pout > 0;
  const rows: Array<{ day: string; web: { research: number; search: number; contents: number; cacheHits: number; costUsd: number }; ai: { calls: number; ok: number; failures: number; inputTokens: number; outputTokens: number; costUsd: number | null } }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = day(new Date(Date.now() - i * 86_400_000));
    const w = web[d] ?? { research: 0, search: 0, contents: 0, costUsd: 0, cacheHits: 0 };
    const a = Object.values(ai[d] ?? {}).reduce((s, x) => ({ calls: s.calls + x.calls, ok: s.ok + x.ok, failures: s.failures + x.failures, inputTokens: s.inputTokens + x.inputTokens, outputTokens: s.outputTokens + x.outputTokens }), { calls: 0, ok: 0, failures: 0, inputTokens: 0, outputTokens: 0 });
    rows.push({ day: d, web: { research: w.research, search: w.search, contents: w.contents, cacheHits: w.cacheHits, costUsd: w.costUsd }, ai: { ...a, costUsd: priced ? Math.round(((a.inputTokens * pin + a.outputTokens * pout) / 1e6) * 1000) / 1000 : null } });
  }
  const sum = (f: (r: typeof rows[number]) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 1000) / 1000;
  return {
    version: OPS_VERSION, days: n, rows,
    totals: { webUsd: sum((r) => r.web.costUsd), aiUsd: priced ? sum((r) => r.ai.costUsd ?? 0) : null, webResearch: sum((r) => r.web.research), aiCalls: sum((r) => r.ai.calls), aiFailures: sum((r) => r.ai.failures), aiTokens: sum((r) => r.ai.inputTokens + r.ai.outputTokens) },
    aiPriced: priced,
  };
}

// ---------------- خطا ----------------
export interface ErrorEntry { at: string; method: string; route: string; status: number; code: string; message: string }
const RING: ErrorEntry[] = []; const RING_MAX = 200;
const errFile = () => path.join(opsDir(), 'errors.jsonl');
export function recordError(e: Omit<ErrorEntry, 'at'>) {
  const x: ErrorEntry = { at: new Date().toISOString(), ...e, message: String(e.message).slice(0, 300) };
  RING.push(x); if (RING.length > RING_MAX) RING.shift();
  try {
    fs.appendFileSync(errFile(), `${JSON.stringify(x)}\n`);
    const st = fs.statSync(errFile()); if (st.size > 2_000_000) { const lines = fs.readFileSync(errFile(), 'utf8').trim().split('\n').slice(-2000); fs.writeFileSync(errFile(), `${lines.join('\n')}\n`); }
  } catch { /* */ }
  const recent = RING.filter((r) => Date.now() - Date.parse(r.at) < 10 * 60_000).length;
  if (recent >= Number(process.env.ARA_ALERT_5XX_BURST || 10)) void alert('http_5xx_burst', 'خطاهای پیاپی سرور', `${recent} خطای ۵xx در ۱۰ دقیقهٔ اخیر؛ آخرین: ${x.method} ${x.route} — ${x.message}`);
}
export function listErrors(limit = 50): ErrorEntry[] {
  if (!RING.length) { try { for (const l of fs.readFileSync(errFile(), 'utf8').trim().split('\n').slice(-RING_MAX)) RING.push(JSON.parse(l)); } catch { /* */ } }
  return RING.slice(-limit).reverse();
}
export function errorsLastHour(): number { return RING.filter((r) => Date.now() - Date.parse(r.at) < 3_600_000).length; }

// ---------------- هشدار ----------------
export interface AlertEntry { at: string; key: string; title: string; detail: string; delivered: boolean | null; error?: string }
const lastSent = new Map<string, number>();
const alertsFile = () => path.join(opsDir(), 'alerts.jsonl');
type Fetch = typeof fetch;
let alertFetch: Fetch | null = null;
export function _setAlertFetch(f: Fetch | null) { alertFetch = f; lastSent.clear(); }
export async function alert(key: string, title: string, detail: string): Promise<AlertEntry | null> {
  const debounce = Math.max(0, Number(process.env.ARA_ALERT_DEBOUNCE_MIN ?? 30)) * 60_000;
  const prev = lastSent.get(key);
  if (prev !== undefined && Date.now() - prev < debounce) return null;
  lastSent.set(key, Date.now());
  const e: AlertEntry = { at: new Date().toISOString(), key, title, detail: detail.slice(0, 600), delivered: null };
  const url = process.env.ARA_ALERT_WEBHOOK_URL;
  if (url) {
    try {
      const r = await (alertFetch ?? fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `⚠️ ${title}\n${e.detail}`, key, at: e.at, source: 'ara-decision-platform' }), signal: AbortSignal.timeout(10_000) });
      e.delivered = r.ok; if (!r.ok) e.error = `وضعیت ${r.status}`;
    } catch (err) { e.delivered = false; e.error = String((err as Error)?.message ?? err).slice(0, 200); }
  }
  try { fs.appendFileSync(alertsFile(), `${JSON.stringify(e)}\n`); } catch { /* */ }
  console.warn(`[alert] ${title}: ${e.detail}`);
  return e;
}
export function listAlerts(limit = 50): AlertEntry[] {
  try { return fs.readFileSync(alertsFile(), 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l) as AlertEntry).reverse(); } catch { return []; }
}
