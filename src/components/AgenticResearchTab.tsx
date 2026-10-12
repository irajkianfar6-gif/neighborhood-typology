// ============================================================
// فاز ۳ فریمورک ایجنتیک: «پژوهش خودکار»
// شکاف داده → کشف و راستی‌آزمایی منبع (A2) → استخراج جدول از سند (A4) → تطبیق فضایی (A5) → دستهٔ قراردادی در انتظار بازبینی
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileUp, Loader2, Play, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import { WebResearchPanel } from './AgenticWebResearchPanel';
import { agenticApi, type ColumnRole, type DocRecord, type DocTablePreview, type DraftResult, type MemoryHit, type ResearchRecord, type SourceCardStatus } from '../algorithm/agenticApi';

const fa = (n: number) => n.toLocaleString('fa-IR');
const pct = (x: number) => `${fa(Math.round(x * 100))}٪`;
const card = 'rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800';
const input = 'rounded-lg border border-line bg-transparent px-2 py-1.5 dark:border-wall-700';
const btn = 'flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50';
const btn2 = 'flex items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-xs font-bold disabled:opacity-50 dark:border-wall-700';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const LEVEL_FA: Record<string, string> = { PUBLISHABLE: 'قابل انتشار', PROVISIONAL: 'موقت', INSUFFICIENT: 'ناکافی' };
const RES_FA: Record<ResearchRecord['status'], string> = { queued: 'در صف', running: 'در حال پژوهش', done: 'تمام شد', needs_user_choice: 'نام مبهم است', failed: 'ناموفق', cancelled: 'لغو شد' };
const CARD_FA: Record<SourceCardStatus, { t: string; c: string }> = {
  proposed: { t: 'بررسی‌نشده', c: 'bg-slate-100 text-slate-800' }, verified: { t: 'در دسترس', c: 'bg-emerald-100 text-emerald-900' },
  unreachable: { t: 'در دسترس نیست', c: 'bg-amber-100 text-amber-900' }, blocked_by_robots: { t: 'منع robots', c: 'bg-rose-100 text-rose-900' },
  approved: { t: 'تأیید کارشناس', c: 'bg-brand-600 text-white' }, rejected: { t: 'رد کارشناس', c: 'bg-rose-200 text-rose-900' },
};
const STEP_FA: Record<string, string> = { resolve: 'شناسایی محله', run_analysis: 'اجرای سنجه', find_data_gaps: 'شکاف‌های داده', discover_sources: 'کشف و راستی‌آزمایی منبع', search_documents: 'جست‌وجو در اسناد' };
const MATCH_FA: Record<string, string> = { exact: 'دقیق', alias: 'نام دیگر', point_in_polygon: 'نقطه در محدوده', composite_unit: 'واحد ترکیبی', parent_inherited: 'از والد', fuzzy: 'تقریبی', district_fallback: 'فقط منطقه', ambiguous: 'مبهم', unmatched: 'ناموفق' };
const ROLE_FA: Record<ColumnRole['role'], string> = { name: 'نام محله', district: 'منطقه', indicator: 'شاخص', ignore: 'نادیده' };

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('خواندن فایل ناموفق بود'));
    r.readAsDataURL(file);
  });
}

