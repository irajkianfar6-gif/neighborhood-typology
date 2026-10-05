import React from 'react';
import { Activity, ArrowLeft, BarChart3, CheckCircle2, ClipboardList, MessageSquareQuote, Scale, ShieldAlert, Users } from 'lucide-react';
import type { CollectionStatus, PlanModule } from '../../algorithm/dataCollectionApi';
import type { DecisionCardV2 } from '../../algorithm/neighborhoodApi';
import { ITEM_BY_CODE, QC_REASON_FA } from '../../algorithm/surveyInstrument';
import { Bar, Card, ProgressRing, StatusPill, fa, ghostBtn } from './ui';

export type HubTab = 'overview' | 'survey' | 'bulk' | 'audit' | 'register';
const MODULE_TAB: Record<PlanModule['key'], HubTab> = { survey: 'survey', household: 'survey', audit: 'audit', register: 'register', network: 'register' };
const STAGE_FA: Record<string, string> = { CAPACITY: 'ظرفیت', ACCESS: 'دسترسی', USE: 'استفاده', EXPERIENCE: 'تجربه', OUTCOME: 'پیامد' };
const AGE_FA: Record<string, string> = { '18-29': '۱۸–۲۹', '30-44': '۳۰–۴۴', '45-64': '۴۵–۶۴', '65+': '۶۵+' };
const SEX_FA: Record<string, string> = { male: 'مرد', female: 'زن' };

