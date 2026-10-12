// ============================================================
// تحلیل مقایسه‌ای هوشمند دو پهنه با هوش مصنوعی (حکیم)
// دادهٔ کامل دو پهنه (SI، لایه‌ها، رادار، حالت، ظرفیت‌ها) + ۱۰ شاخصِ
// دارای بیشترین واگرایی به مدل فرستاده می‌شود و حکیم با یک JSON
// ساخت‌یافته، همگرایی‌ها/واگرایی‌ها، خوانش رادار و مقایسهٔ حالت‌ها را
// با ارجاع به اعداد روایت می‌کند — بر پایهٔ الگوریتم مرجع و کاتالوگ مادر.
// ============================================================
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
  Bot,
  Scale,
  Copy,
  Check,
  X,
  GitCompareArrows,
} from 'lucide-react';
import type { ZoneResult } from '../algorithm/types';
import type { IndicatorSample } from '../algorithm/liveExtract';
import { chatWithAIJSON } from '../lib/aiService';
import {
  buildCompareMessages,
  localCompareFallback,
  CompareDivergenceRow,
  ZoneCompare,
} from '../lib/aiExplain';
import { getHakimGrounding } from '../lib/hakimGrounding';
import { toPersianDigits } from './AnimatedCounter';

interface Props {
  nameA: string;
  a: ZoneResult;
  nameB: string;
  b: ZoneResult;
  divergence: CompareDivergenceRow[];
  onClose: () => void;
}

function CompareBlock({ icon, label, text }: { icon: ReactNode; label: string; text: string }) {
  if (!text || !text.trim()) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-black text-ink-600 flex items-center gap-1">{icon} {label}</span>
      <p className="text-[9.5px] font-semibold text-ink-700 leading-relaxed">{text}</p>
    </div>
  );
}

