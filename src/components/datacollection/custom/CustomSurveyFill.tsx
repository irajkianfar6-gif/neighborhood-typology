import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Loader2, RotateCcw, Send, XCircle } from 'lucide-react';
import { LIKERT5_LABELS, LIKERT7_LABELS, QC_FA, checkResponse, visibleCustomItems, type CustomAnswers, type CustomItem, type CustomQuestionnaire, type Demographics } from '../../../algorithm/customSurveyModel';
import { submitCustomResponses } from '../../../algorithm/customSurveyApi';
import { deviceId } from '../../../algorithm/dataCollectionApi';
import { Card, Notice, fa, ghostBtn, inputCls, primaryBtn } from '../ui';

const DEMO = {
  sex: { l: 'جنس', o: [['female', 'زن'], ['male', 'مرد']] },
  ageBand: { l: 'گروه سنی', o: [['18-29', '۱۸ تا ۲۹'], ['30-44', '۳۰ تا ۴۴'], ['45-64', '۴۵ تا ۶۴'], ['65+', '۶۵ و بیشتر']] },
  tenure: { l: 'وضعیت سکونت', o: [['owner', 'مالک'], ['renter', 'مستأجر'], ['other', 'سایر']] },
} as const;
const chip = (on: boolean) => `rounded-xl border px-3 py-2 text-xs font-bold transition ${on ? 'border-brand-800 bg-brand-800 text-white dark:border-signal-400 dark:bg-signal-400 dark:text-wall-950' : 'border-line bg-paper hover:border-brand-300 dark:border-wall-700 dark:bg-wall-850'}`;

function Answer({ item, value, onChange }: { item: CustomItem; value: CustomAnswers[string]; onChange: (v: CustomAnswers[string]) => void }) {
  if (item.kind === 'likert5' || item.kind === 'likert7') {
    const labels = item.kind === 'likert7' ? LIKERT7_LABELS : LIKERT5_LABELS;
    return <div className="flex flex-wrap gap-1.5">{labels.map((l, k) => <button key={k} type="button" className={chip(value === k + 1)} onClick={() => onChange(value === k + 1 ? undefined : k + 1)}>{l}</button>)}</div>;
  }
  if (item.kind === 'binary') return <div className="flex gap-1.5">{[[1, 'بله'], [0, 'خیر']].map(([v, l]) => <button key={v} type="button" className={chip(value === v)} onClick={() => onChange(value === v ? undefined : v as number)}>{l}</button>)}</div>;
  if (item.kind === 'choice') return <div className="flex flex-wrap gap-1.5">{(item.options ?? []).map((o) => <button key={o.value} type="button" className={chip(value === o.value)} onClick={() => onChange(value === o.value ? undefined : o.value)}>{o.label}</button>)}</div>;
  if (item.kind === 'multi') {
    const cur = Array.isArray(value) ? value : [];
    return <div className="flex flex-wrap gap-1.5">{(item.options ?? []).map((o) => { const on = cur.includes(o.value); return <button key={o.value} type="button" className={chip(on)} onClick={() => { const n = on ? cur.filter((x) => x !== o.value) : [...cur, o.value]; onChange(n.length ? n : undefined); }}>{on ? '✓ ' : ''}{o.label}</button>; })}</div>;
  }
  if (item.kind === 'number') {
    return <div className="flex items-center gap-2"><input className={`${inputCls} !w-40`} type="number" min={item.min} max={item.max} step={item.step ?? 'any'} value={typeof value === 'number' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />{item.unit && <span className="text-xs text-ink-500">{item.unit}</span>}{item.min !== undefined && item.max !== undefined && <span className="text-[10px] text-ink-400">({fa(item.min)} تا {fa(item.max)})</span>}</div>;
  }
  return <textarea className={inputCls} rows={3} maxLength={item.maxLength ?? 500} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value ? e.target.value : undefined)} />;
}

