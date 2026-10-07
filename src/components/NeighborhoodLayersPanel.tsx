// ============================================================
// لایه‌های محله‌ای تهران در سه فرایند: سنجه (مقدار، صدک، کیفیت) → تشخیص (یافته‌ها و آزمون فرضیه‌ها)
// → تجویز (قلم کتابخانهٔ مداخلات با هدف مکانی، پیش‌نیاز و سنجهٔ پایش)
// ============================================================
import { useState, type ReactNode } from 'react';
import { Briefcase, ChevronDown, GraduationCap, Home, Lightbulb, MapPin, Microscope, Stethoscope, Wrench } from 'lucide-react';
import { CAPITAL_FA } from '../algorithm/types';
import type { LayerFinding, LayerKey, NeighborhoodLayersAssessment } from '../algorithm/neighborhoodApi';

const fa = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('fa-IR', { maximumFractionDigits: d }));
const ICON: Record<LayerKey, ReactNode> = { lighting: <Lightbulb size={14} />, housing: <Home size={14} />, employment: <Briefcase size={14} />, education: <GraduationCap size={14} /> };
const SEV: Record<LayerFinding['severity'], { label: string; cls: string }> = {
  high: { label: 'شدید', cls: 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200' },
  medium: { label: 'متوسط', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200' },
  low: { label: 'خفیف', cls: 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200' },
  info: { label: 'آگاهی', cls: 'bg-slate-100 text-slate-800 dark:bg-slate-700/40 dark:text-slate-200' },
};
const CONF_FA = { high: 'اطمینان بالا', medium: 'اطمینان متوسط', low: 'اطمینان پایین' } as const;
const TEST_FA = { supports: { label: 'تأیید می‌کند', cls: 'text-rose-700 dark:text-rose-300' }, contradicts: { label: 'رد می‌کند', cls: 'text-emerald-700 dark:text-emerald-300' }, neutral: { label: 'خنثی', cls: 'text-ink-500' } } as const;
const FRICTION_FA: Record<string, string> = { cost: 'هزینه', insecurity: 'ناامنی', quality: 'کیفیت/نگهداری', time: 'زمان', physical_barrier: 'مانع فیزیکی', information: 'اطلاعات', norm: 'هنجار', governance: 'حکمرانی' };
const STAGE_FA: Record<string, string> = { CAPACITY: 'ظرفیت', ACCESS: 'دسترسی', USE: 'استفاده', EXPERIENCE: 'تجربه', OUTCOME: 'پیامد' };

export default function NeighborhoodLayersPanel({ layers, compact = false }: { layers: NeighborhoodLayersAssessment; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-xs dark:border-wall-700 dark:bg-wall-800" aria-label="لایه‌های محله‌ای تهران">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-black"><Microscope size={14} /> لایه‌های محله‌ای تهران: سنجه، تشخیص و تجویز</p>
        <span className="text-[10px] text-ink-500">{layers.version} · قواعد {layers.rules}</span>
      </div>

      {/* ۱) سنجه */}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {layers.measures.map((m) => (
          <div key={m.key} className="rounded-xl border border-line/70 p-3 dark:border-wall-700">
            <div className="flex items-center gap-1.5 font-black">{ICON[m.key]} {m.title}</div>
            <div className="mt-1 flex items-baseline gap-1.5"><span className="text-lg font-black">{fa(m.value)}</span><span className="text-[10px] text-ink-500">{m.unit}</span></div>
            <div className="mt-0.5 text-[10px] text-ink-600 dark:text-slate-300">
              {m.band ?? '—'} · صدک {fa(m.percentileInTehran, 0)} در تهران (بالاتر = بهتر) · کیفیت {m.quality ?? '—'}{m.level === 'district' ? ' · سطح منطقه' : ''}
            </div>
            {!compact && (
              <button type="button" onClick={() => setOpen(open === m.key ? null : m.key)} className="mt-1 flex items-center gap-1 text-[10px] font-bold text-brand-700 dark:text-signal-400">
                جزئیات <ChevronDown size={11} />
              </button>
            )}
            {open === m.key && (
              <div className="mt-1 space-y-0.5 text-[10px]">
                {m.extra.map((x) => <div key={x.label} className="flex justify-between gap-2"><span className="text-ink-500">{x.label}</span><strong>{x.value}</strong></div>)}
                {m.note && <p className="pt-1 text-ink-400">{m.note}</p>}
                <p className="text-ink-400">زمان مشاهده: {m.observedAt}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ۲) تشخیص */}
      <div className="rounded-xl border border-line/70 p-3 dark:border-wall-700">
        <p className="mb-2 flex items-center gap-2 font-black"><Stethoscope size={13} /> یافته‌های تشخیصی ({fa(layers.findings.length, 0)})</p>
        {!layers.findings.length ? <p className="text-ink-500">هیچ یافتهٔ معناداری از این لایه‌ها برنیامد.</p> : (
          <ul className="space-y-1.5">
            {layers.findings.map((f) => (
              <li key={f.id} className="rounded-lg bg-black/[.03] p-2 dark:bg-white/5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${SEV[f.severity].cls}`}>{SEV[f.severity].label}</span>
                  <strong>{f.title}</strong>
                  <span className="text-[10px] text-ink-500">· {CAPITAL_FA[f.capital]}{f.indicator ? ` (${f.indicator})` : ''} · {CONF_FA[f.confidence]}{f.friction?.length ? ` · فرضیه: ${f.friction.map((x) => FRICTION_FA[x] ?? x).join('، ')}` : ''}</span>
                </div>
                {!compact && <ul className="mt-1 list-disc space-y-0.5 pr-5 text-[10px] text-ink-600 dark:text-slate-300">{[...f.evidence, ...(f.corroboration ?? [])].map((e) => <li key={e}>{e}</li>)}</ul>}
              </li>
            ))}
          </ul>
        )}
        {layers.hypothesisTests.length > 0 && (
          <div className="mt-2 border-t border-line/60 pt-2 dark:border-wall-700">
            <p className="mb-1 font-bold">آزمون فرضیه‌های علّی با این لایه‌ها</p>
            <ul className="space-y-0.5 text-[10px]">
              {layers.hypothesisTests.map((t, i) => (
                <li key={i}><strong>{FRICTION_FA[t.frictionType] ?? t.frictionType}</strong> — {t.test}: <span className={`font-black ${TEST_FA[t.result].cls}`}>{TEST_FA[t.result].label}</span> <span className="text-ink-500">({t.detail})</span></li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ۳) تجویز */}
      {layers.prescriptions.length > 0 && (
        <div className="rounded-xl border border-line/70 p-3 dark:border-wall-700">
          <p className="mb-2 flex items-center gap-2 font-black"><Wrench size={13} /> تجویز مبتنی بر یافته‌ها</p>
          <ol className="space-y-2">
            {layers.prescriptions.slice(0, compact ? 3 : 10).map((p, i) => (
              <li key={p.libraryId} className="rounded-lg border border-line/60 p-2 dark:border-wall-700">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] text-ink-500">{fa(i + 1, 0)}. {p.libraryId}</span>
                  <strong>{p.name}</strong>
                  {p.alignedWithBottleneck && <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">هم‌راستا با گلوگاه</span>}
                </div>
                <div className="mt-0.5 text-[10px] text-ink-500">
                  {CAPITAL_FA[p.capital]} · {STAGE_FA[p.transition[0]]} ← {STAGE_FA[p.transition[1]]} · مسئول: {p.owner}{p.costBnRial !== null ? ` · ≈ ${fa(p.costBnRial, 0)} میلیارد ریال` : ''}{p.months !== null ? ` · ${fa(p.months, 0)} ماه` : ''} · اولویت {fa(p.priority, 2)} · بر پایهٔ {p.findingIds.join('، ')}
                </div>
                <p className="mt-1">{p.rationale}</p>
                {!compact && (
                  <>
                    <ul className="mt-1 list-decimal space-y-0.5 pr-5 text-[10px]">{p.steps.map((s) => <li key={s}>{s}</li>)}</ul>
                    {p.prerequisite && <p className="mt-1 text-[10px] font-bold text-amber-800 dark:text-amber-300">پیش‌نیاز: {p.prerequisite}</p>}
                    <p className="mt-0.5 text-[10px] text-ink-600 dark:text-slate-300">سنجهٔ پایش: {p.kpi}</p>
                  </>
                )}
                {p.spatialTargets && p.spatialTargets.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.spatialTargets.map((s) => (
                      <a key={`${s.name}-${s.lat}`} href={s.mapUrl ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line/70 px-1.5 py-0.5 text-[10px] hover:border-brand-500 dark:border-wall-700">
                        <MapPin size={10} /> {s.name}{s.lengthKm !== null ? ` (${fa(s.lengthKm, 2)} km)` : ''}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {layers.caveats.length > 0 && <ul className="list-disc space-y-0.5 pr-5 text-[10px] text-ink-500">{layers.caveats.map((c) => <li key={c}>{c}</li>)}</ul>}
    </section>
  );
}
