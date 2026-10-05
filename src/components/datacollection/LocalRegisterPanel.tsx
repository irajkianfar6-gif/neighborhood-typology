import React, { useEffect, useState } from 'react';
import { FileText, Network, Plus, Trash2, X } from 'lucide-react';
import { submitNetwork, submitRegisterRecords, voidRegisterEntry, type RegisterKind, type RegisterSummary } from '../../algorithm/dataCollectionApi';
import { Card, Notice, ProgressRing, fa, ghostBtn, inputCls, primaryBtn } from './ui';

const KINDS: Record<RegisterKind, { code: string; title: string; item: string; flag: string; placeholder: string }> = {
  problem: { code: 'S5', title: 'مسائل محله', item: 'مسئلهٔ شناسایی‌شده', flag: 'با مشارکت ساکنان/گروه‌های محلی حل شد', placeholder: 'مثلاً آب‌گرفتگی کوچهٔ ۱۲ در زمستان' },
  process: { code: 'G1', title: 'فرایندهای تصمیم', item: 'فرایند تصمیم‌گیری (طرح، بودجه، مصوبه)', flag: 'گروه‌های محلی مشارکت واقعی داشتند و نظرشان در تصمیم اثر گذاشت', placeholder: 'مثلاً تصویب طرح پیاده‌راه خیابان اصلی' },
  project: { code: 'G5', title: 'پروژه‌ها', item: 'پروژهٔ اجراشده', flag: 'در طراحی از ارزیابی پروژه‌های قبلی استفاده شد', placeholder: 'مثلاً بهسازی پارک محله' },
};
type Tab = RegisterKind | 'network';

export default function LocalRegisterPanel({ neighborhoodId, summary, onSubmitted }: { neighborhoodId: string; summary: RegisterSummary; onSubmitted: () => void }) {
  const [tab, setTab] = useState<Tab>('problem');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {(Object.keys(KINDS) as RegisterKind[]).map((k) => {
          const b = summary.byKind[k];
          return (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`flex items-center gap-3 rounded-2xl border px-3 py-2 text-right transition ${tab === k ? 'border-brand-700 bg-brand-50 dark:border-signal-400 dark:bg-wall-850' : 'border-line hover:border-brand-300 dark:border-wall-700'}`}>
              <ProgressRing value={b.inWindow / b.required} size={38} stroke={4} label={<span className="text-[9px]">{fa(b.inWindow)}/{fa(b.required)}</span>} tone={b.value !== null ? 'ok' : 'warn'} />
              <span><strong className="block text-xs text-ink-900 dark:text-white">{KINDS[k].title}</strong><span className="font-mono text-[10px] text-ink-500">{KINDS[k].code}{b.value !== null && ` = ${fa(b.value, 1)}٪`}</span></span>
            </button>
          );
        })}
        <button type="button" role="tab" aria-selected={tab === 'network'} onClick={() => setTab('network')}
          className={`flex items-center gap-3 rounded-2xl border px-3 py-2 text-right transition ${tab === 'network' ? 'border-brand-700 bg-brand-50 dark:border-signal-400 dark:bg-wall-850' : 'border-line hover:border-brand-300 dark:border-wall-700'}`}>
          <ProgressRing value={(summary.network?.actors.length ?? 0) / 4} size={38} stroke={4} label={<Network size={14} />} tone={summary.network && summary.network.actors.length >= 4 ? 'ok' : 'warn'} />
          <span><strong className="block text-xs text-ink-900 dark:text-white">شبکهٔ نهادها</strong><span className="font-mono text-[10px] text-ink-500">G3{summary.network && ` = ${fa(summary.network.density, 1)}٪`}</span></span>
        </button>
      </div>
      {tab === 'network'
        ? <NetworkEditor neighborhoodId={neighborhoodId} summary={summary} onSubmitted={onSubmitted} />
        : <React.Fragment key={tab}><CaseRegister kind={tab} neighborhoodId={neighborhoodId} summary={summary} onSubmitted={onSubmitted} /></React.Fragment>}
    </div>
  );
}

