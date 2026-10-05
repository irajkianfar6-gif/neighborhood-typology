import React, { useMemo, useState } from 'react';
import { Camera, Crosshair, MapPin, Send, UserCheck } from 'lucide-react';
import { submitAudits, type FieldAuditSummary } from '../../algorithm/dataCollectionApi';
import { Bar, Card, Notice, ProgressRing, fa, ghostBtn, inputCls, primaryBtn } from './ui';

const ITEMS: Array<{ key: string; label: string; rubric: [string, string, string] }> = [
  { key: 'lighting', label: 'روشنایی', rubric: ['تاریک یا چراغ خراب', 'نقاط کور دارد', 'یکنواخت و کافی'] },
  { key: 'seating', label: 'نیمکت / امکان نشستن', rubric: ['ندارد', 'کم یا نامناسب', 'کافی و سالم'] },
  { key: 'shade', label: 'سایه', rubric: ['بدون سایه', 'سایهٔ پراکنده', 'سایهٔ پیوسته (درخت/سایبان)'] },
  { key: 'cleanliness', label: 'پاکیزگی', rubric: ['زباله و آلودگی آشکار', 'نسبتاً تمیز', 'تمیز'] },
  { key: 'accessibility', label: 'دسترس‌پذیری', rubric: ['پله/مانع بدون رمپ', 'رمپ ناقص', 'بدون مانع برای ویلچر و کالسکه'] },
  { key: 'safety', label: 'ایمنی', rubric: ['خطر ترافیک/سقوط/ناامنی', 'خطر محدود', 'ایمن و دید باز'] },
  { key: 'activity', label: 'سرزندگی / فعالیت', rubric: ['خالی و متروک', 'استفادهٔ کم', 'استفادهٔ فعال گروه‌های مختلف'] },
  { key: 'maintenance', label: 'نگهداری', rubric: ['تخریب/رهاشده', 'نیاز به تعمیر', 'نگهداری منظم'] },
];
const TONES = ['border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200', 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200', 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'];
const SCALE = ['نامطلوب', 'متوسط', 'مطلوب'];

