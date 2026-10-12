/** زبانهٔ «عملیات و هزینه»: هزینهٔ روزانه، سلامت هوش مصنوعی و ذخیره‌سازی، خطا و هشدار، پشتیبان‌گیری */
import { useEffect, useState } from 'react';
import { Archive, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { agenticApi, type AiHealth, type BackupInfo, type CityReadiness, type CostReport, type StorageStatus } from '../algorithm/agenticApi';

const card = 'rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800';
const btn2 = 'flex items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-xs font-bold disabled:opacity-50 dark:border-wall-700';
const fa = (n: number, d = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: d });
const usd = (n: number | null) => (n === null ? '—' : `${fa(n, 3)} دلار`);
const mb = (b: number) => `${fa(b / 1e6, 1)} مگابایت`;
const when = (s: string) => new Date(s).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
const STATE: Record<string, string> = { closed: 'سالم', half_open: 'در حال آزمون', open: 'موقتاً کنار گذاشته شده' };

const LEVEL: Record<CityReadiness['level'], { t: string; c: string }> = {
  ready: { t: 'آماده', c: 'bg-emerald-100 text-emerald-900' }, partial: { t: 'نیمه‌آماده', c: 'bg-amber-100 text-amber-900' },
  gazetteer_only: { t: 'فقط فهرست محلات', c: 'bg-slate-100 text-slate-800' }, not_onboarded: { t: 'وارد نشده', c: 'bg-rose-100 text-rose-900' },
};
/** CITY-v1: آمادگی هر شهر برای تحلیل (بر پایهٔ گزتیر و دادهٔ تأییدشده) */
function CitiesCard() {
  const [cs, setCs] = useState<CityReadiness[] | null>(null);
  useEffect(() => { void agenticApi.cities().then(setCs).catch(() => setCs([])); }, []);
  return (
    <div className={card}>
      <h3 className="mb-1 text-sm font-black">شهرها</h3>
      <p className="mb-2 text-[11px] text-slate-500">شهر تازه با scripts/onboard-city.ts و نمایهٔ data/cities افزوده می‌شود.</p>
      {!cs ? <Loader2 className="h-4 w-4 animate-spin" /> : !cs.length ? <p className="text-xs text-slate-500">شهری ثبت نشده است.</p> : (
        <ul className="space-y-2 text-xs">{cs.map((c) => (
          <li key={c.slug}>
            <div className="flex flex-wrap items-center gap-2"><b>{c.cityFa}</b><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${LEVEL[c.level].c}`}>{LEVEL[c.level].t}</span>
              <span className="text-slate-500">{fa(c.neighborhoods)} محله · مرز رسمی {fa(c.boundaries.official)} · OSM {fa(c.boundaries.osm_admin)} · تقریبی {fa(c.boundaries.derived)} · {fa(c.districts)} منطقه · دادهٔ تأییدشده برای {fa(c.withApprovedData)} محله</span></div>
            {c.nextSteps.length > 0 && <ul className="mt-0.5 list-disc pr-5 text-[11px] text-slate-500">{c.nextSteps.map((n) => <li key={n}>{n}</li>)}</ul>}
          </li>))}</ul>
      )}
    </div>
  );
}

export function OpsTab() {
  const [days, setDays] = useState(30);
  const [cost, setCost] = useState<CostReport | null>(null);
  const [ai, setAi] = useState<AiHealth | null>(null);
  const [st, setSt] = useState<StorageStatus | null>(null);
  const [ev, setEv] = useState<Awaited<ReturnType<typeof agenticApi.opsErrors>> | null>(null);
  const [bk, setBk] = useState<Awaited<ReturnType<typeof agenticApi.backups>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => {
    void agenticApi.costs(days).then(setCost).catch(() => undefined);
    void agenticApi.aiHealth().then(setAi).catch(() => undefined);
    void agenticApi.storage().then(setSt).catch(() => undefined);
    void agenticApi.opsErrors().then(setEv).catch(() => undefined);
    void agenticApi.backups().then(setBk).catch(() => undefined);
  };
  useEffect(load, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (k: string, f: () => Promise<string>) => { setBusy(k); setMsg(null); try { setMsg(await f()); load(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); } };
  const active = cost?.rows.filter((r) => r.web.research || r.web.search || r.ai.calls) ?? [];

  return (
    <div className="space-y-4">
      <CitiesCard />
      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black">هزینه و مصرف</h3>
          <div className="flex items-center gap-2 text-xs">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-line bg-transparent px-2 py-1 dark:border-wall-700">
              {[7, 30, 90].map((d) => <option key={d} value={d}>{fa(d)} روز اخیر</option>)}
            </select>
            <button className={btn2} onClick={load}><RefreshCw className="h-3 w-3" /> تازه‌سازی</button>
          </div>
        </div>
        {cost && <>
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <Stat label="هزینهٔ پژوهش وب" value={usd(cost.totals.webUsd)} />
            <Stat label="پژوهش‌های وب" value={fa(cost.totals.webResearch)} />
            <Stat label="فراخوانی هوش مصنوعی" value={`${fa(cost.totals.aiCalls)} (${fa(cost.totals.aiFailures)} ناموفق)`} />
            <Stat label="هزینهٔ هوش مصنوعی" value={cost.aiPriced ? usd(cost.totals.aiUsd) : `${fa(cost.totals.aiTokens)} توکن (قیمت تعریف نشده)`} />
          </div>
          <p className="mb-2 text-[11px] text-slate-500">سقف روزانهٔ پژوهش وب: {fa(cost.web.dailyResearch)} پژوهش و {fa(cost.web.dailyBudgetUsd)} دلار.</p>
          {active.length ? <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="text-slate-500"><th className="p-1 text-right">روز</th><th className="p-1">پژوهش وب</th><th className="p-1">جست‌وجو</th><th className="p-1">هزینهٔ وب</th><th className="p-1">هوش مصنوعی (موفق/کل)</th><th className="p-1">توکن</th><th className="p-1">هزینهٔ هوش مصنوعی</th></tr></thead>
            <tbody>{active.slice().reverse().map((r) => <tr key={r.day} className="border-t border-line dark:border-wall-700"><td className="p-1" dir="ltr">{r.day}</td><td className="p-1 text-center">{fa(r.web.research)}</td><td className="p-1 text-center">{fa(r.web.search)}</td><td className="p-1 text-center">{usd(r.web.costUsd)}</td><td className="p-1 text-center">{fa(r.ai.ok)}/{fa(r.ai.calls)}</td><td className="p-1 text-center">{fa(r.ai.inputTokens + r.ai.outputTokens)}</td><td className="p-1 text-center">{usd(r.ai.costUsd)}</td></tr>)}</tbody></table></div>
            : <p className="text-xs text-slate-500">در این بازه مصرفی ثبت نشده است.</p>}
        </>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={card}>
          <h3 className="mb-2 text-sm font-black">سلامت سرویس‌ها</h3>
          <ul className="space-y-1 text-xs">
            {ai && (!ai.configured ? <li>هوش مصنوعی: پیکربندی نشده</li> : ai.providers.map((p) => <li key={p.id}>هوش مصنوعی — {p.labelFa}: <b>{STATE[p.state] ?? p.state}</b>{p.lastOkAt ? ` · آخرین پاسخ موفق ${when(p.lastOkAt)}` : ' · هنوز پاسخ موفقی نداشته'}{p.lastError && p.state !== 'closed' ? ` · ${p.lastError}` : ''}</li>))}
            {ai?.configured && ai.providers.length < 2 && <li className="text-amber-700 dark:text-amber-400">سرویس پشتیبان هوش مصنوعی تعریف نشده است.</li>}
            {st && <li>ذخیره‌سازی پایدار: {st.sync.active ? <>PostgreSQL فعال · {fa(st.sync.tracked)} پرونده · در صف {fa(st.sync.pending)}{st.sync.failures ? ` · ${fa(st.sync.failures)} خطا` : ''}</> : 'فقط فایل محلی'}</li>}
            {st && <li>جست‌وجوی حافظه: {st.memory.vectorStore === 'pgvector' ? 'ترکیبی در پایگاه داده' : 'ترکیبی درون‌برنامه‌ای'} · {fa(st.memory.chunks)} پاره</li>}
          </ul>
        </div>
        <div className={card}>
          <h3 className="mb-2 text-sm font-black">خطاها و هشدارها</h3>
          {ev && <>
            <p className="mb-1 text-[11px] text-slate-500">{ev.webhook ? 'هشدارها به نشانی پیام‌رسان تعریف‌شده فرستاده می‌شوند.' : 'نشانی هشدار (ARA_ALERT_WEBHOOK_URL) تعریف نشده؛ هشدارها فقط اینجا ثبت می‌شوند.'}</p>
            {ev.alerts.length ? <ul className="mb-2 max-h-40 space-y-1 overflow-y-auto text-[11px]">{ev.alerts.slice(0, 10).map((a, i) => <li key={i}><b>{a.title}</b> — {a.detail} <span className="text-slate-500">({when(a.at)}{a.delivered === false ? '، ارسال نشد' : ''})</span></li>)}</ul> : <p className="mb-2 text-xs text-slate-500">هشداری ثبت نشده است.</p>}
            {ev.errors.length ? <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px]">{ev.errors.slice(0, 10).map((e, i) => <li key={i} dir="auto"><span dir="ltr" className="font-mono">{e.method} {e.route} {e.status}</span> — {e.message} <span className="text-slate-500">({when(e.at)})</span></li>)}</ul> : <p className="text-xs text-slate-500">خطای سروری ثبت نشده است.</p>}
          </>}
        </div>
      </div>

      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black">پشتیبان‌گیری</h3>
          <button className={btn2} disabled={Boolean(busy)} onClick={() => void act('create', async () => { const b = await agenticApi.createBackup(); return `پشتیبان ${b.name} ساخته شد (${fa(b.files)} فایل، ${mb(b.archiveBytes)}).`; })}>{busy === 'create' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />} پشتیبان‌گیری اکنون</button>
        </div>
        {bk && <p className="mb-2 text-[11px] text-slate-500">{bk.schedule.everyHours > 0 ? `خودکار هر ${fa(bk.schedule.everyHours)} ساعت` : 'پشتیبان‌گیری خودکار خاموش است (ARA_BACKUP_HOURS)'} · نگه‌داری {fa(bk.schedule.keep)} نسخهٔ آخر · بازگردانی فقط با اسکریپت scripts/restore-backup.mjs</p>}
        {msg && <p className="mb-2 text-xs">{msg}</p>}
        {bk?.backups.length ? <ul className="space-y-1 text-xs">{bk.backups.map((b) => <li key={b.name} className="flex flex-wrap items-center gap-2"><span dir="ltr" className="font-mono text-[11px]">{b.name}</span><span className="text-slate-500">{when(b.createdAt)} · {fa(b.files)} فایل · {mb(b.archiveBytes)}</span>
          <button className={btn2} disabled={Boolean(busy)} onClick={() => void act(`v${b.name}`, async () => { const v = await agenticApi.verifyBackup(b.name); return v.ok ? `پشتیبان ${b.name} سالم است (${fa(v.files)} فایل).` : `پشتیبان ${b.name} مشکل دارد: ${v.reasons.join('؛ ')}`; })}>{busy === `v${b.name}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} راستی‌آزمایی</button></li>)}</ul>
          : <p className="text-xs text-slate-500">هنوز پشتیبانی ساخته نشده است.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-2 dark:bg-wall-900"><div className="text-[10px] text-slate-500">{label}</div><div className="font-bold">{value}</div></div>;
}