function CaseRegister({ kind, neighborhoodId, summary, onSubmitted }: { kind: RegisterKind; neighborhoodId: string; summary: RegisterSummary; onSubmitted: () => void }) {
  const def = KINDS[kind];
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [flag, setFlag] = useState<boolean | null>(null);
  const [evidenceRef, setEvidenceRef] = useState('');
  const [recordedBy, setRecordedBy] = useState(() => localStorage.getItem('ara_recorder_id') ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const list = summary.records.filter((r) => r.kind === kind);
  const b = summary.byKind[kind];

  const add = async () => {
    if (flag === null) return;
    setBusy(true); setMsg(null);
    try {
      localStorage.setItem('ara_recorder_id', recordedBy.trim());
      const r = await submitRegisterRecords(neighborhoodId, [{ kind, title: title.trim(), date, flag, evidenceRef: evidenceRef.trim() || undefined, recordedBy: recordedBy.trim() }]);
      if (r.stored) { setTitle(''); setEvidenceRef(''); setFlag(null); setMsg({ tone: 'ok', text: 'پرونده ثبت شد.' }); onSubmitted(); }
      else setMsg({ tone: 'danger', text: r.errors.flatMap((e) => e.errors).join('؛ ') });
    } catch (e) { setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'ثبت ناموفق بود' }); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm('این پرونده از محاسبه کنار گذاشته شود؟ (سابقهٔ آن حفظ می‌شود)')) return;
    try { await voidRegisterEntry(neighborhoodId, id, recordedBy || 'operator'); onSubmitted(); } catch (e) { setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'حذف ناموفق بود' }); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card title={`ثبت ${def.item}`} icon={<Plus size={14} />}>
        <div className="space-y-3">
          <label className="block text-[11px] font-bold text-ink-600 dark:text-slate-300">عنوان *<input className={`${inputCls} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={def.placeholder} /></label>
          <label className="block text-[11px] font-bold text-ink-600 dark:text-slate-300">تاریخ (میلادی) *<input type="date" dir="ltr" className={`${inputCls} mt-1`} value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></label>
          <fieldset>
            <legend className="mb-1 text-[11px] font-bold text-ink-600 dark:text-slate-300">{def.flag}؟ *</legend>
            <div className="grid grid-cols-2 gap-2">
              {[[true, 'بله'], [false, 'خیر']].map(([v, l]) => (
                <button key={String(v)} type="button" aria-pressed={flag === v} onClick={() => setFlag(v as boolean)}
                  className={`rounded-xl border px-3 py-2 text-xs font-black transition ${flag === v ? (v ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-slate-400 bg-slate-100 text-slate-700 dark:bg-wall-850 dark:text-slate-200') : 'border-line bg-paper text-ink-500 dark:border-wall-700 dark:bg-wall-850'}`}>{l as string}</button>
              ))}
            </div>
          </fieldset>
          <label className="block text-[11px] font-bold text-ink-600 dark:text-slate-300">ارجاع سند (صورت‌جلسه، نامه، گزارش)<input className={`${inputCls} mt-1`} value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} placeholder="شماره یا عنوان سند" /></label>
          <label className="block text-[11px] font-bold text-ink-600 dark:text-slate-300">ثبت‌کننده *<input className={`${inputCls} mt-1`} value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)} placeholder="نام یا کد" /></label>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <button type="button" className={`${primaryBtn} w-full`} disabled={busy || !title.trim() || !recordedBy.trim() || flag === null} onClick={() => void add()}><Plus size={14} /> افزودن پرونده</button>
          <p className="text-[10px] leading-5 text-ink-400">پرونده‌های دارای سند، کیفیت روش و پایایی شاخص را بالا می‌برند. فقط پرونده‌های سه سال اخیر شمرده می‌شوند.</p>
        </div>
      </Card>
      <Card title={`فهرست ${def.title} (${fa(list.length)})`} icon={<FileText size={14} />}
        actions={<span className="text-[11px] font-black text-ink-600 dark:text-slate-300">{def.code}: {b.value === null ? `${fa(Math.max(0, b.required - b.inWindow))} پرونده تا نخستین برآورد` : `${fa(b.flagged)} از ${fa(b.inWindow)} = ${fa(b.value, 1)}٪`}</span>}>
        {list.length === 0 ? <p className="py-8 text-center text-xs text-ink-400">هنوز پرونده‌ای ثبت نشده است.</p> : (
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-surface dark:bg-wall-800"><tr className="text-ink-400"><th className="p-2 text-right">عنوان</th><th className="p-2">تاریخ</th><th className="p-2">نتیجه</th><th className="p-2">سند</th><th /></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.id} className={`border-t border-line/60 dark:border-wall-700 ${r.inWindow ? '' : 'opacity-50'}`}>
                  <td className="p-2 font-bold">{r.title}</td>
                  <td className="p-2 text-center font-mono" dir="ltr">{r.date}</td>
                  <td className="p-2 text-center">{r.flag ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-black text-emerald-700 dark:bg-emerald-900/30">بله</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 font-black text-slate-600 dark:bg-wall-850">خیر</span>}</td>
                  <td className="p-2 text-center">{r.evidenceRef ? '📎' : '—'}</td>
                  <td className="p-2"><button type="button" aria-label="کنار گذاشتن" onClick={() => void remove(r.id)} className="text-ink-300 hover:text-rose-600"><Trash2 size={13} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function NetworkEditor({ neighborhoodId, summary, onSubmitted }: { neighborhoodId: string; summary: RegisterSummary; onSubmitted: () => void }) {
  const [actors, setActors] = useState<string[]>(summary.network?.actors ?? ['شورایاری', 'سرای محله', 'شهرداری ناحیه']);
  const [links, setLinks] = useState<Set<string>>(new Set((summary.network?.links ?? []).map(([a, b]) => `${a}-${b}`)));
  const [draft, setDraft] = useState('');
  const [assessedBy, setAssessedBy] = useState(() => localStorage.getItem('ara_recorder_id') ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  useEffect(() => { if (summary.network) { setActors(summary.network.actors); setLinks(new Set(summary.network.links.map(([a, b]) => `${a}-${b}`))); } }, [summary.network?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const possible = (actors.length * (actors.length - 1)) / 2;
  const density = possible ? (links.size / possible) * 100 : 0;
  const addActor = () => { const n = draft.trim(); if (n && !actors.includes(n)) setActors((a) => [...a, n]); setDraft(''); };
  const removeActor = (i: number) => {
    setActors((a) => a.filter((_, k) => k !== i));
    setLinks((prev) => new Set([...prev].map((k) => k.split('-').map(Number)).filter(([a, b]) => a !== i && b !== i).map(([a, b]) => `${a > i ? a - 1 : a}-${b > i ? b - 1 : b}`)));
  };
  const toggle = (a: number, b: number) => { const k = a < b ? `${a}-${b}` : `${b}-${a}`; setLinks((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; }); };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await submitNetwork(neighborhoodId, { actors, links: [...links].map((k) => k.split('-').map(Number) as [number, number]), assessedBy: assessedBy.trim(), assessedAt: new Date().toISOString().slice(0, 10) });
      setMsg({ tone: 'ok', text: 'ارزیابی شبکه ذخیره شد.' }); onSubmitted();
    } catch (e) { setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'ذخیره ناموفق بود' }); }
    finally { setBusy(false); }
  };
  const R = 80;
  const pos = actors.map((_, i) => ({ x: Math.cos((2 * Math.PI * i) / Math.max(1, actors.length) - Math.PI / 2) * R, y: Math.sin((2 * Math.PI * i) / Math.max(1, actors.length) - Math.PI / 2) * R }));
  const degree = actors.map((_, i) => [...links].filter((k) => k.split('-').map(Number).includes(i)).length);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card title="ماتریس همکاری عملی نهادهای محله (G3)" icon={<Network size={14} />}>
        <p className="mb-3 text-[11px] leading-6 text-ink-500">نهادهای فعال در محله را وارد کنید و برای هر جفتی که در یک سال گذشته <strong>توافق یا همکاری عملی</strong> داشته‌اند (پروژهٔ مشترک، جلسهٔ منظم، تفاهم‌نامه) خانهٔ ماتریس را فعال کنید.</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {actors.map((a, i) => <span key={a} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-[11px] font-black text-brand-800 dark:bg-wall-850 dark:text-signal-400">{a}<button type="button" aria-label={`حذف ${a}`} onClick={() => removeActor(i)}><X size={11} /></button></span>)}
          <input className={`${inputCls} w-44`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addActor(); } }} placeholder="نهاد جدید + Enter" />
          <button type="button" className={ghostBtn} onClick={addActor}><Plus size={12} /></button>
        </div>
        {actors.length >= 2 && (
          <div className="mt-3 overflow-x-auto">
            <table className="text-[10px]">
              <thead><tr><th />{actors.map((a, j) => <th key={a} className="max-w-16 p-1 align-bottom font-bold text-ink-500"><span className="block truncate" title={a}>{a}</span></th>)}</tr></thead>
              <tbody>{actors.map((a, i) => (
                <tr key={a}>
                  <th className="whitespace-nowrap p-1 text-right font-bold text-ink-600 dark:text-slate-300">{a}</th>
                  {actors.map((b, j) => {
                    if (i === j) return <td key={b} className="p-0.5"><div className="size-7 rounded-md bg-black/5 dark:bg-white/5" /></td>;
                    const on = links.has(i < j ? `${i}-${j}` : `${j}-${i}`);
                    return <td key={b} className="p-0.5"><button type="button" aria-pressed={on} aria-label={`${a} ↔ ${b}`} onClick={() => toggle(i, j)} className={`size-7 rounded-md border transition ${on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line bg-paper hover:border-emerald-300 dark:border-wall-700 dark:bg-wall-850'}`}>{on ? '✓' : ''}</button></td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="text-[11px] font-bold text-ink-600 dark:text-slate-300">ارزیاب *<input className={`${inputCls} mt-1`} value={assessedBy} onChange={(e) => setAssessedBy(e.target.value)} placeholder="نام یا کد کارشناس" /></label>
          <button type="button" className={primaryBtn} disabled={busy || actors.length < 2 || !assessedBy.trim()} onClick={() => void save()}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ ارزیابی شبکه'}</button>
        </div>
        {msg && <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      </Card>
      <Card title="نمای شبکه">
        <svg viewBox="-110 -110 220 220" className="w-full" role="img" aria-label="گراف شبکهٔ نهادها">
          {[...links].map((k) => { const [a, b] = k.split('-').map(Number); return pos[a] && pos[b] ? <line key={k} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="stroke-emerald-500" strokeWidth="1.5" opacity="0.7" /> : null; })}
          {actors.map((a, i) => (
            <g key={a} transform={`translate(${pos[i].x} ${pos[i].y})`}>
              <circle r={6 + degree[i] * 2} className="fill-brand-700 dark:fill-signal-400" />
              <text y={-10 - degree[i] * 2} textAnchor="middle" className="fill-ink-700 text-[8px] font-bold dark:fill-slate-200">{a}</text>
            </g>
          ))}
        </svg>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="rounded-xl bg-paper p-2 dark:bg-wall-850"><div className="text-base font-black">{fa(actors.length)}</div>نهاد</div>
          <div className="rounded-xl bg-paper p-2 dark:bg-wall-850"><div className="text-base font-black">{fa(links.size)}</div>پیوند</div>
          <div className="rounded-xl bg-paper p-2 dark:bg-wall-850"><div className="text-base font-black text-emerald-600">{fa(density, 1)}٪</div>چگالی</div>
        </div>
        {actors.length < 4 && <p className="mt-2 text-[10px] text-amber-600">برای برآورد G3 دست‌کم ۴ نهاد لازم است.</p>}
      </Card>
    </div>
  );
}
