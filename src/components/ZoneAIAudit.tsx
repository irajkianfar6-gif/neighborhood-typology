// ============================================================
// بازبینی اعتبار گونه‌بندی با هوش مصنوعی (حکیم)
// خروجی قطعی الگوریتم (SI/لایه‌ها/حالت) همراه با دادهٔ واقعیِ
// استخراج‌شده به مدل فرستاده می‌شود و مدل با یک JSON ساخت‌یافته
// اعتبار نتیجه را بر پایهٔ الگوریتم مرجع و کاتالوگ مادر شاخص‌ها
// بازبینی می‌کند: رأی، استدلال مستند به اعداد، محرک‌های اصلی،
// خلأ داده، مداخلهٔ اصلاح‌شده و ریسک‌ها.
// ============================================================
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Sparkles,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Info,
  Bot,
  Scale,
  CircleAlert,
  FileText,
  Copy,
  Check,
  ListChecks,
} from 'lucide-react';
import type { CalibrationInfo, ZoneResult } from '../algorithm/types';
import type { FullExtract } from '../algorithm/liveExtract';
import type { PointIngest } from '../algorithm/ingest';
import { chatWithAIJSON } from '../lib/aiService';
import {
  buildAuditMessages,
  buildReportMessages,
  localAuditFallback,
  localReportFallback,
  ZoneAudit,
  ZoneReport,
} from '../lib/aiExplain';
import { getHakimGrounding } from '../lib/hakimGrounding';
import { getArchive, recordEvent } from '../lib/archiveDB';
import { toPersianDigits } from './AnimatedCounter';

interface Props {
  pointKey: string;
  zone: ZoneResult;
  samples: FullExtract | null;
  ingest: PointIngest | null;
  calibration?: CalibrationInfo | null;
}

function VerdictChip({ verdict }: { verdict: string }) {
  const v = String(verdict || '').toLowerCase();
  if (v === 'agree')
    return (
      <span className="flex items-center gap-1.5 text-[9px] font-black text-ok-700 bg-ok-soft border border-ok/30 rounded-full px-2.5 py-1">
        <CheckCircle2 size={11} /> تأیید شد
      </span>
    );
  if (v === 'disagree')
    return (
      <span className="flex items-center gap-1.5 text-[9px] font-black text-danger bg-danger-soft border border-danger/30 rounded-full px-2.5 py-1">
        <CircleAlert size={11} /> نیازمند بازبینی
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-[9px] font-black text-amber-700 bg-amber-50 border border-amber-300/60 rounded-full px-2.5 py-1">
      <AlertTriangle size={11} /> تأیید مشروط
    </span>
  );
}

