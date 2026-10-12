// ============================================================
// فریمورک ایجنتیک تصمیم‌یار: اجرای خودکار «از نام محله تا گزارش» با عامل‌های تخصصی،
// دروازه‌های کیفیت، صف تأیید انسانی، کاتالوگ ابزارها (MCP) و سیاست دسترسی عامل‌ها
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, Clock, FileText, Loader2, Play, ShieldCheck, Wrench, XCircle } from 'lucide-react';
import { BatchTab, CopilotTab } from './AgenticPhase2Tabs';
import { ResearchTab } from './AgenticResearchTab';
import { DashboardTab, ScenarioTab, SurveyTab } from './AgenticPhase4Tabs';
import { FieldLearningTab } from './AgenticPhase5Tab';
import { agenticApi, type AgenticAgent, type AgenticInfo, type AgenticRun, type AgenticRunSummary, type AgenticToolInfo, type StorageStatus, type AiHealth, type ToolCallResponse } from '../algorithm/agenticApi';

type Tab = 'copilot' | 'run' | 'batch' | 'research' | 'survey' | 'field' | 'scenario' | 'dashboard' | 'agents' | 'tools';
const STATUS_FA: Record<AgenticRun['status'], { label: string; cls: string }> = {
  queued: { label: 'در صف', cls: 'bg-slate-100 text-slate-800 dark:bg-wall-700 dark:text-slate-200' },
  cancelled: { label: 'لغو شد', cls: 'bg-slate-100 text-slate-800 dark:bg-wall-700 dark:text-slate-200' },
  running: { label: 'در حال اجرا', cls: 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200' },
  completed: { label: 'کامل شد', cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200' },
  needs_user: { label: 'منتظر انتخاب شما', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200' },
  blocked: { label: 'متوقف با نقاد', cls: 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200' },
  failed: { label: 'ناموفق', cls: 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200' },
};
const GATE_CLS: Record<string, string> = { passed: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20', warning: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20', blocked: 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20', pending: 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-900/20' };
const GATE_FA: Record<string, string> = { passed: 'عبور', warning: 'هشدار', blocked: 'مسدود', pending: 'منتظر تأیید' };
const LEVEL_FA: Record<string, string> = { PUBLISHABLE: 'قابل انتشار', PROVISIONAL: 'موقت', INSUFFICIENT: 'ناکافی' };
const AUTONOMY_FA: Record<string, string> = { full: 'کاملاً خودکار', full_with_gate: 'خودکار با دروازه', draft_only: 'پیش‌نویس؛ تصمیم با انسان', human: 'انسان' };
const CAT_FA: Record<string, string> = { identity: 'هویت و مرز', data: 'داده', quality: 'کیفیت', measurement: 'سنجه', diagnosis: 'تشخیص', prescription: 'تجویز', survey: 'پیمایش و میدان', governance: 'حاکمیت', report: 'گزارش' };
const fa = (n: number) => n.toLocaleString('fa-IR');
const card = 'rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800';

function StepIcon({ s }: { s: string }) {
  if (s === 'done') return <CheckCircle2 size={14} className="text-emerald-600" />;
  if (s === 'failed') return <XCircle size={14} className="text-rose-600" />;
  return <Clock size={14} className="text-ink-500" />;
}

export default function AgenticFrameworkPage() {
  const [tab, setTab] = useState<Tab>('copilot');
  const [info, setInfo] = useState<AgenticInfo | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [agents, setAgents] = useState<AgenticAgent[]>([]);
  const [tools, setTools] = useState<AgenticToolInfo[]>([]);
  const [runs, setRuns] = useState<AgenticRunSummary[]>([]);
  const [run, setRun] = useState<AgenticRun | null>(null);
  const [name, setName] = useState('یوسف آباد');
  const [city, setCity] = useState('تهران');
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [i, a, t, r] = await Promise.all([agenticApi.info(), agenticApi.agents(), agenticApi.tools(), agenticApi.runs()]);
      setInfo(i); setAgents(a); setTools(t); setRuns(r);
      void agenticApi.storage().then(setStorage).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const start = async (input: { name?: string; city?: string; neighborhoodId?: string }) => {
    setBusy(true); setError(null); setShowReport(false);
    try { setRun(await agenticApi.start({ ...input, offline })); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const decide = async (approvalId: string, decision: 'approved' | 'rejected') => {
    if (!run) return;
    try { setRun(await agenticApi.decide(run.runId, approvalId, decision)); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const agentName = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.nameFa])), [agents]);

  return (
    <div className="space-y-4 p-4 text-sm" dir="rtl">
      <header className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-black"><Bot size={20} /> فریمورک ایجنتیک تصمیم‌یار</h1>
          <p className="mt-1 text-xs text-ink-500">عامل‌های تخصصی، کل مسیر «نام محله ← شواهد ← سنجه ← تشخیص ← تجویز ← نقد ← گزارش» را با ابزارهای قطعی اجرا می‌کنند. هیچ عددی را هوش مصنوعی نمی‌سازد.</p>
        </div>
        {info && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-wall-700">{fa(info.activeAgents)} عامل فعال از {fa(info.agents - 1)}</span>
            <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-wall-700">{fa(info.tools)} ابزار استاندارد</span>
            <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-wall-700">{fa(info.stats.calls)} فراخوانی · {fa(info.stats.errors)} خطا</span>
            <span className={`rounded-full px-2 py-1 ${info.llm?.configured ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'}`}>{info.llm?.configured ? 'هوش مصنوعی: فعال' : 'هوش مصنوعی تنظیم نشده (حالت قطعی)'}</span>
            {info.queue && <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-wall-700">صف: {fa(info.queue.running ?? 0)} در اجرا · {fa(info.queue.queued ?? 0)} منتظر</span>}
            <span className="rounded-full bg-slate-100 px-2 py-1 font-mono dark:bg-wall-700" dir="ltr">MCP: {info.mcp.endpoint}</span>
          </div>
        )}
      </header>

      <nav className="flex flex-wrap gap-2">
        {([['copilot', 'دستیار عامل‌محور'], ['run', 'اجرای خودکار'], ['batch', 'اجرای دسته‌ای شهر'], ['research', 'پژوهش خودکار'], ['survey', 'دادهٔ پیمایشی (پرسشنامه)'], ['field', 'میدان و یادگیری'], ['scenario', 'شبیه‌سازی سناریو'], ['dashboard', 'داشبورد عامل‌ها'], ['agents', 'عامل‌ها و دسترسی‌ها'], ['tools', 'ابزارها (MCP)']] as Array<[Tab, string]>).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-3 py-1.5 text-xs font-bold ${tab === k ? 'bg-brand-600 text-white' : 'bg-surface border border-line dark:border-wall-700 dark:bg-wall-800'}`}>{l}</button>
        ))}
      </nav>
      {error && <p className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200">{error}</p>}

      {tab === 'run' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <section className={card}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs">نام محله<input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-line bg-transparent px-2 py-1.5 dark:border-wall-700" /></label>
                <label className="flex flex-col gap-1 text-xs">شهر<input value={city} onChange={(e) => setCity(e.target.value)} className="w-28 rounded-lg border border-line bg-transparent px-2 py-1.5 dark:border-wall-700" /></label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> فقط دادهٔ ذخیره‌شده (بدون اینترنت)</label>
                <button disabled={busy || !name.trim()} onClick={() => void start({ name: name.trim(), city: city.trim() || undefined })} className="flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} اجرای خودکار کامل
                </button>
              </div>
              {busy && <p className="mt-2 text-xs text-ink-500">عامل‌ها در حال کارند؛ گردآوری داده‌های باز ممکن است چند دقیقه طول بکشد…</p>}
            </section>

            {run && (
              <>
                <section className={card}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black">{run.nameFa ?? run.input?.name ?? '—'} <span className="font-mono text-[10px] text-ink-500" dir="ltr">{run.runId}</span></p>
                    <div className="flex gap-2 text-[11px]">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_FA[run.status].cls}`}>{STATUS_FA[run.status].label}</span>
                      {run.level && <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-wall-700">کارت: {LEVEL_FA[run.level] ?? run.level}</span>}
                    </div>
                  </div>
                  {run.status === 'needs_user' && run.outputs.candidates && (
                    <div className="mb-3 space-y-1">
                      <p className="text-xs font-bold">نام مبهم است؛ محلهٔ درست را انتخاب کنید:</p>
                      <div className="flex flex-wrap gap-2">
                        {run.outputs.candidates.map((c) => (
                          <button key={c.neighborhoodId} onClick={() => void start({ neighborhoodId: c.neighborhoodId })} className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-slate-50 dark:border-wall-700 dark:hover:bg-wall-700">
                            {c.nameFa} — {c.cityFa}{c.districtFa ? `، ${c.districtFa}` : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <ol className="space-y-1.5">
                    {run.steps.map((s) => (
                      <li key={s.id + s.tool} className="flex items-start gap-2 text-xs">
                        <StepIcon s={s.status} />
                        <span className="w-10 shrink-0 font-mono text-[10px] text-ink-500">{s.agentId}</span>
                        <span className="min-w-0 flex-1"><b>{s.title}</b> <span className="text-ink-500">({agentName[s.agentId] ?? s.agentId} · <span dir="ltr" className="font-mono">{s.tool}</span> · {fa(s.durationMs)} ms)</span><br />{s.error ? <span className="text-rose-700">{s.error}</span> : s.summary}</span>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className={card}>
                  <p className="mb-2 flex items-center gap-2 font-black"><ShieldCheck size={14} /> دروازه‌های کیفیت</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {run.gates.map((g) => (
                      <div key={g.id} className={`rounded-xl border p-2 text-xs ${GATE_CLS[g.status]}`}>
                        <p className="font-bold">{g.id} · {g.title} — {GATE_FA[g.status]}</p>
                        <p className="mt-1 text-ink-600 dark:text-ink-300">{g.detail}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {run.outputs.critic && (
                  <section className={card}>
                    <p className="mb-2 flex items-center gap-2 font-black"><CircleAlert size={14} /> بازبینی نقاد: {run.outputs.critic.verdict}</p>
                    <ul className="space-y-1 text-xs">
                      {run.outputs.critic.checks.map((c) => (
                        <li key={c.id}><span className={c.status === 'pass' ? 'text-emerald-700' : c.status === 'warn' ? 'text-amber-700' : 'text-rose-700'}>{c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '⛔'}</span> <b>{c.title}</b> — <span className="text-ink-500">{c.detail}</span></li>
                      ))}
                    </ul>
                  </section>
                )}

                {run.outputs.report && (
                  <section className={card}>
                    <button onClick={() => setShowReport((x) => !x)} className="flex items-center gap-2 font-black"><FileText size={14} /> گزارش تحلیلی {showReport ? '▲' : '▼'}</button>
                    {showReport && <pre className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[11px] leading-6 dark:bg-wall-900">{run.outputs.report}</pre>}
                  </section>
                )}
              </>
            )}
          </div>

          <aside className="space-y-4">
            {run && run.approvals.length > 0 && (
              <section className={card}>
                <p className="mb-2 font-black">صف تأیید انسانی</p>
                <ul className="space-y-2 text-xs">
                  {run.approvals.map((a) => (
                    <li key={a.id} className="rounded-xl border border-line p-2 dark:border-wall-700">
                      <p className="font-bold">{a.title}</p>
                      {a.status === 'pending' && a.kind !== 'neighborhood_choice' ? (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => void decide(a.id, 'approved')} className="rounded-lg bg-emerald-600 px-2 py-1 text-white">تأیید</button>
                          <button onClick={() => void decide(a.id, 'rejected')} className="rounded-lg bg-rose-600 px-2 py-1 text-white">رد</button>
                        </div>
                      ) : <p className="mt-1 text-ink-500">{a.status === 'approved' ? 'تأیید شد' : a.status === 'rejected' ? 'رد شد' : 'از فهرست نامزدها انتخاب کنید'}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className={card}>
              <p className="mb-2 font-black">اجراهای اخیر</p>
              {runs.length === 0 ? <p className="text-xs text-ink-500">هنوز اجرایی نیست.</p> : (
                <ul className="space-y-1 text-xs">
                  {runs.map((r) => (
                    <li key={r.runId}>
                      <button onClick={() => void agenticApi.run(r.runId).then(setRun)} className="w-full rounded-lg px-2 py-1 text-right hover:bg-slate-50 dark:hover:bg-wall-700">
                        <b>{r.nameFa ?? r.neighborhoodId ?? '—'}</b> · {STATUS_FA[r.status].label}{r.level ? ` · ${LEVEL_FA[r.level] ?? r.level}` : ''}{r.pendingApprovals ? ` · ${fa(r.pendingApprovals)} تأیید معلق` : ''}
                        <br /><span className="text-[10px] text-ink-500">{new Date(r.createdAt).toLocaleString('fa-IR')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}

      {tab === 'agents' && (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.filter((a) => a.id !== 'operator').map((a) => (
            <div key={a.id} className={`${card} text-xs ${a.status === 'planned' ? 'opacity-70' : ''}`}>
              <div className="flex items-center justify-between"><p className="font-black">{a.id} · {a.nameFa}</p><span className={`rounded-full px-2 py-0.5 text-[10px] ${a.status === 'active' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200' : 'bg-slate-100 dark:bg-wall-700'}`}>{a.status === 'active' ? 'فعال' : `فاز ${fa(a.phase)}`}</span></div>
              <p className="mt-1 text-ink-600 dark:text-ink-300">{a.mission}</p>
              <p className="mt-2"><b>خودکاری:</b> {AUTONOMY_FA[a.autonomy] ?? a.autonomy}</p>
              <p className="mt-1"><b>ابزارهای مجاز:</b> <span dir="ltr" className="font-mono text-[10px]">{a.tools.join(', ')}</span></p>
              {a.humanApproval.length > 0 && <p className="mt-1 text-amber-800 dark:text-amber-300"><b>تأیید انسانی:</b> {a.humanApproval.join('؛ ')}</p>}
            </div>
          ))}
        </section>
      )}

      {tab === 'copilot' && <CopilotTab agentName={agentName} llmConfigured={Boolean(info?.llm?.configured)} />}
      {tab === 'batch' && <BatchTab />}
      {tab === 'research' && <ResearchTab />}
      {tab === 'survey' && <SurveyTab llmConfigured={Boolean(info?.llm?.configured)} />}
      {tab === 'field' && <FieldLearningTab onOpenSurvey={() => setTab('survey')} />}
      {tab === 'scenario' && <ScenarioTab llmConfigured={Boolean(info?.llm?.configured)} />}
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'tools' && <ToolsTab tools={tools} agents={agents} info={info} storage={storage} />}
    </div>
  );
}

const AI_STATE: Record<string, string> = { closed: 'سالم', half_open: 'در حال آزمون', open: 'موقتاً کنار گذاشته شده' };
function AiHealthLine() {
  const [h, setH] = useState<AiHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);
  useEffect(() => { void agenticApi.aiHealth().then(setH).catch(() => undefined); }, []);
  if (!h) return null;
  const run = async () => { setBusy(true); setProbe(null); try { const r = await agenticApi.aiProbe(); setH(r.health); setProbe(r.results.map((x) => `${x.labelFa}: ${x.ok ? `پاسخ داد (${fa(x.ms)} میلی‌ثانیه)` : 'پاسخ نداد'}`).join(' · ') || 'سرویسی پیکربندی نشده'); } catch { setProbe('آزمون ناموفق بود'); } finally { setBusy(false); } };
  return <p className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-wall-900">هوش مصنوعی: {!h.configured ? 'پیکربندی نشده (سامانه بدون هوش مصنوعی کار می‌کند)' : h.providers.map((p) => `${p.labelFa} ${AI_STATE[p.state] ?? p.state}${p.calls ? ` (${fa(p.ok)} موفق از ${fa(p.calls)})` : ''}`).join(' · ')}
    {h.configured && h.providers.length < 2 && ' · سرویس پشتیبان تعریف نشده'}
    {h.configured && <button type="button" disabled={busy} onClick={() => void run()} className="mr-2 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:opacity-50 dark:border-wall-700">{busy ? 'در حال آزمون…' : 'آزمون اتصال'}</button>}
    {probe && <span className="mr-2 text-slate-600 dark:text-slate-300">{probe}</span>}</p>;
}

function ToolsTab({ tools, agents, info, storage }: { tools: AgenticToolInfo[]; agents: AgenticAgent[]; info: AgenticInfo | null; storage: StorageStatus | null }) {
  const [sel, setSel] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('operator');
  const [input, setInput] = useState('{\n  "neighborhoodId": "tehran:m605"\n}');
  const [res, setRes] = useState<ToolCallResponse | { error: string; details?: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const tool = tools.find((t) => t.name === sel) ?? null;
  const exec = async () => {
    if (!tool) return;
    setBusy(true); setRes(null);
    try { setRes(await agenticApi.callTool(tool.name, agentId, JSON.parse(input || '{}'))); }
    catch (e) { setRes({ error: e instanceof Error ? e.message : String(e), details: (e as { details?: unknown }).details }); }
    finally { setBusy(false); }
  };
  const groups = tools.reduce<Record<string, AgenticToolInfo[]>>((acc, t) => { (acc[t.category] ??= []).push(t); return acc; }, {});
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className={`${card} space-y-3 text-xs`}>
        <AiHealthLine />
        {storage && <p className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-wall-900">ذخیره‌سازی پایدار: {storage.sync.active
          ? <>PostgreSQL فعال · پرونده‌های همگام {storage.sync.tracked.toLocaleString('fa-IR')} · در صف {storage.sync.pending.toLocaleString('fa-IR')}{storage.sync.failures ? ` · خطا ${storage.sync.failures.toLocaleString('fa-IR')}` : ''} · جست‌وجوی برداری {storage.memory.vectorStore === 'pgvector' ? 'در پایگاه داده' : 'درون‌برنامه‌ای'}</>
          : <>فقط فایل محلی{storage.sync.enabled && storage.sync.lastError ? ` (اتصال به پایگاه داده ناموفق: ${storage.sync.lastError})` : ''} · جست‌وجوی ترکیبی درون‌برنامه‌ای</>}</p>}
        {info && <p className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-wall-900">اتصال کلاینت MCP: <span dir="ltr" className="font-mono">POST {info.mcp.endpoint}</span> · سرآیند عامل: <span dir="ltr" className="font-mono">{info.mcp.agentHeader}</span> · نسخه‌ها: <span dir="ltr" className="font-mono">{Object.values(info.versions).join(' · ')}</span></p>}
        {Object.entries(groups).map(([cat, ts]) => (
          <div key={cat}>
            <p className="mb-1 font-black">{CAT_FA[cat] ?? cat}</p>
            {ts.map((t) => (
              <button key={t.name} onClick={() => { setSel(t.name); setRes(null); }} className={`block w-full rounded-lg px-2 py-1 text-right ${sel === t.name ? 'bg-brand-600 text-white' : 'hover:bg-slate-50 dark:hover:bg-wall-700'}`}>
                {t.title} <span dir="ltr" className="font-mono text-[10px] opacity-70">{t.name}</span>
              </button>
            ))}
          </div>
        ))}
      </section>
      <section className={`${card} space-y-3 text-xs lg:col-span-2`}>
        {!tool ? <p className="flex items-center gap-2 text-ink-500"><Wrench size={14} /> یک ابزار را انتخاب کنید.</p> : (
          <>
            <p className="font-black">{tool.title} <span dir="ltr" className="font-mono text-[10px]">{tool.name}</span></p>
            <p className="text-ink-600 dark:text-ink-300">{tool.description}</p>
            <p className="text-[11px] text-ink-500">{tool.annotations.readOnlyHint ? 'فقط‌خواندنی' : 'ذخیرهٔ کارت'} · {tool.annotations.openWorldHint ? 'ممکن است به منابع بیرونی وصل شود' : 'فقط دادهٔ داخلی'} · سقف زمان {fa(tool.timeoutMs / 1000)} ثانیه · عامل‌های مجاز: {agents.filter((a) => a.tools.includes(tool.name)).map((a) => a.id).join('، ') || '—'}</p>
            <div className="rounded-lg bg-slate-50 p-2 dark:bg-wall-900">
              <p className="mb-1 font-bold">ورودی‌ها</p>
              {Object.entries(tool.inputSchema.properties ?? {}).length === 0 ? <p className="text-ink-500">بدون ورودی</p> : (
                <ul className="space-y-0.5">{Object.entries(tool.inputSchema.properties ?? {}).map(([k, p]) => <li key={k}><span dir="ltr" className="font-mono">{k}</span>{tool.inputSchema.required?.includes(k) ? ' *' : ''} — {p.description ?? (p.enum ? p.enum.join(' | ') : Array.isArray(p.type) ? p.type.join('|') : p.type)}</li>)}</ul>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">فراخوانی به‌عنوان
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="rounded-lg border border-line bg-transparent px-1 py-1 dark:border-wall-700">
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.nameFa}</option>)}
                </select>
              </label>
              <button disabled={busy} onClick={() => void exec()} className="flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-1.5 font-bold text-white disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} اجرا</button>
            </div>
            <textarea dir="ltr" value={input} onChange={(e) => setInput(e.target.value)} rows={5} className="w-full rounded-lg border border-line bg-transparent p-2 font-mono text-[11px] dark:border-wall-700" />
            {res && <pre dir="ltr" className="max-h-[420px] overflow-auto rounded-lg bg-slate-50 p-2 text-[10px] dark:bg-wall-900">{JSON.stringify(res, null, 2)}</pre>}
          </>
        )}
      </section>
    </div>
  );
}
