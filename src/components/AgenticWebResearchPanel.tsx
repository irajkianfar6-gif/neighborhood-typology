// ============================================================
// پژوهش عمیق وب برای شاخص‌های بی‌داده (عامل A2):
// پژوهش چندمرحله‌ای با ارجاع → راستی‌آزمایی قطعی هر عدد → تأیید کارشناس → دستهٔ قراردادی «در انتظار بازبینی»
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileDown, Globe, Loader2, Play, ThumbsDown, ThumbsUp } from 'lucide-react';
import { agenticApi, type WebCandidate, type WebResearch, type WebStatus } from '../algorithm/agenticApi';

const fa = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 2 });
const card = 'rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800';
const input = 'rounded-lg border border-line bg-transparent px-2 py-1.5 dark:border-wall-700';
const btn = 'flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50';
const btn2 = 'flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-bold disabled:opacity-50 dark:border-wall-700';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EFFORT: Array<[string, string, number]> = [['standard', 'استاندارد (حدود ۳۰ ثانیه برای هر شاخص)', 0.05], ['deep', 'عمیق (تا ۲ دقیقه)', 0.1], ['exhaustive', 'جامع (تا ۵ دقیقه)', 0.45]];
const ST: Record<WebCandidate['status'], { t: string; c: string }> = {
  acceptable: { t: 'راستی‌آزمایی‌شده', c: 'bg-emerald-100 text-emerald-900' }, needs_review: { t: 'نیازمند بازبینی', c: 'bg-amber-100 text-amber-900' }, rejected: { t: 'رد خودکار', c: 'bg-rose-100 text-rose-900' },
};
const GROUND: Record<WebCandidate['check']['grounding'], string> = { page: 'عدد در متن صفحهٔ منبع یافت شد', snippet: 'عدد در تکه‌متن منبع یافت شد', quote_only: 'عدد فقط در نقل‌قول بود', none: 'عدد در منبع یافت نشد' };
const LEVEL: Record<string, string> = { neighborhood: 'محله', district: 'منطقه', city: 'شهر', province: 'استان', national: 'کشور', unknown: 'نامعلوم' };
const RUN: Record<WebResearch['status'], string> = { running: 'در حال پژوهش…', completed: 'تمام شد', failed: 'ناموفق', interrupted: 'نیمه‌تمام' };