export default function CollectionOverview({ status, card, onOpen }: { status: CollectionStatus; card: DecisionCardV2 | null; onOpen: (t: HubTab) => void }) {
  const { survey, plan } = status;
  const cardScore = new Map((card?.indicators ?? []).map((i) => [i.code, i]));
  const totalRejected = survey.nReceived - survey.nAccepted;
  const checks = Object.entries(survey.itemScores)
    .map(([code, perceived]) => ({ code, perceived, item: ITEM_BY_CODE[code], measured: ITEM_BY_CODE[code]?.checksAgainst ? cardScore.get(ITEM_BY_CODE[code].checksAgainst!) : undefined }))
    .filter((c) => c.measured && c.measured.score !== null);

  const quota = (dim: 'sex' | 'ageBand') => {
    const got = survey.quotas[dim] ?? {};
    const tgt = dim === 'sex'
      ? (status.structure.male && status.structure.female ? { male: status.structure.male, female: status.structure.female } : null)
      : status.structure.ageBands;
    const keys = dim === 'sex' ? ['female', 'male'] : ['18-29', '30-44', '45-64', '65+'];
    const gotTotal = Object.values(got).reduce((a, b) => a + b, 0) || 1;
    const tgtTotal = tgt ? Object.values(tgt).reduce((a, b) => a + b, 0) || 1 : 1;
    return keys.map((k) => ({ key: k, label: dim === 'sex' ? SEX_FA[k] : AGE_FA[k], got: got[k] ?? 0, share: ((got[k] ?? 0) / gotTotal) * 100, target: tgt && tgt[k] !== undefined ? (tgt[k] / tgtTotal) * 100 : undefined, expected: tgt && tgt[k] !== undefined ? Math.round((tgt[k] / tgtTotal) * plan.recommendedN) : undefined }));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<ProgressRing value={plan.overall} size={54} stroke={6} />} label="پیشرفت کل گردآوری" value={`${fa(plan.overall * 100)}٪`} hint={`${fa(plan.unlockable.length)} شاخص قابل گشودن`} />
        <Kpi icon={<Users size={22} />} label="پاسخ معتبر ساکنان" value={`${fa(survey.nAccepted)} / ${fa(plan.recommendedN)}`} hint={`دروازهٔ انتشار: ${fa(plan.gateN)} · ${survey.adequacy === 'ADEQUATE' ? 'کافی' : survey.adequacy === 'MINIMUM' ? 'حداقلی' : 'ناکافی'}`} />
        <Kpi icon={<Scale size={22} />} label="پایایی (آلفای کرونباخ)" value={survey.alpha === null ? '—' : fa(survey.alpha, 2)} hint={survey.alpha === null ? 'دست‌کم ۱۰ پاسخ کامل لازم است' : survey.alpha >= 0.7 ? 'پایا (≥ ۰٫۷)' : 'زیر آستانهٔ ۰٫۷'} tone={survey.alpha !== null && survey.alpha >= 0.7 ? 'ok' : 'warn'} />
        <Kpi icon={<Activity size={22} />} label="حاشیهٔ خطا (۹۵٪)" value={survey.marginOfError === null ? '—' : `±${fa(survey.marginOfError, 1)}٪`} hint={survey.weighting === 'raked' ? 'وزن‌دهی بر جنس/سن' : 'بدون وزن جمعیتی'} />
        <Kpi icon={<ShieldAlert size={22} />} label="ردشده در کنترل کیفیت" value={fa(totalRejected)} hint={totalRejected ? Object.entries(survey.rejectedByReason).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r, n]) => `${QC_REASON_FA[r] ?? r} (${fa(n)})`).join('، ') : 'بدون پاسخ ردشده'} tone={totalRejected ? 'warn' : 'ok'} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {plan.modules.map((m) => (
          <React.Fragment key={m.key}>
          <Card title={m.title} icon={<ClipboardList size={14} />}
            actions={<div className="flex items-center gap-2"><StatusPill status={m.status} /><button type="button" className={ghostBtn} onClick={() => onOpen(MODULE_TAB[m.key])}>ورود داده <ArrowLeft size={12} /></button></div>}>
            <Bar value={m.progress * 100} tone={m.status === 'ready' ? 'ok' : m.status === 'partial' ? 'warn' : 'brand'} />
            <p className="mt-2 text-[10px] leading-5 text-ink-500">{m.guidance}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {m.indicators.map((i) => (
                <div key={i.code} className="rounded-xl border border-line/70 p-2 dark:border-wall-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-ink-800 dark:text-slate-100"><span className="font-mono text-brand-700 dark:text-signal-400">{i.code}</span> {i.name}</span>
                    {i.status === 'ready' ? <CheckCircle2 size={14} className="text-emerald-500" /> : <span className="text-[10px] font-black text-ink-400">{fa(i.have)}/{fa(i.need)}</span>}
                  </div>
                  <div className="mt-1.5"><Bar value={i.progress * 100} tone={i.status === 'ready' ? 'ok' : 'warn'} /></div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[10px] text-ink-500">
                    <span>{i.value === null ? i.unit : <>مقدار پیمایش: <strong className="text-ink-800 dark:text-slate-100">{fa(i.value, 1)}</strong></>}</span>
                    {i.card.coveredElsewhere && <span className="rounded-full bg-sky-50 px-1.5 py-0.5 font-bold text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">در کارت از منبع دیگر</span>}
                    {!i.card.coveredElsewhere && i.card.score !== null && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700 dark:bg-emerald-900/20">در کارت: {fa(i.card.score, 0)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          </React.Fragment>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="ترکیب نمونه در برابر جمعیت محله" icon={<Users size={14} />}>
          {(['sex', 'ageBand'] as const).map((dim) => (
            <div key={dim} className="mb-3 space-y-2">
              {quota(dim).map((q) => (
                <div key={q.key} className="text-[10px]">
                  <div className="mb-1 flex justify-between"><span className="font-bold">{q.label}</span><span>{fa(q.got)} پاسخ · {fa(q.share)}٪{q.target !== undefined && <span className="text-ink-400"> (جمعیت {fa(q.target)}٪ · هدف ≈ {fa(q.expected)})</span>}</span></div>
                  <Bar value={q.share} marker={q.target} tone={q.target !== undefined && Math.abs(q.share - q.target) > 10 ? 'warn' : 'info'} />
                </div>
              ))}
            </div>
          ))}
          <p className="text-[10px] text-ink-400">{status.structure.source ? `خط عمودی = سهم در جمعیت (${status.structure.source})` : 'ترکیب جمعیتی محله در دادهٔ قراردادی نیست؛ وزن‌دهی انجام نمی‌شود.'}</p>
        </Card>

        <Card title="پروفایل ادراکی زنجیرهٔ C-A-U-E-O" icon={<BarChart3 size={14} />}>
          {Object.values(survey.chainProfile).every((v) => v === null) ? <p className="py-6 text-center text-[11px] text-ink-400">پس از نخستین پاسخ معتبر نمایش داده می‌شود.</p> : (
            <div className="space-y-2.5">
              {Object.entries(survey.chainProfile).map(([stage, v]) => (
                <div key={stage} className="text-[10px]"><div className="mb-1 flex justify-between"><span className="font-bold">{STAGE_FA[stage]}</span><span className="font-black">{v ? fa(v.score, 1) : '—'}</span></div><Bar value={v?.score ?? null} tone={(v?.score ?? 0) >= 60 ? 'ok' : (v?.score ?? 0) >= 40 ? 'warn' : 'danger'} /></div>
              ))}
              <p className="text-[10px] leading-5 text-ink-400">افت ناگهانی میان دو مرحله، محل احتمالی گلوگاه از نگاه ساکنان است و با تشخیص سامانه هم‌سنجی می‌شود.</p>
            </div>
          )}
        </Card>

        <Card title="ادراک ساکنان در برابر اندازه‌گیری" icon={<Scale size={14} />}>
          {checks.length === 0 ? <p className="py-6 text-center text-[11px] text-ink-400">پس از تحلیل محله و دریافت پاسخ‌ها، ادراک (مثلاً سبزینگی) با شاخص عینی متناظر (N2، P5، ...) مقایسه می‌شود.</p> : (
            <div className="space-y-2">
              {checks.map((c) => {
                const gap = c.perceived - (c.measured!.score as number);
                return (
                  <div key={c.code} className="rounded-xl border border-line/70 p-2 text-[10px] dark:border-wall-700">
                    <div className="flex justify-between font-bold"><span>{c.item.text.slice(0, 38)}…</span><span className={Math.abs(gap) > 25 ? 'text-rose-600' : 'text-emerald-600'}>{gap > 0 ? '+' : ''}{fa(gap, 0)}</span></div>
                    <div className="mt-1 grid grid-cols-2 gap-1 text-ink-500"><span>ادراک {c.code}: {fa(c.perceived, 0)}</span><span>اندازه‌گیری {c.item.checksAgainst}: {fa(c.measured!.score, 0)}</span></div>
                  </div>
                );
              })}
              <p className="text-[10px] text-ink-400">اختلاف بیش از ۲۵ امتیاز نشانهٔ ناهمخوانی ادراک و واقعیت است (مسئلهٔ کیفیت، نه کمیت).</p>
            </div>
          )}
        </Card>
      </div>

      {survey.followUpSamples.length > 0 && (
        <Card title="صدای ساکنان (پاسخ سؤال‌های تکمیلی)" icon={<MessageSquareQuote size={14} />}>
          <div className="grid gap-2 md:grid-cols-2">
            {survey.followUpSamples.slice(0, 10).map((f, i) => (
              <blockquote key={i} className="rounded-xl border-r-4 border-brand-300 bg-paper px-3 py-2 text-[11px] leading-6 dark:border-signal-400 dark:bg-wall-850">
                «{f.text}»<footer className="mt-1 text-[9px] text-ink-400">{f.code} · {ITEM_BY_CODE[f.code]?.text.slice(0, 40)}</footer>
              </blockquote>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 dark:border-wall-700 dark:bg-wall-800">
      <div className={`flex shrink-0 items-center justify-center ${tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-brand-700 dark:text-signal-400'}`}>{icon}</div>
      <div className="min-w-0"><div className="text-[10px] font-bold text-ink-400">{label}</div><div className="text-sm font-black text-ink-900 dark:text-white">{value}</div>{hint && <div className="truncate text-[10px] text-ink-500" title={hint}>{hint}</div>}</div>
    </div>
  );
}
