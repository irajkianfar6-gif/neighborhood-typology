import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, BookOpen, Brain,
  CheckCircle2, ChevronDown, Clock3, Database, Download, FileText,
  GitCompareArrows, Globe, Layers, Lightbulb, Loader2, MapPin,
  MessageCircle, RefreshCw, Scale, Settings, Shield, Sparkles,
  Target, TrendingDown, TrendingUp, Wifi, WifiOff, XCircle, Zap,
} from 'lucide-react';
import type { DecisionCard, LivingMemoryEntry, StatusBand } from '../algorithm/types';
import { BAND_CONFIG, CAPITALS, CAPITAL_FA, CHAIN_FA, CHAIN_STAGES, DIAGNOSTIC_TYPES } from '../algorithm/types';
import { scoreToBand } from '../algorithm/statusBands';
import CapitalRadarChart from './CapitalRadarChart';
import GapAnalysisChart from './GapAnalysisChart';
import EquityMap from './EquityMap';
import CausalChainViz from './CausalChainViz';
import InterventionMatrix from './InterventionMatrix';
import BottleneckMap from './BottleneckMap';
import LearningDashboard from './LearningDashboard';
import PerceptualSurveyForm from './PerceptualSurveyForm';
import AIDecisionAdvisor from './AIDecisionAdvisor';
import NeighborhoodComparison from './NeighborhoodComparison';
import DecisionRegistryView from './DecisionRegistryView';
import { downloadReport, downloadReportJSON } from '../algorithm/reportGenerator';
import { analyzeDecisionSupport } from '../algorithm/decisionSupportApi';
import type { SurveyResponse } from '../algorithm/perceptualSurvey';
import { fetchOpenMeteoAirQuality, type RealDataSource } from '../algorithm/realDataConnectors';
import { analyzeNeighborhoodByName, LEVEL_FA, type DecisionCardV2, type NeighborhoodCandidate } from '../algorithm/neighborhoodApi';
import NeighborhoodEvidencePanel, { CandidatePicker } from './NeighborhoodEvidencePanel';
import { getSatelliteFeatures, getSatelliteStatusSummary, type SatelliteFeatureRecord, type SatelliteStatusSummary } from '../lib/satelliteApi';

type SectionKey = 'summary' | 'diagnosis' | 'action' | 'evidence';
type ViewKey =
  | 'overview' | 'radar' | 'chain' | 'gaps' | 'equity' | 'bottleneck' | 'causes'
  | 'interventions' | 'priority' | 'evaluation'
  | 'learning' | 'ai' | 'data' | 'survey' | 'compare' | 'registry';

interface NavigationItem {
  key: ViewKey;
  label: string;
  icon: React.ReactNode;
  requiresAnalysis?: boolean;
}

type DisplayDataSource = Pick<RealDataSource, 'name' | 'baseUrl' | 'latencyMs' | 'cache' | 'error' | 'lastFetched' | 'provider'> & {
  status: RealDataSource['status'] | 'standby';
};

const NAVIGATION: Record<SectionKey, { label: string; description: string; icon: React.ReactNode; items: NavigationItem[] }> = {
  summary: {
    label: 'خلاصه تصمیم',
    description: 'حکم، گلوگاه و اقدام اول',
    icon: <BarChart3 size={18} />,
    items: [{ key: 'overview', label: 'نمای مدیریتی', icon: <BarChart3 size={15} />, requiresAnalysis: true }],
  },
  diagnosis: {
    label: 'تشخیص محله',
    description: 'سرمایه‌ها، شکاف‌ها و علت‌ها',
    icon: <Target size={18} />,
    items: [
      { key: 'radar', label: 'پروفایل سرمایه‌ها', icon: <Target size={15} />, requiresAnalysis: true },
      { key: 'chain', label: 'زنجیره C-A-U-E-O', icon: <Layers size={15} />, requiresAnalysis: true },
      { key: 'gaps', label: 'ناترازی', icon: <AlertTriangle size={15} />, requiresAnalysis: true },
      { key: 'equity', label: 'عدالت', icon: <Scale size={15} />, requiresAnalysis: true },
      { key: 'bottleneck', label: 'گلوگاه', icon: <MapPin size={15} />, requiresAnalysis: true },
      { key: 'causes', label: 'نقشه علت', icon: <Lightbulb size={15} />, requiresAnalysis: true },
    ],
  },
  action: {
    label: 'برنامه اقدام',
    description: 'مداخله، اولویت و ارزیابی',
    icon: <Shield size={18} />,
    items: [
      { key: 'interventions', label: 'سبد مداخله', icon: <Shield size={15} />, requiresAnalysis: true },
      { key: 'priority', label: 'اولویت اقدامات', icon: <TrendingUp size={15} />, requiresAnalysis: true },
      { key: 'evaluation', label: 'طرح ارزیابی', icon: <Settings size={15} />, requiresAnalysis: true },
    ],
  },
  evidence: {
    label: 'شواهد و یادگیری',
    description: 'داده، مقایسه و ابزارهای تکمیلی',
    icon: <Database size={18} />,
    items: [
      { key: 'data', label: 'منابع داده', icon: <Database size={15} /> },
      { key: 'registry', label: 'رجیستر ۱۶۴ شاخصی', icon: <Database size={15} /> },
      { key: 'survey', label: 'پیمایش ادراکی', icon: <Globe size={15} /> },
      { key: 'compare', label: 'مقایسه محله‌ها', icon: <GitCompareArrows size={15} /> },
      { key: 'learning', label: 'حافظه یادگیری', icon: <BookOpen size={15} /> },
      { key: 'ai', label: 'مشاور هوشمند', icon: <MessageCircle size={15} /> },
    ],
  },
};

const SECTION_ORDER: SectionKey[] = ['summary', 'diagnosis', 'action', 'evidence'];
const SAMPLE_NEIGHBORHOODS = ['باغ فیض، تهران', 'زعفرانیه، مشهد', 'گوهردشت، کرج'];
const TOTAL_DATA_SOURCES = 9;

const STATUS_TONES: Record<StatusBand, { color: string; soft: string; border: string }> = {
  CRITICAL: { color: '#D63B42', soft: 'rgba(229, 72, 77, 0.10)', border: 'rgba(229, 72, 77, 0.22)' },
  WEAK: { color: '#C97308', soft: 'rgba(232, 147, 12, 0.11)', border: 'rgba(232, 147, 12, 0.24)' },
  MODERATE: { color: '#9B7A08', soft: 'rgba(212, 188, 114, 0.15)', border: 'rgba(201, 162, 39, 0.24)' },
  GOOD: { color: '#16845F', soft: 'rgba(16, 185, 129, 0.10)', border: 'rgba(16, 185, 129, 0.22)' },
  EXCELLENT: { color: '#147A72', soft: 'rgba(13, 148, 136, 0.10)', border: 'rgba(13, 148, 136, 0.22)' },
};

interface Props {
  card?: DecisionCard | null;
  loading?: boolean;
}

