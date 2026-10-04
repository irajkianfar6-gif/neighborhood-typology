// ============================================================
// پنل شواهد کارت V2: سطح انتشار، پوشش، امتناع‌ها، شاخص‌ها با منبع/پایایی،
// و «چه داده‌ای این حکم را تغییر می‌دهد» با الگوی قرارداد داده
// ============================================================
import { useState } from 'react';
import { AlertTriangle, ChevronDown, Database, Download, FileWarning, MapPin, ShieldCheck } from 'lucide-react';
import { CAPITAL_FA } from '../algorithm/types';
import { LEVEL_FA, templateUrl, type DecisionCardV2, type NeighborhoodCandidate } from '../algorithm/neighborhoodApi';

const LEVEL_CLASS: Record<string, string> = {
  PUBLISHABLE: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200',
  PROVISIONAL: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200',
  EXPLORATORY: 'bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-900/30 dark:text-orange-200',
  INSUFFICIENT: 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-900/30 dark:text-rose-200',
};
const TIER_FA: Record<string, string> = { official: 'رسمی', contract: 'قرارداد داده', survey: 'پیمایش', field: 'ممیزی میدانی', open_measured: 'دادهٔ باز سنجیده', open_model: 'مدل باز', expert: 'خبره', proxy: 'جانشین (proxy)', none: '—' };
const SECTION_FA: Record<string, string> = { diagnosticType: 'تیپ تشخیصی', equity: 'عدالت/شکاف گروهی', trend: 'روند', causal: 'علّیت', engine: 'موتور' };
const fa = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('fa-IR', { maximumFractionDigits: d }));