export default function CustomSurveyFill({ q, neighborhoodId, neighborhoodName, onSubmitted, onExit }: { q: CustomQuestionnaire; neighborhoodId: string; neighborhoodName: string; onSubmitted: () => void; onExit: () => void }) {
  const [consent, setConsent] = useState(false);
  const [demo, setDemo] = useState<Demographics>({});
  const [answers, setAnswers] = useState<CustomAnswers>({});
  const [mode, setMode] = useState<'self' | 'interviewer'>('interviewer');
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const visible = useMemo(() => visibleCustomItems(q, answers, demo), [q, answers, demo]);
  const elapsed = started ? Math.round((now - started) / 1000) : 0;
  const clean = useMemo(() => Object.fromEntries(Object.entries(answers).filter(([k, v]) => v !== undefined && visible.some((i) => i.code === k))), [answers, visible]);
  const pre = checkResponse(q, { answers: clean, consent, durationSec: elapsed, demographics: demo }).filter((r) => r !== 'TOO_FAST');
  const missing = visible.filter((i) => i.required && clean[i.code] === undefined);
  const sections: string[] = Array.from(new Set(visible.map((i) => i.section ?? '')));

  const reset = () => { setConsent(false); setDemo({}); setAnswers({}); setStarted(null); setResult(null); };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await submitCustomResponses(q.id, neighborhoodId, [{ answers: clean, demographics: q.collectDemographics ? demo : undefined, consent, durationSec: elapsed, deviceId: mode === 'self' ? deviceId() : undefined, mode, collectedAt: new Date().toISOString() }]);
      setResult(r.accepted ? { ok: true, text: 'پاسخ پذیرفته شد و در برآورد شاخص‌ها شمرده می‌شود.' } : { ok: false, text: `پاسخ ثبت شد ولی به دلیل «${r.rejected[0]?.reasons.map((x) => QC_FA[x] ?? x).join('، ')}» در برآورد شمرده نمی‌شود.` });
      onSubmitted();
    } catch (e) { setResult({ ok: false, text: e instanceof Error ? e.message : 'ارسال ناموفق بود' }); } finally { setBusy(false); }
  };

  if (result) return (
    <Card>
      <div className="py-6 text-center">
        {result.ok ? <CheckCircle2 size={40} className="mx-auto text-emerald-500" /> : <XCircle size={40} className="mx-auto text-amber-500" />}
        <p className="mt-3 text-sm font-black">{result.text}</p>
        <div className="mt-4 flex justify-center gap-2"><button type="button" className={primaryBtn} onClick={reset}><RotateCcw size={13} /> پاسخگوی بعدی</button><button type="button" className={ghostBtn} onClick={onExit}>بازگشت</button></div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-3">
      <Card title={`${q.title} — ${neighborhoodName}`} actions={<span className="flex items-center gap-1 text-[11px] text-ink-500"><Clock size={12} /> {fa(elapsed)} ثانیه{q.minDurationSec ? ` (حداقل ${fa(q.minDurationSec)})` : ''}</span>}>
        {q.description && <p className="mb-3 whitespace-pre-line text-xs leading-6 text-ink-600 dark:text-slate-300">{q.description}</p>}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-bold">شیوهٔ تکمیل:</span>
          {(['interviewer', 'self'] as const).map((m) => <button key={m} type="button" className={chip(mode === m)} onClick={() => setMode(m)}>{m === 'interviewer' ? 'مصاحبه‌گر' : 'خوداظهاری'}</button>)}
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs font-bold leading-6"><input type="checkbox" className="mt-1.5" checked={consent} onChange={(e) => { setConsent(e.target.checked); if (e.target.checked && !started) setStarted(Date.now()); }} />
          پاسخگو آگاهانه و داوطلبانه رضایت داد؛ پاسخ‌ها بی‌نام و فقط به‌صورت تجمیعی گزارش می‌شوند.</label>
      </Card>

      {consent && q.collectDemographics && (
        <Card title="مشخصات پاسخگو">
          <div className="grid gap-3 md:grid-cols-3">
            {(Object.keys(DEMO) as Array<keyof typeof DEMO>).map((k) => (
              <div key={k}><span className="mb-1 block text-[10px] font-black text-ink-500">{DEMO[k].l}</span>
                <div className="flex flex-wrap gap-1.5">{DEMO[k].o.map(([v, l]) => <button key={v} type="button" className={chip(demo[k] === v)} onClick={() => setDemo({ ...demo, [k]: demo[k] === v ? undefined : v })}>{l}</button>)}</div></div>
            ))}
          </div>
        </Card>
      )}

      {consent && sections.map((sec) => (
        <React.Fragment key={sec || '_'}><Card title={sec || undefined}>
          <div className="space-y-4">
            {visible.filter((i) => (i.section ?? '') === sec).map((it) => (
              <div key={it.code}>
                <p className="mb-1.5 text-xs font-black leading-6 text-ink-800 dark:text-slate-100">{it.text}{it.required && <span className="text-rose-500"> *</span>}</p>
                {it.help && <p className="-mt-1 mb-1.5 text-[10px] text-ink-400">{it.help}</p>}
                <Answer item={it} value={answers[it.code]} onChange={(v) => setAnswers({ ...answers, [it.code]: v })} />
              </div>
            ))}
          </div>
        </Card></React.Fragment>
      ))}

      {consent && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={primaryBtn} disabled={busy || missing.length > 0 || pre.length > 0} onClick={() => void submit()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} ثبت پاسخ</button>
          {missing.length > 0 && <span className="text-[11px] text-amber-600">{fa(missing.length)} پرسش الزامی بی‌پاسخ است</span>}
          {pre.filter((r) => r !== 'REQUIRED_MISSING').map((r) => <span key={r} className="text-[11px] text-amber-600">{QC_FA[r] ?? r}</span>)}
          {elapsed < q.minDurationSec && <span className="text-[11px] text-ink-400">پاسخ زیر {fa(q.minDurationSec)} ثانیه در برآورد شمرده نمی‌شود</span>}
        </div>
      )}
      {!consent && <Notice tone="info">بدون رضایت پاسخگو، پرسش‌ها نمایش داده نمی‌شود.</Notice>}
    </div>
  );
}