export default function DecisionSupportPage({ card: initialCard, loading: initialLoading }: Props) {
  const [section, setSection] = useState<SectionKey>('summary');
  const [activeView, setActiveView] = useState<ViewKey>('overview');
  const [neighborhoodName, setNeighborhoodName] = useState(() => {
    if (initialCard?.neighborhoodName) return initialCard.neighborhoodName;
    try {
      return localStorage.getItem('ara_neighborhood_name') ?? '';
    } catch {
      return '';
    }
  });
  const [card, setCard] = useState<DecisionCard | null>(initialCard ?? null);
  const [loading, setLoading] = useState(Boolean(initialLoading));
  const [dataSourceStatus, setDataSourceStatus] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(initialCard ? new Date() : null);
  const [memoryEntries, setMemoryEntries] = useState<LivingMemoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('decision-support-memory');
      return saved ? JSON.parse(saved) as LivingMemoryEntry[] : [];
    } catch {
      return [];
    }
  });
  const [rawData, setRawData] = useState<Record<string, unknown> | null>(null);
  const [sourceStatuses, setSourceStatuses] = useState<RealDataSource[]>([]);
  const [lastCoords, setLastCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [v2Card, setV2Card] = useState<DecisionCardV2 | null>(null);
  const [pendingChoice, setPendingChoice] = useState<{ query: string; candidates: NeighborhoodCandidate[] } | null>(null);
  const [typeAbstained, setTypeAbstained] = useState(false);
  const [fetchProgress, setFetchProgress] = useState(0);
  const [surveyResponses, setSurveyResponses] = useState<SurveyResponse[]>([]);
  const [surveySavedNotice, setSurveySavedNotice] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (initialCard) {
      setCard(initialCard);
      setNeighborhoodName(initialCard.neighborhoodName);
      setLastUpdated(new Date());
    }
  }, [initialCard]);

  useEffect(() => {
    if (initialLoading !== undefined) setLoading(initialLoading);
  }, [initialLoading]);

  const handleAnalyze = useCallback(async (neighborhoodId?: string) => {
    const requestedName = neighborhoodName.trim();
    if ((!requestedName && !neighborhoodId) || loading) return;

    setLoading(true);
    setAnalysisError(null);
    setDetailsOpen(false);
    setDataSourceStatus([]);
    setSourceStatuses([]);
    setRawData(null);
    setFetchProgress(0);
    setSection('summary');
    setActiveView('overview');

    try {
      setPendingChoice(null);
      setV2Card(null);
      setDataSourceStatus(['شناسایی محله در گزتیر (مرز نسخه‌دار) آغاز شد']);
      setFetchProgress(10);
      const response = await analyzeNeighborhoodByName({
        name: neighborhoodId ? undefined : requestedName,
        neighborhoodId,
        purpose: 'baseline',
      });
      if (response.status === 'NEEDS_DISAMBIGUATION') {
        setPendingChoice({ query: response.query, candidates: response.candidates });
        setDataSourceStatus(prev => [...prev, `${response.candidates.length.toLocaleString('fa-IR')} محلهٔ هم‌نام یافت شد؛ انتخاب کاربر لازم است`]);
        setFetchProgress(0);
        return;
      }
      const v2 = response.card;
      setV2Card(v2);
      setLastCoords(v2.neighborhood.centroid);
      setFetchProgress(80);
      const scoredIndicators = v2.indicators.filter(item => item.score !== null);
      const sourceMap = new Map<string, RealDataSource>();
      for (const item of scoredIndicators) {
        const key = item.source.split(' — ')[0];
        if (!sourceMap.has(key)) sourceMap.set(key, { name: key, baseUrl: item.channel, status: item.reliability >= 0.6 ? 'online' : 'degraded', lastFetched: item.observedAt ?? undefined });
      }
      const srcs = [...sourceMap.values()];
      setSourceStatuses(srcs);
      const availableCount = srcs.length;
      setRawData({ neighborhood: v2.neighborhood, context: v2.context, coverage: v2.coverage, indicators: scoredIndicators.map(item => ({ code: item.code, raw: item.raw, unit: item.unit, score: item.score, reliability: item.reliability, tier: item.tier, source: item.source })) });
      setDataSourceStatus(prev => [
        ...prev,
        `محله: ${v2.neighborhood.nameFa} (${v2.neighborhood.cityFa}) — مرز ${v2.neighborhood.boundaryIsProxy ? 'تقریبی' : v2.neighborhood.boundaryTier}`,
        `${scoredIndicators.length.toLocaleString('fa-IR')} از ${v2.indicators.length.toLocaleString('fa-IR')} شاخص با منبع مستند امتیاز گرفت`,
        `سطح انتشار: ${LEVEL_FA[v2.publication.level].label}`,
      ]);
      if (!response.engineCard) {
        setCard(null);
        throw new Error(`شواهد برای اجرای موتور تصمیم کافی نیست (${LEVEL_FA[v2.publication.level].label}). فهرست «چه داده‌ای این حکم را تغییر می‌دهد» را در پنل شواهد ببینید.`);
      }
      const result = { card: response.engineCard };
      setTypeAbstained(v2.engine?.diagnosticType === null);

      setCard(result.card);
      setLastUpdated(new Date());
      setFetchProgress(100);
      setDataSourceStatus(prev => [...prev, 'تحلیل تکمیل شد؛ بخش‌های فاقد شواهد کافی با امتناع صریح علامت خورده‌اند']);

      const entry: LivingMemoryEntry = {
        id: `analysis-${Date.now()}`,
        capitalKey: result.card.bottleneck.capital,
        trigger: `تحلیل محله ${requestedName}`,
        outcome: 'success',
        rule: `${availableCount} منبع واقعی | Q=${result.card.qualityVerdict.Q.toFixed(1)} | تیپ ${result.card.diagnosticType} | ${CAPITAL_FA[result.card.bottleneck.capital]}(${CHAIN_FA[result.card.bottleneck.transition[0]]}→${CHAIN_FA[result.card.bottleneck.transition[1]]}) | ${result.card.bottleneck.location}`,
        evidence: result.card.finalStatement,
        dateRecorded: new Date().toISOString(),
        applicationCount: 0,
      };
      setMemoryEntries(prev => [...prev, entry]);
      try {
        localStorage.setItem('ara_neighborhood_name', requestedName);
      } catch {
        // Storage is optional.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'خطای ناشناخته در تحلیل';
      setAnalysisError(message);
      setDetailsOpen(true);
      setDataSourceStatus(prev => [...prev, `تحلیل متوقف شد: ${message}`]);
    } finally {
      setLoading(false);
    }
  }, [loading, neighborhoodName]);

  useEffect(() => {
    if (!lastCoords || !card) return;
    const interval = window.setInterval(async () => {
      try {
        const freshAir = await fetchOpenMeteoAirQuality(lastCoords.lat, lastCoords.lng);
        if (freshAir) {
          setDataSourceStatus(prev => [...prev.slice(-7), `کیفیت هوا به‌روزرسانی شد: PM2.5 = ${freshAir.pm25}`]);
          setLastUpdated(new Date());
        }
      } catch {
        // Background refresh must not interrupt the user.
      }
    }, 300000);
    return () => window.clearInterval(interval);
  }, [lastCoords, card]);

  useEffect(() => {
    try {
      localStorage.setItem('decision-support-memory', JSON.stringify(memoryEntries));
    } catch {
      // Storage is optional.
    }
  }, [memoryEntries]);

  const handleSurveyComplete = useCallback((responses: SurveyResponse[]) => {
    setSurveyResponses(responses);
    setSurveySavedNotice(true);
    try {
      localStorage.setItem('decision-support-survey', JSON.stringify(responses));
    } catch {
      // Storage is optional.
    }
  }, []);

  const currentNavigation = NAVIGATION[section];
  const activeItem = useMemo(
    () => currentNavigation.items.find(item => item.key === activeView) ?? currentNavigation.items[0],
    [activeView, currentNavigation],
  );
  const onlineSources = sourceStatuses.filter(source => source.status === 'online').length;
  const degradedSources = sourceStatuses.filter(source => source.status === 'degraded').length;
  const confidence = sourceStatuses.length === 0
    ? null
    : Math.round((sourceStatuses.reduce((score, source) => score + (source.status === 'online' ? 1 : source.status === 'degraded' ? 0.75 : 0), 0) / sourceStatuses.length) * 100);
  const sourceCoverageHealthy = confidence === null || confidence >= 75;
  const sourceConnectionLabel = sourceStatuses.length === 0
    ? `${TOTAL_DATA_SOURCES.toLocaleString('fa-IR')} منبع آماده گردآوری`
    : `${onlineSources.toLocaleString('fa-IR')} برخط${degradedSources ? ` · ${degradedSources.toLocaleString('fa-IR')} ناپایدار` : ''}`;
  const loadingStep = getLoadingStep(fetchProgress);

  const changeSection = (nextSection: SectionKey, nextView = NAVIGATION[nextSection].items[0].key) => {
    setSection(nextSection);
    setActiveView(nextView);
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, item: NavigationItem) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const enabledItems = currentNavigation.items.filter(candidate => !(candidate.requiresAnalysis && !card));
    const currentIndex = enabledItems.findIndex(candidate => candidate.key === item.key);
    if (currentIndex < 0) return;

    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = enabledItems.length - 1;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex + 1) % enabledItems.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex - 1 + enabledItems.length) % enabledItems.length;

    const nextItem = enabledItems[nextIndex];
    setActiveView(nextItem.key);
    window.requestAnimationFrame(() => document.getElementById(`decision-tab-${nextItem.key}`)?.focus());
  };

  return (
    <div className="w-full min-w-0 space-y-5 text-ink-800 dark:text-slate-100" dir="rtl">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="icon-tile size-11 rounded-2xl">
              <Brain size={22} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-black text-ink-900 dark:text-white md:text-2xl">تصمیم‌یار جامع محله</h1>
              <p className="mt-1 text-xs font-medium text-ink-500 dark:text-slate-400 md:text-sm">
                از داده محله تا تشخیص گلوگاه و انتخاب اقدام اولویت‌دار
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-ink-400 dark:text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ok" />پرونده تصمیم‌محور</span>
            <span className="hidden size-1 rounded-full bg-line-strong sm:inline-block" />
            <span>نسخه تحلیل ۱.۰</span>
            {card && <><span className="hidden size-1 rounded-full bg-line-strong sm:inline-block" /><span>محله: {card.neighborhoodName}</span></>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-extrabold">
          <span className={`chip border ${sourceCoverageHealthy ? 'border-ok/30 bg-ok-soft text-ok-700 dark:border-ok/20 dark:bg-ok/10 dark:text-ok' : 'border-warn/30 bg-warn-soft text-warn-700 dark:border-warn/20 dark:bg-warn/10 dark:text-warn'}`} aria-label={`وضعیت منابع داده: ${sourceConnectionLabel}`}>
            {sourceStatuses.length === 0 ? <Database size={11} aria-hidden="true" /> : sourceCoverageHealthy ? <span className="live-dot" aria-hidden="true" /> : <AlertTriangle size={11} aria-hidden="true" />}
            {sourceConnectionLabel}
          </span>
          {lastUpdated && (
            <span className="chip border border-line bg-surface text-ink-500 dark:border-wall-700 dark:bg-wall-800 dark:text-slate-400">
              <Clock3 size={12} aria-hidden="true" />
              آخرین تحلیل: {lastUpdated.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {card && card.trend.direction !== 'first_run' && (
            <span className={`chip border ${card.trend.direction === 'up' ? 'border-ok/30 bg-ok-soft text-ok-700 dark:border-ok/20 dark:bg-ok/10 dark:text-ok' : card.trend.direction === 'down' ? 'border-danger/30 bg-danger-soft text-danger-700 dark:border-danger/20 dark:bg-danger/10 dark:text-red-300' : 'border-line bg-surface text-ink-500 dark:border-wall-700 dark:bg-wall-800 dark:text-slate-400'}`}>
              {card.trend.direction === 'up' ? <TrendingUp size={12} aria-hidden="true" /> : card.trend.direction === 'down' ? <TrendingDown size={12} aria-hidden="true" /> : null}
              روند Q: {card.trend.deltaQ > 0 ? '+' : ''}{card.trend.deltaQ.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}
            </span>
          )}
          {card?.surveyEvidence?.integrated && (
            <span className="chip border border-info/20 bg-info-soft text-info-700 dark:bg-info/10 dark:text-teal-200">
              <Globe size={12} aria-hidden="true" />
              پیمایش ادغام‌شده ({card.surveyEvidence.questionsAnswered.toLocaleString('fa-IR')} پاسخ)
            </span>
          )}
        </div>
      </header>

      <section className="panel-card overflow-hidden" aria-labelledby="analysis-start-title">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="p-4 md:p-5">
            <div className="mb-3 flex items-center gap-2">
              <MapPin size={17} className="text-brand-700 dark:text-signal-400" aria-hidden="true" />
              <h2 id="analysis-start-title" className="text-sm font-black text-ink-900 dark:text-white">محله مورد بررسی</h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor="neighborhood-name" className="mb-1.5 block text-xs font-bold text-ink-500 dark:text-slate-400">
                  نام محله و شهر
                </label>
                <input
                  id="neighborhood-name"
                  type="text"
                  value={neighborhoodName}
                  onChange={event => setNeighborhoodName(event.target.value)}
                  onKeyDown={event => event.key === 'Enter' && void handleAnalyze()}
                  placeholder="مثال: باغ فیض، تهران"
                  aria-describedby="neighborhood-help"
                  className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink-900 outline-none transition placeholder:text-ink-300 focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:text-white dark:placeholder:text-slate-600 dark:focus-visible:border-signal-400 dark:focus-visible:ring-signal-400/10"
                />
                <p id="neighborhood-help" className="mt-1.5 text-[10px] text-ink-400 dark:text-slate-500">
                  برای دقت مکان‌یابی، نام شهر را نیز وارد کنید.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleAnalyze()}
                disabled={loading || !neighborhoodName.trim()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-brand-800 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/25 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-signal-400 dark:text-wall-950 dark:hover:bg-signal-300"
              >
                {loading ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
                {loading ? 'در حال تحلیل' : card ? 'تحلیل دوباره' : 'شروع تحلیل'}
              </button>
              {lastCoords && !loading && (
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-xs font-black text-brand-800 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:text-signal-400 dark:hover:bg-wall-700"
                  aria-label="به‌روزرسانی داده‌های تحلیل"
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  <span className="sm:hidden xl:inline">به‌روزرسانی</span>
                </button>
              )}
            </div>
            {!card && !loading && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold text-ink-400 dark:text-slate-500">نمونه سریع:</span>
                {SAMPLE_NEIGHBORHOODS.map(sample => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setNeighborhoodName(sample)}
                    className="rounded-full border border-line bg-paper px-2.5 py-1 text-[10px] font-bold text-ink-500 transition hover:border-brand-300 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-800/20 dark:border-wall-700 dark:bg-wall-850 dark:text-slate-400 dark:hover:text-signal-400"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-line bg-brand-50/60 p-4 dark:border-wall-700 dark:bg-wall-850/70 lg:border-r lg:border-t-0">
            {card ? (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-black text-brand-900 dark:text-signal-400">{loading ? 'بازآفرینی پرونده' : 'پرونده فعال'}</p>
                  <span className={`size-2 rounded-full ${loading ? 'animate-pulse bg-warn' : 'bg-ok'}`} aria-hidden="true" />
                </div>
                <p className="mt-2 truncate text-sm font-black text-ink-900 dark:text-white">{card.neighborhoodName}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(['Q', 'T', 'R'] as const).map(key => (
                    <span key={key} className="rounded-lg border border-line bg-white/80 px-2 py-1 text-[9px] font-black text-ink-600 dark:border-wall-700 dark:bg-wall-800 dark:text-slate-300">
                      {key} {card.qualityVerdict[key].toLocaleString('fa-IR', { maximumFractionDigits: 1 })}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-[10px] font-semibold leading-5 text-ink-500 dark:text-slate-400">{sourceConnectionLabel}</p>
              </div>
            ) : (
              <>
                <p className="text-xs font-black text-brand-900 dark:text-signal-400">خروجی این تحلیل</p>
                <ul className="mt-2 space-y-1.5 text-[11px] font-semibold text-ink-500 dark:text-slate-400">
                  <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-ok" /> حکم کیفیت و سه امتیاز Q/T/R</li>
                  <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-ok" /> نشانی پنج‌بعدی گلوگاه</li>
                  <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-ok" /> سبد اقدام و طرح ارزیابی</li>
                </ul>
              </>
            )}
          </div>
        </div>
      </section>

      {loading && (
        <AnalysisProgress progress={fetchProgress} step={loadingStep} />
      )}

      {pendingChoice && (
        <CandidatePicker
          query={pendingChoice.query}
          candidates={pendingChoice.candidates}
          onPick={candidate => { setNeighborhoodName(`${candidate.nameFa}، ${candidate.cityFa}`); void handleAnalyze(candidate.neighborhoodId); }}
        />
      )}

      {v2Card && <NeighborhoodEvidencePanel card={v2Card} />}

      {analysisError && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-danger-700 dark:bg-danger/10 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <XCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-black">تحلیل کامل نشد</p>
              <p className="mt-1 text-xs">{analysisError}</p>
            </div>
          </div>
          <button type="button" onClick={() => void handleAnalyze()} className="rounded-xl border border-danger/30 px-3 py-2 text-xs font-black focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-danger/15">
            تلاش دوباره
          </button>
        </div>
      )}

      {dataSourceStatus.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface dark:border-wall-700 dark:bg-wall-900/80">
          <button
            type="button"
            onClick={() => setDetailsOpen(open => !open)}
            aria-expanded={detailsOpen}
            aria-controls="analysis-technical-details"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand-800/10"
          >
            <span className="flex min-w-0 items-center gap-2 text-xs font-black text-ink-700 dark:text-slate-200">
              <Database size={15} className="text-brand-700 dark:text-signal-400" aria-hidden="true" />
              جزئیات دریافت داده
              <span className="chip bg-paper text-ink-400 dark:bg-wall-800 dark:text-slate-500">{dataSourceStatus.length} رویداد</span>
            </span>
            <ChevronDown size={16} className={`shrink-0 text-ink-400 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {detailsOpen && (
            <div id="analysis-technical-details" className="border-t border-line px-4 py-3 dark:border-wall-700">
              <ol className="space-y-2">
                {dataSourceStatus.map((status, index) => (
                  <li key={`${status}-${index}`} className="flex items-start gap-2 text-[11px] font-medium text-ink-500 dark:text-slate-400">
                    {status.includes('متوقف') ? <XCircle size={13} className="mt-0.5 shrink-0 text-danger" /> :
                      status.includes('نیافت') ? <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" /> :
                      index === dataSourceStatus.length - 1 && !loading ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" /> :
                      <Activity size={13} className="mt-0.5 shrink-0 text-info" />}
                    <span>{status}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {!card && !loading ? (
        <EmptyWorkspace
          recentEntries={memoryEntries.slice(-3).reverse()}
          onSelectRecent={name => setNeighborhoodName(name)}
          onOpenEvidence={() => changeSection('evidence')}
        />
      ) : (
        <>
          <section ref={workspaceRef} aria-label="مسیر تصمیم" className="decision-journey panel-card p-3 md:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black text-brand-700 dark:text-signal-400">مسیر تصمیم</p>
                <p className="mt-1 text-[11px] font-semibold text-ink-500 dark:text-slate-400">از خواندن حکم تا انتخاب اقدام قابل سنجش پیش بروید.</p>
              </div>
              <span className="chip border border-line bg-paper text-ink-500 dark:border-wall-700 dark:bg-wall-850 dark:text-slate-400">
                گام {SECTION_ORDER.indexOf(section) + 1} از {SECTION_ORDER.length}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {SECTION_ORDER.map((sectionKey, index) => {
                const nav = NAVIGATION[sectionKey];
                const selected = sectionKey === section;
                const locked = sectionKey !== 'evidence' && !card;
                return (
                  <button
                    key={sectionKey}
                    type="button"
                    onClick={() => changeSection(sectionKey)}
                    disabled={locked}
                    aria-current={selected ? 'step' : undefined}
                    className={`group relative min-w-0 rounded-xl border px-2 py-2.5 text-right transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/15 disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'border-brand-300 bg-brand-50 dark:border-signal-400/30 dark:bg-wall-800' : 'border-line bg-surface hover:border-brand-200 hover:bg-brand-50/50 dark:border-wall-700 dark:bg-wall-900 dark:hover:bg-wall-800'}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`flex size-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${selected ? 'bg-brand-800 text-white dark:bg-signal-400 dark:text-wall-950' : index < SECTION_ORDER.indexOf(section) ? 'bg-ok-soft text-ok-700 dark:bg-ok/10 dark:text-ok' : 'bg-paper text-ink-400 dark:bg-wall-800 dark:text-slate-500'}`}>
                        {index < SECTION_ORDER.indexOf(section) ? <CheckCircle2 size={13} /> : index + 1}
                      </span>
                      <span className={`truncate text-[10px] font-black sm:text-[11px] ${selected ? 'text-brand-900 dark:text-signal-400' : 'text-ink-500 dark:text-slate-400'}`}>{nav.label}</span>
                    </span>
                    <span className="mt-1 hidden truncate pr-8 text-[9px] font-semibold text-ink-400 dark:text-slate-500 md:block">{nav.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel-card min-w-0 overflow-hidden">
            <div className="border-b border-line px-3 pt-3 dark:border-wall-700 md:px-5 md:pt-4">
              <div role="tablist" aria-label={currentNavigation.label} className="flex gap-1.5 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {currentNavigation.items.map(item => {
                  const selected = item.key === activeView;
                  const disabled = Boolean(item.requiresAnalysis && !card);
                  return (
                    <button
                      key={item.key}
                      id={`decision-tab-${item.key}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`decision-panel-${item.key}`}
                      tabIndex={selected ? 0 : -1}
                      disabled={disabled}
                      onClick={() => setActiveView(item.key)}
                      onKeyDown={event => handleTabKeyDown(event, item)}
                      className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/15 disabled:cursor-not-allowed disabled:opacity-40 ${
                        selected
                          ? 'bg-brand-800 text-white shadow-sm dark:bg-signal-400 dark:text-wall-950'
                          : 'bg-paper text-ink-500 hover:bg-brand-50 hover:text-brand-800 dark:bg-wall-800 dark:text-slate-400 dark:hover:bg-wall-700 dark:hover:text-signal-400'
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              key={activeItem.key}
              id={`decision-panel-${activeItem.key}`}
              role="tabpanel"
              aria-labelledby={`decision-tab-${activeItem.key}`}
              tabIndex={0}
              className="decision-view-enter min-w-0 p-4 focus-visible:outline-none md:p-6"
            >
              <DecisionView
                activeView={activeView}
                card={card}
                typeAbstained={typeAbstained}
                rawData={rawData}
                sourceStatuses={sourceStatuses}
                memoryEntries={memoryEntries}
                setMemoryEntries={setMemoryEntries}
                confidence={confidence}
                lastUpdated={lastUpdated}
                onNavigate={changeSection}
                onSurveyComplete={handleSurveyComplete}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function AnalysisProgress({ progress, step }: { progress: number; step: { index: number; label: string; description: string } }) {
  const steps = ['تعیین موقعیت', 'گردآوری داده', 'ساخت شاخص‌ها', 'تولید تصمیم'];
  return (
    <section className="panel-card p-4 md:p-5" aria-live="polite" aria-busy="true">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-800 dark:bg-wall-800 dark:text-signal-400">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-black text-ink-900 dark:text-white">{step.label}</p>
            <p className="mt-1 text-[11px] font-medium text-ink-500 dark:text-slate-400">{step.description}</p>
          </div>
        </div>
        <span className="text-sm font-black tabular-nums text-brand-800 dark:text-signal-400">{progress.toLocaleString('fa-IR')}٪</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-line dark:bg-wall-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500 dark:bg-signal-400" style={{ width: `${progress}%` }} />
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-1" aria-label="مراحل تحلیل">
        {steps.map((label, index) => (
          <li key={label} className={`text-center text-[9px] font-extrabold ${index <= step.index ? 'text-brand-800 dark:text-signal-400' : 'text-ink-300 dark:text-slate-600'}`}>
            <span className={`mx-auto mb-1 block h-1.5 rounded-full ${index <= step.index ? 'bg-brand-600 dark:bg-signal-400' : 'bg-line dark:bg-wall-700'}`} />
            {label}
          </li>
        ))}
      </ol>
    </section>
  );
}

function EmptyWorkspace({
  recentEntries,
  onSelectRecent,
  onOpenEvidence,
}: {
  recentEntries: LivingMemoryEntry[];
  onSelectRecent: (name: string) => void;
  onOpenEvidence: () => void;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,.6fr)]">
      <div className="panel-card flex min-h-64 flex-col items-center justify-center p-6 text-center md:p-10">
        <div className="flex size-16 items-center justify-center rounded-3xl bg-brand-100 text-brand-800 dark:bg-wall-800 dark:text-signal-400">
          <Brain size={30} aria-hidden="true" />
        </div>
        <h2 className="mt-5 text-lg font-black text-ink-900 dark:text-white">برای ساخت پرونده تصمیم، یک محله را تحلیل کنید</h2>
        <p className="mt-2 max-w-xl text-xs font-medium leading-6 text-ink-500 dark:text-slate-400">
          تصمیم‌یار داده‌های مکانی و شاخص‌های عمومی را گردآوری می‌کند، گلوگاه تبدیل کیفیت را تشخیص می‌دهد و اقدامات را با ملاحظه عدالت اولویت‌بندی می‌کند.
        </p>
        <button type="button" onClick={onOpenEvidence} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-xs font-black text-brand-800 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:text-signal-400">
          مشاهده منابع و ابزارها
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
      </div>
      <aside className="panel-card p-5">
        <div className="panel-heading">
          <div className="icon-tile"><Clock3 size={17} /></div>
          <div>
            <h2 className="panel-title">تحلیل‌های اخیر</h2>
            <p className="mt-0.5 text-[10px] text-ink-400 dark:text-slate-500">از حافظه محلی این مرورگر</p>
          </div>
        </div>
        {recentEntries.length > 0 ? (
          <div className="mt-4 space-y-2">
            {recentEntries.map(entry => {
              const name = entry.trigger.replace('تحلیل محله ', '');
              return (
                <button key={entry.id} type="button" onClick={() => onSelectRecent(name)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-paper p-3 text-right transition hover:border-brand-200 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:hover:bg-wall-700">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-black text-ink-800 dark:text-slate-200">{name}</span>
                    <span className="mt-1 block truncate text-[9px] text-ink-400 dark:text-slate-500">{entry.rule}</span>
                  </span>
                  <ArrowLeft size={14} className="shrink-0 text-brand-700 dark:text-signal-400" />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-line p-5 text-center text-[11px] font-medium text-ink-400 dark:border-wall-700 dark:text-slate-500">
            هنوز تحلیلی در حافظه ثبت نشده است.
          </div>
        )}
      </aside>
    </section>
  );
}

function DecisionView({
  activeView,
  card,
  typeAbstained = false,
  rawData,
  sourceStatuses,
  memoryEntries,
  setMemoryEntries,
  confidence,
  lastUpdated,
  onNavigate,
  onSurveyComplete,
}: {
  activeView: ViewKey;
  card: DecisionCard | null;
  typeAbstained?: boolean;
  rawData: Record<string, unknown> | null;
  sourceStatuses: RealDataSource[];
  memoryEntries: LivingMemoryEntry[];
  setMemoryEntries: React.Dispatch<React.SetStateAction<LivingMemoryEntry[]>>;
  confidence: number | null;
  lastUpdated: Date | null;
  onNavigate: (section: SectionKey, view?: ViewKey) => void;
  onSurveyComplete: (responses: SurveyResponse[]) => void;
}) {
  if (activeView === 'learning') return <LearningDashboard entries={memoryEntries} onEntriesChange={setMemoryEntries} />;
  if (activeView === 'ai') return <AIDecisionAdvisor neighborhoodName={card?.neighborhoodName ?? ''} />;
  if (activeView === 'survey') return <PerceptualSurveyForm onComplete={onSurveyComplete} />;
  if (activeView === 'compare') return <NeighborhoodComparison />;
  if (activeView === 'data') return <DataSourcesView rawData={rawData} sources={sourceStatuses} />;
  if (activeView === 'registry') {
    const measuredCodes = card?.evaluationPlan.baseline.map((entry) => entry.split(':')[0].trim()) ?? [];
    return <DecisionRegistryView measuredCodes={measuredCodes} />;
  }

  if (!card) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-10 text-center dark:border-wall-700">
        <Brain size={38} className="mx-auto text-ink-300 dark:text-slate-600" />
        <p className="mt-4 text-sm font-black text-ink-700 dark:text-slate-300">این بخش پس از تحلیل محله فعال می‌شود.</p>
      </div>
    );
  }

  if (activeView === 'overview') return <Overview card={card} typeAbstained={typeAbstained} rawData={rawData} sourceStatuses={sourceStatuses} confidence={confidence} lastUpdated={lastUpdated} onNavigate={onNavigate} />;
  if (activeView === 'radar') return <CapitalRadarChart scores={card.capitalScores} />;
  if (activeView === 'gaps') return <GapAnalysisChart gaps={card.chainGaps} capitalScores={card.capitalScores} />;
  if (activeView === 'equity') return <EquityMap gaps={card.equityMap} />;
  if (activeView === 'causes') return <CausalChainViz hypotheses={card.hypotheses} />;
  if (activeView === 'interventions') return <InterventionMatrix interventions={card.interventions} />;
  if (activeView === 'bottleneck') return <BottleneckMap bottleneck={card.bottleneck} />;
  if (activeView === 'chain') return <ChainProfile card={card} />;
  if (activeView === 'priority') return <PriorityRanking card={card} />;
  if (activeView === 'evaluation') return <EvaluationPlan card={card} />;
  return null;
}

function Overview({
  card,
  typeAbstained = false,
  rawData,
  sourceStatuses,
  confidence,
  lastUpdated,
  onNavigate,
}: {
  card: DecisionCard;
  typeAbstained?: boolean;
  rawData: Record<string, unknown> | null;
  sourceStatuses: RealDataSource[];
  confidence: number | null;
  lastUpdated: Date | null;
  onNavigate: (section: SectionKey, view?: ViewKey) => void;
}) {
  const triad = card.qualityVerdict;
  const topRankedActionId = [...card.priorityRanking].sort((a, b) => a.rank - b.rank)[0]?.id;
  const firstAction = card.interventions.find(action => action.id === topRankedActionId) ?? card.interventions[0];
  const diagnostic = typeAbstained
    ? { ...DIAGNOSTIC_TYPES[card.diagnosticType], interpretation: 'صادر نشد — شواهد کافی برای تیپ تشخیصی نیست', strategy: 'تکمیل شواهد پیش از انتخاب راهبرد تیپ' }
    : DIAGNOSTIC_TYPES[card.diagnosticType];
  const weakestScore = [...card.capitalScores].sort((a, b) => a.score - b.score)[0];
  const verdictMetrics = [
    { key: 'Q', label: 'کیفیت', value: triad.Q },
    { key: 'T', label: 'تبدیل', value: triad.T },
    { key: 'R', label: 'بازتولید', value: triad.R },
  ] as const;
  return (
    <div className="space-y-6">
      <section className="decision-hero overflow-hidden rounded-[1.5rem] border border-brand-200 bg-gradient-to-l from-brand-900 via-brand-800 to-brand-700 text-white shadow-sm dark:border-signal-400/20 dark:from-wall-900 dark:via-wall-850 dark:to-wall-800">
        <div className="grid gap-0 md:grid-cols-[minmax(0,1.2fr)_minmax(220px,.8fr)]">
          <div className="relative p-5 md:p-7">
            <div className="relative z-10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip border border-white/10 bg-white/10 text-brand-100 dark:text-signal-300">حکم مدیریتی</span>
                <span className="chip border border-white/10 bg-white/10 text-brand-100">{typeAbstained ? diagnostic.interpretation : `تیپ ${card.diagnosticType} — ${diagnostic.interpretation}`}</span>
              </div>
              <p className="mt-5 text-[10px] font-black text-brand-100/70 dark:text-signal-300/70">اقدام اولویت‌دار پیشنهادی</p>
              <h2 className="mt-1 max-w-2xl text-lg font-black leading-8 text-white md:text-xl">{firstAction?.name ?? 'تکمیل شواهد پیش از انتخاب مداخله'}</h2>
              <p className="mt-3 max-w-2xl text-xs font-semibold leading-6 text-white/75 md:text-sm">
                گلوگاه در سرمایه {CAPITAL_FA[card.bottleneck.capital]} و گذار {CHAIN_FA[card.bottleneck.transition[0]]} به {CHAIN_FA[card.bottleneck.transition[1]]} قرار دارد؛ راهبرد مناسب، {diagnostic.strategy} است.
              </p>
              <div className="mt-4 flex flex-wrap gap-2" aria-label="خلاصه امتیازهای حکم">
                {verdictMetrics.map(metric => {
                  const bandKey = scoreToBand(metric.value);
                  return (
                    <span key={metric.key} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-2.5 py-1.5 text-[10px] font-black text-white/85">
                      <span className="size-2 rounded-full" style={{ backgroundColor: STATUS_TONES[bandKey].color }} />
                      {metric.key} · {metric.label}
                      <strong className="text-white">{metric.value.toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>
                      <span className="text-white/55">{BAND_CONFIG[bandKey].label}</span>
                    </span>
                  );
                })}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onNavigate('diagnosis', 'bottleneck')} className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-[11px] font-black text-brand-900 transition hover:-translate-y-0.5 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25 dark:bg-signal-400 dark:text-wall-950 dark:hover:bg-signal-300">
                  مشاهده تشخیص گلوگاه
                  <ArrowLeft size={14} />
                </button>
                <button type="button" onClick={() => onNavigate('action', 'priority')} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-[11px] font-black text-white transition hover:-translate-y-0.5 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15">
                  رفتن به اولویت اقدام
                  <TrendingUp size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="border-t border-white/10 bg-black/10 p-5 backdrop-blur-sm md:border-r md:border-t-0">
            <DecisionFact label="گلوگاه اصلی" value={`${CAPITAL_FA[card.bottleneck.capital]}؛ ${CHAIN_FA[card.bottleneck.transition[0]]} به ${CHAIN_FA[card.bottleneck.transition[1]]}`} />
            <DecisionFact label="دامنه اثر" value={`${card.bottleneck.group} در ${card.bottleneck.location}`} />
            <DecisionFact label="راهبرد تیپ" value={diagnostic.strategy} />
            <div className="mt-4 flex flex-wrap gap-2 text-[9px] font-extrabold text-white/75">
              <span className="rounded-full bg-white/10 px-2.5 py-1">اطمینان داده: {confidence === null ? 'در انتظار' : `${confidence.toLocaleString('fa-IR')}٪`}</span>
              {lastUpdated && <span className="rounded-full bg-white/10 px-2.5 py-1">به‌روزرسانی {lastUpdated.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
          </div>
        </div>
      </section>

      <section aria-label="برداشت سریع پرونده" className="grid gap-3 md:grid-cols-3">
        <InsightCard
          eyebrow="نقطه فشار"
          title={weakestScore ? CAPITAL_FA[weakestScore.capitalKey] : 'نیازمند داده بیشتر'}
          description={weakestScore ? `کم‌امتیازترین سرمایه با امتیاز ${weakestScore.score.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} از ۱۰۰` : 'هنوز سرمایه غالب شناسایی نشده است.'}
          icon={<TrendingDown size={18} />}
          tone="warning"
        />
        <InsightCard
          eyebrow="منطق مداخله"
          title={diagnostic.strategy}
          description={typeAbstained ? diagnostic.interpretation : `تیپ ${card.diagnosticType}: ${diagnostic.interpretation}`}
          icon={<Target size={18} />}
          tone="brand"
        />
        <InsightCard
          eyebrow="آمادگی تصمیم"
          title={confidence === null ? 'در انتظار شواهد' : confidence >= 75 ? 'قابل اتکا' : confidence >= 50 ? 'قابل استفاده با احتیاط' : 'نیازمند تکمیل داده'}
          description={confidence === null ? 'اتصال منابع هنوز ارزیابی نشده است.' : `${onlineSourcesLabel(sourceStatuses)} و اطمینان ${confidence.toLocaleString('fa-IR')}٪`}
          icon={<Shield size={18} />}
          tone={confidence !== null && confidence >= 75 ? 'success' : 'neutral'}
        />
      </section>

      <section aria-label="شاخص‌های اصلی کیفیت" className="grid gap-3 sm:grid-cols-3">
        <ScoreCard label="Q — کیفیت محقق‌شده" value={triad.Q} description="کیفیتی که اکنون تجربه می‌شود" />
        <ScoreCard label="T — توان تبدیل" value={triad.T} description="تبدیل ظرفیت به استفاده و تجربه" />
        <ScoreCard label="R — توان بازتولید" value={triad.R} description="پایداری و تکرارپذیری کیفیت" />
      </section>

      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-black text-ink-900 dark:text-white">وضعیت هشت سرمایه محله</h3>
            <p className="mt-1 text-[10px] text-ink-400 dark:text-slate-500">امتیاز و سطح وضعیت هر سرمایه در مقیاس صفر تا صد</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => downloadReport(card)} className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[10px] font-black text-brand-800 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:text-signal-400">
              <FileText size={14} /> گزارش متنی
            </button>
            <button type="button" onClick={() => downloadReportJSON(card)} className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[10px] font-black text-ink-500 transition hover:bg-paper focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:text-slate-300">
              <Download size={14} /> داده JSON
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {card.capitalScores.map(score => (
            <button key={score.capitalKey} type="button" onClick={() => onNavigate('diagnosis', 'radar')} className="group rounded-2xl border border-line bg-surface p-3 text-center transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:hover:border-signal-400/30">
              <div className="mx-auto mb-2 h-1.5 w-10 overflow-hidden rounded-full bg-line dark:bg-wall-700"><div className="h-full rounded-full" style={{ width: `${score.score}%`, backgroundColor: STATUS_TONES[score.band].color }} /></div>
              <div className="text-xl font-black tabular-nums" style={{ color: STATUS_TONES[score.band].color }}>{score.score.toFixed(1)}</div>
              <div className="mt-1 truncate text-[10px] font-black text-ink-700 dark:text-slate-300">{CAPITAL_FA[score.capitalKey]}</div>
              <div className="mt-1 text-[9px] font-bold text-ink-400 dark:text-slate-500">{BAND_CONFIG[score.band].label}</div>
            </button>
          ))}
        </div>
      </section>

      {sourceStatuses.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="وضعیت منابع داده">
          {sourceStatuses.map(source => <SourceBadge key={source.name} source={source} />)}
        </div>
      )}

      {rawData && <LiveDataSummary rawData={rawData} />}
      {card.satelliteEvidence && <SatelliteEvidenceSummary evidence={card.satelliteEvidence} />}
    </div>
  );
}

function DecisionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="text-[9px] font-extrabold text-white/55">{label}</div>
      <div className="mt-1 text-xs font-black leading-5 text-white">{value}</div>
    </div>
  );
}

function InsightCard({
  eyebrow,
  title,
  description,
  icon,
  tone,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  tone: 'brand' | 'warning' | 'success' | 'neutral';
}) {
  const tones = {
    brand: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-signal-400/20 dark:bg-wall-800 dark:text-signal-400',
    warning: 'border-warn/20 bg-warn-soft text-warn-700 dark:border-warn/20 dark:bg-warn/10 dark:text-warn',
    success: 'border-ok/20 bg-ok-soft text-ok-700 dark:border-ok/20 dark:bg-ok/10 dark:text-ok',
    neutral: 'border-line bg-paper text-ink-500 dark:border-wall-700 dark:bg-wall-850 dark:text-slate-400',
  } as const;
  return (
    <article className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] dark:border-wall-700 dark:bg-wall-800">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[9px] font-black text-ink-400 dark:text-slate-500">{eyebrow}</p>
        <h3 className="mt-1 text-xs font-black leading-5 text-ink-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-[10px] font-medium leading-5 text-ink-500 dark:text-slate-400">{description}</p>
      </div>
    </article>
  );
}

function onlineSourcesLabel(sources: RealDataSource[]) {
  if (sources.length === 0) return 'منابع در انتظار گردآوری‌اند';
  const online = sources.filter(source => source.status === 'online').length;
  const degraded = sources.filter(source => source.status === 'degraded').length;
  return `${online.toLocaleString('fa-IR')} منبع برخط${degraded ? ` و ${degraded.toLocaleString('fa-IR')} منبع ناپایدار` : ''}`;
}

function ScoreCard({ label, value, description }: { label: string; value: number; description: string }) {
  const bandKey = scoreToBand(value);
  const band = BAND_CONFIG[bandKey];
  const tone = STATUS_TONES[bandKey];
  return (
    <article className="rounded-2xl border bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] dark:bg-wall-800" style={{ borderColor: tone.border }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-black text-ink-800 dark:text-slate-200">{label}</h3>
          <p className="mt-1 text-[9px] font-medium text-ink-400 dark:text-slate-500">{description}</p>
        </div>
        <span className="chip" style={{ color: tone.color, backgroundColor: tone.soft }}>{band.label}</span>
      </div>
      <div className="mt-4 flex items-end gap-2">
        <span className="text-3xl font-black tabular-nums" style={{ color: tone.color }}>{value.toFixed(1)}</span>
        <span className="pb-1 text-[9px] font-bold text-ink-300 dark:text-slate-600">از ۱۰۰</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line dark:bg-wall-700">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${value}%`, backgroundColor: tone.color }} />
      </div>
    </article>
  );
}

function ChainProfile({ card }: { card: DecisionCard }) {
  return (
    <div className="space-y-4">
      <SectionHeading title="پروفایل زنجیره C-A-U-E-O" description="کیفیت تبدیل هر سرمایه از ظرفیت تا پیامد" />
      <div className="space-y-3">
        {CAPITALS.map(capital => (
          <article key={capital} className="rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800">
            <h4 className="text-xs font-black text-ink-800 dark:text-slate-200">{CAPITAL_FA[capital]}</h4>
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {CHAIN_STAGES.map(stageKey => {
                const stage = (card.chainProfile[capital] ?? []).find((item) => item.stage === stageKey);
                return (
                <div key={stageKey} className="min-w-0 rounded-xl bg-paper p-2 text-center dark:bg-wall-850">
                  <div className="text-sm font-black tabular-nums text-ink-900 dark:text-white">{stage ? stage.score.toFixed(1) : '—'}</div>
                  <div className="mt-1 truncate text-[9px] font-bold text-ink-400 dark:text-slate-500">{CHAIN_FA[stageKey]}</div>
                </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function PriorityRanking({ card }: { card: DecisionCard }) {
  return (
    <div className="space-y-4">
      <SectionHeading title="اولویت اقدامات" description="رتبه‌بندی اقدامات بر پایه شدت، جمعیت، اهرم، امکان و عدالت" />
      <div className="space-y-2">
        {card.priorityRanking.map((rank, index) => {
          const action = card.interventions.find(item => item.id === rank.id);
          return (
            <article key={rank.id} className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${index === 0 ? 'border-brand-300 bg-brand-50 dark:border-signal-400/30 dark:bg-wall-800' : 'border-line bg-surface dark:border-wall-700 dark:bg-wall-900'}`}>
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-lg font-black ${index === 0 ? 'bg-brand-800 text-white dark:bg-signal-400 dark:text-wall-950' : 'bg-paper text-ink-400 dark:bg-wall-800 dark:text-slate-500'}`}>{rank.rank.toLocaleString('fa-IR')}</span>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-black text-ink-900 dark:text-white">{action?.name ?? rank.id}</h4>
                <p className="mt-1 text-[10px] text-ink-400 dark:text-slate-500">شناسه: {rank.id}</p>
              </div>
              <div className="sm:text-left">
                <div className="text-[9px] font-bold text-ink-400 dark:text-slate-500">امتیاز اولویت</div>
                <div className="mt-1 text-lg font-black tabular-nums text-brand-800 dark:text-signal-400">{rank.score.toFixed(2)}</div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function EvaluationPlan({ card }: { card: DecisionCard }) {
  const plan = card.evaluationPlan;
  const items = [
    ['خط پایه', plan.baseline], ['اهداف', plan.targets], ['شاخص‌های خروجی', plan.outputIndicators],
    ['شاخص‌های پیامد', plan.outcomeIndicators], ['اثر بلندمدت', plan.impactIndicators],
    ['اثرات ناخواسته', plan.sideEffects], ['قواعد توقف', plan.stopRules],
  ] as const;
  return (
    <div className="space-y-4">
      <SectionHeading title="طرح ارزیابی" description="معیارهای سنجش موفقیت، اثر و توقف مداخله" />
      <div className="grid gap-3 md:grid-cols-2">
        {items.map(([label, values]) => (
          <article key={label} className="rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800">
            <h4 className="text-[10px] font-black text-brand-800 dark:text-signal-400">{label}</h4>
            <p className="mt-2 text-xs font-semibold leading-6 text-ink-600 dark:text-slate-300">{values.join(' | ') || 'هنوز تعریف نشده است'}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function DataSourcesView({ rawData, sources }: { rawData: Record<string, unknown> | null; sources: RealDataSource[] }) {
  const standbySources = [
    ['Open-Meteo Air Quality', 'کیفیت هوا و اقلیم'], ['OpenStreetMap Overpass', 'خدمات و نقاط شهری'],
    ['World Bank WDI', 'شاخص‌های کلان'], ['WHO GHO', 'شاخص‌های سلامت'],
    ['Open-Meteo Historical', 'اقلیم تاریخی'], ['OSM Walkability', 'پیاده‌مداری و شبکه راه'],
    ['Healthsites.io', 'مراکز درمانی'], ['UNESCO UIS / World Bank fallback', 'شاخص‌های آموزش'],
  ];
  return (
    <div className="space-y-5">
      <SectionHeading title="منابع داده و کیفیت اتصال" description={`تصمیم‌یار از ${TOTAL_DATA_SOURCES} خانواده داده عمومی استفاده می‌کند؛ داده‌های سازمانی نیازمند اتصال مجزا هستند.`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(sources.length > 0 ? sources : standbySources.map(([name, description]) => ({ name, baseUrl: description, status: 'standby' } as DisplayDataSource))).map(source => (
          <DataSourceCard key={source.name} source={source} />
        ))}
      </div>
      {rawData && (
        <details className="rounded-2xl border border-line bg-surface dark:border-wall-700 dark:bg-wall-800">
          <summary className="cursor-pointer px-4 py-3 text-xs font-black text-ink-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:text-slate-200">مشاهده داده‌های خام دریافتی</summary>
          <div className="grid gap-2 border-t border-line p-4 sm:grid-cols-2 xl:grid-cols-3 dark:border-wall-700">
            {Object.entries(rawData).flatMap(([source, data]) => {
              if (!data || typeof data !== 'object') return [];
              return Object.entries(data as Record<string, unknown>).map(([key, value]) => (
                <div key={`${source}.${key}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2 text-[10px] dark:bg-wall-850">
                  <span className="truncate font-bold text-ink-400 dark:text-slate-500">{source}.{key}</span>
                  <span className="shrink-0 font-mono font-black text-ink-800 dark:text-slate-200">{typeof value === 'number' ? value.toFixed(1) : String(value ?? '—')}</span>
                </div>
              ));
            })}
          </div>
        </details>
      )}
      <div className="rounded-2xl border border-info/20 bg-info-soft p-4 text-xs font-medium leading-6 text-info-700 dark:bg-info/10 dark:text-teal-200">
        شاخص‌های محله‌ای از نزدیک‌ترین داده عمومی قابل دسترس ساخته می‌شوند. برای احکام اجرایی الزام‌آور، اتصال به سرشماری، داده مدیریت شهری و پیمایش میدانی توصیه می‌شود.
      </div>
    </div>
  );
}

function DataSourceCard({ source }: { source: DisplayDataSource; key?: React.Key }) {
  const online = source.status === 'online';
  const degraded = source.status === 'degraded';
  return (
    <article className="rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800">
      <div className="flex items-start gap-3">
        <div className="icon-tile"><Globe size={16} /></div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-xs font-black text-ink-800 dark:text-slate-200">{source.name}</h4>
          <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-ink-400 dark:text-slate-500">{source.baseUrl}</p>
          <span className={`mt-2 inline-flex items-center gap-1 text-[9px] font-black ${online ? 'text-ok-700 dark:text-ok' : degraded ? 'text-warn-700 dark:text-warn' : source.status === 'standby' ? 'text-ink-400 dark:text-slate-500' : 'text-danger'}`}>
            {online || degraded ? <Wifi size={11} /> : <WifiOff size={11} />}
            {online ? 'برخط' : degraded ? 'ناپایدار / جایگزین' : source.status === 'standby' ? 'آماده اتصال' : 'بدون پاسخ'}
          </span>
          {(source.latencyMs !== undefined || source.cache || source.error) && (
            <p className="mt-2 text-[9px] leading-4 text-ink-400 dark:text-slate-500">
              {source.latencyMs !== undefined ? `${Math.round(source.latencyMs).toLocaleString('fa-IR')} ms` : ''}
              {source.cache ? ` · cache ${source.cache}` : ''}
              {source.error ? ` · ${source.error}` : ''}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function SourceBadge({ source }: { source: RealDataSource; key?: React.Key }) {
  const online = source.status === 'online';
  const degraded = source.status === 'degraded';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-extrabold ${online ? 'border-ok/20 bg-ok-soft text-ok-700 dark:bg-ok/10 dark:text-ok' : 'border-warn/20 bg-warn-soft text-warn-700 dark:bg-warn/10 dark:text-warn'}`}>
      {online || degraded ? <Wifi size={10} /> : <WifiOff size={10} />}
      {source.name}
      <span className="sr-only">{online ? 'برخط' : degraded ? 'اتصال ناپایدار یا منبع جایگزین' : 'داده جایگزین یا آفلاین'}</span>
    </span>
  );
}

function LiveDataSummary({ rawData }: { rawData: Record<string, unknown> }) {
  const hospitals = [
    (rawData.pois as { hospitals?: number })?.hospitals,
    (rawData.healthFacilities as { hospitals?: number })?.hospitals,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const items = [
    ['PM2.5', formatMetric((rawData.air as { pm25?: number })?.pm25, 1, ' µg/m³'), <Wifi size={13} />],
    ['دما', formatMetric((rawData.air as { temperature?: number })?.temperature, 1, '°C'), <Activity size={13} />],
    ['مدرسه', formatMetric((rawData.pois as { schools?: number })?.schools, 0), <MapPin size={13} />],
    ['ایستگاه اتوبوس', formatMetric((rawData.pois as { busStops?: number })?.busStops, 0), <Zap size={13} />],
    ['بیمارستان', hospitals.length > 0 ? hospitals.reduce((sum, value) => sum + value, 0).toLocaleString('fa-IR') : '—', <TrendingUp size={13} />],
    ['بیکاری', formatMetric((rawData.worldBank as { unemployment?: number })?.unemployment, 1, '٪'), <TrendingDown size={13} />],
    ['تورم', formatMetric((rawData.worldBank as { inflation?: number })?.inflation, 1, '٪'), <Scale size={13} />],
    ['باسوادی', formatMetric((rawData.unesco as { literacyRate?: number })?.literacyRate, 0, '٪'), <Globe size={13} />],
  ] as const;
  return (
    <section>
      <h3 className="mb-3 text-sm font-black text-ink-900 dark:text-white">خلاصه شواهد زنده</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {items.map(([label, value, icon]) => (
          <div key={label} className="rounded-xl bg-paper p-3 dark:bg-wall-850">
            <span className="text-brand-700 dark:text-signal-400">{icon}</span>
            <div className="mt-2 text-[9px] font-bold text-ink-400 dark:text-slate-500">{label}</div>
            <div className="mt-0.5 text-xs font-black tabular-nums text-ink-800 dark:text-slate-200">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SatelliteEvidenceSummary({ evidence }: { evidence: NonNullable<DecisionCard['satelliteEvidence']> }) {
  const rows = evidence.latestByFeature.slice(0, 8);
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20" aria-label="شواهد ماهواره‌ای">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-emerald-950 dark:text-emerald-100">شواهد ماهواره‌ای مستقل</h3>
          <p className="mt-1 text-[10px] leading-5 text-emerald-800/75 dark:text-emerald-200/70">این داده‌ها برای provenance و بررسی تصمیم نمایش داده می‌شوند و مستقیماً امتیاز تصمیم را تغییر نمی‌دهند.</p>
        </div>
        <span className="rounded-full border border-emerald-300 bg-white/70 px-2.5 py-1 text-[9px] font-black text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{evidence.decisionImpact === 'evidence_only' ? 'فقط شواهد' : evidence.decisionImpact}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SatelliteEvidenceMetric label="ویژگی‌ها" value={evidence.latestByFeature.length.toLocaleString('fa-IR')} />
        <SatelliteEvidenceMetric label="مشاهده مستقیم" value={evidence.observedCount.toLocaleString('fa-IR')} />
        <SatelliteEvidenceMetric label="مشتق‌شده" value={evidence.derivedCount.toLocaleString('fa-IR')} />
        <SatelliteEvidenceMetric label="قدیمی‌تر از SLA" value={evidence.staleCount.toLocaleString('fa-IR')} />
      </div>
      {rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-xl border border-emerald-200/80 bg-white/70 dark:border-emerald-900/60 dark:bg-wall-900/50">
          <table className="w-full min-w-[620px] text-right text-[10px]"><thead><tr className="border-b border-emerald-100 text-emerald-800 dark:border-emerald-900/60 dark:text-emerald-200"><th className="px-3 py-2 font-black">ویژگی</th><th className="px-3 py-2 font-black">مقدار</th><th className="px-3 py-2 font-black">منبع / تاریخ</th><th className="px-3 py-2 font-black">کیفیت</th></tr></thead><tbody>{rows.map((row) => <tr key={row.featureId} className="border-b border-emerald-100/80 last:border-0 dark:border-emerald-900/40"><td className="px-3 py-2 font-black text-emerald-950 dark:text-emerald-100">{row.feature}</td><td className="px-3 py-2 font-mono font-black text-ink-800 dark:text-slate-200">{row.value.toLocaleString('fa-IR', { maximumFractionDigits: 3 })}{row.unit ? ` ${row.unit}` : ''}</td><td className="px-3 py-2 text-ink-500 dark:text-slate-400">{row.provider} · {new Date(row.acquiredAt).toLocaleDateString('fa-IR')}</td><td className="px-3 py-2 font-black text-emerald-800 dark:text-emerald-200">{Math.round(row.confidence * 100).toLocaleString('fa-IR')}٪ · mask {Math.round(row.maskFraction * 100).toLocaleString('fa-IR')}٪{row.stale ? ' · قدیمی' : ''}</td></tr>)}</tbody></table>
        </div>
      ) : <p className="mt-3 rounded-xl border border-dashed border-emerald-300 px-3 py-4 text-center text-[10px] font-bold text-emerald-800 dark:border-emerald-800 dark:text-emerald-200">برای این AOI هنوز feature معتبر در کاتالوگ ثبت نشده است.</p>}
    </section>
  );
}

function SatelliteEvidenceMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-emerald-200/80 bg-white/60 p-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/20"><div className="text-[9px] font-bold text-emerald-800/70 dark:text-emerald-200/70">{label}</div><div className="mt-1 text-sm font-black text-emerald-950 dark:text-emerald-100">{value}</div></div>;
}

function formatMetric(value: number | undefined, digits: number, suffix = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('fa-IR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-base font-black text-ink-900 dark:text-white">{title}</h3>
      <p className="mt-1 text-[11px] font-medium text-ink-500 dark:text-slate-400">{description}</p>
    </div>
  );
}

function getLoadingStep(progress: number) {
  if (progress < 15) return { index: 0, label: 'تعیین موقعیت محله', description: 'نام محله به مختصات جغرافیایی تبدیل می‌شود.' };
  if (progress < 80) return { index: 1, label: 'گردآوری شواهد', description: 'منابع عمومی به‌صورت هم‌زمان دریافت و اعتبارسنجی می‌شوند.' };
  if (progress < 92) return { index: 2, label: 'ساخت شاخص‌های محله', description: 'داده‌های خام به شاخص‌های قابل مقایسه تبدیل می‌شوند.' };
  return { index: 3, label: 'تولید تصمیم', description: 'گلوگاه، فرضیه‌های علّی و اولویت اقدامات محاسبه می‌شوند.' };
}
