// ============================================================
// فاز ۵ فریمورک ایجنتیک: کارزار میدانی، پایش پس از مداخله و یادگیری/واسنجی
// همهٔ تصمیم‌های اثرگذار (شروع میدانی، ثبت مداخله، پذیرش واسنجی) با کارشناس است.
// ============================================================
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, ClipboardCheck, GraduationCap, Loader2, Play, RefreshCw, Target } from 'lucide-react';
import { agenticApi, type CalibrationProposal, type FieldCampaign, type FieldCycle, type FieldProgress, type LibraryItem, type MonitoringRecord, type MonVerdict } from '../algorithm/agenticApi';
import { CAPITAL_FA, type CapitalKey } from '../algorithm/types';

const fa = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 1 });
const pct = (x: number) => `${fa(Math.round(x * 100))}٪`;
const card = 'rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800';
const input = 'rounded-lg border border-line bg-transparent px-2 py-1.5 dark:border-wall-700';
const btn = 'flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50';
const btn2 = 'flex items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-xs font-bold disabled:opacity-50 dark:border-wall-700';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const capFa = (k: string) => CAPITAL_FA[k as CapitalKey] ?? k;
const STATUS_FA: Record<string, string> = { draft: 'پیش‌نویس (در انتظار تأیید)', fielding: 'در حال گردآوری', closed: 'بسته‌شده', cancelled: 'لغوشده', proposed: 'پیشنهادی', approved: 'پذیرفته', rejected: 'ردشده' };
const VERDICT_FA: Record<MonVerdict, string> = { improved: 'بهبود', worsened: 'بدتر شدن', no_change: 'بدون تغییر معنادار', insufficient_data: 'دادهٔ ناکافی' };
const VERDICT_CLS: Record<MonVerdict, string> = { improved: 'text-emerald-700', worsened: 'text-rose-700', no_change: 'text-amber-700', insufficient_data: 'text-muted' };
const KIND_FA: Record<string, string> = { tier_calibration: 'واسنجی سطح شواهد', collector_qc: 'کیفیت پرسشگری', intervention_evidence: 'شواهد مداخله', tool_reliability: 'پایایی ابزار' };
const GROUP_FA: Record<string, string> = { sex: 'جنسیت', ageBand: 'گروه سنی', male: 'مرد', female: 'زن' };
const g = (k: string) => GROUP_FA[k] ?? k;

