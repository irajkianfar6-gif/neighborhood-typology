import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Bot, Copy, Loader2, Lock, Plus, Save, Send, Trash2, Wand2 } from 'lucide-react';
import {
  CORE_CODES, CORE_NAME, DEMO_CODES, KIND_LABELS, METHOD_LABELS, SURVEY_NATIVE, isLikert, validateDefinition,
  type CompareOp, type CustomItem, type CustomKind, type CustomQuestionnaire, type IndicatorMapping, type MappingMethod, type ShowIf,
} from '../../../algorithm/customSurveyModel';
import { aiReviewSurvey, newCustomVersion, publishCustomSurvey, saveCustomSurvey, type ReviewIssue } from '../../../algorithm/customSurveyApi';
import { Card, Notice, fa, ghostBtn, inputCls, primaryBtn } from '../ui';

const OPS: Array<{ v: CompareOp; l: string }> = [{ v: 'eq', l: 'برابر' }, { v: 'neq', l: 'نابرابر' }, { v: 'gte', l: '≥' }, { v: 'lte', l: '≤' }, { v: 'in', l: 'یکی از' }];
const DEMO_FA: Record<string, string> = { tenure: '(مشخصات) وضعیت سکونت', sex: '(مشخصات) جنس', ageBand: '(مشخصات) گروه سنی' };
const label = 'mb-1 block text-[10px] font-black text-ink-500';
const parseVal = (s: string): number | number[] | undefined => {
  const parts = s.split(/[,،\s]+/).filter(Boolean).map(Number).filter(Number.isFinite);
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : parts;
};
const showVal = (v: number | number[] | undefined) => (v === undefined ? '' : Array.isArray(v) ? v.join('، ') : String(v));

function newItem(items: CustomItem[]): CustomItem {
  let n = items.length + 1;
  while (items.some((i) => i.code === `Q${n}`)) n++;
  return { code: `Q${n}`, text: '', kind: 'likert5', required: true };
}
function defaultMethod(kind: CustomKind): MappingMethod {
  return kind === 'number' ? 'numeric_normative' : kind === 'choice' || kind === 'multi' ? 'option_score' : 'scale_mean';
}

