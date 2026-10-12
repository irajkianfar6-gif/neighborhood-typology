// ============================================================
// فاز ۴ فریمورک ایجنتیک: دادهٔ پیمایشی (پرسشنامه)، شبیه‌سازی سناریو و حساسیت (A11)،
// آزمون نقاد (A12) و داشبورد عامل‌ها (A14)
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Activity, ClipboardList, FlaskConical, Loader2, Play, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { agenticApi, type AgentDashboard, type CriticSuiteResult, type LlmReviewResult, type ScenarioEval, type ScenarioResult, type SensitivityResult, type SurveyStatus } from '../algorithm/agenticApi';
import { analyzeNeighborhoodByName, type DecisionCardV2, type NeighborhoodCandidate } from '../algorithm/neighborhoodApi';
import { ALGORITHM_INDICATORS } from '../algorithm/algorithmIndicators';
import { CAPITAL_FA, CHAIN_FA, CAPITALS, DIAGNOSTIC_TYPES, type CapitalKey, type ChainStage, type DiagnosticType } from '../algorithm/types';
import DataCollectionHub from './datacollection/DataCollectionHub';

const fa = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 1 });
const card = 'rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800';
const input = 'rounded-lg border border-line bg-transparent px-2 py-1.5 dark:border-wall-700';
const btn = 'flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50';
const btn2 = 'flex items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-xs font-bold disabled:opacity-50 dark:border-wall-700';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const Err = ({ e }: { e: string | null }) => (e ? <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-900">{e}</div> : null);
const capFa = (k: string) => CAPITAL_FA[k as CapitalKey] ?? k;
const stageFa = (k: string) => CHAIN_FA[k as ChainStage] ?? k;
const typeFa = (t: string | null) => (t ? `${t} — ${DIAGNOSTIC_TYPES[t as DiagnosticType]?.interpretation ?? ''}` : '—');
const bnFa = (b: ScenarioEval['bottleneck']) => (b ? `${capFa(b.capital)}: ${stageFa(b.transition[0])} ← ${stageFa(b.transition[1])}` : '—');

/** انتخاب محله با نام (و حل ابهام) — برای زبانهٔ پیمایش */
function NeighborhoodPicker({ onCard, busy, setBusy }: { onCard: (c: DecisionCardV2) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const [name, setName] = useState('یوسف آباد');
  const [city, setCity] = useState('تهران');
  const [cands, setCands] = useState<NeighborhoodCandidate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const go = async (q: { name?: string; city?: string; neighborhoodId?: string }) => {
    setBusy(true); setErr(null); setCands([]);
    try {
      const r = await analyzeNeighborhoodByName(q);
      if ('card' in r) onCard(r.card); else setCands(r.candidates);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">نام محله<input className={input} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="flex flex-col gap-1">شهر<input className={input} value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <button className={btn} disabled={busy || name.trim().length < 2} onClick={() => void go({ name, city })}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} بارگذاری محله</button>
      </div>
      {cands.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs"><span className="text-muted">نام مبهم است؛ انتخاب کنید:</span>
          {cands.map((c) => <button key={c.neighborhoodId} className={btn2} onClick={() => void go({ neighborhoodId: c.neighborhoodId })}>{c.nameFa}، {c.districtFa ?? c.cityFa}</button>)}
        </div>
      )}
      <Err e={err} />
    </div>
  );
}

export function SurveyTab({ llmConfigured }: { llmConfigured: boolean }) {
  const [cardV2, setCard] = useState<DecisionCardV2 | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SurveyStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const id = cardV2?.neighborhood.neighborhoodId ?? null;
  const loadStatus = async (nb: string) => { try { setStatus(await agenticApi.surveyStatus(nb)); } catch (e) { setErr(errMsg(e)); } };
  useEffect(() => { if (id) void loadStatus(id); }, [id, cardV2?.generatedAt]);
  const reanalyze = async (nb: string) => {
    setBusy(true); setErr(null);
    try { await agenticApi.invalidateCache(nb); const r = await analyzeNeighborhoodByName({ neighborhoodId: nb }); if ('card' in r) setCard(r.card); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const draftQ = async () => {
    if (!id) return; setBusy(true); setErr(null); setDraft(null);
    try { const d = await agenticApi.draftGapQuestionnaire(id); setDraft(`پیش‌نویس «${d.title}» با ${fa(d.items)} گویه برای ${d.indicators.join('، ')} ساخته شد؛ در «پرسشنامه‌های سفارشی» پایین بازبینی و منتشر کنید.`); await loadStatus(id); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-1 flex items-center gap-1 text-sm font-bold"><ClipboardList className="h-4 w-4" /> دادهٔ پیمایشی و پرسشنامه (عامل A8)</h3>
        <p className="mb-3 text-xs text-muted">همان ابزار گردآوری دادهٔ «تصمیم‌یار محله»: پیمایش ادراکی، پرسشنامهٔ سفارشی، ورود گروهی پاسخ، ممیزی میدانی و ثبت محلی. پس از ورود داده، «تحلیل دوباره» حافظهٔ کاری عامل‌ها را هم تازه می‌کند تا اجراهای بعدی دادهٔ جدید را ببینند.</p>
        <NeighborhoodPicker onCard={(c) => { setCard(c); setDraft(null); }} busy={busy} setBusy={setBusy} />
      </div>
      <Err e={err} />
      {status && (
        <div className={`${card} text-xs`}>
          <div className="mb-2 font-bold">وضعیت دادهٔ پیمایشی — {status.name}</div>
          <div className="grid gap-2 sm:grid-cols-4">
            <div>پاسخ پذیرفتهٔ پیمایش ادراکی: <b>{fa(status.perceptual.nAccepted)}</b> از {fa(status.plan.recommendedN)} نمونهٔ توصیه‌شده</div>
            <div>پرسشنامهٔ سفارشی دارای داده: <b>{fa(status.custom.length)}</b>؛ پیش‌نویس: {fa(status.drafts.length)}</div>
            <div>نقطهٔ ممیزی: <b>{fa(status.audits.points)}</b>؛ ثبت محلی: {fa(status.register.records)}</div>
            <div>پیشرفت برنامهٔ گردآوری: <b>{fa(Math.round(status.plan.overall * 100))}٪</b></div>
          </div>
          <div className="mt-2">شکاف‌هایی که با پرسشنامه پر می‌شوند: {status.surveyFillableGaps.length ? status.surveyFillableGaps.map((c) => <span key={c} className="mx-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-amber-900">{c}</span>) : '—'}</div>
          {status.otherGaps.length > 0 && <div className="mt-1 text-muted">شکاف‌های غیرپیمایشی (از «پژوهش خودکار»): {status.otherGaps.join('، ')}</div>}
          {status.surveyFillableGaps.length > 0 && (
            <button className={`${btn2} mt-2`} disabled={busy || !llmConfigured} title={llmConfigured ? '' : 'مدل زبانی پیکربندی نشده است'} onClick={() => void draftQ()}><Sparkles className="h-3.5 w-3.5" /> پیش‌نویس پرسشنامهٔ شکاف‌ها با هوش مصنوعی</button>
          )}
          {draft && <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-emerald-900">{draft}</div>}
        </div>
      )}
      {cardV2 && <DataCollectionHub card={cardV2} onReanalyze={(nb) => void reanalyze(nb)} reanalyzing={busy} />}
    </div>
  );
}

const BY_CAP = CAPITALS.map((k) => ({ k, inds: ALGORITHM_INDICATORS.filter((i) => i.capitalKey === k) }));

function EvalTable({ base, scen }: { base: ScenarioEval; scen: ScenarioEval }) {
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-muted"><th className="text-right">مؤلفه</th><th>پایهٔ سنجیده</th><th>سناریو</th></tr></thead>
      <tbody>
        {CAPITALS.map((k) => <tr key={k} className="border-t border-line dark:border-wall-700"><td>{capFa(k)}</td><td className="text-center">{base.capitals ? fa(base.capitals[k]) : '—'}</td><td className="text-center">{scen.capitals ? fa(scen.capitals[k]) : '—'}</td></tr>)}
        {(['Q', 'T', 'R'] as const).map((m) => <tr key={m} className="border-t border-line font-bold dark:border-wall-700"><td>{m}</td><td className="text-center">{base[m] !== null ? fa(base[m]!) : '—'}</td><td className="text-center">{scen[m] !== null ? fa(scen[m]!) : '—'}</td></tr>)}
        <tr className="border-t border-line dark:border-wall-700"><td>نوع تشخیصی</td><td className="text-center">{typeFa(base.diagnosticType)}</td><td className="text-center">{typeFa(scen.diagnosticType)}</td></tr>
        <tr className="border-t border-line dark:border-wall-700"><td>گلوگاه</td><td className="text-center">{bnFa(base.bottleneck)}</td><td className="text-center">{bnFa(scen.bottleneck)}</td></tr>
      </tbody>
    </table>
  );
}

export function ScenarioTab({ llmConfigured }: { llmConfigured: boolean }) {
  const [nb, setNb] = useState('tehran:m605');
  const [offline, setOffline] = useState(true);
  const [base, setBase] = useState<Record<string, number>>({});
  const [ov, setOv] = useState<Record<string, string>>({});
  const [res, setRes] = useState<ScenarioResult | null>(null);
  const [sens, setSens] = useState<SensitivityResult | null>(null);
  const [suite, setSuite] = useState<CriticSuiteResult | null>(null);
  const [rev, setRev] = useState<LlmReviewResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const overrides = useMemo(() => Object.fromEntries((Object.entries(ov) as Array<[string, string]>).filter(([, v]) => v.trim() !== '' && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])), [ov]);
  const run = async (what: string, f: () => Promise<void>) => { setBusy(what); setErr(null); try { await f(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); } };
  const load = () => run('load', async () => { const r = await agenticApi.scenario({ neighborhoodId: nb, overrides: {}, offline }); setBase(r.baseScores); setRes(r); setOv({}); setSens(null); setSuite(null); setRev(null); });
  const fill = (v: number) => setOv((o) => { const n = { ...o }; for (const i of ALGORITHM_INDICATORS) if (!(i.code in base) && !n[i.code]) n[i.code] = String(v); return n; });
  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-1 flex items-center gap-1 text-sm font-bold"><FlaskConical className="h-4 w-4" /> شبیه‌سازی سناریو و حساسیت (عامل A11)</h3>
        <p className="mb-3 text-xs text-muted">«اگر امتیاز این شاخص‌ها چنین شود…» — همان موتور قطعی روی امتیازهای فرضی اجرا می‌شود. نتیجه فقط کاوشی است، ذخیره یا منتشر نمی‌شود و کارت محله را تغییر نمی‌دهد. موتور فقط وقتی اجرا می‌شود که هر هشت سرمایه دست‌کم یک امتیاز (سنجیده یا فرضی) داشته باشند.</p>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="flex flex-col gap-1">شناسهٔ محله<input className={`${input} font-mono`} dir="ltr" value={nb} onChange={(e) => setNb(e.target.value)} /></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> فقط دادهٔ محلی (سریع)</label>
          <button className={btn} disabled={Boolean(busy)} onClick={() => void load()}>{busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} بارگذاری پایهٔ سنجیده</button>
        </div>
      </div>
      <Err e={err} />
      {res && (
        <>
          <div className={card}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <b>امتیاز شاخص‌ها (۰ تا ۱۰۰، بالاتر = بهتر)</b>
              <span className="text-muted">سنجیده: {fa(Object.keys(base).length)} از {fa(ALGORITHM_INDICATORS.length)}</span>
              <button className={btn2} onClick={() => fill(50)}>پر کردن بی‌داده‌ها با ۵۰ (فرضی)</button>
              <button className={btn2} onClick={() => setOv({})}>پاک کردن تغییرها</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {BY_CAP.map(({ k, inds }) => (
                <div key={k} className="rounded-xl border border-line p-2 text-xs dark:border-wall-700">
                  <div className="mb-1 font-bold">{capFa(k)}</div>
                  {inds.map((i) => (
                    <label key={i.code} className="flex items-center justify-between gap-1 py-0.5" title={i.name}>
                      <span className="truncate"><span className="font-mono">{i.code}</span> {i.name}</span>
                      <span className="flex items-center gap-1">
                        <span className={`w-8 text-center ${i.code in base ? 'text-emerald-700' : 'text-muted'}`}>{i.code in base ? fa(base[i.code]) : '—'}</span>
                        <input className={`${input} w-14 py-0.5 text-center`} dir="ltr" inputMode="decimal" placeholder="فرضی" value={ov[i.code] ?? ''} onChange={(e) => setOv({ ...ov, [i.code]: e.target.value })} />
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={btn} disabled={Boolean(busy)} onClick={() => void run('sim', async () => setRes(await agenticApi.scenario({ neighborhoodId: nb, overrides, offline })))}><Play className="h-3.5 w-3.5" /> اجرای سناریو</button>
              <button className={btn2} disabled={Boolean(busy)} onClick={() => void run('sens', async () => setSens(await agenticApi.sensitivity({ neighborhoodId: nb, scores: overrides, offline })))}>{busy === 'sens' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />} تحلیل حساسیت (±۲۰٪)</button>
              <button className={btn2} disabled={Boolean(busy)} onClick={() => void run('suite', async () => setSuite(await agenticApi.criticSelfTest({ neighborhoodId: nb, offline })))}><ShieldCheck className="h-3.5 w-3.5" /> آزمون تزریق خطا به نقاد</button>
              <button className={btn2} disabled={Boolean(busy) || !llmConfigured} onClick={() => void run('rev', async () => setRev(await agenticApi.llmReview({ neighborhoodId: nb, offline })))}>{busy === 'rev' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} نقد مشورتی مدل زبانی</button>
            </div>
          </div>
          <div className={card}>
            <div className="mb-2 flex flex-wrap gap-2 text-xs"><span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900">سناریو — قابل انتشار نیست</span>
              {res.changes.bottleneckChanged !== null && <span className={`rounded px-2 py-0.5 ${res.changes.bottleneckChanged ? 'bg-rose-100 text-rose-900' : 'bg-emerald-100 text-emerald-900'}`}>{res.changes.bottleneckChanged ? 'گلوگاه تغییر کرد' : 'گلوگاه ثابت ماند'}</span>}
              {res.hypotheticalCodes.length > 0 && <span className="text-muted">شاخص‌های فرضی: {fa(res.hypotheticalCodes.length)}</span>}
            </div>
            <p className="mb-2 text-xs text-muted">{res.note}</p>
            <EvalTable base={res.base} scen={res.scenario} />
          </div>
        </>
      )}
      {sens && (
        <div className={`${card} text-xs`}>
          <div className="mb-1 font-bold">تحلیل حساسیت: {sens.verdict === 'stable' ? 'پایدار' : sens.verdict === 'fragile' ? 'شکننده' : 'ارزیابی نشد'}{sens.stability !== null && ` — پایداری ${fa(Math.round(sens.stability * 100))}٪`}</div>
          {sens.reason && <p className="text-muted">{sens.reason}</p>}
          {sens.fragileCodes.length > 0 && <p>شاخص‌هایی که با خطای ±{fa(sens.perturbation * 100)}٪ تشخیص را عوض می‌کنند: <b className="font-mono">{sens.fragileCodes.join('، ')}</b> — پیش از تصمیم، دادهٔ این‌ها را تقویت کنید.</p>}
          {sens.tested.length > 0 && <p className="text-muted">آزموده: {fa(sens.tested.length)} شاخص با اعتبار کمتر از {fa(sens.reliabilityBelow)} (شاخص‌های فرضی هم کم‌اعتبار حساب می‌شوند).</p>}
        </div>
      )}
      {suite && (
        <div className={`${card} text-xs`}>
          <div className="mb-2 font-bold">آزمون تزریق خطا ({suite.critic}): کشف {fa(suite.detected)} از {fa(suite.total)} — {fa(Math.round(suite.detectionRate * 100))}٪ {suite.passed ? '✓ (معیار ≥ ۹۰٪)' : '✗'}؛ حکم نقاد روی کارت اصلی: {suite.baselineVerdict}</div>
          <table className="w-full"><tbody>
            {suite.cases.map((c) => <tr key={c.id} className="border-t border-line dark:border-wall-700"><td className="font-mono">{c.id}</td><td>{c.title}</td><td className="font-mono">{c.expect}</td><td className={c.detected ? 'text-emerald-700' : 'text-rose-700'}>{c.detected ? 'کشف شد' : 'کشف نشد'}</td></tr>)}
          </tbody></table>
        </div>
      )}
      {rev && (
        <div className={`${card} text-xs`}>
          <div className="mb-1 font-bold">نقد مشورتی مدل زبانی {rev.model ? `(${rev.model})` : ''} — فقط مشورتی؛ {fa(rev.rejected)} ادعای بی‌پشتوانه رد شد</div>
          {rev.error && <p className="text-rose-700">{rev.error}</p>}
          <ul className="list-inside list-disc">{rev.issues.map((x, i) => <li key={i}><b>{x.severity === 'high' ? 'مهم' : x.severity === 'medium' ? 'متوسط' : 'جزئی'}</b>{x.indicator ? ` (${x.indicator})` : ''}: {x.problem}</li>)}</ul>
          {rev.used && !rev.error && rev.issues.length === 0 && <p>ایرادی گزارش نشد.</p>}
        </div>
      )}
    </div>
  );
}

export function DashboardTab() {
  const [d, setD] = useState<AgentDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { setErr(null); try { setD(await agenticApi.dashboard()); } catch (e) { setErr(errMsg(e)); } };
  useEffect(() => { void load(); }, []);
  const ms = (x: number) => (x >= 1000 ? `${fa(x / 1000)} ث` : `${fa(x)} م‌ث`);
  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-center gap-4 text-xs`}>
        <b className="flex items-center gap-1 text-sm"><Activity className="h-4 w-4" /> داشبورد عامل‌ها (A14)</b>
        {d && <>
          <span>فراخوانی: <b>{fa(d.totals.calls)}</b></span><span>خطا: <b>{fa(d.totals.errors)}</b> ({fa(Math.round(d.totals.errorRate * 100))}٪)</span>
          <span>میانگین/صدک ۹۵: {ms(d.totals.avgMs)} / {ms(d.totals.p95Ms)}</span>
          <span>صف: {(Object.entries(d.jobs) as Array<[string, number]>).filter(([k]) => k !== 'concurrency').map(([k, v]) => `${k} ${fa(v)}`).join('، ')}</span>
          <span>پژوهش {fa(d.assets.research)}، کارت منبع {fa(d.assets.sourceCards)}، سند {fa(d.assets.documents)}، حافظه {fa(d.assets.memory?.chunks ?? 0)} قطعه</span>
        </>}
        <button className={btn2} onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /> تازه‌سازی</button>
      </div>
      <Err e={err} />
      {d && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className={`${card} text-xs`}>
            <div className="mb-2 font-bold">عامل‌ها (آخرین {fa(d.window)} فراخوانی)</div>
            <table className="w-full"><thead><tr className="text-muted"><th className="text-right">عامل</th><th>فراخوانی</th><th>خطا</th><th>میانگین</th><th>صدک ۹۵</th></tr></thead><tbody>
              {d.agents.map((a) => <tr key={a.id} className="border-t border-line dark:border-wall-700"><td><span className="font-mono">{a.id}</span> {a.nameFa}</td><td className="text-center">{fa(a.calls)}</td><td className={`text-center ${a.errors ? 'text-rose-700' : ''}`}>{fa(a.errors)}</td><td className="text-center">{a.calls ? ms(a.avgMs) : '—'}</td><td className="text-center">{a.calls ? ms(a.p95Ms) : '—'}</td></tr>)}
            </tbody></table>
          </div>
          <div className={`${card} text-xs`}>
            <div className="mb-2 font-bold">ابزارها</div>
            <table className="w-full"><thead><tr className="text-muted"><th className="text-right">ابزار</th><th>فراخوانی</th><th>خطا</th><th>میانگین</th><th>خطای رایج</th></tr></thead><tbody>
              {d.tools.map((t) => <tr key={t.tool} className="border-t border-line dark:border-wall-700"><td className="font-mono">{t.tool}</td><td className="text-center">{fa(t.calls)}</td><td className={`text-center ${t.errors ? 'text-rose-700' : ''}`}>{fa(t.errors)}</td><td className="text-center">{ms(t.avgMs)}</td><td className="font-mono">{t.topErrors.map((e) => `${e.code}×${e.n}`).join(' ')}</td></tr>)}
            </tbody></table>
            {d.recentErrors.length > 0 && <div className="mt-3"><div className="font-bold">خطاهای اخیر</div>{d.recentErrors.map((e, i) => <div key={i} className="truncate text-muted"><span className="font-mono">{e.agentId}/{e.tool}</span> {e.summary}</div>)}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
