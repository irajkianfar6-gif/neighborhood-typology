// ============================================================
// مقایسه دو محله کنار هم
// ============================================================
import { useState, useCallback } from 'react';
import { GitCompareArrows, Loader2, AlertTriangle } from 'lucide-react';
import { CAPITAL_FA, BAND_CONFIG } from '../algorithm/types';
import { scoreToBand } from '../algorithm/statusBands';
import { analyzeNeighborhoodByName, LEVEL_FA } from '../algorithm/neighborhoodApi';
import type { DecisionCard } from '../algorithm/types';

interface Props {}

export default function NeighborhoodComparison(_props: Props) {
  const [nameA, setNameA] = useState('');
  const [nameB, setNameB] = useState('');
  const [cardA, setCardA] = useState<DecisionCard | null>(null);
  const [cardB, setCardB] = useState<DecisionCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');

  const analyzeOne = useCallback(async (name: string): Promise<DecisionCard | null> => {
    if (!name.trim()) return null;
    const response = await analyzeNeighborhoodByName({ name: name.trim() });
    if (response.status === 'NEEDS_DISAMBIGUATION') {
      const options = response.candidates.slice(0, 4).map(c => `${c.nameFa} (${c.cityFa})`).join('، ');
      throw new Error(`«${name}» مبهم است؛ نام شهر را هم بنویسید (مثلاً: ${options})`);
    }
    if (!response.engineCard) {
      throw new Error(`«${name}»: ${LEVEL_FA[response.card.publication.level].label} — شواهد برای مقایسه کافی نیست`);
    }
    return response.engineCard;
  }, []);

  const handleCompare = useCallback(async () => {
    if (!nameA.trim() || !nameB.trim()) return;
    setLoading(true);
    setProgress('تحلیل محله اول...');
    setCardA(null);
    setCardB(null);
    try {
      const a = await analyzeOne(nameA);
      setCardA(a);
      setProgress('تحلیل محله دوم...');
      const b = await analyzeOne(nameB);
      setCardB(b);
      setProgress('');
    } catch (error) {
      setProgress(error instanceof Error ? error.message : 'خطا در تحلیل');
    } finally {
      setLoading(false);
    }
  }, [nameA, nameB, analyzeOne]);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <GitCompareArrows className="text-brand-700 dark:text-signal-400" />
        مقایسه دو محله
      </h3>

      {/* Input row */}
      <div className="grid gap-3 items-end lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div>
          <label className="block text-xs font-bold text-ink-500 dark:text-slate-400 mb-1">محله اول</label>
          <input
            type="text"
            value={nameA}
            onChange={e => setNameA(e.target.value)}
            placeholder="مثال: باغ فیض، تهران"
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink-900 outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:text-white"
          />
        </div>
        <button
          onClick={handleCompare}
          disabled={loading || !nameA.trim() || !nameB.trim()}
          className="flex items-center justify-center gap-2 rounded-xl bg-brand-800 px-5 py-2.5 text-sm font-black text-white transition disabled:opacity-40 dark:bg-signal-400 dark:text-wall-950"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <GitCompareArrows size={16} />}
          {loading ? progress || 'در حال مقایسه...' : 'مقایسه کن'}
        </button>
        <div>
          <label className="block text-xs font-bold text-ink-500 dark:text-slate-400 mb-1">محله دوم</label>
          <input
            type="text"
            value={nameB}
            onChange={e => setNameB(e.target.value)}
            placeholder="مثال: زعفرانیه، مشهد"
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink-900 outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:text-white"
          />
        </div>
      </div>

      {!loading && progress && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">{progress}</p>}
      {/* Results */}
      {cardA && cardB && (
        <ComparisonTable a={cardA} b={cardB} />
      )}

      {cardA && !cardB && !loading && (
        <div className="flex items-center gap-2 text-yellow-400 text-sm">
          <AlertTriangle size={16} />
          فقط محله اول تحلیل شد — محله دوم یافت نشد
        </div>
      )}
    </div>
  );
}

function ComparisonTable({ a, b }: { a: DecisionCard; b: DecisionCard }) {
  const bandColor = (score: number) => {
    const band = scoreToBand(score);
    return BAND_CONFIG[band].color;
  };
  const bandLabel = (score: number) => BAND_CONFIG[scoreToBand(score)].label;

  return (
    <div className="space-y-4">
      {/* Q T R comparison */}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { label: 'Q — کیفیت محقق‌شده', valA: a.qualityVerdict.Q, valB: b.qualityVerdict.Q },
          { label: 'T — توان تبدیل', valA: a.qualityVerdict.T, valB: b.qualityVerdict.T },
          { label: 'R — توان بازتولید', valA: a.qualityVerdict.R, valB: b.qualityVerdict.R },
        ].map(row => (
          <div key={row.label} className="rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800">
            <div className="text-xs text-gray-400 mb-2">{row.label}</div>
            <div className="flex items-center justify-between">
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: bandColor(row.valA) }}>{row.valA.toFixed(1)}</div>
                <div className="text-xs text-gray-500 truncate max-w-[100px]">{a.neighborhoodName}</div>
              </div>
              <div className="text-2xl text-gray-600">VS</div>
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: bandColor(row.valB) }}>{row.valB.toFixed(1)}</div>
                <div className="text-xs text-gray-500 truncate max-w-[100px]">{b.neighborhoodName}</div>
              </div>
            </div>
            <div className="flex justify-between mt-2 text-xs">
              <span className="text-gray-400">{bandLabel(row.valA)}</span>
              <span className="text-gray-400">{bandLabel(row.valB)}</span>
            </div>
            {/* Delta bar */}
            <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.max(5, (row.valA / (row.valA + row.valB)) * 100))}%`,
                  backgroundColor: bandColor(row.valA),
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Capital comparison table */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800">
        <h4 className="font-bold mb-3 text-sm">مقایسه هشت سرمایه</h4>
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-right py-2">سرمایه</th>
              <th className="text-center py-2">{a.neighborhoodName}</th>
              <th className="text-center py-2">{b.neighborhoodName}</th>
              <th className="text-center py-2">اختلاف</th>
            </tr>
          </thead>
          <tbody>
            {a.capitalScores.map((csA, i) => {
              const csB = b.capitalScores[i];
              const delta = csA.score - csB.score;
              return (
                <tr key={csA.capitalKey} className="border-b border-gray-700/50">
                  <td className="py-2 text-gray-300">{CAPITAL_FA[csA.capitalKey]}</td>
                  <td className="text-center" style={{ color: BAND_CONFIG[csA.band].color }}>
                    {csA.score.toFixed(1)}
                  </td>
                  <td className="text-center" style={{ color: BAND_CONFIG[csB.band].color }}>
                    {csB.score.toFixed(1)}
                  </td>
                  <td className={`text-center font-mono ${delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Diagnostic types */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800">
          <div className="text-xs text-gray-400 mb-1">تیپ تشخیصی</div>
          <div className="text-3xl font-bold text-brand-700 dark:text-signal-400">{a.diagnosticType}</div>
          <div className="text-xs text-gray-400 mt-1">{a.neighborhoodName}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800">
          <div className="text-xs text-gray-400 mb-1">تیپ تشخیصی</div>
          <div className="text-3xl font-bold text-brand-700 dark:text-signal-400">{b.diagnosticType}</div>
          <div className="text-xs text-gray-400 mt-1">{b.neighborhoodName}</div>
        </div>
      </div>
    </div>
  );
}
