import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Download, Loader2, RefreshCw } from 'lucide-react';
import { QC_FA, type CustomQuestionnaire } from '../../../algorithm/customSurveyModel';
import { aiInterpretSurvey, customExportUrl, customSummary, type AiInterpretation, type CustomSurveySummary } from '../../../algorithm/customSurveyApi';
import { Bar, Card, Notice, fa, ghostBtn, primaryBtn } from '../ui';

const GROUP_FA: Record<string, string> = { sex: 'جنس', ageBand: 'سن', tenure: 'سکونت', male: 'مرد', female: 'زن', owner: 'مالک', renter: 'مستأجر', other: 'سایر' };

export default function CustomSurveyResults({ q, neighborhoodId, aiReady }: { q: CustomQuestionnaire; neighborhoodId: string; aiReady: boolean }) {
  const [s, setS] = useState<CustomSurveySummary | null>(null);
  const [ai, setAi] = useState<AiInterpretation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy('load'); setErr(null);
    try { const r = await customSummary(q.id, neighborhoodId); setS(r.summary); setAi(r.interpretation); } catch (e) { setErr(e instanceof Error ? e.message : 'خطا'); } finally { setBusy(null); }
  }, [q.id, neighborhoodId]);
  useEffect(() => { void load(); }, [load]);
  const interpret = async () => {
    setBusy('ai'); setErr(null);
    try { setAi(await aiInterpretSurvey(q.id, neighborhoodId)); } catch (e) { setErr(e instanceof Error ? e.message : 'خطا'); } finally { setBusy(null); }
  };
  if (!s) return <div className="flex items-center justify-center gap-2 py-10 text-xs text-ink-500">{busy ? <><Loader2 size={16} className="animate-spin" /> در حال محاسبه…</> : err}</div>;
  const stale = ai && ai.basedOn.nAccepted !== s.nAccepted;

  return (
    <div className="space-y-3">
      <Card title={`نتایج «${q.title}» (نسخهٔ ${fa(q.version)})`} actions={<div className="flex gap-2">
        <button type="button" className={ghostBtn} onClick={() => void load()} disabled={!!busy}><RefreshCw size={13} /> به‌روزرسانی</button>
        <a className={ghostBtn} href={customExportUrl(q.id, neighborhoodId)} download><Download size={13} /> CSV</a></div>}>
        <div className="grid gap-3 text-center sm:grid-cols-4">
          {[['دریافتی', s.nReceived], ['پذیرفته', s.nAccepted], ['ردشده', s.nReceived - s.nAccepted], ['پاسخ باز', s.textAnswers]].map(([l, v]) => (
            <div key={l as string} className="rounded-2xl bg-paper p-3 dark:bg-wall-850"><p className="text-lg font-black">{fa(v as number)}</p><p className="text-[10px] text-ink-500">{l}</p></div>
          ))}
        </div>
        {Object.keys(s.rejectedByReason).length > 0 && <p className="mt-2 text-[11px] text-ink-500">دلایل رد: {Object.entries(s.rejectedByReason).map(([k, v]) => `${QC_FA[k] ?? k} (${fa(v as number)})`).join('، ')}</p>}
        <p className="mt-1 text-[11px] text-ink-500">وزن‌دهی: {s.weighting === 'raked' ? `بله — ${s.weightingNote ?? 'بر اساس ترکیب جنس/سن محله'}` : 'بدون وزن (مشخصات یا جمعیت مرجع در دسترس نیست)'}</p>
      </Card>

      {err && <Notice tone="danger">{err}</Notice>}

      {s.indicators.length > 0 && (
        <Card title="شاخص‌ها (محاسبهٔ قطعی)">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-[11px]">
              <thead className="text-ink-500"><tr><th className="p-1.5">شاخص</th><th>امتیاز ۰..۱۰۰</th><th>CI95</th><th>n</th><th>α</th><th>وضعیت</th></tr></thead>
              <tbody>{s.indicators.map((e) => (
                <tr key={e.code} className="border-t border-line align-top dark:border-wall-700">
                  <td className="p-1.5"><strong className="font-mono">{e.code}</strong> {e.name}<span className="block text-[10px] text-ink-400">گویه‌ها: {e.items.join('، ')}</span>
                    {Object.entries(e.groups).map(([g, vals]: [string, Record<string, { score: number; n: number }>]) => <span key={g} className="block text-[10px] text-ink-400">{GROUP_FA[g]}: {Object.entries(vals).map(([k, v]: [string, { score: number; n: number }]) => `${GROUP_FA[k] ?? k} ${fa(v.score, 1)} (n=${fa(v.n)})`).join(' · ')}</span>)}</td>
                  <td className="w-40 p-1.5"><span className="font-black">{fa(e.score, 1)}</span><Bar value={e.score} tone={e.score === null ? 'info' : e.score >= 60 ? 'ok' : e.score >= 40 ? 'warn' : 'danger'} /></td>
                  <td className="p-1.5">{e.ci95 ? `${fa(e.ci95[0], 1)}–${fa(e.ci95[1], 1)}` : '—'}</td>
                  <td className="p-1.5">{fa(e.n)}</td>
                  <td className={`p-1.5 ${e.alpha !== null && e.alpha < 0.7 ? 'text-amber-600' : ''}`}>{e.alpha === null ? '—' : fa(e.alpha, 2)}</td>
                  <td className="p-1.5 text-[10px] font-bold">{!e.core ? <span className="text-ink-400">شاخص سفارشی — فقط گزارش</span>
                    : !e.publishable ? <span className="text-amber-600">نمونه کم (حداقل {fa(q.minEligible)})</span>
                    : e.role === 'check' ? <span className="text-sky-600">کنترلی — مقایسه با منبع دیگر</span>
                    : <span className="text-emerald-600">وارد کارت تصمیم می‌شود (پس از بازمحاسبه)</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="گویه‌ها">
        <div className="space-y-3">
          {s.items.map((it) => (
            <div key={it.code} className="rounded-xl border border-line p-2.5 dark:border-wall-700">
              <p className="text-xs font-black"><span className="font-mono text-[10px] text-ink-400">{it.code}</span> {it.text} <span className="text-[10px] font-normal text-ink-400">(n={fa(it.n)} از {fa(it.eligible)} واجد شرایط{it.score !== undefined && it.score !== null ? ` · امتیاز ${fa(it.score, 1)}` : ''}{it.mean !== undefined && it.mean !== null ? ` · میانگین ${fa(it.mean, 2)}` : ''}{it.median !== undefined && it.median !== null ? ` · میانه ${fa(it.median, 1)}` : ''})</span></p>
              {it.distribution && <div className="mt-2 grid gap-1">{it.distribution.map((d) => (
                <div key={d.value} className="grid grid-cols-[minmax(80px,180px)_1fr_60px] items-center gap-2 text-[10px]"><span className="truncate">{d.label}</span><Bar value={d.share} /><span>{fa(d.share, 1)}٪ ({fa(d.count)})</span></div>
              ))}</div>}
              {it.textSamples && <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] text-ink-600 dark:text-slate-300">{it.textSamples.slice(-30).reverse().map((t) => <li key={t.id}>«{t.text}»</li>)}</ul>}
            </div>
          ))}
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Bot size={14} /> تفسیر هوش مصنوعی</span>} actions={
        <button type="button" className={primaryBtn} disabled={!!busy || !aiReady || !s.nAccepted} onClick={() => void interpret()} title={aiReady ? '' : 'هوش مصنوعی پیکربندی نشده است'}>
          {busy === 'ai' ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />} {ai ? 'تفسیر دوباره' : 'تفسیر نتایج و پاسخ‌های باز'}</button>}>
        {!ai ? <p className="text-[11px] text-ink-500">هوش مصنوعی آمار بالا و پاسخ‌های باز را می‌خواند، مضمون‌ها را دسته‌بندی و جمع‌بندی می‌کند. اعداد را سامانه محاسبه می‌کند و این تفسیر وارد کارت تصمیم نمی‌شود.</p> : (
          <div className="space-y-3 text-xs leading-6">
            <Notice tone="info">{ai.disclaimer} (مدل: {ai.model} · {new Date(ai.generatedAt).toLocaleString('fa-IR')} · بر پایهٔ {fa(ai.basedOn.nAccepted)} پاسخ){stale ? ' — پاسخ‌های تازه رسیده؛ برای به‌روزرسانی «تفسیر دوباره» را بزنید.' : ''}</Notice>
            <p>{ai.summary}</p>
            {ai.keyFindings.length > 0 && <div><p className="font-black">یافته‌های کلیدی</p><ul className="list-disc pr-5">{ai.keyFindings.map((k, i) => <li key={i}>{k.text}{k.basis.length > 0 && <span className="text-[10px] text-ink-400"> [{k.basis.join('، ')}]</span>}</li>)}</ul></div>}
            {ai.themes.length > 0 && <div><p className="font-black">مضمون‌های پاسخ‌های باز (شمارش توسط سامانه)</p>
              {ai.themes.map((t, i) => <div key={i} className="mt-1.5 rounded-xl bg-paper p-2 dark:bg-wall-850"><p className="font-bold">{t.label} — {fa(t.count)} پاسخ ({fa(t.share, 1)}٪)</p><p className="text-[11px] text-ink-500">{t.description}</p>{t.examples.map((x, j) => <p key={j} className="text-[10px] text-ink-400">«{x}»</p>)}</div>)}</div>}
            {ai.actions.length > 0 && <div><p className="font-black">اقدام‌های پیشنهادی</p><ul className="list-disc pr-5">{ai.actions.map((a, i) => <li key={i}>{a.text}{a.linkedIndicators.length > 0 && <span className="text-[10px] text-ink-400"> [{a.linkedIndicators.join('، ')}]</span>}</li>)}</ul></div>}
            {ai.cautions.length > 0 && <div><p className="font-black text-amber-700">احتیاط‌ها</p><ul className="list-disc pr-5 text-amber-700">{ai.cautions.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
          </div>
        )}
      </Card>
    </div>
  );
}