function ResearchPanel() {
  const [name, setName] = useState('یوسف آباد');
  const [city, setCity] = useState('تهران');
  const [useLlm, setUseLlm] = useState(false);
  const [rid, setRid] = useState<string | null>(null);
  const [r, setR] = useState<ResearchRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const final = (x: ResearchRecord) => ['done', 'needs_user_choice', 'failed', 'cancelled'].includes(x.status);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!rid) return;
    let stop = false;
    const tick = async () => { try { const v = await agenticApi.research(rid); if (stop) return; setR(v); if (final(v)) return; } catch { /* تلاش بعدی */ } if (!stop) timer.current = window.setTimeout(() => void tick(), 1500); };
    void tick();
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); };
  }, [rid]);
  const start = async (neighborhoodId?: string) => {
    setErr(null); setR(null);
    try { const x = await agenticApi.startResearch({ ...(neighborhoodId ? { neighborhoodId } : { name: name.trim(), city: city.trim() }), useLlm, offline: true, verify: true }); setRid(x.researchId); } catch (e) { setErr(errMsg(e)); }
  };
  const decide = async (cardId: string, d: 'approved' | 'rejected') => {
    setBusyCard(cardId);
    try { const c = await agenticApi.decideSource(cardId, d); setR((prev) => prev && { ...prev, briefs: prev.briefs.map((b) => ({ ...b, candidates: b.candidates.map((k) => (k.cardId === cardId ? { ...k, status: c.status } : k)) })) }); } catch (e) { setErr(errMsg(e)); }
    setBusyCard(null);
  };
  const running = Boolean(r && !final(r)) || Boolean(rid && !r);
  return (
    <section className={card}>
      <h3 className="mb-1 text-sm font-bold">پژوهش محله: یافتن منبع برای شاخص‌های بی‌داده</h3>
      <p className="mb-2 text-xs text-ink-500">سنجه اجرا می‌شود، شاخص‌های بی‌امتیاز یا کم‌اعتبار شناسایی و برای هر کدام منبع عمومی پیدا و بررسی می‌شود (اجازهٔ robots.txt و در دسترس بودن). هیچ عددی خودکار وارد سنجه نمی‌شود.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">محله<input value={name} onChange={(e) => setName(e.target.value)} className={`${input} w-40`} /></label>
        <label className="flex flex-col gap-1 text-xs">شهر<input value={city} onChange={(e) => setCity(e.target.value)} className={`${input} w-24`} /></label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} /> پیشنهاد منبع با هوش مصنوعی (همه بررسی می‌شوند)</label>
        <button disabled={running || name.trim().length < 2} onClick={() => void start()} className={btn}>{running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} شروع پژوهش</button>
      </div>
      {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
      {r && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <b>{RES_FA[r.status]}</b>
            {r.neighborhood && <span>{r.neighborhood.nameFa} <span className="font-mono text-[11px]" dir="ltr">{r.neighborhood.id}</span></span>}
            {r.level && <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-wall-700">کارت {LEVEL_FA[r.level] ?? r.level}</span>}
            {r.summary && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900">{fa(r.summary.gaps)} شکاف · {fa(r.summary.covered)} با منبع نامزد · {fa(r.summary.verifiedSources)} منبع در دسترس</span>}
          </div>
          <ol className="space-y-0.5 text-xs">
            {r.steps.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 size={14} className={s.status === 'done' ? 'text-emerald-600' : 'text-rose-600'} /><b>{s.agent} {STEP_FA[s.name] ?? s.name}</b><span className="text-ink-500">{s.summary}</span></li>)}
            {running && <li className="flex items-center gap-2 text-ink-500"><Loader2 size={14} className="animate-spin" /> در حال کار…</li>}
          </ol>
          {r.status === 'needs_user_choice' && r.candidates && (
            <div className="flex flex-wrap gap-1 text-xs">کدام محله؟ {r.candidates.map((c) => <button key={c.id} onClick={() => void start(c.id)} className={btn2}>{c.nameFa}</button>)}</div>
          )}
          {r.error && <p className="text-xs text-rose-700">{r.error}</p>}
          <div className="space-y-2">
            {r.briefs.map((b) => (
              <details key={b.code} className="rounded-xl border border-line p-2 dark:border-wall-700" open={b.candidates.length > 0 && b.candidates.length < 4}>
                <summary className="cursor-pointer text-xs"><b className="font-mono" dir="ltr">{b.code}</b> {b.name} <span className="text-ink-500">— {b.reason === 'no_score' ? 'بدون داده' : 'اعتبار کم'} · {fa(b.candidates.length)} منبع نامزد</span></summary>
                <p className="mt-1 text-[11px] text-brand-700">گام بعدی: {b.nextAction}</p>
                <ul className="mt-1 space-y-1">
                  {b.candidates.map((c) => (
                    <li key={c.cardId} className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className={`rounded-full px-2 py-0.5 ${CARD_FA[c.status].c}`}>{CARD_FA[c.status].t}</span>
                      <a href={c.url} target="_blank" rel="noreferrer" className="font-bold hover:underline">{c.title}</a>
                      <span className="text-ink-500">اعتماد {pct(c.trust)} · {c.spatialLevel}{c.domestic ? ' · داخلی' : ''}</span>
                      {!['approved', 'rejected'].includes(c.status) && <>
                        <button disabled={busyCard === c.cardId} onClick={() => void decide(c.cardId, 'approved')} className="text-emerald-700" title="تأیید منبع"><ThumbsUp size={13} /></button>
                        <button disabled={busyCard === c.cardId} onClick={() => void decide(c.cardId, 'rejected')} className="text-rose-700" title="رد منبع"><ThumbsDown size={13} /></button>
                      </>}
                    </li>
                  ))}
                  {b.documents.map((d) => <li key={d.refId + d.page} className="text-[11px]">سند: <b>{d.title}</b> (ص {fa(d.page)}) — <span className="text-ink-500">{d.snippet}</span></li>)}
                </ul>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DocumentPanel() {
  const [city, setCity] = useState('تهران');
  const [org, setOrg] = useState('');
  const [period, setPeriod] = useState('');
  const [doc, setDoc] = useState<DocRecord | null>(null);
  const [tables, setTables] = useState<DocTablePreview[]>([]);
  const [tid, setTid] = useState<string | null>(null);
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recent, setRecent] = useState<DocRecord[]>([]);
  useEffect(() => { void agenticApi.documents().then(setRecent).catch(() => undefined); }, []);
  const open = async (id: string) => {
    setErr(null); setDraft(null);
    try { const x = await agenticApi.document(id, city.trim()); setDoc(x.document); setTables(x.tables); const t = x.tables[0]; setTid(t?.tableId ?? null); setRoles(t?.roles ?? []); if (x.document.period && !period) setPeriod(x.document.period.periodEnd); } catch (e) { setErr(errMsg(e)); }
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setErr(null); setDraft(null);
    try { const d = await agenticApi.uploadDocument(f.name, await toBase64(f)); await open(d.docId); void agenticApi.documents().then(setRecent); } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };
  const table = tables.find((t) => t.tableId === tid) ?? null;
  const pick = (id: string) => { setTid(id); setRoles(tables.find((t) => t.tableId === id)?.roles ?? []); setDraft(null); };
  const setRole = (i: number, role: ColumnRole['role']) => setRoles((rs) => rs.map((r) => (r.column === i ? { ...r, role } : r)));
  const setCode = (i: number, code: string) => setRoles((rs) => rs.map((r) => (r.column === i ? { ...r, code: code.toUpperCase() } : r)));
  const run = async (dryRun: boolean) => {
    if (!doc || !tid) return;
    setBusy(true); setErr(null);
    try { setDraft(await agenticApi.draftBatch(doc.docId, tid, { city: city.trim(), sourceOrg: org.trim(), periodEnd: period || undefined, roles, dryRun })); } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };
  const v = doc?.verification;
  const byType: Record<string, number> = {};
  for (const m of draft?.matches ?? []) byType[m.matchType] = (byType[m.matchType] ?? 0) + 1;
  return (
    <section className={card}>
      <h3 className="mb-1 text-sm font-bold">استخراج از سند (PDF، اکسل، CSV، صفحهٔ HTML)</h3>
      <p className="mb-2 text-xs text-ink-500">جدول‌ها استخراج، ستون‌ها به شاخص نگاشت و نام‌ها با محله‌ها تطبیق داده می‌شوند. خروجی فقط «دستهٔ در انتظار بازبینی» در بخش ورود داده است و پس از تأیید شما وارد سنجه می‌شود. PDF اسکن‌شده (تصویری) هنوز پشتیبانی نمی‌شود.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${btn} cursor-pointer`}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />} انتخاب فایل<input type="file" className="hidden" accept=".pdf,.xlsx,.csv,.tsv,.txt,.html,.htm,.png,.jpg,.jpeg" onChange={(e) => void upload(e.target.files?.[0])} /></label>
        <label className="flex flex-col gap-1 text-xs">شهر<input value={city} onChange={(e) => setCity(e.target.value)} className={`${input} w-24`} /></label>
        <label className="flex flex-col gap-1 text-xs">سازمان منتشرکننده<input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="مثلاً مرکز آمار ایران" className={`${input} w-48`} /></label>
        <label className="flex flex-col gap-1 text-xs">پایان دوره (سال-ماه میلادی)<input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2017-03" className={`${input} w-24`} dir="ltr" /></label>
      </div>
      {recent.length > 0 && !doc && <div className="mt-2 flex flex-wrap gap-1 text-[11px]">اسناد قبلی: {recent.slice(0, 6).map((d) => <button key={d.docId} onClick={() => void open(d.docId)} className={btn2}>{d.filename}</button>)}</div>}
      {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
      {doc && (
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <b>{doc.filename}</b><span className="text-ink-500">{doc.kind.toUpperCase()} · {fa(doc.tables.length)} جدول · {fa(doc.pages)} صفحه</span>
            {v && v.agreement !== null && <span className={`rounded-full px-2 py-0.5 ${v.agreement >= 0.95 ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>توافق دو روش استخراج: {pct(v.agreement)} ({fa(v.agreed)}/{fa(v.numericCells)} عدد)</span>}
            {doc.period && <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-wall-700">سال سند: {fa(doc.period.year)}</span>}
          </div>
          {doc.warnings.map((w, i) => <p key={i} className="text-amber-800">{w}</p>)}
          {tables.length > 1 && <div className="flex flex-wrap gap-1">{tables.map((t) => <button key={t.tableId} onClick={() => pick(t.tableId)} className={`${btn2} ${t.tableId === tid ? 'bg-brand-600 text-white' : ''}`}>{t.tableId} ({fa(t.totalRows)} ردیف)</button>)}</div>}
          {table?.ocr && <p className="rounded bg-amber-50 p-1.5 text-[11px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">این جدول از تصویر اسکن (OCR) بازسازی شده است: همهٔ خانه‌ها باید با سند اصلی مقایسه شوند؛ عددهایی که گذر دوم تأیید نکرد خالی‌اند ({fa(table.ocrUnconfirmed ?? 0)} خانه).</p>}
          {table && (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-[11px]">
                <thead>
                  <tr>{table.header.map((h, i) => { const r = roles.find((x) => x.column === i); return (
                    <th key={i} className="border border-line p-1 align-top dark:border-wall-700">
                      <div className="font-bold">{h || `ستون ${fa(i + 1)}`}</div>
                      <select value={r?.role ?? 'ignore'} onChange={(e) => setRole(i, e.target.value as ColumnRole['role'])} className="mt-1 bg-transparent">{Object.entries(ROLE_FA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      {r?.role === 'indicator' && <input value={r.code ?? ''} onChange={(e) => setCode(i, e.target.value)} className="mt-1 w-14 border border-line bg-transparent px-1 font-mono dark:border-wall-700" dir="ltr" title={r.reason} />}
                    </th>); })}</tr>
                </thead>
                <tbody>{table.rows.slice(0, 8).map((row, ri) => <tr key={ri}>{row.map((c, ci) => <td key={ci} className="border border-line p-1 dark:border-wall-700">{c}</td>)}</tr>)}</tbody>
              </table>
              {table.totalRows > 8 && <p className="text-[11px] text-ink-500">… {fa(table.totalRows - 8)} ردیف دیگر</p>}
            </div>
          )}
          <div className="flex gap-2">
            <button disabled={busy || !table || org.trim().length < 2} onClick={() => void run(true)} className={btn2}>پیش‌نمایش ردیف‌ها</button>
            <button disabled={busy || !draft || draft.rows === 0 || Boolean(draft.batch && draft.batch.status !== 'DRY_RUN')} onClick={() => void run(false)} className={btn}>ساخت دستهٔ در انتظار بازبینی</button>
          </div>
          {draft && (
            <div className="rounded-xl bg-slate-50 p-2 dark:bg-wall-900">
              <p><b>{fa(draft.rows)}</b> ردیف قراردادی · تطبیق نام‌ها: {Object.entries(byType).map(([k, n]) => `${MATCH_FA[k] ?? k} ${fa(n)}`).join('، ')}{draft.skipped.length ? ` · ${fa(draft.skipped.length)} ردیف کنار گذاشته شد` : ''}</p>
              {draft.matches.filter((m) => m.needsReview).slice(0, 6).map((m) => <p key={m.row} className="text-amber-800">ردیف {fa(m.row)} «{m.name}»: {m.note}</p>)}
              {draft.batch && draft.batch.status !== 'DRY_RUN' && <p className="mt-1 font-bold text-emerald-800">دستهٔ {draft.batch.batchId} ثبت شد ({fa(draft.batch.accepted)} ردیف معتبر) — برای ورود به سنجه، در بخش «ورود دادهٔ قراردادی» بازبینی و تأیید کنید.</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MemoryPanel() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MemoryHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { setErr(null); try { setHits((await agenticApi.searchMemory(q.trim())).hits); } catch (e) { setErr(errMsg(e)); } };
  return (
    <section className={card}>
      <h3 className="mb-2 text-sm font-bold">جست‌وجو در اسناد و منابع</h3>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim().length > 1) void go(); }} placeholder="مثلاً نرخ اشتغال منطقه ۶" className={`${input} flex-1 text-xs`} />
        <button disabled={q.trim().length < 2} onClick={() => void go()} className={btn2}><Search size={14} /> جست‌وجو</button>
      </div>
      {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
      {hits && <ul className="mt-2 space-y-1 text-[11px]">{hits.length ? hits.map((h) => <li key={h.chunkId}><b>{h.kind === 'document' ? 'سند' : 'منبع'}: {h.title}</b>{h.page ? ` (ص ${fa(h.page)})` : ''} — <span className="text-ink-500">{h.snippet}</span></li>) : <li className="text-ink-500">چیزی یافت نشد.</li>}</ul>}
    </section>
  );
}

export function ResearchTab() {
  return (
    <div className="space-y-4">
      <ResearchPanel />
      <WebResearchPanel />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><DocumentPanel /></div>
        <MemoryPanel />
      </div>
    </div>
  );
}
