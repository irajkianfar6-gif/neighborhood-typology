import React, { useCallback, useEffect, useState } from 'react';
import { Archive, BarChart3, Bot, ClipboardEdit, FilePlus2, Loader2, PenLine, Sparkles, Trash2 } from 'lucide-react';
import { CORE_CODES, CORE_NAME, SURVEY_NATIVE, blankQuestionnaire, type CustomQuestionnaire } from '../../../algorithm/customSurveyModel';
import { aiDraftSurvey, aiStatus, archiveCustomSurvey, createCustomSurvey, deleteCustomSurvey, listCustomSurveys, newCustomVersion, type QuestionnaireRow } from '../../../algorithm/customSurveyApi';
import { Card, Notice, fa, ghostBtn, inputCls, primaryBtn } from '../ui';
import CustomSurveyEditor from './CustomSurveyEditor';
import CustomSurveyFill from './CustomSurveyFill';
import CustomSurveyResults from './CustomSurveyResults';

type View = { kind: 'list' } | { kind: 'edit' | 'fill' | 'results'; q: CustomQuestionnaire };
const STATUS: Record<CustomQuestionnaire['status'], { l: string; c: string }> = {
  draft: { l: 'پیش‌نویس', c: 'bg-slate-100 text-slate-600 dark:bg-wall-850 dark:text-slate-300' },
  published: { l: 'منتشرشده', c: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' },
  archived: { l: 'بایگانی', c: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' },
};

export default function CustomSurveyStudio({ neighborhoodId, neighborhoodName, onChanged }: { neighborhoodId: string; neighborhoodName: string; onChanged?: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [rows, setRows] = useState<QuestionnaireRow[]>([]);
  const [ai, setAi] = useState<{ configured: boolean; model: string; host: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ goal: '', audience: '', nItems: 12, indicators: [] as string[], open: false });

  const refresh = useCallback(async () => {
    try { setRows((await listCustomSurveys(neighborhoodId)).filter((r) => r.scope.kind === 'all' || (r.scope.kind === 'neighborhoods' ? r.scope.neighborhoods.includes(neighborhoodId) : r.scope.cities.includes(neighborhoodId.split(':')[0])))); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'فهرست دریافت نشد'); }
  }, [neighborhoodId]);
  useEffect(() => { void refresh(); aiStatus().then(setAi).catch(() => setAi(null)); }, [refresh]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'خطا'); } finally { setBusy(null); } };
  const aiReady = Boolean(ai?.configured);
  const back = () => { setView({ kind: 'list' }); void refresh(); onChanged?.(); };

  if (view.kind === 'edit') return <CustomSurveyEditor initial={view.q} neighborhoodId={neighborhoodId} neighborhoodName={neighborhoodName} aiReady={aiReady} onSaved={() => void refresh()} onClose={back} />;
  if (view.kind === 'fill') return <CustomSurveyFill q={view.q} neighborhoodId={neighborhoodId} neighborhoodName={neighborhoodName} onSubmitted={() => { void refresh(); onChanged?.(); }} onExit={back} />;
  if (view.kind === 'results') return <div className="space-y-3"><button type="button" className={ghostBtn} onClick={back}>بازگشت به فهرست</button><CustomSurveyResults q={view.q} neighborhoodId={neighborhoodId} aiReady={aiReady} /></div>;

  return (
    <div className="space-y-3">
      <Card title="پرسشنامه‌ساز" icon={<ClipboardEdit size={15} />} actions={<div className="flex flex-wrap gap-2">
        <button type="button" className={ghostBtn} disabled={!!busy} onClick={() => void run('new', async () => { const r = await createCustomSurvey({ ...blankQuestionnaire(neighborhoodId), title: 'پرسشنامهٔ جدید' }); setView({ kind: 'edit', q: r.questionnaire }); })}><FilePlus2 size={13} /> پرسشنامهٔ خالی</button>
        <button type="button" className={primaryBtn} disabled={!aiReady} onClick={() => setDraft({ ...draft, open: !draft.open })} title={aiReady ? '' : 'کلید هوش مصنوعی روی سرور تنظیم نشده است'}><Sparkles size={13} /> ساخت با هوش مصنوعی</button></div>}>
        <p className="text-[11px] leading-6 text-ink-500">پرسش‌ها، نوع پاسخ، شرط نمایش و اتصال هر گویه به شاخص را خودتان تعیین می‌کنید. نتایج با روش قطعی (میانگین وزنی، بازهٔ اطمینان، آلفای کرونباخ) محاسبه می‌شود و شاخص‌های هستهٔ با نمونهٔ کافی پس از «بازمحاسبه» وارد کارت تصمیم می‌شوند. هوش مصنوعی فقط پیش‌نویس، بازبینی و تفسیر متنی انجام می‌دهد.</p>
        <p className="mt-1 text-[10px] text-ink-400">هوش مصنوعی: {ai ? (ai.configured ? `فعال — ${ai.model} از ${ai.host}` : 'پیکربندی نشده (ARA_ANTHROPIC_API_KEY)') : 'نامشخص'}</p>
        {draft.open && (
          <div className="mt-3 grid gap-3 rounded-2xl border border-violet-200 bg-violet-50/50 p-3 md:grid-cols-2 dark:border-violet-900 dark:bg-violet-900/10">
            <div className="md:col-span-2"><span className="mb-1 block text-[10px] font-black text-ink-500">هدف پرسشنامه را بنویسید</span>
              <textarea className={inputCls} rows={3} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} placeholder="مثلاً: سنجش احساس امنیت شبانه، رضایت از پارک‌ها و مشکلات رفت‌وآمد سالمندان محله" /></div>
            <div><span className="mb-1 block text-[10px] font-black text-ink-500">پاسخگویان</span><input className={inputCls} value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value })} placeholder="ساکنان بزرگسال محله" /></div>
            <div><span className="mb-1 block text-[10px] font-black text-ink-500">تعداد تقریبی گویه</span><input className={inputCls} type="number" min={3} max={40} value={draft.nItems} onChange={(e) => setDraft({ ...draft, nItems: Number(e.target.value) })} /></div>
            <div className="md:col-span-2"><span className="mb-1 block text-[10px] font-black text-ink-500">شاخص‌های هدف (اختیاری)</span>
              <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">{CORE_CODES.filter((c) => SURVEY_NATIVE.has(c)).map((c) => { const on = draft.indicators.includes(c); return (
                <button key={c} type="button" className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${on ? 'border-violet-600 bg-violet-600 text-white' : 'border-line bg-surface dark:border-wall-700 dark:bg-wall-800'}`} onClick={() => setDraft({ ...draft, indicators: on ? draft.indicators.filter((x) => x !== c) : [...draft.indicators, c] })}>{c} {CORE_NAME[c]}</button>); })}</div></div>
            <div className="flex items-center gap-2 md:col-span-2">
              <button type="button" className={primaryBtn} disabled={!!busy || draft.goal.trim().length < 10} onClick={() => void run('ai', async () => { const r = await aiDraftSurvey({ goal: draft.goal, audience: draft.audience || undefined, nItems: draft.nItems, indicators: draft.indicators.length ? draft.indicators : undefined, neighborhoodId }); setDraft({ ...draft, open: false }); setView({ kind: 'edit', q: r.questionnaire }); })}>
                {busy === 'ai' ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />} ساخت پیش‌نویس</button>
              {busy === 'ai' && <span className="text-[11px] text-ink-500">ممکن است تا یک دقیقه یا بیشتر طول بکشد…</span>}
            </div>
          </div>
        )}
      </Card>
      {err && <Notice tone="danger">{err}</Notice>}
      {rows.length === 0 && <Notice tone="info">هنوز پرسشنامهٔ سفارشی برای این محله ندارید.</Notice>}
      <div className="grid gap-2 lg:grid-cols-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-2xl border border-line bg-surface p-3 dark:border-wall-700 dark:bg-wall-800">
            <div className="flex items-start justify-between gap-2">
              <div><p className="text-xs font-black">{r.title || 'بی‌عنوان'}</p>
                <p className="mt-0.5 text-[10px] text-ink-400">نسخهٔ {fa(r.version)} · {fa(r.items.length)} گویه · {fa(r.items.filter((i) => i.mapping).length)} نگاشت · {r.scope.kind === 'all' ? 'همهٔ محلات' : 'این محله'} · پاسخ این محله: {fa(r.counts.accepted)} پذیرفته از {fa(r.counts.total)}{r.ai?.drafted ? ' · پیش‌نویس هوش مصنوعی' : ''}</p></div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS[r.status].c}`}>{STATUS[r.status].l}</span>
            </div>
            {r.status === 'draft' && r.issues.some((i) => i.severity === 'error') && <p className="mt-1 text-[10px] text-rose-600">{fa(r.issues.filter((i) => i.severity === 'error').length)} خطا پیش از انتشار</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button type="button" className={ghostBtn} onClick={() => setView({ kind: 'edit', q: r })}><PenLine size={12} /> {r.status === 'draft' ? 'ویرایش' : 'مشاهده'}</button>
              {r.status === 'published' && <button type="button" className={primaryBtn} onClick={() => setView({ kind: 'fill', q: r })}><ClipboardEdit size={12} /> ثبت پاسخ</button>}
              {r.status !== 'draft' && <button type="button" className={ghostBtn} onClick={() => setView({ kind: 'results', q: r })}><BarChart3 size={12} /> نتایج</button>}
              {r.status !== 'draft' && <button type="button" className={ghostBtn} disabled={!!busy} onClick={() => void run('v', async () => { const v = await newCustomVersion(r.id); setView({ kind: 'edit', q: v }); })}>نسخهٔ جدید</button>}
              {r.status === 'published' && <button type="button" className={ghostBtn} disabled={!!busy} onClick={() => { if (confirm('بایگانی شود؟ پاسخ‌ها حفظ می‌شوند ولی پاسخ تازه پذیرفته نمی‌شود.')) void run('a', async () => { await archiveCustomSurvey(r.id); await refresh(); }); }}><Archive size={12} /> بایگانی</button>}
              {r.status === 'draft' && <button type="button" className={`${ghostBtn} hover:!text-rose-600`} disabled={!!busy} onClick={() => { if (confirm('پیش‌نویس حذف شود؟')) void run('d', async () => { await deleteCustomSurvey(r.id); await refresh(); }); }}><Trash2 size={12} /> حذف</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
