import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, FileSpreadsheet, KeyRound, LayoutDashboard, Loader2, MapPin, RefreshCw, Sparkles, Landmark, UploadCloud } from 'lucide-react';
import { getCollectionStatus, loadQueue, saveQueue, submitSurveyResponses, type CollectionStatus } from '../../algorithm/dataCollectionApi';
import { LEVEL_FA, type DecisionCardV2 } from '../../algorithm/neighborhoodApi';
import CollectionOverview, { type HubTab } from './CollectionOverview';
import SurveyWizard from './SurveyWizard';
import BulkSurveyImport from './BulkSurveyImport';
import FieldAuditWizard from './FieldAuditWizard';
import LocalRegisterPanel from './LocalRegisterPanel';
import { Notice, ProgressRing, fa, ghostBtn, inputCls, primaryBtn } from './ui';

const TABS: Array<{ key: HubTab; label: string; icon: React.ReactNode; hint: string }> = [
  { key: 'overview', label: 'داشبورد گردآوری', icon: <LayoutDashboard size={15} />, hint: 'پیشرفت، کیفیت نمونه و شاخص‌های قابل گشودن' },
  { key: 'survey', label: 'پرسشنامهٔ ساکنان', icon: <ClipboardList size={15} />, hint: 'فرم مرحله‌ای مصاحبه یا خوداظهاری' },
  { key: 'bulk', label: 'ورود دسته‌ای', icon: <FileSpreadsheet size={15} />, hint: 'پرسشنامه‌های کاغذی / اکسل' },
  { key: 'audit', label: 'ممیزی میدانی', icon: <MapPin size={15} />, hint: 'چک‌لیست فضای عمومی P3' },
  { key: 'register', label: 'ثبت‌های محلی', icon: <Landmark size={15} />, hint: 'مسائل، فرایندها، پروژه‌ها و شبکهٔ نهادها' },
];