export function WebResearchPanel() {
  const [status, setStatus] = useState<WebStatus | null>(null);
  const [nb, setNb] = useState('tehran:m605');
  const [codes, setCodes] = useState('');
  const [effort, setEffort] = useState('standard');
  const [maxN, setMaxN] = useState(5);
  const [r, setR] = useState<WebResearch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [periods, setPeriods] = useState<Record<string, string>>({});
  const timer = useRef<number | null>(null);
  const loadStatus = () => agenticApi.webStatus().then(setStatus).catch(() => undefined);
  useEffect(() => { void loadStatus(); return () => { if (timer.current) window.clearInterval(timer.current); }; }, []);
  // آخرین پژوهش همین محله (ادامهٔ بازبینی پس از بازگشت به صفحه)
  useEffect(() => {
    if (!/^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(nb.trim())) return;
    let alive = true;
    void agenticApi.webResearchList(nb.trim()).then((list) => { if (!alive) return; const last = list[0] ?? null; setR(last); if (last?.status === 'running') poll(last.id); }).catch(() => undefined);
    return () => { alive = false; };
  }, [nb]); // eslint-disable-line react-hooks/exhaustive-deps
  const poll = (id: string) => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => { void agenticApi.webResearch(id).then((x) => { setR(x); if (x.status !== 'running') { window.clearInterval(timer.current!); timer.current = null; void loadStatus(); } }).catch(() => undefined); }, 4000);
  };
  const run = async (what: string, f: () => Promise<void>) => { setBusy(what); setErr(null); setInfo(null); try { await f(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); } };
  const start = () => run('start', async () => {
    const list = codes.split(/[\s,،]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    const x = await agenticApi.startWebResearch({ neighborhoodId: nb, codes: list.length ? list : undefined, effort, maxIndicators: maxN, offline: true });
    setR(x); poll(x.id);
  });
  const decide = (code: string, c: WebCandidate, d: 'approved' | 'rejected') => run(`d${code}${c.idx}`, async () => {
    const out = await agenticApi.decideWebCandidate(r!.id, code, c.idx, d, { periodEnd: periods[`${code}:${c.idx}`] || undefined });
    setInfo(d === 'approved' ? `دستهٔ قراردادی ${out.decision?.batchId ?? ''} ساخته شد و در انتظار بازبینی است (صفحهٔ «تبادل دادهٔ رسمی»).` : 'نامزد رد شد.');
    setR(await agenticApi.webResearch(r!.id));
  });
  const fetchPage = (url: string) => run(`p${url}`, async () => {
    const out = await agenticApi.fetchWebPages([url], true);
    const p = out.pages[0];
    setInfo(p?.docId ? `صفحه به حافظهٔ اسناد افزوده شد (${fa(p.tables)} جدول). در بخش «استخراج از سند» آن را باز کنید.` : 'سرویس نتوانست این صفحه را بخواند (ممکن است فقط از داخل ایران در دسترس باشد).');
  });
  const est = (EFFORT.find((e) => e[0] === effort)?.[2] ?? 0.05) * maxN;
  return (
    <div className={card}>
      <h3 className="mb-1 flex items-center gap-1 text-sm font-bold"><Globe className="h-4 w-4" /> پژوهش عمیق وب برای شاخص‌های بی‌داده (عامل A2)</h3>
      <p className="mb-3 text-xs text-muted">برای هر شاخص، چند جست‌وجو و خواندن منبع انجام و فقط عددهایی گزارش می‌شود که در منبع آمده‌اند. سپس هر عدد به‌طور خودکار بررسی می‌شود: ارجاع به منبع، وجود همان عدد در متن صفحه، دامنهٔ مجاز، سطح مکانی (محله یا منطقه) و سال داده. شاخص‌های ادراکی (مثل اعتماد) پژوهش نمی‌شوند و فقط با پیمایش سنجیده می‌شوند. هیچ عددی بدون تأیید کارشناس وارد سنجه نمی‌شود.</p>
      {status && <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span className={`rounded-full px-2 py-0.5 ${status.configured ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'}`}>{status.configured ? 'سرویس پژوهش وب: فعال' : 'سرویس پژوهش وب پیکربندی نشده'}</span>
        <span className="rounded-full bg-line px-2 py-0.5 dark:bg-wall-700">امروز: {fa(status.usage.research)} از {fa(status.limits.dailyResearch)} پژوهش، {fa(status.usage.search)} جست‌وجو، هزینه ≈ {fa(status.usage.costUsd)} از {fa(status.limits.dailyBudgetUsd)} دلار</span>
      </div>}
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">شناسهٔ محله<input className={`${input} font-mono`} dir="ltr" value={nb} onChange={(e) => setNb(e.target.value)} /></label>
        <label className="flex flex-col gap-1">کد شاخص‌ها (خالی = شکاف‌های کارت)<input className={`${input} font-mono`} dir="ltr" placeholder="POP, H1, E4" value={codes} onChange={(e) => setCodes(e.target.value)} /></label>
        <label className="flex flex-col gap-1">عمق پژوهش<select className={input} value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="flex flex-col gap-1">حداکثر شاخص<input type="number" min={1} max={10} className={`${input} w-20`} value={maxN} onChange={(e) => setMaxN(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} /></label>
        <button className={btn} disabled={Boolean(busy) || !status?.configured || r?.status === 'running'} onClick={() => void start()}>{busy === 'start' || r?.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} شروع پژوهش</button>
        <span className="text-[11px] text-muted">هزینهٔ تقریبی: تا {fa(est)} دلار</span>
      </div>
      {err && <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-900">{err}</div>}
      {info && <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">{info}</div>}
      {r && (
        <div className="mt-4 space-y-3 text-xs">
          <div className="flex flex-wrap gap-3">
            <b>{r.nameFa}، {r.cityFa}{r.district ? ` (منطقهٔ ${fa(r.district)})` : ''}</b><span>{RUN[r.status]} — {fa(r.findings.length)} از {fa(r.codes.length)} شاخص</span>
            <span>راستی‌آزمایی‌شده: {fa(r.summary.acceptable)}</span><span>نیازمند بازبینی: {fa(r.summary.needsReview)}</span><span>رد خودکار: {fa(r.summary.rejected)}</span><span>بی‌نتیجه: {fa(r.summary.notFound)}</span><span>هزینه ≈ {fa(r.summary.costUsd)} دلار</span>
          </div>
          {r.skipped.surveyOnly.length > 0 && <div className="text-muted">فقط با پیمایش: {r.skipped.surveyOnly.join('، ')}</div>}
          {r.error && <div className="text-rose-800">{r.error}</div>}
          {r.findings.map((f) => (
            <div key={f.code} className="rounded-xl border border-line p-3 dark:border-wall-700">
              <div className="mb-1 flex flex-wrap items-center gap-2"><b>{f.code} — {f.name}</b><span className="text-muted">{f.definition}</span>{f.cached && <span className="rounded bg-line px-1 dark:bg-wall-700">از نهان‌گاه</span>}</div>
              {f.error && <div className="text-rose-800">خطا: {f.error}</div>}
              {f.notes && <div className="mb-2 whitespace-pre-wrap text-muted">{f.notes.replace(/\[\[[\d,\s]+\]\]/g, '')}</div>}
              {f.candidates.map((c) => (
                <div key={c.idx} className="mb-2 rounded-lg bg-black/[0.03] p-2 dark:bg-white/5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 ${ST[c.status].c}`}>{ST[c.status].t}</span>
                    <b className="text-sm">{c.value === null ? '—' : fa(c.value)} {c.unit}</b>
                    <span>{LEVEL[c.spatialLevel] ?? c.spatialLevel}: {c.areaName}</span><span>دوره: {c.period ?? '—'}</span>
                    <a className="flex items-center gap-0.5 text-brand-700 underline" href={c.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />{c.sourceTitle.slice(0, 60)}</a>
                    {c.isOfficial && <span className="rounded bg-brand-50 px-1 text-brand-900">رسمی</span>}
                  </div>
                  {c.quote && <div className="mt-1 border-r-2 border-line pr-2 text-muted">«{c.quote.slice(0, 400)}»</div>}
                  <div className="mt-1">{GROUND[c.check.grounding]}{c.check.reasons.length > 0 && ` — ${c.check.reasons.join('؛ ')}`}</div>
                  {c.decision ? <div className="mt-1 font-bold">{c.decision.decision === 'approved' ? `تأیید شد؛ دستهٔ ${c.decision.batchId} در انتظار بازبینی` : 'رد شد'}</div>
                    : c.status !== 'rejected' && <div className="mt-1 flex flex-wrap items-center gap-2">
                      {!c.check.periodEnd && <input className={`${input} w-28 font-mono`} dir="ltr" placeholder="YYYY-MM" value={periods[`${f.code}:${c.idx}`] ?? ''} onChange={(e) => setPeriods((p) => ({ ...p, [`${f.code}:${c.idx}`]: e.target.value }))} />}
                      <button className={btn2} disabled={Boolean(busy) || !c.check.contractLevel} title={!c.check.contractLevel ? 'سطح مکانی برای ورود به سنجه کافی نیست' : ''} onClick={() => void decide(f.code, c, 'approved')}><ThumbsUp className="h-3 w-3" /> تأیید و ساخت دستهٔ بازبینی</button>
                      <button className={btn2} disabled={Boolean(busy)} onClick={() => void decide(f.code, c, 'rejected')}><ThumbsDown className="h-3 w-3" /> رد</button>
                    </div>}
                </div>
              ))}
              {f.sources.length > 0 && <details><summary className="cursor-pointer text-muted">منابع خوانده‌شده ({fa(f.sources.length)})</summary>
                <ul className="mt-1 space-y-1">{f.sources.map((s) => <li key={s.url} className="flex flex-wrap items-center gap-2"><a className="text-brand-700 underline" href={s.url} target="_blank" rel="noreferrer">{s.title.slice(0, 90)}</a>
                  <button className={btn2} disabled={Boolean(busy)} onClick={() => void fetchPage(s.url)}>{busy === `p${s.url}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />} افزودن به اسناد</button></li>)}</ul>
              </details>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
