// ============================================================
// فاز ۲ فریمورک ایجنتیک: «دستیار عامل‌محور» (پرسش آزاد ← عامل‌ها و ابزارها ← پاسخ مستند)
// و «اجرای دسته‌ای شهر» (همهٔ محله‌های یک شهر در صف کار پایدار)
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Download, Loader2, MessageSquare, Play, Square, XCircle } from 'lucide-react';
import { agenticApi, type BatchRecord, type CopilotSession } from '../algorithm/agenticApi';

const fa = (n: number) => n.toLocaleString('fa-IR');
const card = 'rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800';
const input = 'rounded-lg border border-line bg-transparent px-2 py-1.5 dark:border-wall-700';
const btn = 'flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50';
const LEVEL_FA: Record<string, string> = { PUBLISHABLE: 'قابل انتشار', PROVISIONAL: 'موقت', INSUFFICIENT: 'ناکافی' };
const RUN_FA: Record<string, string> = { completed: 'کامل', needs_user: 'منتظر انتخاب', blocked: 'متوقف با نقاد', failed: 'ناموفق', cancelled: 'لغو', queued: 'در صف', running: 'در حال اجرا' };
const VERDICT_FA: Record<string, string> = { pass: 'تأیید نقاد', pass_with_warnings: 'تأیید با هشدار', fail: 'رد نقاد' };
const SES_FA: Record<CopilotSession['status'], string> = { queued: 'در صف', running: 'در حال کار', answered: 'پاسخ داده شد', answered_with_warnings: 'پاسخ با هشدار', failed: 'ناموفق', cancelled: 'لغو شد' };
const BATCH_FA: Record<BatchRecord['status'], string> = { queued: 'در صف', running: 'در حال اجرا', completed: 'تمام شد', cancelled: 'لغو شد', failed: 'ناموفق' };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** نظرسنجی دوره‌ای تا رسیدن به وضعیت پایانی */
function usePoll<T>(load: (() => Promise<T>) | null, done: (v: T) => boolean, onValue: (v: T) => void, ms = 1500) {
  const ref = useRef({ done, onValue });
  ref.current = { done, onValue };
  useEffect(() => {
    if (!load) return;
    let stop = false;
    const tick = async () => {
      try { const v = await load(); if (stop) return; ref.current.onValue(v); if (ref.current.done(v)) return; } catch { /* تلاش بعدی */ }
      if (!stop) setTimeout(() => void tick(), ms);
    };
    void tick();
    return () => { stop = true; };
  }, [load, ms]);
}

function Counts({ title, m, map }: { title: string; m: Record<string, number>; map?: Record<string, string> }) {
  const e = Object.entries(m).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <h4 className="mb-1 text-xs font-bold">{title}</h4>
      {e.length ? <ul className="space-y-0.5 text-[11px]">{e.slice(0, 8).map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span>{map?.[k] ?? k}</span><b>{fa(v)}</b></li>)}</ul> : <p className="text-[11px] text-ink-500">—</p>}
    </div>
  );
}