export function FieldLearningTab({ onOpenSurvey }: { onOpenSurvey?: () => void }) {
  const [nb, setNb] = useState('tehran:m605');
  const [offline, setOffline] = useState(true);
  const [cycle, setCycle] = useState<FieldCycle | null>(null);
  const [camp, setCamp] = useState<FieldCampaign | null>(null);
  const [prog, setProg] = useState<FieldProgress | null>(null);
  const [lib, setLib] = useState<LibraryItem[]>([]);
  const [libId, setLibId] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [mons, setMons] = useState<MonitoringRecord[]>([]);
  const [props, setProps] = useState<CalibrationProposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const run = async (what: string, f: () => Promise<void>) => { setBusy(what); setErr(null); setInfo(null); try { await f(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); } };

  const refresh = async (id = nb) => {
    const c = await agenticApi.fieldCycle(id); setCycle(c);
    const latest = c.campaigns.find((x) => x.status === 'draft' || x.status === 'fielding') ?? c.campaigns.find((x) => x.status === 'closed') ?? c.campaigns[0];
    if (latest) { const r = await agenticApi.campaign(latest.id); setCamp(r.campaign); setProg(r.progress); } else { setCamp(null); setProg(null); }
    setMons((await agenticApi.monitoring(id)).items);
    setProps((await agenticApi.proposals()).items);
  };
  useEffect(() => { void agenticApi.library().then((l) => { setLib(l); if (l[0]) setLibId(l[0].id); }).catch(() => undefined); }, []);

  const open = camp && (camp.status === 'draft' || camp.status === 'fielding');
  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-1 flex items-center gap-1 text-sm font-bold"><ClipboardCheck className="h-4 w-4" /> چرخهٔ میدان و یادگیری</h3>
        <p className="mb-3 text-xs text-muted">سنجش پایه ← کارزار میدانی ← تأیید کارشناس ← گردآوری ← بازسنجی ← پایش مداخله ← یادگیری. عامل‌ها برنامه و گزارش می‌سازند؛ شروع کار میدانی، ثبت مداخله و پذیرش هر واسنجی فقط با تصمیم کارشناس است.</p>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="flex flex-col gap-1">شناسهٔ محله<input className={`${input} font-mono`} dir="ltr" value={nb} onChange={(e) => setNb(e.target.value)} /></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> فقط دادهٔ محلی (سریع)</label>
          <button className={btn} disabled={Boolean(busy)} onClick={() => void run('load', () => refresh())}>{busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} نمایش وضعیت چرخه</button>
        </div>
        {err && <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-900">{err}</div>}
        {info && <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">{info}</div>}
        {cycle && (
          <div className="mt-3 space-y-2">
            <div className="text-xs font-bold">{cycle.nameFa}</div>
            <ol className="flex flex-wrap gap-2 text-xs">
              {cycle.stages.map((s, i) => <li key={s.key} className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${s.done ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-line'}`}>{s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}{fa(i + 1)}. {s.title}</li>)}
            </ol>
            <div className="rounded-xl bg-brand-50 p-2 text-xs text-brand-900 dark:bg-wall-700 dark:text-white">گام بعدی: {cycle.next}</div>
          </div>
        )}
      </div>

      {cycle && (
        <div className={card}>
          <h4 className="mb-2 flex items-center gap-1 text-sm font-bold"><Target className="h-4 w-4" /> کارزار میدانی (عامل A8)</h4>
          {!open && <button className={btn} disabled={Boolean(busy)} onClick={() => void run('create', async () => { await agenticApi.createCampaign({ neighborhoodId: nb, offline }); await refresh(); setInfo('کارزار ساخته شد؛ برنامه را بازبینی و شروع را تأیید کنید.'); })}>{busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} ساخت کارزار میدانی</button>}
          {camp && (
            <div className="mt-3 space-y-3 text-xs">
              <div className="flex flex-wrap gap-3"><span>وضعیت: <b>{STATUS_FA[camp.status]}</b></span><span>نمونهٔ هدف: <b>{fa(camp.plan.targetN)}</b></span><span>نقاط ممیزی: <b>{fa(camp.plan.auditPoints)}</b></span><span>مدت: {fa(camp.plan.days)} روز</span><span>سطح پایه: {camp.baseline.level}</span></div>
              <div>شاخص‌های هدف پیمایش: {camp.plan.targetCodes.length ? camp.plan.targetCodes.join('، ') : '—'}{camp.plan.otherGaps.length > 0 && <span className="text-muted"> (کمبودهای دیگر با منابع غیرپیمایشی: {camp.plan.otherGaps.length})</span>}</div>
              {Object.keys(camp.plan.quotas).length > 0 && <div>سهمیه‌ها: {Object.entries(camp.plan.quotas).map(([k, v]) => `${g(k)}: ${(Object.entries(v) as Array<[string, number]>).map(([gg, n]) => `${g(gg)} ${fa(n)}`).join('، ')}`).join(' | ')} <span className="text-muted">— {camp.plan.quotaNote}</span></div>}
              {camp.plan.questionnaires.length > 0 && <div>پرسشنامه‌ها: {camp.plan.questionnaires.map((q) => q.title).join('، ')}</div>}
              {camp.status === 'draft' && (
                <div className="flex flex-wrap gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2 text-amber-900">
                  <span className="self-center">تأیید شروع کار میدانی (تصمیم کارشناس):</span>
                  <button className={btn} disabled={Boolean(busy)} onClick={() => void run('approve', async () => { await agenticApi.decideCampaign(camp.id, 'approved'); await refresh(); })}>تأیید و شروع</button>
                  <button className={btn2} disabled={Boolean(busy)} onClick={() => void run('reject', async () => { await agenticApi.decideCampaign(camp.id, 'rejected'); await refresh(); })}>رد</button>
                </div>
              )}
              {camp.status === 'fielding' && prog && (
                <div className="space-y-2">
                  <div>
                    <div className="mb-1">پاسخ پذیرفته: <b>{fa(prog.perceptual.accepted)}</b> از {fa(prog.perceptual.target)} (دریافتی {fa(prog.perceptual.received)}، نرخ رد {pct(prog.perceptual.rejectionRate)}{prog.perceptual.marginOfError !== null && `، خطای نمونه ±${fa(prog.perceptual.marginOfError)}٪`}) — {prog.perceptual.adequacy}</div>
                    <div className="h-2 rounded-full bg-line"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, prog.perceptual.progress * 100)}%` }} /></div>
                  </div>
                  {Object.entries(prog.quotas).map(([k, v]) => <div key={k}>{g(k)}: {Object.entries(v).map(([gg, q]) => `${g(gg)} ${fa(q.got)}/${fa(q.target)}`).join('، ')}</div>)}
                  {Object.keys(prog.perceptual.rejectedByReason).length > 0 && <div>دلایل رد: {(Object.entries(prog.perceptual.rejectedByReason) as Array<[string, number]>).map(([r, n]) => `${r} (${fa(n)})`).join('، ')}</div>}
                  {prog.collectors.length > 0 && <div>پرسشگران: {prog.collectors.map((c) => <span key={c.collectorId} className={`ml-2 ${c.flagged ? 'font-bold text-rose-700' : ''}`}>{c.collectorId}: {fa(c.accepted)}/{fa(c.received)}{c.flagged && ' ⚠'}</span>)}</div>}
                  <div>ممیزی میدانی: {fa(prog.audits.points)} از {fa(prog.audits.target)} نقطه{prog.audits.kappa !== null && ` (توافق ممیزان κ=${fa(prog.audits.kappa)})`}</div>
                  {prog.warnings.map((w) => <div key={w} className="text-amber-800">⚠ {w}</div>)}
                  <div className="flex flex-wrap gap-2">
                    {onOpenSurvey && <button className={btn2} onClick={onOpenSurvey}>ورود پاسخ‌ها در زبانهٔ «دادهٔ پیمایشی»</button>}
                    <button className={btn2} disabled={Boolean(busy)} onClick={() => void run('load', () => refresh())}>به‌روزرسانی پیشرفت</button>
                    <button className={btn} disabled={Boolean(busy) || !prog.readyToClose} onClick={() => void run('close', async () => { await agenticApi.closeCampaign(camp.id); await refresh(); })}>{busy === 'close' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} بستن کارزار و بازسنجی</button>
                    {!prog.readyToClose && <button className={btn2} disabled={Boolean(busy)} onClick={() => { if (window.confirm('داده هنوز کافی نیست. کارزار با همین داده بسته و بازسنجی شود؟')) void run('close', async () => { await agenticApi.closeCampaign(camp.id, true); await refresh(); }); }}>بستن با دادهٔ ناکافی</button>}
                  </div>
                </div>
              )}
              {camp.outcome && (
                <div className="space-y-1 rounded-xl border border-line p-3 dark:border-wall-700">
                  <div className="font-bold">نتیجهٔ بازسنجی</div>
                  <div>سطح: {camp.outcome.levelBefore} ← {camp.outcome.levelAfter}؛ پوشش: {(Object.entries(camp.outcome.coverageDelta) as Array<[string, number]>).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${fa(v)}`).join('، ')}</div>
                  <div>شاخص‌های تازه‌سنجیده: {camp.outcome.newlyScored.join('، ') || '—'}؛ اعتبار افزوده: {camp.outcome.reliabilityGained.join('، ') || '—'}{camp.outcome.lost.length > 0 && `؛ ازدست‌رفته: ${camp.outcome.lost.join('، ')}`}</div>
                  <div>تغییر سرمایه‌ها: {Object.entries(camp.outcome.capitalDelta).filter(([, v]) => v !== null && v !== 0).map(([k, v]) => `${capFa(k)} ${(v as number) > 0 ? '+' : ''}${fa(v as number)}`).join('، ') || 'بدون تغییر'}؛ گلوگاه {camp.outcome.bottleneckChanged ? 'تغییر کرد' : 'تغییر نکرد'}</div>
                  {camp.outcome.surveyVsPrior.length > 0 && <div>پیمایش در برابر برآورد پیشین: {camp.outcome.surveyVsPrior.map((d) => `${d.code}: ${fa(d.before)} ← ${fa(d.after)}`).join('، ')}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {cycle && (
        <div className={card}>
          <h4 className="mb-2 text-sm font-bold">پایش پس از مداخله</h4>
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-1">مداخلهٔ اجراشده (از کتابخانه)<select className={input} value={libId} onChange={(e) => setLibId(e.target.value)}>{lib.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}</select></label>
            <label className="flex flex-col gap-1">تاریخ شروع<input type="date" className={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
            <button className={btn} disabled={Boolean(busy) || !libId} onClick={() => void run('mon', async () => { await agenticApi.registerMonitoring({ neighborhoodId: nb, libraryId: libId, startDate, offline }); await refresh(); setInfo('مداخله برای پایش ثبت شد.'); })}>ثبت برای پایش (کارشناس)</button>
          </div>
          <div className="mt-3 space-y-2 text-xs">
            {mons.map((m) => {
              const ev = m.evaluations.at(-1);
              return (
                <div key={m.id} className="rounded-xl border border-line p-2 dark:border-wall-700">
                  <div className="flex flex-wrap items-center gap-2"><b>{m.name}</b><span className="text-muted">شروع {m.startDate}، موعد {m.dueDate}</span>
                    <button className={btn2} disabled={Boolean(busy)} onClick={() => void run(`ev${m.id}`, async () => { await agenticApi.evaluateMonitoring(m.id); await refresh(); })}>{busy === `ev${m.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />} ارزیابی</button></div>
                  {ev && <div className="mt-1">نتیجه: <b className={VERDICT_CLS[ev.overall]}>{VERDICT_FA[ev.overall]}</b>{!ev.due && ' (پیش از موعد)'} — {ev.perTarget.map((p) => `${p.code}: ${p.delta === null ? '—' : `${p.delta > 0 ? '+' : ''}${fa(p.delta)}`} (${VERDICT_FA[p.verdict]})`).join('، ')}<div className="text-muted">{ev.note}</div></div>}
                </div>
              );
            })}
            {!mons.length && <div className="text-muted">هنوز مداخله‌ای برای این محله ثبت نشده است.</div>}
          </div>
        </div>
      )}

      {cycle && (
        <div className={card}>
          <h4 className="mb-2 flex items-center gap-1 text-sm font-bold"><GraduationCap className="h-4 w-4" /> یادگیری و واسنجی</h4>
          <p className="mb-2 text-xs text-muted">از نتیجهٔ کارزارها و پایش‌ها پیشنهاد واسنجی ساخته می‌شود. هیچ پیشنهادی خودکار اعمال نمی‌شود.</p>
          <button className={btn2} disabled={Boolean(busy)} onClick={() => void run('gen', async () => { const r = await agenticApi.generateProposals(); await refresh(); setInfo(`${fa(r.created.length)} پیشنهاد تازه ساخته شد.`); })}>{busy === 'gen' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} تولید پیشنهادهای یادگیری</button>
          <div className="mt-3 space-y-2 text-xs">
            {props.map((p) => (
              <div key={p.id} className="rounded-xl border border-line p-2 dark:border-wall-700">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-line px-1.5 dark:bg-wall-700">{KIND_FA[p.kind] ?? p.kind}</span><b>{p.title}</b><span className="text-muted">{STATUS_FA[p.status]}</span></div>
                <div className="mt-1">{p.detail}</div>
                <div className="text-muted">پیشنهاد: {p.suggestedChange}</div>
                {p.status === 'proposed' && <div className="mt-1 flex gap-2"><button className={btn2} disabled={Boolean(busy)} onClick={() => void run('dp', async () => { await agenticApi.decideProposal(p.id, 'approved'); await refresh(); })}>پذیرش</button><button className={btn2} disabled={Boolean(busy)} onClick={() => void run('dp', async () => { await agenticApi.decideProposal(p.id, 'rejected'); await refresh(); })}>رد</button></div>}
              </div>
            ))}
            {!props.length && <div className="text-muted">پیشنهادی وجود ندارد.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
