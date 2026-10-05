import React, { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { bulkTemplateCsv, parseSurveyCsv } from '../../algorithm/surveyBulk';
import { submitSurveyResponses } from '../../algorithm/dataCollectionApi';
import { ALL_ITEMS, QC_REASON_FA } from '../../algorithm/surveyInstrument';
import { Card, Notice, fa, ghostBtn, inputCls, primaryBtn } from './ui';

export default function BulkSurveyImport({ neighborhoodId, onSubmitted }: { neighborhoodId: string; onSubmitted: () => void }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [collectorId, setCollectorId] = useState(() => localStorage.getItem('ara_collector_id') ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | { received: number; accepted: number; reasons: Record<string, number> }>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseSurveyCsv(text, { collectorId: collectorId.trim() || undefined }) : null), [text, collectorId]);
  const errors = parsed?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = parsed?.issues.filter((i) => i.level === 'warning') ?? [];
  const errorRows = new Set(errors.map((e) => e.row));

  const downloadTemplate = () => {
    const blob = new Blob([bulkTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'survey_template.csv'; a.click();
    URL.revokeObjectURL(a.href);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { setError('فایل اکسل را با «Save As → CSV UTF-8» ذخیره کنید یا سطرها را مستقیم از اکسل کپی و این‌جا جای‌گذاری کنید.'); return; }
    setError(null); setResult(null); setFileName(f.name); setText(await f.text());
  };
  const submit = async () => {
    if (!parsed?.rows.length) return;
    setBusy(true); setError(null);
    const agg = { received: 0, accepted: 0, reasons: {} as Record<string, number> };
    try {
      for (let i = 0; i < parsed.rows.length; i += 500) {
        const r = await submitSurveyResponses(neighborhoodId, parsed.rows.slice(i, i + 500));
        agg.received += r.received; agg.accepted += r.accepted;
        for (const rej of r.rejected) for (const reason of rej.reasons) agg.reasons[reason] = (agg.reasons[reason] ?? 0) + 1;
      }
      setResult(agg); onSubmitted();
    } catch (e) { setError(e instanceof Error ? e.message : 'ارسال ناموفق بود'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card title="ورود دسته‌ای پرسشنامه‌های کاغذی یا اکسل" icon={<FileSpreadsheet size={15} />}
        actions={<button type="button" className={ghostBtn} onClick={downloadTemplate}><Download size={13} /> دریافت الگوی CSV</button>}>
        <ol className="mb-3 grid gap-2 text-[11px] text-ink-500 md:grid-cols-3">
          <li className="rounded-xl bg-paper p-2 dark:bg-wall-850"><strong className="text-ink-800 dark:text-slate-100">۱. الگو</strong> — هر سطر یک پرسشنامه؛ ستون‌ها کد گویه‌ها ({fa(ALL_ITEMS.length)} گویه) و مشخصات‌اند.</li>
          <li className="rounded-xl bg-paper p-2 dark:bg-wall-850"><strong className="text-ink-800 dark:text-slate-100">۲. مقادیر</strong> — لیکرت ۱ تا ۵، بله/خیر یا ۰/۱، EMP از ۱ تا ۴؛ ارقام فارسی و برچسب‌های «زن/مرد/مالک/مستأجر» پذیرفته می‌شود.</li>
          <li className="rounded-xl bg-paper p-2 dark:bg-wall-850"><strong className="text-ink-800 dark:text-slate-100">۳. کنترل</strong> — پیش‌نمایش سطرهای معیوب را نشان می‌دهد؛ فقط سطرهای سالم ارسال می‌شوند.</li>
        </ol>
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files[0]); }}
            className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line p-4 text-center dark:border-wall-700">
            <Upload size={22} className="text-brand-700 dark:text-signal-400" />
            <p className="text-xs font-black text-ink-700 dark:text-slate-200">{fileName ?? 'فایل CSV را این‌جا رها کنید'}</p>
            <button type="button" className={ghostBtn} onClick={() => fileRef.current?.click()}>انتخاب فایل</button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          <label className="text-[11px] font-bold text-ink-600 dark:text-slate-300">کد پرسشگر پیش‌فرض
            <input className={`${inputCls} mt-1`} value={collectorId} onChange={(e) => setCollectorId(e.target.value)} placeholder="برای سطرهای بدون collector_id" />
          </label>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-black text-brand-700 dark:text-signal-400">یا جای‌گذاری مستقیم از اکسل</summary>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setFileName(null); setResult(null); }} rows={6} dir="ltr" className={`${inputCls} mt-2 font-mono`} placeholder="respondent_id,consent,sex,age_band,duration_sec,C1,…" />
        </details>
      </Card>

      {error && <Notice tone="danger">{error}</Notice>}

      {parsed && (
        <Card title="پیش‌نمایش و کنترل کیفیت" actions={
          <button type="button" className={primaryBtn} disabled={busy || !parsed.rows.length} onClick={() => void submit()}>
            {busy ? 'در حال ارسال…' : `ارسال ${fa(parsed.rows.length)} پرسشنامهٔ سالم`}
          </button>}>
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            {([['سطر داده', parsed.rows.length + errorRows.size, ''], ['سالم', parsed.rows.length, 'text-emerald-600'], ['معیوب (ارسال نمی‌شود)', errorRows.size, 'text-rose-600'], ['هشدار کیفیت', new Set(warnings.map((w) => w.row)).size, 'text-amber-600']] as Array<[string, number, string]>).map(([l, v, c]) => (
              <div key={l as string} className="rounded-xl bg-paper p-2 text-center dark:bg-wall-850"><div className={`text-lg font-black ${c}`}>{fa(v as number)}</div><div className="text-[10px] text-ink-500">{l}</div></div>
            ))}
          </div>
          {parsed.unknownColumns.length > 0 && <Notice tone="info">ستون‌های ناشناخته نادیده گرفته می‌شوند: {parsed.unknownColumns.join('، ')}</Notice>}
          {parsed.issues.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-line text-[11px] dark:border-wall-700">
              {parsed.issues.slice(0, 200).map((i, k) => (
                <div key={k} className={`flex gap-2 border-b border-line/60 px-3 py-1.5 last:border-0 dark:border-wall-700 ${i.level === 'error' ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  <span className="shrink-0 font-black">سطر {fa(i.row)}</span><span>{i.message}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {result && (
        <Notice tone={result.accepted ? 'ok' : 'warn'}>
          {fa(result.received)} پرسشنامه ثبت شد؛ {fa(result.accepted)} پاسخ از کنترل کیفیت سرور گذشت.
          {Object.keys(result.reasons).length > 0 && <> دلایل رد: {(Object.entries(result.reasons) as Array<[string, number]>).map(([r, n]) => `${QC_REASON_FA[r] ?? r} (${fa(n)})`).join('، ')}</>}
        </Notice>
      )}
    </div>
  );
}