export default function ZoneAIAudit({ pointKey, zone, samples, ingest, calibration }: Props) {
  const [audit, setAudit] = useState<ZoneAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mountedRef = useRef(true);

  // ── گزارش کارشناسی عملیاتی ──────────────────────────────
  const [report, setReport] = useState<ZoneReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLocal, setReportLocal] = useState(false);
  const [copied, setCopied] = useState(false);

  const runReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    setReportLocal(false);
    setCopied(false);
    try {
      const grounding = await getHakimGrounding();
      const { system, user } = buildReportMessages(zone, samples, ingest, audit, grounding, calibration);
      const data = await chatWithAIJSON<ZoneReport>(
        [{ role: 'user', content: user }],
        { system, maxTokens: 1600, timeoutMs: 150000 },
      );
      setReport({
        title: typeof data.title === 'string' && data.title.trim() ? data.title : `گزارش کارشناسی پهنهٔ ${zone.zone.name}`,
        executiveSummary: typeof data.executiveSummary === 'string' ? data.executiveSummary : '',
        currentSituation: typeof data.currentSituation === 'string' ? data.currentSituation : '',
        intervention: typeof data.intervention === 'string' ? data.intervention : '',
        actionSteps: Array.isArray(data.actionSteps) ? data.actionSteps.map(String) : [],
        kpis: Array.isArray(data.kpis) ? data.kpis.map(String) : [],
        risks: Array.isArray(data.risks) ? data.risks.map(String) : [],
        conclusion: typeof data.conclusion === 'string' ? data.conclusion : '',
      });
      // ثبت خودکار گزارش در خزانهٔ دادهٔ آرا
      void getArchive().then((a) =>
        a.put('analyses', {
          id: `report-${Date.now()}`,
          at: Date.now(),
          kind: 'report',
          zoneRef: zone.zone.id,
          zoneName: zone.zone.name,
          lat: zone.zone.lat,
          lng: zone.zone.lng,
          payload: data,
          local: false,
        }),
      );
      void recordEvent('report', 'تولید گزارش کارشناسی عملیاتی', `${zone.zone.name} — «${String(data.title ?? '').slice(0, 40)}»`, { refId: zone.zone.id, refType: 'zone' });
    } catch (e) {
      setReportLocal(true);
      setReport(localReportFallback(zone));
      setReportError(e instanceof Error ? e.message : 'خطای نامشخص');
    } finally {
      setReportLoading(false);
    }
  }, [zone, samples, ingest, audit, calibration]);

  const copyReport = useCallback(async () => {
    if (!report) return;
    const numbered = (arr: string[]) => arr.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const bullets = (arr: string[]) => arr.map((s) => `• ${s}`).join('\n');
    const text = [
      `📋 ${report.title}`,
      '',
      `خلاصهٔ اجرایی: ${report.executiveSummary}`,
      '',
      `وضعیت فعلی: ${report.currentSituation}`,
      '',
      `مداخلهٔ پیشنهادی: ${report.intervention}`,
      '',
      report.actionSteps.length ? `گام‌های اجرایی:\n${numbered(report.actionSteps)}` : '',
      report.kpis.length ? `KPIهای پایش:\n${bullets(report.kpis)}` : '',
      report.risks.length ? `ریسک‌ها و ملاحظات:\n${bullets(report.risks)}` : '',
      '',
      `جمع‌بندی: ${report.conclusion}`,
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
      // دسترسی به کلیپ‌بورد مسدود بود — بی‌صدا نادیده بگیر
    }
  }, [report]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIsLocal(false);

    const run = async () => {
      try {
        const grounding = await getHakimGrounding();
        const { system, user } = buildAuditMessages(zone, samples, ingest, grounding, calibration);
        const data = await chatWithAIJSON<ZoneAudit>(
          [{ role: 'user', content: user }],
          { system, maxTokens: 1600, timeoutMs: 150000 },
        );
        if (cancelled || !mountedRef.current) return;
        setAudit({
          verdict: data.verdict ?? 'conditional',
          aiConfidence: typeof data.aiConfidence === 'number' ? Math.min(1, Math.max(0, data.aiConfidence)) : 0.5,
          justification: Array.isArray(data.justification) ? data.justification.map(String) : [],
          topDrivers: Array.isArray(data.topDrivers) ? data.topDrivers : [],
          dataGaps: Array.isArray(data.dataGaps) ? data.dataGaps.map(String) : [],
          refinedIntervention: typeof data.refinedIntervention === 'string' ? data.refinedIntervention : '',
          risks: Array.isArray(data.risks) ? data.risks.map(String) : [],
        });
        // ثبت خودکار بازبینی در خزانهٔ دادهٔ آرا
        void getArchive().then((a) =>
          a.put('analyses', {
            id: `audit-${Date.now()}`,
            at: Date.now(),
            kind: 'audit',
            zoneRef: zone.zone.id,
            zoneName: zone.zone.name,
            lat: zone.zone.lat,
            lng: zone.zone.lng,
            payload: data,
            local: false,
          }),
        );
        void recordEvent('audit', 'بازبینی اعتبار گونه‌بندی', `${zone.zone.name} — رأی ${data.verdict ?? 'conditional'} · اطمینان ${Math.round((data.aiConfidence ?? 0) * 100)}٪`, { refId: zone.zone.id, refType: 'zone' });
      } catch (e) {
        if (cancelled || !mountedRef.current) return;
        setIsLocal(true);
        setAudit(localAuditFallback(zone, samples));
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
  }, [pointKey, zone, samples, ingest, attempt, calibration]);

  const confPct = Math.round((audit?.aiConfidence ?? 0) * 100);

  return (
    <div className="bg-surface border border-line rounded-2xl p-4 flex flex-col gap-3">
      {/* سربرگ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-xs font-black text-ink-800 flex items-center gap-1.5">
            <Sparkles size={14} className="text-brand-800" /> بازبینی اعتبار هوشمند گونه‌بندی
            <span className="text-[8.5px] font-black bg-gradient-to-l from-brand-900 to-brand-700 text-signal-400 rounded-full px-2 py-0.5">
              حکیم
            </span>
          </h2>
          <p className="text-[9.5px] text-ink-400 font-semibold mt-0.5">
            بازبینی رأی الگوریتم بر پایهٔ اعداد واقعی: {zone.zone.name} · {zone.zone.provinceFa} — حالت {toPersianDigits(zone.prescription.stateId)}
          </p>
        </div>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-[10px] font-black text-ink-600 hover:border-brand-300 hover:text-brand-800 transition-all cursor-pointer disabled:opacity-50"
          title="اجرای مجدد بازبینی"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> بازبینی دوباره
        </button>
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-2.5 py-8 animate-fade-in">
          <Bot size={24} className="text-brand-700 animate-pulse" />
          <p className="text-[10.5px] font-black text-ink-500">حکیم در حال بازبینی اعتبار نتیجه با دادهٔ استخراج‌شده است…</p>
          <p className="text-[8.5px] font-semibold text-ink-400">مقایسهٔ خروجی الگوریتم با {samples ? `${samples.samples.length} شاخص واقعی` : 'مشاهدات برخط'} · تحلیل استدلالی و مستند به اعداد</p>
        </div>
      )}

      {!loading && audit && (
        <div className="flex flex-col gap-3 animate-fade-in">
          {/* رأی + اطمینان */}
          <div className="flex flex-wrap items-center gap-2.5">
            <VerdictChip verdict={audit.verdict} />
            <div className="flex items-center gap-2 flex-1 min-w-[180px]">
              <Scale size={12} className="text-ink-400 shrink-0" />
              <div className="flex-1 h-1.5 rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${confPct}%`,
                    background: confPct >= 0.7 ? '#2E9E6B' : confPct >= 0.4 ? '#E3C028' : '#E5484D',
                  }}
                />
              </div>
              <span className="text-[9px] font-black text-ink-600 shrink-0">اطمینان مدل: ٪{toPersianDigits(confPct)}</span>
            </div>
            {isLocal && (
              <span className="flex items-center gap-1 text-[8.5px] font-bold text-amber-700 bg-amber-50 border border-amber-300/50 rounded-full px-2 py-1">
                <AlertTriangle size={10} /> سرویس برخط در دسترس نبود — بازبینی قطعی محلی
              </span>
            )}
          </div>

          {/* استدلال */}
          {audit.justification.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><ShieldCheck size={11} className="text-brand-700" /> استدلال بازبینی (مستند به اعداد)</span>
              <div className="flex flex-col gap-1">
                {audit.justification.map((j, i) => (
                  <div key={i} className="flex gap-1.5 text-[9.5px] font-semibold text-ink-600 leading-relaxed">
                    <span className="text-brand-700 mt-0.5 shrink-0">•</span>
                    <span>{j}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* محرک‌های اصلی */}
          {audit.topDrivers.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><Info size={11} className="text-teal-600" /> محرک‌های اصلی نتیجه</span>
              <div className="flex flex-wrap gap-1.5">
                {audit.topDrivers.map((d, i) => (
                  <span key={i} className="text-[8.5px] font-bold text-ink-600 bg-paper border border-line rounded-full px-2.5 py-1">
                    <span className="font-black text-brand-800">{d.indicator}</span>
                    {d.effect ? ` — ${d.effect}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* خلأ داده */}
          {audit.dataGaps.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><AlertTriangle size={11} className="text-amber-600" /> خلأهای داده‌ای مؤثر بر اعتماد</span>
              <div className="flex flex-wrap gap-1.5">
                {audit.dataGaps.map((g, i) => (
                  <span key={i} className="text-[8.5px] font-bold text-amber-700 bg-amber-50 border border-amber-300/50 rounded-full px-2.5 py-1">{g}</span>
                ))}
              </div>
            </div>
          )}

          {/* مداخلهٔ اصلاح‌شده */}
          {audit.refinedIntervention && (
            <div className="rounded-xl border border-ok/25 bg-ok-soft/50 p-3 flex flex-col gap-1">
              <span className="text-[9px] font-black text-ok-700 flex items-center gap-1"><CheckCircle2 size={11} /> مداخلهٔ اصلاح‌شده توسط حکیم</span>
              <p className="text-[9.5px] font-semibold text-ink-700 leading-relaxed">{audit.refinedIntervention}</p>
            </div>
          )}

          {/* ریسک‌ها */}
          {audit.risks.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><CircleAlert size={11} className="text-danger" /> ریسک‌ها و ملاحظات تفسیر</span>
              <div className="flex flex-wrap gap-1.5">
                {audit.risks.map((r, i) => (
                  <span key={i} className="text-[8.5px] font-bold text-danger-700 bg-danger-soft border border-danger/25 rounded-full px-2.5 py-1">{r}</span>
                ))}
              </div>
            </div>
          )}

          {error && !isLocal && (
            <p className="text-[8.5px] font-bold text-danger">{error}</p>
          )}

          <p className="text-[8.5px] font-semibold text-ink-400 border-t border-line pt-2.5">
            خروجی قطعی الگوریتم (آنتروپی+AHP) بدون تغییر حفظ می‌شود؛ این بازبینی جنبهٔ مشورتی دارد و برای مستندسازی تصمیم در پروندهٔ پهنه درج می‌شود.
          </p>
          {calibration && calibration.frozen && (
            <p className="flex items-center gap-1 text-[8px] font-bold text-teal-700 bg-teal-50/70 border border-teal-300/40 rounded-full px-2.5 py-1 w-fit" title="پیوست فنی — بخش ۱.۱ و ۲.۱: وزن‌های آنتروپی و بازه‌های Min–Max روی جمعیت مرجع محاسبه و منجمد می‌شوند و پهنهٔ نقطه فقط اعمال می‌شود">
              <ShieldCheck size={10} /> کالیبراسیون منجمد بر {toPersianDigits(calibration.cohortSize)} پهنهٔ مرجع — نقطه در محاسبهٔ وزن/بازه شرکت نکرده
            </p>
          )}
        </div>
      )}

      {/* ── گزارش کارشناسی عملیاتی (حکیم) ──────────────────── */}
      {!loading && (
        <div className="flex flex-col gap-3 border-t border-line pt-3 animate-fade-in">
          {!report ? (
            <button
              onClick={() => void runReport()}
              disabled={reportLoading}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-brand-800/25 bg-brand-50 px-3 py-2.5 text-[10px] font-black text-brand-800 hover:bg-brand-100 transition-all cursor-pointer disabled:opacity-60"
              title="حکیم یک گزارش کارشناسی عملیاتی کامل (خلاصه، وضعیت، گام‌ها، KPI، ریسک‌ها) برای درج در پروندهٔ پهنه تولید می‌کند"
            >
              {reportLoading ? (
                <>
                  <Bot size={13} className="animate-pulse" /> حکیم در حال نگارش گزارش کارشناسی است…
                </>
              ) : (
                <>
                  <FileText size={13} /> تولید گزارش کارشناسی عملیاتی (حکیم)
                </>
              )}
            </button>
          ) : (
            <div className="rounded-2xl border border-brand-800/20 bg-gradient-to-b from-brand-50/50 to-paper p-3.5 flex flex-col gap-2.5">
              {/* سربرگ گزارش */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[10.5px] font-black text-ink-800 flex items-center gap-1.5">
                  <FileText size={13} className="text-brand-800" /> گزارش کارشناسی عملیاتی
                  {reportLocal && (
                    <span className="text-[8px] font-bold text-amber-700 bg-amber-50 border border-amber-300/50 rounded-full px-1.5 py-0.5">مشورتی محلی</span>
                  )}
                </h3>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => void copyReport()}
                    disabled={reportLoading}
                    className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[9px] font-black text-ink-600 hover:border-brand-300 hover:text-brand-800 transition-all cursor-pointer disabled:opacity-50"
                    title="کپی متن کامل گزارش"
                  >
                    {copied ? <Check size={11} className="text-ok-700" /> : <Copy size={11} />} {copied ? 'کپی شد' : 'کپی گزارش'}
                  </button>
                  <button
                    onClick={() => void runReport()}
                    disabled={reportLoading}
                    className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[9px] font-black text-ink-600 hover:border-brand-300 hover:text-brand-800 transition-all cursor-pointer disabled:opacity-50"
                    title="تولید دوبارهٔ گزارش"
                  >
                    <RefreshCw size={11} className={reportLoading ? 'animate-spin' : ''} /> بازتولید
                  </button>
                </div>
              </div>

              {reportLoading && (
                <div className="flex items-center justify-center gap-2.5 py-5">
                  <Bot size={18} className="text-brand-700 animate-pulse" />
                  <p className="text-[9.5px] font-black text-ink-500">حکیم در حال نگارش گزارش کارشناسی با دادهٔ استخراج‌شده است…</p>
                </div>
              )}

              {!reportLoading && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10.5px] font-black text-brand-900 leading-relaxed">{report.title}</p>
                  <ReportBlock icon={<Sparkles size={11} className="text-brand-700 shrink-0" />} label="خلاصهٔ اجرایی" text={report.executiveSummary} />
                  <ReportBlock icon={<Info size={11} className="text-teal-600 shrink-0" />} label="وضعیت فعلی" text={report.currentSituation} />
                  <ReportBlock icon={<CheckCircle2 size={11} className="text-ok-700 shrink-0" />} label="مداخلهٔ پیشنهادی" text={report.intervention} />
                  {report.actionSteps.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-black text-ink-600 flex items-center gap-1">
                        <ListChecks size={11} className="text-brand-700 shrink-0" /> گام‌های اجرایی
                      </span>
                      <ol className="flex flex-col gap-1 pr-4 list-decimal [&>li]:pl-1">
                        {report.actionSteps.map((s, i) => (
                          <li key={i} className="text-[9.5px] font-semibold text-ink-600 leading-relaxed">{s}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {report.kpis.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-black text-ink-600 flex items-center gap-1">
                        <CheckCircle2 size={11} className="text-ok-700 shrink-0" /> KPIهای پایش
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {report.kpis.map((k, i) => (
                          <span key={i} className="text-[8.5px] font-bold text-ink-700 bg-ok-soft border border-ok/30 rounded-full px-2.5 py-1">{k}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {report.risks.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-black text-ink-600 flex items-center gap-1">
                        <AlertTriangle size={11} className="text-amber-600 shrink-0" /> ریسک‌ها و ملاحظات
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {report.risks.map((r, i) => (
                          <span key={i} className="text-[8.5px] font-bold text-danger-700 bg-danger-soft border border-danger/25 rounded-full px-2.5 py-1">{r}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <ReportBlock icon={<ShieldCheck size={11} className="text-ok-700 shrink-0" />} label="جمع‌بندی" text={report.conclusion} />
                  {reportError && !reportLocal && <p className="text-[8.5px] font-bold text-danger">{reportError}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReportBlock({ icon, label, text }: { icon: ReactNode; label: string; text: string }) {
  if (!text || !text.trim()) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-black text-ink-600 flex items-center gap-1">{icon} {label}</span>
      <p className="text-[9.5px] font-semibold text-ink-700 leading-relaxed">{text}</p>
    </div>
  );
}
