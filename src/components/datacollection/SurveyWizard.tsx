import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock, RotateCcw, Send, ShieldCheck, UserRound, Users, XCircle } from 'lucide-react';
import {
  ITEM_BY_CODE, LIKERT_LABELS, QC_REASON_FA, SURVEY_SECTIONS, INSTRUMENT_VERSION,
  followUpActive, precheck, visibleItems, type Answers, type InstrumentItem,
} from '../../algorithm/surveyInstrument';
import { deviceId, loadQueue, saveQueue, submitSurveyResponses, type SurveySubmission } from '../../algorithm/dataCollectionApi';
import { NeighborhoodApiError } from '../../algorithm/neighborhoodApi';
import { Notice, Stepper, fa, ghostBtn, inputCls, primaryBtn } from './ui';

type Demo = SurveySubmission['demographics'];
const FACES = ['😟', '🙁', '😐', '🙂', '😀'];
const FACE_TONE = [
  'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-200',
  'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-200',
  'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-wall-850 dark:text-slate-200',
  'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-200',
  'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-200',
];
const MIN_SECONDS = 90;

const STEP_LABELS = ['معرفی و رضایت', 'مشخصات', ...SURVEY_SECTIONS.map((s) => s.title), 'مرور و ارسال'];
const DEMO_OPTIONS = {
  sex: [{ v: 'female', l: 'زن' }, { v: 'male', l: 'مرد' }],
  ageBand: [{ v: '18-29', l: '۱۸ تا ۲۹' }, { v: '30-44', l: '۳۰ تا ۴۴' }, { v: '45-64', l: '۴۵ تا ۶۴' }, { v: '65+', l: '۶۵ و بیشتر' }],
  tenure: [{ v: 'owner', l: 'مالک' }, { v: 'renter', l: 'مستأجر' }, { v: 'other', l: 'سایر' }],
  disability: [{ v: 'false', l: 'خیر' }, { v: 'true', l: 'بله' }],
} as const;
const DEMO_LABEL: Record<keyof typeof DEMO_OPTIONS, string> = { sex: 'جنس', ageBand: 'گروه سنی', tenure: 'وضعیت سکونت', disability: 'دارای معلولیت یا محدودیت حرکتی' };