export function CandidatePicker({ query, candidates, onPick }: { query: string; candidates: NeighborhoodCandidate[]; onPick: (c: NeighborhoodCandidate) => void }) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-900/20">
      <p className="font-black text-amber-900 dark:text-amber-200">«{query}» با چند محله مطابقت دارد؛ لطفاً محلهٔ موردنظر را انتخاب کنید:</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {candidates.map((c) => (
          <button key={c.neighborhoodId} type="button" onClick={() => onPick(c)} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-right text-xs font-bold hover:border-amber-500 dark:border-amber-800 dark:bg-wall-800">
            <MapPin size={14} className="shrink-0 text-amber-700" />
            <span>{c.nameFa} — {c.cityFa}{c.districtFa ? `، ${c.districtFa}` : ''}</span>
            <span className="mr-auto text-[10px] text-ink-500">{c.boundaryIsProxy ? 'مرز تقریبی' : 'مرز رسمی/OSM'} · {fa(c.areaKm2, 2)} km²</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function NeighborhoodEvidencePanel({ card }: { card: DecisionCardV2 }) {
  const [showAll, setShowAll] = useState(false);
  const level = LEVEL_FA[card.publication.level];
  const scored = card.indicators.filter((i) => i.score !== null);
  const rows = showAll ? card.indicators : scored;
  const nb = card.neighborhood;
  return (
    <section className="space-y-4" aria-label="شواهد و سطح انتشار">
      <div className={`rounded-2xl border p-4 ${LEVEL_CLASS[card.publication.level]}`}>
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck size={18} />
          <strong className="text-sm">سطح انتشار: {level.label}</strong>
          <span className="text-xs opacity-80">{level.description}</span>
        </div>
        {card.publication.reasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pr-5 text-xs">{card.publication.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-4 text-xs">
        <Fact label="محله" value={`${nb.nameFa} — ${nb.cityFa}`} hint={`${nb.neighborhoodId} · مرز ${nb.boundaryIsProxy ? 'تقریبی' : nb.boundaryTier} (${nb.boundarySource})`} />
        <Fact label="جمعیت" value={fa(card.context.population, 0)} hint={`${card.context.populationSource}${card.context.populationYear ? ` (${card.context.populationYear})` : ''} · ${card.context.populationTier}`} />
        <Fact label="مساحت / تراکم" value={`${fa(card.context.areaKm2, 2)} km²`} hint={card.context.density ? `${fa(card.context.density, 0)} نفر/km²` : 'تراکم نامعلوم'} />
        <Fact label="پوشش شاخص" value={`${fa(card.coverage.usable, 0)} از ${fa(card.coverage.total, 0)} قابل‌استفاده`} hint={`${fa(card.coverage.scored, 0)} امتیازدار · سهم proxy ${fa(card.coverage.proxyShare * 100, 0)}٪`} />
      </div>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
        {card.capitals.map((c) => (
          <div key={c.capital} className={`rounded-xl border p-2 text-center text-xs ${LEVEL_CLASS[c.level]}`}>
            <div className="font-black">{CAPITAL_FA[c.capital]}</div>
            <div className="mt-1 text-lg font-black">{c.score === null ? '—' : fa(c.score)}</div>
            <div className="text-[10px] opacity-80">{LEVEL_FA[c.level].label} · {fa(c.indicatorsUsed.length, 0)} شاخص</div>
          </div>
        ))}
      </div>

      {card.abstentions.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4 text-xs dark:border-wall-700 dark:bg-wall-800">
          <p className="mb-2 flex items-center gap-2 font-black"><AlertTriangle size={14} /> بخش‌هایی که سامانه از صدور حکم در آن‌ها خودداری کرد</p>
          <ul className="space-y-1">{card.abstentions.map((a, i) => <li key={i}><strong>{SECTION_FA[a.section] ?? a.section}:</strong> {a.reason}</li>)}</ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface dark:border-wall-700 dark:bg-wall-800">
        <div className="flex items-center justify-between p-3 text-xs">
          <span className="flex items-center gap-2 font-black"><Database size={14} /> شاخص‌ها با منبع، تاریخ و پایایی</span>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="flex items-center gap-1 font-bold text-brand-700 dark:text-signal-400">
            {showAll ? 'فقط امتیازدارها' : `نمایش همه (${fa(card.indicators.length, 0)})`} <ChevronDown size={12} />
          </button>
        </div>
        <table className="w-full text-[11px]">
          <thead className="bg-black/5 dark:bg-white/5"><tr>
            <th className="p-2 text-right">کد</th><th className="p-2 text-right">شاخص</th><th className="p-2">مقدار خام</th><th className="p-2">امتیاز</th>
            <th className="p-2">پایایی</th><th className="p-2">ردهٔ شاهد</th><th className="p-2 text-right">منبع / روش</th><th className="p-2">تاریخ</th>
          </tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.code} className="border-t border-line/60 dark:border-wall-700">
                <td className="p-2 font-mono">{i.code}{i.conflict && <span title="تعارض منابع" className="mr-1 text-rose-600">⚠</span>}</td>
                <td className="p-2">{i.name}</td>
                <td className="p-2 text-center">{i.raw === null ? '—' : `${fa(i.raw, 2)} ${i.unit}`}</td>
                <td className="p-2 text-center font-bold">{i.score === null ? <span className="text-ink-500" title={i.missingReason}>ندارد</span> : fa(i.score)}</td>
                <td className="p-2 text-center">{i.score === null ? '—' : fa(i.reliability, 2)}</td>
                <td className="p-2 text-center">{TIER_FA[i.tier] ?? i.tier}</td>
                <td className="p-2" title={i.notes?.join(' | ')}>{i.score === null ? (i.missingReason ?? '—') : `${i.source} — ${i.method}`}</td>
                <td className="p-2 text-center">{i.observedAt ? i.observedAt.slice(0, 10) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {card.whatWouldChangeThis.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4 text-xs dark:border-wall-700 dark:bg-wall-800">
          <p className="mb-2 flex items-center gap-2 font-black"><FileWarning size={14} /> چه داده‌ای این حکم را تغییر می‌دهد ({fa(card.whatWouldChangeThis.length, 0)} شاخص)</p>
          <div className="grid gap-2 md:grid-cols-2">
            {card.whatWouldChangeThis.slice(0, 40).map((m) => (
              <div key={m.code} className="rounded-xl border border-line/70 p-2 dark:border-wall-700">
                <div className="font-bold">{m.code} · {m.name} <span className="text-ink-500">({CAPITAL_FA[m.capital]})</span></div>
                <div className="text-ink-500">{m.reason}</div>
                <div>اقدام: {m.nextAction} — مالک داده: {m.owner}</div>
                {m.template && <a className="mt-1 inline-flex items-center gap-1 font-bold text-brand-700 dark:text-signal-400" href={templateUrl(m.template)}><Download size={12} /> الگوی {m.template}</a>}
              </div>
            ))}
          </div>
        </div>
      )}

      {card.context.warnings.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-3 text-[11px] dark:border-wall-700 dark:bg-wall-800">
          <summary className="cursor-pointer font-bold">هشدارهای بافت و منابع ({fa(card.context.warnings.length, 0)})</summary>
          <ul className="mt-2 list-disc space-y-0.5 pr-5">{card.context.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
      <p className="text-[10px] text-ink-500">
        نسخه: {Object.entries(card.reproducibilityKey).map(([k, v]) => `${k}=${v}`).join(' · ')} · اثرانگشت {card.fingerprint}
        {card.dataVintage.oldest && ` · بازهٔ داده ${card.dataVintage.oldest.slice(0, 10)} تا ${card.dataVintage.newest?.slice(0, 10)}`}
      </p>
    </section>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 dark:border-wall-700 dark:bg-wall-800">
      <div className="text-[10px] font-bold text-ink-500">{label}</div>
      <div className="mt-1 font-black">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-ink-500">{hint}</div>}
    </div>
  );
}