export default function FieldAuditWizard({ neighborhoodId, centroid, summary, onSubmitted }: { neighborhoodId: string; centroid: { lat: number; lng: number }; summary: FieldAuditSummary; onSubmitted: () => void }) {
  const [auditorId, setAuditorId] = useState(() => localStorage.getItem('ara_auditor_id') ?? '');
  const nextId = `P-${String(summary.points + 1).padStart(2, '0')}`;
  const [pointId, setPointId] = useState(nextId);
  const [lat, setLat] = useState(String(centroid.lat.toFixed(6)));
  const [lng, setLng] = useState(String(centroid.lng.toFixed(6)));
  const [items, setItems] = useState<Record<string, number>>({});
  const [photoRef, setPhotoRef] = useState('');
  const [gpsState, setGpsState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const needSecond = summary.pointList.filter((p) => p.auditors.length === 1 && !p.auditors.includes(auditorId.trim()));
  const complete = ITEMS.every((i) => items[i.key] !== undefined);
  const score = complete ? Math.round((ITEMS.reduce((s, i) => s + items[i.key], 0) / (ITEMS.length * 2)) * 100) : null;

  const locate = () => {
    if (!navigator.geolocation) { setGpsState('مرورگر از موقعیت‌یابی پشتیبانی نمی‌کند'); return; }
    setGpsState('در حال دریافت موقعیت…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setGpsState(`دقت حدود ${fa(p.coords.accuracy)} متر`); },
      () => setGpsState('دسترسی به موقعیت داده نشد؛ مختصات را دستی وارد کنید'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      localStorage.setItem('ara_auditor_id', auditorId.trim());
      const r = await submitAudits(neighborhoodId, [{ auditorId: auditorId.trim(), pointId: pointId.trim(), lat: Number(lat), lng: Number(lng), items, photoRef: photoRef.trim() || undefined, auditedAt: new Date().toISOString() }]);
      if (r.stored) {
        setMsg({ tone: 'ok', text: `نقطهٔ ${pointId} ثبت شد.` });
        setItems({}); setPhotoRef(''); setPointId(`P-${String(summary.points + 2).padStart(2, '0')}`);
        onSubmitted();
      } else setMsg({ tone: 'danger', text: r.errors.flatMap((e) => e.errors).join('؛ ') });
    } catch (e) { setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'ثبت ناموفق بود' }); }
    finally { setBusy(false); }
  };

  const plot = useMemo(() => {
    const pts = summary.pointList.map((p) => ({ ...p, x: (p.lng - centroid.lng) * 91000, y: (p.lat - centroid.lat) * 111000 }));
    const ext = Math.max(300, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.2;
    return { pts, ext };
  }, [summary.pointList, centroid]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Card title="ثبت نقطهٔ ممیزی فضای عمومی (شاخص P3)" icon={<MapPin size={15} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] font-bold text-ink-600 dark:text-slate-300">کد ممیز *<input className={`${inputCls} mt-1`} value={auditorId} onChange={(e) => setAuditorId(e.target.value)} placeholder="مثلاً aud-01" /></label>
            <label className="text-[11px] font-bold text-ink-600 dark:text-slate-300">شناسهٔ نقطه *<input className={`${inputCls} mt-1`} value={pointId} onChange={(e) => setPointId(e.target.value)} /></label>
          </div>
          {needSecond.length > 0 && (
            <div className="mt-3 rounded-xl bg-sky-50 p-3 text-[11px] dark:bg-sky-900/20">
              <p className="flex items-center gap-1 font-black text-sky-800 dark:text-sky-200"><UserCheck size={13} /> برای پایایی بین‌ارزیاب، این نقاط به ممیز دوم نیاز دارند:</p>
              <div className="mt-2 flex flex-wrap gap-1">{needSecond.slice(0, 12).map((p) => <button key={p.pointId} type="button" onClick={() => { setPointId(p.pointId); setLat(String(p.lat)); setLng(String(p.lng)); }} className="rounded-lg border border-sky-300 bg-white px-2 py-1 font-mono text-[10px] font-black text-sky-800 dark:bg-wall-850 dark:text-sky-200">{p.pointId}</button>)}</div>
            </div>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-[11px] font-bold text-ink-600 dark:text-slate-300">عرض جغرافیایی<input dir="ltr" className={`${inputCls} mt-1 font-mono`} value={lat} onChange={(e) => setLat(e.target.value)} /></label>
            <label className="text-[11px] font-bold text-ink-600 dark:text-slate-300">طول جغرافیایی<input dir="ltr" className={`${inputCls} mt-1 font-mono`} value={lng} onChange={(e) => setLng(e.target.value)} /></label>
            <button type="button" className={ghostBtn} onClick={locate}><Crosshair size={13} /> موقعیت فعلی</button>
          </div>
          {gpsState && <p className="mt-1 text-[10px] text-ink-500">{gpsState}</p>}
        </Card>

        <Card title="چک‌لیست ۸ گویه‌ای" actions={score !== null && <span className="rounded-full bg-brand-50 px-2 py-1 text-[11px] font-black text-brand-800 dark:bg-wall-850 dark:text-signal-400">امتیاز نقطه: {fa(score)}</span>}>
          <div className="space-y-2">
            {ITEMS.map((it) => (
              <div key={it.key} className="grid gap-2 rounded-xl border border-line/70 p-2 dark:border-wall-700 md:grid-cols-[130px_1fr] md:items-center">
                <span className="text-xs font-black text-ink-800 dark:text-slate-100">{it.label}</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {[0, 1, 2].map((v) => (
                    <button key={v} type="button" aria-pressed={items[it.key] === v} onClick={() => setItems((s) => ({ ...s, [it.key]: v }))}
                      className={`rounded-lg border px-2 py-1.5 text-right transition ${items[it.key] === v ? TONES[v] : 'border-line bg-paper text-ink-500 hover:border-brand-300 dark:border-wall-700 dark:bg-wall-850 dark:text-slate-400'}`}>
                      <strong className="block text-[10px]">{fa(v)} · {SCALE[v]}</strong>
                      <span className="block text-[9px] leading-4 opacity-80">{it.rubric[v]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <label className="mt-3 block text-[11px] font-bold text-ink-600 dark:text-slate-300"><span className="flex items-center gap-1"><Camera size={12} /> ارجاع عکس (نام فایل یا شمارهٔ عکس)</span>
            <input className={`${inputCls} mt-1`} value={photoRef} onChange={(e) => setPhotoRef(e.target.value)} placeholder="IMG_2041.jpg" />
          </label>
          {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
          <div className="mt-3 flex justify-end">
            <button type="button" className={primaryBtn} disabled={busy || !complete || !auditorId.trim() || !pointId.trim() || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))} onClick={() => void submit()}>
              <Send size={14} /> {busy ? 'در حال ثبت…' : 'ثبت نقطه'}
            </button>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="پیشرفت ممیزی">
          <div className="flex items-center gap-4">
            <ProgressRing value={summary.points / 5} label={<>{fa(summary.points)}<br /><span className="text-[9px] font-bold text-ink-400">از ۵ نقطه</span></>} tone={summary.points >= 5 ? 'ok' : 'warn'} size={78} />
            <div className="space-y-1 text-[11px]">
              <div>ممیزها: <strong>{fa(summary.auditors)}</strong></div>
              <div>پایایی κ: <strong className={summary.kappa !== null && summary.kappa >= 0.6 ? 'text-emerald-600' : 'text-amber-600'}>{summary.kappa === null ? 'ندارد' : fa(summary.kappa, 2)}</strong></div>
              <div>P3: <strong>{summary.p3 === null ? '—' : fa(summary.p3, 1)}</strong></div>
            </div>
          </div>
          {summary.reasons.length > 0 && <ul className="mt-3 space-y-1 text-[10px] text-amber-700 dark:text-amber-300">{summary.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>}
        </Card>
        <Card title="پراکنش نقاط نسبت به مرکز محله">
          <svg viewBox="-110 -110 220 220" className="w-full rounded-xl bg-paper dark:bg-wall-850" role="img" aria-label="نقشهٔ نقاط ممیزی">
            <line x1="-100" y1="0" x2="100" y2="0" className="stroke-black/10 dark:stroke-white/10" /><line x1="0" y1="-100" x2="0" y2="100" className="stroke-black/10 dark:stroke-white/10" />
            <circle r="3" className="fill-ink-400" />
            {plot.pts.map((p) => (
              <g key={p.pointId} transform={`translate(${(p.x / plot.ext) * 100} ${(-p.y / plot.ext) * 100})`}>
                <circle r="6" className={p.score >= 66 ? 'fill-emerald-500' : p.score >= 40 ? 'fill-amber-500' : 'fill-rose-500'} opacity={0.85} />
                {p.auditors.length > 1 && <circle r="9" className="fill-none stroke-sky-500" strokeWidth="1.5" />}
                <text y="-10" textAnchor="middle" className="fill-ink-600 text-[8px] font-bold dark:fill-slate-300">{p.pointId}</text>
              </g>
            ))}
          </svg>
          <p className="mt-1 text-[10px] text-ink-400">رنگ = امتیاز نقطه · حلقهٔ آبی = دو ممیز</p>
        </Card>
        {Object.keys(summary.itemMeans).length > 0 && (
          <Card title="میانگین گویه‌ها (۰ تا ۲)">
            <div className="space-y-2">{ITEMS.map((it) => (
              <div key={it.key} className="text-[10px]"><div className="mb-1 flex justify-between"><span>{it.label}</span><span className="font-black">{fa(summary.itemMeans[it.key], 2)}</span></div><Bar value={summary.itemMeans[it.key] ?? 0} max={2} tone={(summary.itemMeans[it.key] ?? 0) >= 1.4 ? 'ok' : (summary.itemMeans[it.key] ?? 0) >= 0.8 ? 'warn' : 'danger'} /></div>
            ))}</div>
          </Card>
        )}
      </div>
    </div>
  );
}