export default function DataCollectionHub({ card, onReanalyze, reanalyzing }: { card: DecisionCardV2 | null; onReanalyze: (neighborhoodId: string) => void; reanalyzing?: boolean }) {
  const [tab, setTab] = useState<HubTab>('overview');
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState(0);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState(() => { try { return localStorage.getItem('ara_api_token') ?? ''; } catch { return ''; } });
  const id = card?.neighborhood.neighborhoodId ?? null;

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try { setStatus(await getCollectionStatus(id)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'وضعیت گردآوری دریافت نشد'); }
    finally { setLoading(false); setQueue(loadQueue(id).length); }
  }, [id]);
  useEffect(() => { void refresh(); }, [refresh]);

  const flushQueue = async () => {
    if (!id) return;
    const list = loadQueue(id);
    if (!list.length) return;
    try { await submitSurveyResponses(id, list); saveQueue(id, []); setQueue(0); void refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'ارسال صف ناموفق بود'); }
  };

  if (!card || !id) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-10 text-center dark:border-wall-700">
        <ClipboardList size={36} className="mx-auto text-ink-300" />
        <p className="mt-3 text-sm font-black text-ink-700 dark:text-slate-200">ابتدا نام محله را در کادر بالای صفحه وارد و تحلیل کنید.</p>
        <p className="mt-1 text-xs text-ink-500">داده‌های پیمایشی به مرز نسخه‌دار همان محله متصل می‌شوند و در محاسبهٔ کارت تصمیم به کار می‌روند.</p>
      </div>
    );
  }

  const fresh = status ? {
    survey: Math.max(0, status.survey.nAccepted - (card.survey?.nAccepted ?? 0)),
    audit: Math.max(0, status.audit.points - (card.fieldAudit?.points ?? 0)),
    register: Math.max(0, status.register.records.length - (card.localRegister?.records ?? 0)),
  } : { survey: 0, audit: 0, register: 0 };
  const freshTotal = fresh.survey + fresh.audit + fresh.register;
  const level = LEVEL_FA[card.publication.level];

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-line bg-gradient-to-l from-brand-50 via-surface to-surface p-4 dark:border-wall-700 dark:from-wall-850 dark:via-wall-800 dark:to-wall-800 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <ProgressRing value={status?.plan.overall ?? 0} size={72} stroke={7} />
            <div>
              <p className="text-[10px] font-black text-brand-700 dark:text-signal-400">گردآوری دادهٔ پیمایشی و میدانی</p>
              <h3 className="mt-0.5 text-base font-black text-ink-900 dark:text-white">{card.neighborhood.nameFa} — {card.neighborhood.cityFa}</h3>
              <p className="mt-1 text-[11px] text-ink-500">
                سطح فعلی کارت: <strong>{level.label}</strong> · {fa(card.coverage.usable)} از {fa(card.coverage.total)} شاخص قابل‌استفاده
                {status && <> · {fa(status.plan.unlockable.length)} شاخص با همین ابزارها قابل تکمیل است</>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {queue > 0 && <button type="button" className={ghostBtn} onClick={() => void flushQueue()}><UploadCloud size={13} /> ارسال {fa(queue)} پاسخ در صف</button>}
            <button type="button" className={ghostBtn} onClick={() => void refresh()} disabled={loading}>{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} به‌روزرسانی</button>
            <button type="button" className={ghostBtn} onClick={() => setShowToken((v) => !v)} aria-expanded={showToken}><KeyRound size={13} /> توکن</button>
            <button type="button" className={`${primaryBtn} ${freshTotal ? 'animate-pulse' : ''}`} onClick={() => onReanalyze(id)} disabled={reanalyzing}>
              {reanalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              بازمحاسبهٔ تصمیم‌یار{freshTotal ? ` (${fa(freshTotal)} دادهٔ تازه)` : ''}
            </button>
          </div>
        </div>
        {showToken && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex-1 text-[11px] font-bold text-ink-600 dark:text-slate-300">توکن API با نقش «اپراتور» یا بالاتر (در محیط تولید برای ثبت داده لازم است)
              <input type="password" className={`${inputCls} mt-1`} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </label>
            <button type="button" className={primaryBtn} onClick={() => { try { if (token.trim()) localStorage.setItem('ara_api_token', token.trim()); else localStorage.removeItem('ara_api_token'); } catch { /* optional */ } setShowToken(false); }}>ذخیره در این مرورگر</button>
          </div>
        )}
        {freshTotal > 0 && (
          <p className="mt-3 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
            از آخرین تحلیل: {fresh.survey ? `${fa(fresh.survey)} پاسخ معتبر ` : ''}{fresh.audit ? `${fa(fresh.audit)} نقطهٔ ممیزی ` : ''}{fresh.register ? `${fa(fresh.register)} پرونده ` : ''}اضافه شده است؛ برای اثر در تشخیص و تجویز «بازمحاسبه» را بزنید.
          </p>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5" role="tablist" aria-label="ابزارهای گردآوری">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-2xl border p-3 text-right transition ${tab === t.key ? 'border-brand-800 bg-brand-800 text-white shadow-sm dark:border-signal-400 dark:bg-signal-400 dark:text-wall-950' : 'border-line bg-surface hover:border-brand-300 dark:border-wall-700 dark:bg-wall-800'}`}>
            <span className="flex items-center gap-2 text-xs font-black">{t.icon}{t.label}</span>
            <span className={`mt-1 block text-[10px] ${tab === t.key ? 'opacity-80' : 'text-ink-400'}`}>{t.hint}</span>
          </button>
        ))}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {!status && loading && <div className="flex items-center justify-center gap-2 py-10 text-xs text-ink-500"><Loader2 size={16} className="animate-spin" /> در حال دریافت وضعیت گردآوری…</div>}

      {status && tab === 'overview' && <CollectionOverview status={status} card={card} onOpen={setTab} />}
      {tab === 'survey' && <SurveyWizard neighborhoodId={id} neighborhoodName={card.neighborhood.nameFa} onSubmitted={() => void refresh()} onExit={() => setTab('overview')} />}
      {tab === 'bulk' && <BulkSurveyImport neighborhoodId={id} onSubmitted={() => void refresh()} />}
      {status && tab === 'audit' && <FieldAuditWizard neighborhoodId={id} centroid={card.neighborhood.centroid} summary={status.audit} onSubmitted={() => void refresh()} />}
      {status && tab === 'register' && <LocalRegisterPanel neighborhoodId={id} summary={status.register} onSubmitted={() => void refresh()} />}
    </div>
  );
}