function Condition({ value, onChange, prior, demographics, title }: { value?: ShowIf; onChange: (v?: ShowIf) => void; prior: CustomItem[]; demographics: boolean; title: string }) {
  const sources = [...prior.filter((p) => p.kind !== 'text').map((p) => ({ v: p.code, l: `${p.code} — ${p.text.slice(0, 40)}` })), ...(demographics ? Object.keys(DEMO_CODES).map((k) => ({ v: k, l: DEMO_FA[k] })) : [])];
  const src = value ? prior.find((p) => p.code === value.item) : undefined;
  const hint = value ? (DEMO_CODES[value.item] ?? (src?.kind === 'binary' ? [{ value: 1, label: 'بله' }, { value: 0, label: 'خیر' }] : src?.options)) : undefined;
  return (
    <div>
      <span className={label}>{title}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <select className={`${inputCls} !w-auto`} value={value?.item ?? ''} onChange={(e) => onChange(e.target.value ? { item: e.target.value, op: value?.op ?? 'eq', value: value?.value ?? 1 } : undefined)}>
          <option value="">— همیشه —</option>
          {sources.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
        {value && <>
          <select className={`${inputCls} !w-auto`} value={value.op} onChange={(e) => onChange({ ...value, op: e.target.value as CompareOp })}>{OPS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
          <input className={`${inputCls} !w-28`} defaultValue={showVal(value.value)} onBlur={(e) => { const v = parseVal(e.target.value); if (v !== undefined) onChange({ ...value, value: v }); }} placeholder="مقدار (مثلاً 2 یا 1،2)" />
        </>}
      </div>
      {hint && <p className="mt-1 text-[10px] text-ink-400">کدها: {hint.map((h) => `${h.value}=${h.label}`).join('، ')}{src && isLikert(src.kind) ? '' : ''}</p>}
      {src && isLikert(src.kind) && <p className="mt-1 text-[10px] text-ink-400">طیف: ۱ = کاملاً مخالف … {src.kind === 'likert7' ? '۷' : '۵'} = کاملاً موافق</p>}
    </div>
  );
}

function ItemEditor({ item, idx, items, demographics, readOnly, issues, review, onChange, onMove, onDup, onDelete }: {
  item: CustomItem; idx: number; items: CustomItem[]; demographics: boolean; readOnly: boolean; issues: string[]; review?: ReviewIssue[];
  onChange: (i: CustomItem) => void; onMove: (d: -1 | 1) => void; onDup: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(!item.text);
  const set = (p: Partial<CustomItem>) => onChange({ ...item, ...p });
  const m = item.mapping;
  const setM = (p: Partial<IndicatorMapping> | null) => set({ mapping: p === null ? undefined : { ...(m ?? { code: 'S1', role: 'primary', method: defaultMethod(item.kind) }), ...p } });
  const customCode = m && !CORE_CODES.includes(m.code);
  const prior = items.slice(0, idx);
  return (
    <div className={`rounded-2xl border p-3 ${issues.length ? 'border-rose-300 dark:border-rose-800' : 'border-line dark:border-wall-700'} bg-surface dark:bg-wall-800`}>
      <div className="flex items-start gap-2">
        <span className="mt-1 rounded-lg bg-brand-50 px-2 py-0.5 font-mono text-[10px] font-black text-brand-800 dark:bg-wall-850 dark:text-signal-400">{item.code}</span>
        <button type="button" className="flex-1 text-right text-xs font-bold text-ink-800 dark:text-slate-100" onClick={() => setOpen(!open)}>
          {item.text || <span className="text-ink-400">(گویهٔ بی‌متن)</span>}
          <span className="mr-2 text-[10px] font-normal text-ink-400">{KIND_LABELS[item.kind]}{item.required ? ' · الزامی' : ''}{item.showIf ? ' · شرطی' : ''}{m ? ` · ← ${m.code}${m.role === 'check' ? ' (کنترلی)' : ''}` : ''}</span>
        </button>
        {!readOnly && <div className="flex gap-1">
          <button type="button" className={ghostBtn + ' !px-2'} onClick={() => onMove(-1)} disabled={idx === 0} aria-label="بالا"><ArrowUp size={12} /></button>
          <button type="button" className={ghostBtn + ' !px-2'} onClick={() => onMove(1)} disabled={idx === items.length - 1} aria-label="پایین"><ArrowDown size={12} /></button>
          <button type="button" className={ghostBtn + ' !px-2'} onClick={onDup} aria-label="تکثیر"><Copy size={12} /></button>
          <button type="button" className={ghostBtn + ' !px-2 hover:!text-rose-600'} onClick={onDelete} aria-label="حذف"><Trash2 size={12} /></button>
        </div>}
      </div>
      {issues.map((t, k) => <p key={k} className="mt-1 text-[10px] font-bold text-rose-600">• {t}</p>)}
      {review?.map((r, k) => (
        <div key={k} className="mt-2 rounded-xl bg-violet-50 p-2 text-[11px] text-violet-900 dark:bg-violet-900/20 dark:text-violet-200">
          <Bot size={11} className="inline" /> <strong>{r.problem}</strong> — {r.suggestion}
          {r.rewrite && !readOnly && <button type="button" className="mr-2 font-black underline" onClick={() => set({ text: r.rewrite })}>اعمال: «{r.rewrite}»</button>}
        </div>
      ))}
      {open && (
        <fieldset disabled={readOnly} className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><span className={label}>متن پرسش</span><textarea className={inputCls} rows={2} value={item.text} onChange={(e) => set({ text: e.target.value })} /></div>
          <div><span className={label}>کد (لاتین، یکتا)</span><input className={`${inputCls} font-mono`} dir="ltr" value={item.code} onChange={(e) => set({ code: e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 24) })} /></div>
          <div><span className={label}>نوع پاسخ</span>
            <select className={inputCls} value={item.kind} onChange={(e) => { const kind = e.target.value as CustomKind; set({ kind, options: kind === 'choice' || kind === 'multi' ? item.options?.length ? item.options : [{ value: 1, label: '' }, { value: 2, label: '' }] : undefined, mapping: kind === 'text' ? undefined : m ? { ...m, method: defaultMethod(kind) } : undefined }); }}>
              {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><span className={label}>راهنما برای پاسخگو (اختیاری)</span><input className={inputCls} value={item.help ?? ''} onChange={(e) => set({ help: e.target.value || undefined })} /></div>
          <div><span className={label}>بخش (اختیاری)</span><input className={inputCls} value={item.section ?? ''} onChange={(e) => set({ section: e.target.value || undefined })} /></div>
          <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={Boolean(item.required)} onChange={(e) => set({ required: e.target.checked })} /> پاسخ الزامی است</label>

          {(item.kind === 'choice' || item.kind === 'multi') && (
            <div className="md:col-span-2">
              <span className={label}>گزینه‌ها (امتیاز ۰..۱۰۰ = چقدر مطلوب؛ برای نگاشت به شاخص لازم است)</span>
              {(item.options ?? []).map((o, k) => (
                <div key={k} className="mb-1 flex items-center gap-1.5">
                  <span className="w-6 text-center font-mono text-[10px] text-ink-400">{o.value}</span>
                  <input className={inputCls} value={o.label} placeholder={`گزینهٔ ${fa(k + 1)}`} onChange={(e) => set({ options: item.options!.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />
                  <input className={`${inputCls} !w-20`} type="number" min={0} max={100} value={o.score ?? ''} placeholder="امتیاز" onChange={(e) => set({ options: item.options!.map((x, j) => (j === k ? { ...x, score: e.target.value === '' ? undefined : Number(e.target.value) } : x)) })} />
                  <button type="button" className={ghostBtn + ' !px-2'} onClick={() => set({ options: item.options!.filter((_, j) => j !== k) })}><Trash2 size={11} /></button>
                </div>
              ))}
              <button type="button" className={ghostBtn} onClick={() => set({ options: [...(item.options ?? []), { value: Math.max(0, ...(item.options ?? []).map((o) => o.value)) + 1, label: '' }] })}><Plus size={12} /> گزینه</button>
            </div>
          )}
          {item.kind === 'number' && (
            <div className="grid grid-cols-3 gap-2 md:col-span-2">
              <div><span className={label}>حداقل مجاز</span><input className={inputCls} type="number" value={item.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
              <div><span className={label}>حداکثر مجاز</span><input className={inputCls} type="number" value={item.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
              <div><span className={label}>واحد</span><input className={inputCls} value={item.unit ?? ''} onChange={(e) => set({ unit: e.target.value || undefined })} /></div>
            </div>
          )}
          <div className="md:col-span-2"><Condition title="نمایش فقط وقتی که…" value={item.showIf} onChange={(v) => set({ showIf: v })} prior={prior} demographics={demographics} /></div>

          {item.kind !== 'text' && (
            <div className="rounded-xl border border-dashed border-brand-200 p-3 md:col-span-2 dark:border-wall-700">
              <label className="flex items-center gap-2 text-xs font-black"><input type="checkbox" checked={Boolean(m)} onChange={(e) => setM(e.target.checked ? {} : null)} /> این گویه یک شاخص را می‌سنجد (اثر در کارت تصمیم)</label>
              {m && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div><span className={label}>شاخص</span>
                    <select className={inputCls} value={customCode ? '__custom' : m.code} onChange={(e) => setM({ code: e.target.value === '__custom' ? 'X_' : e.target.value, role: e.target.value !== '__custom' && !SURVEY_NATIVE.has(e.target.value) ? 'check' : m.role })}>
                      {CORE_CODES.map((c) => <option key={c} value={c}>{c} — {CORE_NAME[c]}{SURVEY_NATIVE.has(c) ? '' : ' (عینی)'}</option>)}
                      <option value="__custom">شاخص سفارشی (X_…) — فقط گزارش، نه کارت</option>
                    </select>
                    {customCode && <input className={`${inputCls} mt-1 font-mono`} dir="ltr" value={m.code} onChange={(e) => setM({ code: `X_${e.target.value.replace(/^X_?/i, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20)}` })} />}
                  </div>
                  <div><span className={label}>نقش</span>
                    <select className={inputCls} value={m.role} onChange={(e) => setM({ role: e.target.value as 'primary' | 'check' })}>
                      <option value="primary">اصلی — مقدار شاخص در کارت</option>
                      <option value="check">کنترلی — فقط مقایسه با منبع دیگر</option>
                    </select></div>
                  <div><span className={label}>روش امتیازدهی</span>
                    <select className={inputCls} value={m.method} onChange={(e) => setM({ method: e.target.value as MappingMethod })}>
                      {Object.entries(METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></div>
                  {m.method !== 'numeric_normative' && <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={Boolean(m.reversed)} onChange={(e) => setM({ reversed: e.target.checked || undefined })} /> معکوس (موافقت/بله = وضعیت نامطلوب)</label>}
                  {m.method === 'share_condition' && (
                    <div className="flex items-end gap-1.5"><div><span className={label}>شرط</span><select className={inputCls} value={m.op ?? 'eq'} onChange={(e) => setM({ op: e.target.value as CompareOp })}>{OPS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></div>
                      <div><span className={label}>مقدار مرز</span><input className={inputCls} defaultValue={showVal(m.threshold)} onBlur={(e) => setM({ threshold: parseVal(e.target.value) })} /></div></div>
                  )}
                  {(m.method === 'numeric_normative' || (m.method === 'scale_mean' && item.kind === 'number')) && (
                    <div className="flex gap-1.5"><div><span className={label}>مقدار بهترین (=۱۰۰)</span><input className={inputCls} type="number" value={m.best ?? ''} onChange={(e) => setM({ best: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
                      <div><span className={label}>مقدار بدترین (=۰)</span><input className={inputCls} type="number" value={m.worst ?? ''} onChange={(e) => setM({ worst: e.target.value === '' ? undefined : Number(e.target.value) })} /></div></div>
                  )}
                  <div className="md:col-span-2"><Condition title="جامعهٔ هدف شاخص (اختیاری؛ مثلاً فقط مستأجران)" value={m.population} onChange={(v) => setM({ population: v })} prior={prior} demographics={demographics} /></div>
                  <p className="text-[10px] text-ink-400 md:col-span-2">امتیاز ۱۰۰ همیشه یعنی وضعیت مطلوب. شاخص = میانگین وزنی امتیاز گویه‌های همان شاخص برای پاسخگویان واجد شرایط؛ بازهٔ اطمینان و آلفای کرونباخ خودکار محاسبه می‌شود.</p>
                </div>
              )}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}

export default function CustomSurveyEditor({ initial, neighborhoodId, neighborhoodName, aiReady, onSaved, onClose }: {
  initial: CustomQuestionnaire; neighborhoodId: string; neighborhoodName: string; aiReady: boolean; onSaved: (q: CustomQuestionnaire) => void; onClose: () => void;
}) {
  const [q, setQ] = useState<CustomQuestionnaire>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger' | 'info'; text: string } | null>(null);
  const [review, setReview] = useState<{ overall: string; issues: ReviewIssue[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const readOnly = q.status !== 'draft';
  const issues = useMemo(() => validateDefinition(q), [q]);
  const errors = issues.filter((i) => i.severity === 'error');
  const upd = (p: Partial<CustomQuestionnaire>) => { setQ((x) => ({ ...x, ...p })); setDirty(true); };
  const setItems = (items: CustomItem[]) => upd({ items });

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'خطا' }); } finally { setBusy(null); }
  };
  const save = async () => { const r = await saveCustomSurvey(q.id, q); setQ(r.questionnaire); setDirty(false); onSaved(r.questionnaire); return r.questionnaire; };

  return (
    <div className="space-y-3">
      <Card title={<span className="flex items-center gap-2">{readOnly && <Lock size={13} />}{q.title || 'پرسشنامهٔ بی‌عنوان'} <span className="text-[10px] font-normal text-ink-400">نسخهٔ {fa(q.version)} · {q.status === 'draft' ? 'پیش‌نویس' : q.status === 'published' ? 'منتشرشده' : 'بایگانی'}</span></span>}
        actions={<button type="button" className={ghostBtn} onClick={onClose}>بازگشت به فهرست</button>}>
        {q.ai?.drafted && <Notice tone="info"><Bot size={12} className="inline" /> پیش‌نویس با هوش مصنوعی ({q.ai.drafted.model}) ساخته شده است؛ پیش از انتشار همهٔ گویه‌ها و نگاشت‌ها را بازبینی کنید.</Notice>}
        {readOnly && <Notice tone="warn">پرسشنامهٔ منتشرشده قفل است تا پاسخ‌ها قابل مقایسه بمانند. برای تغییر، نسخهٔ جدید بسازید.
          <button type="button" className="mr-2 font-black underline" onClick={() => void run('ver', async () => { const v = await newCustomVersion(q.id); setQ(v); onSaved(v); setMsg({ tone: 'ok', text: `نسخهٔ ${v.version} به‌صورت پیش‌نویس ساخته شد.` }); })}>ساخت نسخهٔ جدید</button></Notice>}
        <fieldset disabled={readOnly} className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><span className={label}>عنوان</span><input className={inputCls} value={q.title} onChange={(e) => upd({ title: e.target.value })} /></div>
          <div><span className={label}>معرفی برای پاسخگو</span><textarea className={inputCls} rows={2} value={q.description ?? ''} onChange={(e) => upd({ description: e.target.value })} /></div>
          <div><span className={label}>هدف تحلیلی (برای تیم و هوش مصنوعی)</span><textarea className={inputCls} rows={2} value={q.purpose ?? ''} onChange={(e) => upd({ purpose: e.target.value })} /></div>
          <div><span className={label}>دامنه</span>
            <select className={inputCls} value={q.scope.kind === 'all' ? 'all' : 'nb'} onChange={(e) => upd({ scope: e.target.value === 'all' ? { kind: 'all' } : { kind: 'neighborhoods', neighborhoods: [neighborhoodId] } })}>
              <option value="nb">فقط محلهٔ {neighborhoodName}</option><option value="all">همهٔ محلات</option>
            </select></div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className={label}>حداقل زمان تکمیل (ثانیه)</span><input className={inputCls} type="number" min={0} value={q.minDurationSec} onChange={(e) => upd({ minDurationSec: Number(e.target.value) })} /></div>
            <div><span className={label}>حداقل پاسخ برای انتشار برآورد</span><input className={inputCls} type="number" min={10} value={q.minEligible} onChange={(e) => upd({ minEligible: Number(e.target.value) })} /></div>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold md:col-span-2"><input type="checkbox" checked={q.collectDemographics} onChange={(e) => upd({ collectDemographics: e.target.checked })} /> پرسش مشخصات (جنس، سن، وضعیت سکونت) برای وزن‌دهی و مقایسهٔ گروه‌ها</label>
        </fieldset>
      </Card>

      {review && <Notice tone="info"><Bot size={12} className="inline" /> بازبینی هوش مصنوعی: {review.overall} {review.issues.filter((i) => !i.item).map((i, k) => <span key={k} className="block">• {i.problem} — {i.suggestion}</span>)}</Notice>}

      <div className="space-y-2">
        {q.items.map((it, idx) => (
          <React.Fragment key={idx}><ItemEditor item={it} idx={idx} items={q.items} demographics={q.collectDemographics} readOnly={readOnly}
            issues={issues.filter((i) => i.item === it.code && i.severity === 'error').map((i) => i.message)} review={review?.issues.filter((r) => r.item === it.code)}
            onChange={(n) => setItems(q.items.map((x, j) => (j === idx ? n : x)))}
            onMove={(d) => { const a = [...q.items]; [a[idx], a[idx + d]] = [a[idx + d], a[idx]]; setItems(a); }}
            onDup={() => { const c = newItem(q.items).code; const a = [...q.items]; a.splice(idx + 1, 0, { ...structuredClone(it), code: c }); setItems(a); }}
            onDelete={() => setItems(q.items.filter((_, j) => j !== idx))} /></React.Fragment>
        ))}
        {!readOnly && <button type="button" className={ghostBtn} onClick={() => setItems([...q.items, newItem(q.items)])}><Plus size={13} /> افزودن گویه</button>}
      </div>

      {issues.length > 0 && (
        <Notice tone={errors.length ? 'danger' : 'warn'}>
          {errors.length ? `${fa(errors.length)} خطا مانع انتشار است:` : 'هشدارها (مانع انتشار نیست):'}
          {issues.filter((i) => !i.item || i.severity === 'warning').slice(0, 12).map((i, k) => <span key={k} className="block">• {i.item ? `${i.item}: ` : ''}{i.message}</span>)}
        </Notice>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {!readOnly && (
        <div className="sticky bottom-2 flex flex-wrap gap-2 rounded-2xl border border-line bg-surface/95 p-2 backdrop-blur dark:border-wall-700 dark:bg-wall-800/95">
          <button type="button" className={ghostBtn} disabled={!!busy} onClick={() => void run('save', async () => { await save(); setMsg({ tone: 'ok', text: 'ذخیره شد.' }); })}>{busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} ذخیرهٔ پیش‌نویس{dirty ? ' *' : ''}</button>
          <button type="button" className={ghostBtn} disabled={!!busy || !aiReady || !q.items.length} title={aiReady ? '' : 'هوش مصنوعی پیکربندی نشده است'}
            onClick={() => void run('review', async () => { if (dirty) await save(); const r = await aiReviewSurvey(q.id); setReview(r); setMsg({ tone: 'info', text: `بازبینی انجام شد: ${fa(r.issues.length)} نکته.` }); })}>
            {busy === 'review' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} بازبینی روش‌شناختی با هوش مصنوعی</button>
          <button type="button" className={primaryBtn} disabled={!!busy || errors.length > 0}
            onClick={() => void run('pub', async () => { await save(); const p = await publishCustomSurvey(q.id); setQ(p); onSaved(p); setMsg({ tone: 'ok', text: 'منتشر شد؛ اکنون می‌توانید پاسخ ثبت کنید.' }); })}>
            {busy === 'pub' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} انتشار</button>
        </div>
      )}
    </div>
  );
}