export default function ZoneAICompare({ nameA, a, nameB, b, divergence, onClose }: Props) {
  const [cmp, setCmp] = useState<ZoneCompare | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIsLocal(false);

    const run = async () => {
      try {
        const grounding = await getHakimGrounding();
        const { system, user } = buildCompareMessages(nameA, a, nameB, b, divergence, grounding);
        const data = await chatWithAIJSON<ZoneCompare>(
          [{ role: 'user', content: user }],
          { system, maxTokens: 1600, timeoutMs: 180000 },
        );
        if (cancelled || !mountedRef.current) return;
        setCmp({
          summary: typeof data.summary === 'string' ? data.summary : '',
          similarities: Array.isArray(data.similarities) ? data.similarities.map(String) : [],
          divergences: Array.isArray(data.divergences) ? data.divergences.map(String) : [],
          radarReading: typeof data.radarReading === 'string' ? data.radarReading : '',
          stateComparison: typeof data.stateComparison === 'string' ? data.stateComparison : '',
          topDivergentIndicators: Array.isArray(data.topDivergentIndicators)
            ? data.topDivergentIndicators.map((d) => ({
                indicator: typeof d?.indicator === 'string' ? d.indicator : '',
                a: typeof d?.a === 'string' ? d.a : '',
                b: typeof d?.b === 'string' ? d.b : '',
                note: typeof d?.note === 'string' ? d.note : '',
              }))
            : [],
          implications: Array.isArray(data.implications) ? data.implications.map(String) : [],
          recommendation: typeof data.recommendation === 'string' ? data.recommendation : '',
          risks: Array.isArray(data.risks) ? data.risks.map(String) : [],
        });
      } catch (e) {
        if (cancelled || !mountedRef.current) return;
        setIsLocal(true);
        setCmp(localCompareFallback(nameA, a, nameB, b, divergence));
        setError(e instanceof Error ? e.message : 'خطای نامشخص');
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [nameA, a, nameB, b, divergence, attempt]);

  const copyCompare = useCallback(async () => {
    if (!cmp) return;
    const bullets = (arr: string[]) => arr.map((s) => `• ${s}`).join('\n');
    const text = [
      `تحلیل مقایسه‌ای هوشمند: «${nameA}» در برابر «${nameB}»`,
      '',
      `خلاصه: ${cmp.summary}`,
      '',
      cmp.similarities.length ? `همگرایی‌ها:\n${bullets(cmp.similarities)}` : '',
      cmp.divergences.length ? `واگرایی‌ها:\n${bullets(cmp.divergences)}` : '',
      cmp.radarReading ? `خوانش رادار: ${cmp.radarReading}` : '',
      cmp.stateComparison ? `مقایسهٔ حالت‌ها: ${cmp.stateComparison}` : '',
      cmp.topDivergentIndicators.length
        ? `شاخص‌های دارای بیشترین واگرایی:\n${cmp.topDivergentIndicators.map((d) => `• ${d.indicator}: ${d.a} در برابر ${d.b} — ${d.note}`).join('\n')}`
        : '',
      cmp.implications.length ? `دلالت‌ها:\n${bullets(cmp.implications)}` : '',
      cmp.recommendation ? `توصیه: ${cmp.recommendation}` : '',
      cmp.risks.length ? `ملاحظات:\n${bullets(cmp.risks)}` : '',
      '',
      '— تولیدشده توسط حکیم · سامانه آرا (ISGP) —',
    ]
      .filter((l) => l.trim().length > 0)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // دسترسی به کلیپ‌بورد مسدود بود
    }
  }, [cmp, nameA, nameB]);

  return (
    <div className="rounded-2xl border border-brand-800/25 bg-gradient-to-b from-brand-50/40 to-surface p-3.5 flex flex-col gap-2.5 animate-fade-in">
      {/* سربرگ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-[10.5px] font-black text-ink-800 flex items-center gap-1.5">
            <Sparkles size={13} className="text-brand-800" /> تحلیل مقایسه‌ای هوشمند
            <span className="text-[8px] font-black bg-gradient-to-l from-brand-900 to-brand-700 text-signal-400 rounded-full px-2 py-0.5">حکیم</span>
          </h3>
          <p className="text-[9px] text-ink-400 font-semibold mt-0.5">
            «{nameA}» <GitCompareArrows size={10} className="inline text-ink-300" /> «{nameB}» — روایت واگرایی/همگرایی لایه‌ها، رادار و حالت‌ها
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void copyCompare()}
            disabled={loading || !cmp}
            className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[9px] font-black text-ink-600 hover:border-brand-300 hover:text-brand-800 transition-all cursor-pointer disabled:opacity-50"
            title="کپی متن کامل تحلیل"
          >
            {copied ? <Check size={11} className="text-ok-700" /> : <Copy size={11} />} {copied ? 'کپی شد' : 'کپی تحلیل'}
          </button>
          <button
            onClick={() => setAttempt((n) => n + 1)}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[9px] font-black text-ink-600 hover:border-brand-300 hover:text-brand-800 transition-all cursor-pointer disabled:opacity-50"
            title="اجرای مجدد تحلیل"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> بازتولید
          </button>
          <button
            onClick={onClose}
            className="p-1.5 -m-1 rounded-lg text-ink-400 hover:text-danger hover:bg-danger-soft transition-all cursor-pointer"
            title="بستن تحلیل"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-2.5 py-8">
          <Bot size={22} className="text-brand-700 animate-pulse" />
          <p className="text-[10px] font-black text-ink-500">حکیم در حال روایت مقایسه‌ای دو پهنه بر پایهٔ اعداد واقعی است…</p>
          <p className="text-[8.5px] font-semibold text-ink-400">همگرایی/واگرایی لایه‌ها · خوانش رادار · مقایسهٔ حالت‌های ماتریس ۹ حالته</p>
        </div>
      )}

      {!loading && cmp && (
        <div className="flex flex-col gap-2.5">
          <CompareBlock icon={<Sparkles size={11} className="text-brand-700 shrink-0" />} label="خلاصهٔ مقایسه" text={cmp.summary} />

          {cmp.similarities.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-ok-700 flex items-center gap-1"><CheckCircle2 size={11} className="shrink-0" /> همگرایی‌ها</span>
              <div className="flex flex-wrap gap-1.5">
                {cmp.similarities.map((s, i) => (
                  <span key={i} className="text-[8.5px] font-bold text-ink-600 bg-ok-soft border border-ok/30 rounded-full px-2.5 py-1">{s}</span>
                ))}
              </div>
            </div>
          )}

          {cmp.divergences.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><AlertTriangle size={11} className="text-amber-600 shrink-0" /> واگرایی‌ها</span>
              <div className="flex flex-wrap gap-1.5">
                {cmp.divergences.map((d, i) => (
                  <span key={i} className="text-[8.5px] font-bold text-ink-600 bg-amber-50 border border-amber-300/50 rounded-full px-2.5 py-1">{d}</span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <CompareBlock icon={<Scale size={11} className="text-brand-700 shrink-0" />} label="خوانش رادار" text={cmp.radarReading} />
            <CompareBlock icon={<GitCompareArrows size={11} className="text-teal-600 shrink-0" />} label="مقایسهٔ حالت‌ها" text={cmp.stateComparison} />
          </div>

          {cmp.topDivergentIndicators.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><Info size={11} className="text-brand-700 shrink-0" /> شاخص‌های دارای بیشترین واگرایی</span>
              <div className="rounded-lg border border-line overflow-hidden">
                <table className="w-full text-right text-[9px]">
                  <thead className="bg-paper">
                    <tr className="text-ink-400">
                      <th className="px-2.5 py-1.5 font-black text-[8.5px]">شاخص</th>
                      <th className="px-2.5 py-1.5 font-black text-[8.5px]">{nameA}</th>
                      <th className="px-2.5 py-1.5 font-black text-[8.5px]">{nameB}</th>
                      <th className="px-2.5 py-1.5 font-black text-[8.5px]">تفسیر حکیم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmp.topDivergentIndicators.map((d, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="px-2.5 py-1.5 font-bold text-ink-700">{d.indicator}</td>
                        <td className="px-2.5 py-1.5 font-black text-ink-800" dir="ltr">{d.a}</td>
                        <td className="px-2.5 py-1.5 font-black text-ink-800" dir="ltr">{d.b}</td>
                        <td className="px-2.5 py-1.5 font-semibold text-ink-500">{d.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {cmp.implications.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><Info size={11} className="text-teal-600 shrink-0" /> دلالت‌های حاکمیتی</span>
              <div className="flex flex-col gap-1">
                {cmp.implications.map((im, i) => (
                  <div key={i} className="flex gap-1.5 text-[9.5px] font-semibold text-ink-600 leading-relaxed">
                    <span className="text-brand-700 mt-0.5 shrink-0">•</span>
                    <span>{im}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {cmp.recommendation && (
            <div className="rounded-xl border border-ok/25 bg-ok-soft/50 p-3 flex flex-col gap-1">
              <span className="text-[9px] font-black text-ok-700 flex items-center gap-1"><CheckCircle2 size={11} /> توصیهٔ حکیم</span>
              <p className="text-[9.5px] font-semibold text-ink-700 leading-relaxed">{cmp.recommendation}</p>
            </div>
          )}

          {cmp.risks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cmp.risks.map((r, i) => (
                <span key={i} className="text-[8.5px] font-bold text-danger-700 bg-danger-soft border border-danger/25 rounded-full px-2.5 py-1">{r}</span>
              ))}
            </div>
          )}

          {isLocal && (
            <p className="text-[8.5px] font-bold text-amber-700 bg-amber-50 border border-amber-300/50 rounded-lg px-2 py-1.5">
              ⚠ سرویس برخط در دسترس نبود؛ این تحلیل بر پایهٔ دادهٔ قطعی و به‌صورت محلی تولید شد.
            </p>
          )}
          {error && !isLocal && <p className="text-[8.5px] font-bold text-danger">{error}</p>}
        </div>
      )}

      {!loading && !cmp && <p className="text-[9.5px] font-bold text-ink-400">تحلیلی تولید نشد.</p>}
    </div>
  );
}