export default function SurveyWizard({ neighborhoodId, neighborhoodName, onSubmitted, onExit }: { neighborhoodId: string; neighborhoodName: string; onSubmitted: () => void; onExit: () => void }) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'interviewer' | 'self'>(() => (localStorage.getItem('ara_survey_mode') as 'self' | null) ?? 'interviewer');
  const [collectorId, setCollectorId] = useState(() => localStorage.getItem('ara_collector_id') ?? '');
  const [respondentId, setRespondentId] = useState('');
  const [consent, setConsent] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [demo, setDemo] = useState<Demo>({});
  const [answers, setAnswers] = useState<Answers>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [followUps, setFollowUps] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<null | { accepted: boolean; reasons: string[]; queued?: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => { try { localStorage.setItem('ara_survey_mode', mode); localStorage.setItem('ara_collector_id', collectorId); } catch { /* optional */ } }, [mode, collectorId]);

  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const sectionIndex = step - 2;
  const section = SURVEY_SECTIONS[sectionIndex];
  const items = section ? visibleItems(section, answers) : [];
  const allVisible = SURVEY_SECTIONS.flatMap((s) => visibleItems(s, answers));
  const answeredCount = allVisible.filter((i) => answers[i.code] !== undefined).length;
  const overall = allVisible.length ? answeredCount / allVisible.length : 0;
  const warnings = precheck(answers, elapsed, MIN_SECONDS);
  const feeds = useMemo(() => [...new Set(allVisible.filter((i) => answers[i.code] !== undefined).flatMap((i) => i.feeds ?? []))], [allVisible, answers]);

  const canNext = (() => {
    if (step === 0) return consent && (mode === 'self' || collectorId.trim().length > 0);
    if (step === 1) return Boolean(demo.sex && demo.ageBand && demo.tenure);
    if (section) return items.every((i) => answers[i.code] !== undefined || skipped.has(i.code));
    return true;
  })();

  const setAnswer = (code: string, value: number) => {
    setAnswers((prev) => {
      const next = { ...prev, [code]: value };
      // پاسخ گویه‌هایی که شرط نمایششان از بین رفته پاک می‌شود
      for (const s of SURVEY_SECTIONS) for (const it of s.items) if (it.showIf && !it.showIf(next)) delete next[it.code];
      return next;
    });
    setSkipped((prev) => { const n = new Set(prev); n.delete(code); return n; });
  };
  const skip = (code: string) => {
    setAnswers((prev) => { const n = { ...prev }; delete n[code]; return n; });
    setSkipped((prev) => new Set(prev).add(code));
  };

  const goNext = () => {
    if (step === 0 && !startedAt) setStartedAt(Date.now());
    setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1));
    window.requestAnimationFrame(() => document.getElementById('survey-wizard-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const reset = () => {
    setStep(0); setConsent(false); setStartedAt(null); setDemo({}); setAnswers({}); setSkipped(new Set()); setFollowUps({}); setResult(null); setError(null); setRespondentId('');
  };

  const submit = async () => {
    setSubmitting(true); setError(null);
    const cleanAnswers = Object.fromEntries(Object.entries(answers).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
    const fu = Object.fromEntries(Object.entries(followUps as Record<string, string>).filter(([k, v]) => v.trim() && followUpActive(ITEM_BY_CODE[k], answers[k])));
    const payload: SurveySubmission = {
      respondentId: respondentId.trim() || undefined, durationSec: elapsed, answers: cleanAnswers, demographics: demo, consent,
      collectedAt: new Date().toISOString(), collectorId: mode === 'interviewer' ? collectorId.trim() : undefined,
      deviceId: mode === 'self' ? deviceId() : undefined, followUps: Object.keys(fu).length ? fu : undefined, mode, instrumentVersion: INSTRUMENT_VERSION,
    };
    try {
      const r = await submitSurveyResponses(neighborhoodId, [payload]);
      setResult({ accepted: r.accepted === 1, reasons: r.rejected[0]?.reasons ?? [] });
      setCount((c) => c + 1);
      onSubmitted();
    } catch (e) {
      if (e instanceof NeighborhoodApiError && e.code === 'NETWORK') {
        saveQueue(neighborhoodId, [...loadQueue(neighborhoodId), payload]);
        setResult({ accepted: false, reasons: [], queued: true });
      } else setError(e instanceof Error ? e.message : 'ارسال ناموفق بود');
    } finally { setSubmitting(false); }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <div className={`mx-auto flex size-20 items-center justify-center rounded-full ${result.accepted ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30' : result.queued ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/30' : 'bg-rose-100 text-rose-600 dark:bg-rose-900/30'}`}>
          {result.accepted ? <CheckCircle2 size={40} /> : result.queued ? <Clock size={40} /> : <XCircle size={40} />}
        </div>
        <h3 className="text-lg font-black text-ink-900 dark:text-white">
          {result.accepted ? 'پاسخ معتبر ثبت شد' : result.queued ? 'پاسخ در صف ارسال ذخیره شد' : 'پاسخ ثبت شد اما در کنترل کیفیت پذیرفته نشد'}
        </h3>
        {result.queued && <p className="text-xs text-ink-500">اتصال به سرور برقرار نبود. پاسخ در همین مرورگر نگه داشته شده و از داشبورد قابل ارسال دوباره است.</p>}
        {!result.accepted && result.reasons.length > 0 && (
          <ul className="mx-auto max-w-md space-y-1 text-right text-xs text-rose-700 dark:text-rose-300">{result.reasons.map((r) => <li key={r}>• {QC_REASON_FA[r] ?? r}</li>)}</ul>
        )}
        {result.accepted && feeds.length > 0 && <p className="text-xs text-ink-500">این پاسخ در برآورد شاخص‌های {feeds.join('، ')} شمرده می‌شود.</p>}
        <p className="text-[11px] text-ink-400">پرسشنامه‌های ثبت‌شده در این نشست: {fa(count)}</p>
        <div className="flex justify-center gap-2">
          <button type="button" className={primaryBtn} onClick={reset}><RotateCcw size={14} /> پرسشنامهٔ بعدی</button>
          <button type="button" className={ghostBtn} onClick={onExit}>بازگشت به داشبورد</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4" id="survey-wizard-top">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="icon-tile"><ClipboardList size={17} /></div>
          <div>
            <h3 className="text-sm font-black text-ink-900 dark:text-white">پرسشنامهٔ ساکنان — {neighborhoodName}</h3>
            <p className="text-[10px] text-ink-400">نسخهٔ ابزار {INSTRUMENT_VERSION} · {fa(allVisible.length)} گویه · حدود ۵ دقیقه</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-black text-ink-500">
          {startedAt && <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${elapsed < MIN_SECONDS ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20'}`}><Clock size={12} /> {fa(Math.floor(elapsed / 60))}:{(elapsed % 60).toLocaleString('fa-IR', { minimumIntegerDigits: 2 })}</span>}
          <span>{fa(overall * 100)}٪ تکمیل</span>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"><div className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-brand-700 transition-all duration-500 dark:to-signal-400" style={{ width: `${Math.max(step / (STEP_LABELS.length - 1), overall) * 100}%` }} /></div>
      <Stepper steps={STEP_LABELS} current={step} onJump={(i) => { if (i < step) setStep(i); }} />

      {step === 0 && (
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-5 dark:border-wall-700 dark:bg-wall-800">
          <div className="grid gap-2 sm:grid-cols-2">
            {([['interviewer', 'مصاحبه‌گر', 'پرسشگر سؤال‌ها را می‌خواند و پاسخ را ثبت می‌کند', <Users key="u" size={18} />], ['self', 'خوداظهاری', 'ساکن خودش روی گوشی/رایانه پاسخ می‌دهد', <UserRound key="s" size={18} />]] as const).map(([k, l, d, icon]) => (
              <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k}
                className={`flex items-start gap-3 rounded-2xl border p-3 text-right transition ${mode === k ? 'border-brand-700 bg-brand-50 ring-4 ring-brand-800/10 dark:border-signal-400 dark:bg-wall-850' : 'border-line hover:border-brand-300 dark:border-wall-700'}`}>
                <span className="mt-0.5 text-brand-700 dark:text-signal-400">{icon}</span>
                <span><strong className="block text-xs text-ink-900 dark:text-white">{l}</strong><span className="text-[10px] text-ink-500">{d}</span></span>
              </button>
            ))}
          </div>
          {mode === 'interviewer' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[11px] font-bold text-ink-600 dark:text-slate-300">کد پرسشگر *<input className={`${inputCls} mt-1`} value={collectorId} onChange={(e) => setCollectorId(e.target.value)} placeholder="مثلاً enum-03" /></label>
              <label className="text-[11px] font-bold text-ink-600 dark:text-slate-300">کد پرسشنامه (اختیاری)<input className={`${inputCls} mt-1`} value={respondentId} onChange={(e) => setRespondentId(e.target.value)} placeholder="شمارهٔ برگه یا خانوار" /></label>
            </div>
          )}
          <div className="rounded-2xl bg-paper p-4 text-xs leading-7 text-ink-600 dark:bg-wall-850 dark:text-slate-300">
            <p className="flex items-center gap-2 font-black text-ink-900 dark:text-white"><ShieldCheck size={15} /> متن رضایت آگاهانه</p>
            <p className="mt-2">این پرسشنامه برای شناخت کیفیت زندگی در محلهٔ <strong>{neighborhoodName}</strong> و اولویت‌بندی اقدامات اجرا می‌شود. شرکت داوطلبانه است، نام و نشانی پرسیده نمی‌شود و نتایج فقط به‌صورت تجمیعی گزارش می‌شود. هر سؤال را می‌توان بی‌پاسخ گذاشت.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-black text-ink-800 dark:text-slate-100">
            <input type="checkbox" className="size-4 accent-emerald-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            پاسخگو با آگاهی از توضیحات بالا رضایت داد
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-5 dark:border-wall-700 dark:bg-wall-800">
          <p className="text-[11px] text-ink-500">این مشخصات برای وزن‌دهی نمونه بر اساس ترکیب جمعیت محله و تحلیل عدالت (مقایسهٔ گروه‌ها) لازم است.</p>
          {(Object.keys(DEMO_OPTIONS) as Array<keyof typeof DEMO_OPTIONS>).map((k) => (
            <fieldset key={k}>
              <legend className="mb-2 text-xs font-black text-ink-800 dark:text-slate-100">{DEMO_LABEL[k]}{k !== 'disability' && ' *'}</legend>
              <div className="flex flex-wrap gap-2">
                {DEMO_OPTIONS[k].map((o) => {
                  const cur = k === 'disability' ? (demo.disability === undefined ? undefined : String(demo.disability)) : demo[k];
                  const sel = cur === o.v;
                  return (
                    <button key={o.v} type="button" aria-pressed={sel}
                      onClick={() => setDemo((d) => ({ ...d, [k]: k === 'disability' ? o.v === 'true' : o.v }))}
                      className={`min-w-20 rounded-xl border px-4 py-2.5 text-xs font-black transition ${sel ? 'border-brand-800 bg-brand-800 text-white dark:border-signal-400 dark:bg-signal-400 dark:text-wall-950' : 'border-line bg-paper text-ink-600 hover:border-brand-300 dark:border-wall-700 dark:bg-wall-850 dark:text-slate-300'}`}>
                      {o.l}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {section && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-gradient-to-l from-brand-50 to-transparent p-4 dark:from-wall-850">
            <p className="text-[10px] font-black text-brand-700 dark:text-signal-400">بخش {fa(sectionIndex + 1)} از {fa(SURVEY_SECTIONS.length)}</p>
            <h4 className="mt-1 text-base font-black text-ink-900 dark:text-white">{section.title}</h4>
            <p className="mt-1 text-[11px] text-ink-500">{section.subtitle}</p>
          </div>
          {items.map((item, idx) => (
            <React.Fragment key={item.code}><QuestionCard item={item} index={idx + 1} value={answers[item.code]} skipped={skipped.has(item.code)} showMeta={mode === 'interviewer'}
              onAnswer={(v) => setAnswer(item.code, v)} onSkip={() => skip(item.code)}
              followUp={followUps[item.code] ?? ''} onFollowUp={(t) => setFollowUps((f: Record<string, string>) => ({ ...f, [item.code]: t }))} /></React.Fragment>
          ))}
        </div>
      )}

      {step === STEP_LABELS.length - 1 && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="گویه‌های پاسخ‌داده" value={`${fa(answeredCount)} از ${fa(allVisible.length)}`} />
            <Stat label="زمان تکمیل" value={`${fa(Math.floor(elapsed / 60))} دقیقه و ${fa(elapsed % 60)} ثانیه`} />
            <Stat label="شاخص‌های تغذیه‌شده" value={feeds.length ? feeds.join('، ') : '—'} />
          </div>
          {warnings.length > 0 ? (
            <Notice tone="warn">پیش از ارسال: {warnings.map((w) => QC_REASON_FA[w]).join('؛ ')}. سرور چنین پاسخی را در کنترل کیفیت رد می‌کند.</Notice>
          ) : <Notice tone="ok">پاسخ از کنترل‌های اولیهٔ کیفیت گذشت و آمادهٔ ارسال است.</Notice>}
          <div className="grid gap-2 md:grid-cols-2">
            {SURVEY_SECTIONS.map((s, si) => (
              <button key={s.key} type="button" onClick={() => setStep(si + 2)} className="rounded-2xl border border-line p-3 text-right transition hover:border-brand-300 dark:border-wall-700">
                <div className="flex items-center justify-between text-xs font-black text-ink-800 dark:text-slate-100"><span>{s.title}</span><span className="text-[10px] text-brand-700 dark:text-signal-400">ویرایش</span></div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {visibleItems(s, answers).map((i) => {
                    const v = answers[i.code];
                    return <span key={i.code} title={i.text} className={`rounded-lg px-1.5 py-0.5 font-mono text-[10px] ${v === undefined ? 'bg-black/5 text-ink-400 dark:bg-white/5' : 'bg-brand-50 text-brand-800 dark:bg-wall-850 dark:text-signal-400'}`}>{i.code}:{v === undefined ? '—' : i.kind === 'binary' ? (v ? 'بله' : 'خیر') : fa(v)}</span>;
                  })}
                </div>
              </button>
            ))}
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button type="button" className={ghostBtn} disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}><ChevronRight size={15} /> قبلی</button>
        {step < STEP_LABELS.length - 1
          ? <button type="button" className={primaryBtn} disabled={!canNext} onClick={goNext}>{step === 0 ? 'شروع پرسشنامه' : 'بعدی'} <ChevronLeft size={15} /></button>
          : <button type="button" className={primaryBtn} disabled={submitting} onClick={() => void submit()}><Send size={14} /> {submitting ? 'در حال ارسال…' : 'ثبت و ارسال پرسشنامه'}</button>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-line bg-surface p-3 dark:border-wall-700 dark:bg-wall-800"><div className="text-[10px] font-bold text-ink-400">{label}</div><div className="mt-1 text-xs font-black text-ink-900 dark:text-white">{value}</div></div>;
}

function QuestionCard({ item, index, value, skipped, showMeta, onAnswer, onSkip, followUp, onFollowUp }: {
  item: InstrumentItem; index: number; value: number | undefined; skipped: boolean; showMeta: boolean;
  onAnswer: (v: number) => void; onSkip: () => void; followUp: string; onFollowUp: (t: string) => void;
}) {
  const fu = followUpActive(item, value);
  return (
    <fieldset className={`rounded-2xl border bg-surface p-4 transition dark:bg-wall-800 ${value !== undefined ? 'border-emerald-200 dark:border-emerald-900' : 'border-line dark:border-wall-700'}`}>
      <legend className="sr-only">{item.text}</legend>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-black leading-7 text-ink-900 dark:text-white"><span className="ml-2 text-brand-700 dark:text-signal-400">{fa(index)}.</span>{item.text}</p>
        {showMeta && (
          <span className="flex shrink-0 gap-1">
            <span className="rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[9px] text-ink-500 dark:bg-white/5">{item.code}</span>
            {item.feeds?.map((f) => <span key={f} className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-mono text-[9px] font-black text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">→{f}</span>)}
          </span>
        )}
      </div>
      {item.help && <p className="mt-1 text-[10px] text-ink-400">{item.help}</p>}
      <div className="mt-3">
        {item.kind === 'likert' && (
          <div className="grid grid-cols-5 gap-1.5">
            {[1, 2, 3, 4, 5].map((v) => {
              // در گویه‌های معکوس (مثل «آلودگی صوتی آزاردهنده است») موافقت یعنی وضع نامطلوب؛ چهره و رنگ برعکس می‌شود
              const tone = item.reversed ? 5 - v : v - 1;
              return (
              <button key={v} type="button" aria-pressed={value === v} onClick={() => onAnswer(v)} aria-label={LIKERT_LABELS[v - 1]}
                className={`flex flex-col items-center rounded-xl border px-1 py-2 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/15 ${value === v ? `${FACE_TONE[tone]} scale-[1.04] shadow-sm` : 'border-line bg-paper text-ink-500 opacity-80 hover:opacity-100 dark:border-wall-700 dark:bg-wall-850 dark:text-slate-400'}`}>
                <span className="text-xl leading-none" aria-hidden="true">{FACES[tone]}</span>
                <span className="mt-1 text-[9px] font-bold leading-4">{LIKERT_LABELS[v - 1]}</span>
              </button>
              );
            })}
          </div>
        )}
        {item.kind === 'binary' && (
          <div className="grid grid-cols-2 gap-2">
            {[[1, 'بله', 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'], [0, 'خیر', 'border-slate-400 bg-slate-100 text-slate-700 dark:bg-wall-850 dark:text-slate-200']].map(([v, l, cls]) => (
              <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onAnswer(v as number)}
                className={`rounded-xl border px-3 py-3 text-sm font-black transition ${value === v ? `${cls} shadow-sm` : 'border-line bg-paper text-ink-500 hover:border-brand-300 dark:border-wall-700 dark:bg-wall-850 dark:text-slate-400'}`}>{l as string}</button>
            ))}
          </div>
        )}
        {item.kind === 'choice' && (
          <div className="grid gap-2 sm:grid-cols-2">
            {item.options?.map((o) => (
              <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onAnswer(o.value)}
                className={`rounded-xl border p-3 text-right transition ${value === o.value ? 'border-brand-800 bg-brand-50 ring-4 ring-brand-800/10 dark:border-signal-400 dark:bg-wall-850' : 'border-line bg-paper hover:border-brand-300 dark:border-wall-700 dark:bg-wall-850'}`}>
                <strong className="block text-xs text-ink-900 dark:text-white">{o.label}</strong>
                {o.hint && <span className="text-[10px] text-ink-500">{o.hint}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onSkip} className={`text-[10px] font-bold ${skipped ? 'text-amber-600' : 'text-ink-400 hover:text-ink-600'}`}>{skipped ? 'بی‌پاسخ ثبت شد' : 'ترجیح می‌دهم پاسخ ندهم'}</button>
      </div>
      {fu && item.followUp && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <label className="text-[11px] font-black text-amber-800 dark:text-amber-200">سؤال تکمیلی: {item.followUp.text}
            <input value={followUp} onChange={(e) => onFollowUp(e.target.value)} maxLength={300} className={`${inputCls} mt-2`} placeholder="پاسخ کوتاه (اختیاری)" />
          </label>
        </div>
      )}
    </fieldset>
  );
}