export function CopilotTab({ agentName, llmConfigured }: { agentName: Record<string, string>; llmConfigured: boolean }) {
  const [q, setQ] = useState('وضعیت محله یوسف آباد تهران را تحلیل کن و گلوگاه اصلی را بگو');
  const [offline, setOffline] = useState(false);
  const [ses, setSes] = useState<CopilotSession | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<Pick<CopilotSession, 'sessionId' | 'question' | 'status'>>>([]);
  const loadHist = () => void agenticApi.sessions().then(setHistory).catch(() => undefined);
  useEffect(loadHist, []);
  const final = (s: CopilotSession) => !['queued', 'running'].includes(s.status);
  const [loader, setLoader] = useState<(() => Promise<CopilotSession>) | null>(null);
  useEffect(() => { setLoader(sid ? () => () => agenticApi.session(sid) : null); }, [sid]);
  usePoll(loader, final, (s) => { setSes(s); if (final(s)) loadHist(); });
  const running = Boolean(ses && !final(ses));

  const ask = async () => {
    setErr(null); setSes(null);
    try { const r = await agenticApi.ask(q.trim(), offline); setSid(r.sessionId); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section className={card}>
          <p className="mb-2 text-xs text-ink-500">پرسش خود را آزاد بنویسید. هماهنگ‌کننده (A0) با کمک مدل زبانی تصمیم می‌گیرد کدام عامل و ابزار را صدا بزند؛ همهٔ عددها از ابزارهای قطعی می‌آیند و پاسخ نهایی از نظر عدد بی‌پشتوانه بررسی می‌شود.{!llmConfigured && ' مدل زبانی تنظیم نشده است؛ دستیار با گراف قطعی استاندارد پاسخ می‌دهد.'}</p>
          <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={3} className={`${input} w-full`} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> فقط دادهٔ ذخیره‌شده</label>
            <button disabled={running || q.trim().length < 3} onClick={() => void ask()} className={btn}>{running ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />} بپرس</button>
            {running && ses?.jobId && <button onClick={() => void agenticApi.cancelJob(ses.jobId!)} className="flex items-center gap-1 rounded-xl border border-line px-3 py-2 text-xs dark:border-wall-700"><Square size={12} /> توقف</button>}
          </div>
          {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
        </section>
        {ses && (
          <section className={card}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <b>{SES_FA[ses.status]}</b>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-wall-700">{ses.mode === 'llm' ? `مدل: ${ses.model ?? '…'}` : 'حالت قطعی (بدون مدل)'}</span>
              {ses.grounding && <span className={`rounded-full px-2 py-0.5 ${ses.grounding.ungrounded.length ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>{ses.grounding.ungrounded.length ? `${fa(ses.grounding.ungrounded.length)} عدد بی‌پشتوانه: ${ses.grounding.ungrounded.join('، ')}` : `اتکای عددی: ${fa(ses.grounding.checked)} عدد بررسی شد`}{ses.grounding.revised ? ' (پس از یک بار اصلاح)' : ''}</span>}
            </div>
            <ol className="space-y-1">
              {ses.steps.map((st) => (
                <li key={st.i} className="flex items-start gap-2 text-xs">
                  {st.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={14} className="mt-0.5 shrink-0 text-rose-600" />}
                  <div><b>{st.agent ? `${st.agent} ${agentName[st.agent] ?? ''}` : 'مدل'}</b>{st.tool && <span className="font-mono text-[11px] text-ink-500" dir="ltr"> · {st.tool}</span>}
                    <div className="text-ink-500">{st.thought}{st.summary ? ` — ${st.summary}` : ''}{st.error ? ` — ${st.error}` : ''}</div></div>
                </li>
              ))}
              {running && <li className="flex items-center gap-2 text-xs text-ink-500"><Loader2 size={14} className="animate-spin" /> در حال کار…</li>}
            </ol>
            {ses.answer && <div className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-6 dark:bg-wall-900">{ses.answer}</div>}
            {ses.error && <p className="mt-2 text-xs text-rose-700">{ses.error}</p>}
          </section>
        )}
      </div>
      <aside className={card}>
        <h3 className="mb-2 text-xs font-bold">پرسش‌های اخیر</h3>
        <ul className="space-y-1">{history.map((h) => <li key={h.sessionId}><button onClick={() => setSid(h.sessionId)} className="w-full truncate text-right text-[11px] hover:underline">{h.question} · {SES_FA[h.status]}</button></li>)}</ul>
      </aside>
    </div>
  );
}

export function BatchTab() {
  const [city, setCity] = useState('تهران');
  const [offline, setOffline] = useState(true);
  const [limit, setLimit] = useState('');
  const [bid, setBid] = useState<string | null>(null);
  const [b, setB] = useState<BatchRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [list, setList] = useState<BatchRecord[]>([]);
  const loadList = () => void agenticApi.batches().then(setList).catch(() => undefined);
  useEffect(loadList, []);
  const final = (x: BatchRecord) => ['completed', 'cancelled', 'failed'].includes(x.status);
  const [loader, setLoader] = useState<(() => Promise<BatchRecord>) | null>(null);
  useEffect(() => { setLoader(bid ? () => () => agenticApi.batch(bid) : null); }, [bid]);
  usePoll(loader, final, (x) => { setB(x); if (final(x)) loadList(); }, 2000);
  const running = Boolean(b && !final(b));
  const start = async () => {
    setErr(null); setB(null);
    try { const r = await agenticApi.startBatch({ city: city.trim(), offline, limit: limit ? Number(limit) : undefined }); setBid(r.batchId); } catch (e) { setErr(errMsg(e)); }
  };
  const pct = b && b.total ? Math.round(((b.done + b.failed) / b.total) * 100) : 0;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section className={card}>
          <p className="mb-2 text-xs text-ink-500">گراف استاندارد برای همهٔ محله‌های شهر در صف پایدار اجرا می‌شود؛ اگر سرور دوباره راه‌اندازی شود، از محلهٔ باقی‌مانده ادامه می‌دهد.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">شهر<input value={city} onChange={(e) => setCity(e.target.value)} className={`${input} w-28`} /></label>
            <label className="flex flex-col gap-1 text-xs">حداکثر محله (اختیاری)<input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} className={`${input} w-28`} dir="ltr" /></label>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> فقط دادهٔ ذخیره‌شده (سریع)</label>
            <button disabled={running || !city.trim()} onClick={() => void start()} className={btn}>{running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} اجرای دسته‌ای</button>
          </div>
          {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
        </section>
        {b && (
          <section className={card}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <b>{b.city} · {BATCH_FA[b.status]}</b>
              <span>{fa(b.done + b.failed)} از {fa(b.total)} محله{b.failed ? ` (${fa(b.failed)} ناموفق)` : ''}</span>
              {b.summary.avgDurationMs > 0 && <span className="text-ink-500">میانگین {b.summary.avgDurationMs < 1000 ? `${fa(b.summary.avgDurationMs)} میلی‌ثانیه` : `${fa(Math.round(b.summary.avgDurationMs / 100) / 10)} ثانیه`} برای هر محله</span>}
              {running && b.jobId && <button onClick={() => void agenticApi.cancelJob(b.jobId!)} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 dark:border-wall-700"><Square size={11} /> توقف</button>}
              <a href={agenticApi.batchCsvUrl(b.batchId)} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 dark:border-wall-700"><Download size={11} /> دانلود CSV</a>
            </div>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-wall-700"><div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} /></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Counts title="سطح اعتبار کارت" m={b.summary.byLevel} map={LEVEL_FA} />
              <Counts title="وضعیت اجرا" m={b.summary.byRunStatus} map={RUN_FA} />
              <Counts title="رأی نقاد" m={b.summary.byVerdict} map={VERDICT_FA} />
              <Counts title="گلوگاه‌ها" m={b.summary.bottlenecks} />
            </div>
            {Object.keys(b.summary.findings).length > 0 && <div className="mt-3 max-w-sm"><Counts title="یافته‌های لایه‌های محله‌ای" m={b.summary.findings} /></div>}
            {b.items && b.items.some((i) => i.status === 'failed') && (
              <div className="mt-3 text-[11px]"><h4 className="mb-1 flex items-center gap-1 font-bold"><CircleAlert size={12} /> محله‌های ناموفق</h4>
                {b.items.filter((i) => i.status === 'failed').slice(0, 10).map((i) => <div key={i.neighborhoodId}>{i.nameFa}: {i.error}</div>)}</div>
            )}
          </section>
        )}
      </div>
      <aside className={card}>
        <h3 className="mb-2 text-xs font-bold">دسته‌های اخیر</h3>
        <ul className="space-y-1">{list.map((x) => <li key={x.batchId}><button onClick={() => setBid(x.batchId)} className="w-full text-right text-[11px] hover:underline">{x.city} · {fa(x.done + x.failed)}/{fa(x.total)} · {BATCH_FA[x.status]}</button></li>)}</ul>
      </aside>
    </div>
  );
}
