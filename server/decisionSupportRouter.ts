// ============================================================
// مسیریاب API سرویس تصمیم‌یار — کامل با حلقه یادگیری
// ============================================================
import express, { type Router, type Request, type Response, type NextFunction } from 'express';
import { DecisionSupportService, type DecisionSupportRequest, type SurveyInput } from './decisionSupportService';
import { getDecisionRunStore } from './decisionRunStore';
import { CalibrationService } from './calibrationService';
import { generateCausalHypotheses } from './causalAnalyzer';
import { suggestInterventions } from './intelligenceAdvisor';
import { ALGORITHM_INDICATORS } from '../src/algorithm/algorithmIndicators';
import { CAPITALS, type CapitalKey } from '../src/algorithm/types';
import { collectSatelliteEvidence } from './satelliteConsumers';
import type { SatelliteCatalog } from './satelliteCatalog';
import { DecisionSupportEvidenceService } from './decisionSupportEvidence';
import { collectSourceEvidence, mergeIndicatorValues, type MergePolicy, type SourceEvidenceBundle } from './sourceEvidence';
import { SourceRuntime } from './sources/runtime';
import type { Connector } from './sources/types';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
import { loadDecisionSupportRegistry164, summarizeDecisionSupportRegistry } from './decisionSupportRegistry164';
import type { DecisionEvidenceAssessmentRequest } from '../src/algorithm/decisionSupportEvidence';
import type { SurveyResponse } from '../src/algorithm/perceptualSurvey';
import type { InterventionRecord } from '../src/algorithm/interventionTracker';
import {
  scheduleShadowComparison,
  getShadowReport,
  listShadowReports,
  shadowRuntimeSummary,
  shadowModeSetting,
  shadowModeEnabled,
  SHADOW_RULES,
  type ShadowRunInput,
} from './kernelShadowMode';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}

/** سطوح جغرافیایی که هرگز نباید به‌عنوان مقدار «محله» پذیرفته شوند (جانشین ملی/استانی/شهری) */
const NON_LOCAL_LEVELS = new Set(['national', 'province', 'city', 'country', 'region']);

export function checkIndicatorGeography(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return 'indicatorGeography must be an object of indicatorCode → geography level';
  for (const [code, level] of Object.entries(value as Record<string, unknown>)) {
    if (typeof level !== 'string') return `indicatorGeography.${code} must be a string`;
    if (NON_LOCAL_LEVELS.has(level.toLowerCase())) return `indicator ${code} is measured at ${level} level; national/province/city values cannot be used as neighborhood scores`;
  }
  return undefined;
}

export function normalizeIndicatorValues(value: unknown): { values: Record<string, number>; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { values: {}, error: 'indicatorValues must be an object' };
  }
  const allowed = new Set(ALGORITHM_INDICATORS.map((indicator) => indicator.code));
  const values: Record<string, number> = {};
  for (const [code, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(code)) return { values: {}, error: `unknown indicator code: ${code}` };
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
      return { values: {}, error: `indicator ${code} must be a finite number between 0 and 100` };
    }
    values[code] = numeric;
  }
  return { values };
}

function normalizeGroupValues(value: unknown): { values: Record<string, Record<string, number>>; error?: string } {
  if (value === undefined || value === null) return { values: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { values: {}, error: 'groupValues must be an object of indicatorCode → group → score' };
  }
  const allowed = new Set(ALGORITHM_INDICATORS.map((indicator) => indicator.code));
  const values: Record<string, Record<string, number>> = {};
  for (const [code, groups] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(code)) return { values: {}, error: `unknown group indicator code: ${code}` };
    if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
      return { values: {}, error: `groupValues.${code} must be an object of group → score` };
    }
    values[code] = {};
    for (const [group, raw] of Object.entries(groups as Record<string, unknown>)) {
      const numeric = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
        return { values: {}, error: `groupValues.${code}.${group} must be a number between 0 and 100` };
      }
      values[code][group] = numeric;
    }
  }
  return { values };
}

function normalizeSurvey(value: unknown): { survey?: SurveyInput; error?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'survey must be an object with responses array' };
  }
  const { responses, respondentGroup } = value as { responses?: unknown; respondentGroup?: unknown };
  if (!Array.isArray(responses) || responses.length === 0) {
    return { error: 'survey.responses must be a non-empty array' };
  }
  const normalized: SurveyResponse[] = [];
  for (const raw of responses) {
    if (!raw || typeof raw !== 'object') return { error: 'each survey response must be an object' };
    const { questionId, value: answerValue, followUpAnswer } = raw as Record<string, unknown>;
    if (typeof questionId !== 'string' || !questionId.trim()) {
      return { error: 'survey response questionId is required' };
    }
    const numeric = typeof answerValue === 'number' ? answerValue : Number(answerValue);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
      return { error: `survey response ${questionId} must be an integer 1..5` };
    }
    normalized.push({
      questionId: questionId.trim(),
      value: numeric,
      followUpAnswer: typeof followUpAnswer === 'string' ? followUpAnswer : undefined,
    });
  }
  return {
    survey: {
      responses: normalized,
      respondentGroup: typeof respondentGroup === 'string' ? respondentGroup : undefined,
    },
  };
}

/** ورودی فعال‌سازی منابع زنده در تحلیل */
interface LiveSourceRequest {
  point: { lat: number; lng: number };
  at?: string;
}

function normalizeLiveSources(value: unknown): { request?: LiveSourceRequest; policy: MergePolicy; error?: string } {
  if (value === undefined || value === null) return { policy: 'fill_missing' };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { policy: 'fill_missing', error: 'liveSources must be an object' };
  }
  const raw = value as { lat?: unknown; lng?: unknown; at?: unknown; mergePolicy?: unknown };
  const lat = typeof raw.lat === 'number' ? raw.lat : Number(raw.lat);
  const lng = typeof raw.lng === 'number' ? raw.lng : Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { policy: 'fill_missing', error: 'liveSources requires numeric lat and lng' };
  }
  if (lat < 24 || lat > 40.5 || lng < 43 || lng > 64) {
    return { policy: 'fill_missing', error: 'liveSources coordinates are outside the supported Iran bounds' };
  }
  const policy: MergePolicy = raw.mergePolicy === 'prefer_live' ? 'prefer_live' : 'fill_missing';
  return {
    policy,
    request: {
      point: { lat, lng },
      at: typeof raw.at === 'string' && raw.at.trim() ? raw.at.trim() : undefined,
    },
  };
}

export function buildDecisionSupportRouter(options: {
  satelliteCatalog?: Pick<SatelliteCatalog, 'listFeatures'>;
  sourceRuntime?: SourceRuntime;
  /** جایگزینی کانکتورهای دروازهٔ منابع (برای تست و محیط‌های بدون شبکه) */
  sourceConnectors?: Connector[];
} = {}): Router {
  const router = express.Router();
  const service = new DecisionSupportService();
  const store = getDecisionRunStore();
  const calibration = new CalibrationService();
  // رجیستر کنترل‌شده ۱۶۴ شاخصی + موتور دفتر شواهد (پیش‌فرض خاموش نبود؛ اکنون به مسیر محصول وصل است)
  const evidenceService = new DecisionSupportEvidenceService();
  // runtime مشترک دروازهٔ منابع: کش بین درخواست‌ها حفظ می‌شود
  const sourceRuntime = options.sourceRuntime ?? new SourceRuntime({
    diskCacheDir: process.env.SOURCE_CACHE_DIR ?? path.resolve(SERVER_DIR, 'data', 'source-cache'),
  });

  // ─── سایه: ورودی هر اجرا فقط برای بازاجرای اختیاری نگه داشته می‌شود ───
  // (حافظه‌ای و محدود؛ مسیر محصول به آن وابسته نیست)
  const shadowInputs = new Map<string, ShadowRunInput>();
  const SHADOW_INPUT_MAX = 100;
  function rememberShadowInput(input: ShadowRunInput): void {
    shadowInputs.set(input.tsRunId, input);
    while (shadowInputs.size > SHADOW_INPUT_MAX) {
      const oldest = shadowInputs.keys().next().value;
      if (oldest === undefined) break;
      shadowInputs.delete(oldest);
    }
  }

  // ─── POST /api/decision-support/analyze ───────────────────
  router.post('/analyze', asyncRoute(async (req: Request, res: Response) => {
    const body = req.body as Partial<DecisionSupportRequest & { survey?: unknown }>;
    if (typeof body.neighborhoodName !== 'string' || !body.neighborhoodName.trim()) {
      res.status(400).json({ success: false, error: { code: 'MISSING_FIELD', message: 'neighborhoodName is required' } });
      return;
    }
    const geographyError = checkIndicatorGeography((body as { indicatorGeography?: unknown }).indicatorGeography);
    if (geographyError) {
      res.status(422).json({ success: false, error: { code: 'GEOGRAPHY_MISMATCH', message: geographyError } });
      return;
    }
    const normalized = normalizeIndicatorValues(body.indicatorValues);
    if (normalized.error) {
      res.status(422).json({ success: false, error: { code: 'INVALID_INDICATOR_VALUES', message: normalized.error } });
      return;
    }

    // ─── منابع زنده: تقویت مقادیر شاخص پیش از بررسی پوشش ────────
    // منابع score_eligible اینجا واقعاً عدد تولید می‌کنند؛ منابع شاهد فقط
    // در sourceContribution ثبت می‌شوند. مقدار گمشده هرگز صفر نمی‌شود.
    const live = normalizeLiveSources((body as { liveSources?: unknown }).liveSources);
    if (live.error) {
      res.status(422).json({ success: false, error: { code: 'INVALID_LIVE_SOURCES', message: live.error } });
      return;
    }
    let sourceContribution: {
      policy: MergePolicy;
      applied: string[];
      skipped: string[];
      indicators: SourceEvidenceBundle['indicators'];
      aggregates: SourceEvidenceBundle['aggregates'];
      evidenceOnly: SourceEvidenceBundle['evidenceOnly'];
      ledger: SourceEvidenceBundle['ledger'];
      shortages: SourceEvidenceBundle['shortages'];
      coverage: SourceEvidenceBundle['coverage'];
      generatedAt: string;
    } | null = null;
    if (live.request) {
      const bundle = await collectSourceEvidence({ runtime: sourceRuntime, connectors: options.sourceConnectors, ...live.request });
      const merged = mergeIndicatorValues(normalized.values, bundle.aggregates, live.policy);
      normalized.values = merged.values;
      sourceContribution = {
        policy: live.policy,
        applied: merged.applied,
        skipped: merged.skipped,
        indicators: bundle.indicators,
        aggregates: bundle.aggregates,
        evidenceOnly: bundle.evidenceOnly,
        ledger: bundle.ledger,
        shortages: bundle.shortages,
        coverage: bundle.coverage,
        generatedAt: bundle.generatedAt,
      };
    }

    if (Object.keys(normalized.values).length === 0) {
      res.status(422).json({ success: false, error: { code: 'INSUFFICIENT_EVIDENCE', message: 'At least one measured indicator is required; synthetic defaults are disabled.' } });
      return;
    }
    const groupValues = normalizeGroupValues(body.groupValues);
    if (groupValues.error) {
      res.status(422).json({ success: false, error: { code: 'INVALID_GROUP_VALUES', message: groupValues.error } });
      return;
    }
    const survey = normalizeSurvey(body.survey);
    if (survey.error) {
      res.status(422).json({ success: false, error: { code: 'INVALID_SURVEY', message: survey.error } });
      return;
    }
    const suppliedCodes = new Set(Object.keys(normalized.values));
    const coveredCapitals = new Set(ALGORITHM_INDICATORS.filter((indicator) => suppliedCodes.has(indicator.code)).map((indicator) => indicator.capitalKey));
    const missingCapitals = CAPITALS.filter((capital) => !coveredCapitals.has(capital));
    // پوشش پس از ادغام پیمایش بررسی می‌شود؛ خطا فقط اگر پیمایش هم پوشش ندهد
    const surveyCodes = new Set((survey.survey?.responses ?? []).map(r => r.questionId));
    const surveyCoversExperience = surveyCodes.has('E2') || surveyCodes.has('E3');
    if (missingCapitals.length > 0 && !(surveyCoversExperience && missingCapitals.every(c => c === 'S'))) {
      res.status(422).json({ success: false, error: { code: 'INSUFFICIENT_COVERAGE', message: `Measured coverage is missing for capitals: ${missingCapitals.join(', ')}` } });
      return;
    }
    const request: DecisionSupportRequest = {
      neighborhoodName: body.neighborhoodName,
      cityOrCounty: body.cityOrCounty ?? '',
      province: body.province ?? '',
      purpose: body.purpose ?? 'baseline',
      indicatorValues: normalized.values,
      groupValues: groupValues.values,
      groupSlices: body.groupSlices,
      subLocationScores: body.subLocationScores,
      previousPeriodIndicatorValues: body.previousPeriodIndicatorValues,
      survey: survey.survey,
      population: typeof body.population === 'number' && Number.isFinite(body.population) && body.population > 0 ? body.population : undefined,
      aoi: body.aoi,
    };
    try {
      if (options.satelliteCatalog && request.aoi?.bbox) {
        request.satelliteEvidence = collectSatelliteEvidence(options.satelliteCatalog, request.aoi.bbox);
      }
      const { runId, card } = service.analyze(request);

      // ─── اجرای سایه (فاز ۳): نسخهٔ kernel در کنار موتور TypeScript ───────
      // پاسخ محصول در هر دو حالت دست‌نخورده است و هیچ عددی از سایه وارد آن
      // نمی‌شود. حالت پیش‌فرض «async» است تا تأخیر محصول تغییر نکند.
      const shadowInput: ShadowRunInput = {
        tsRunId: runId,
        neighborhoodName: request.neighborhoodName,
        indicatorValues: normalized.values,
        groupValues: groupValues.values,
        card,
      };
      rememberShadowInput(shadowInput);
      const payload = { runId, card, ...(sourceContribution ? { sourceContribution } : {}) };
      if (shadowModeSetting() === 'await') {
        // در حالت await گزارش پیش از پاسخ ساخته می‌شود (برای آزمون قطعی)؛
        // شکست سایه هرگز به خطای محصول تبدیل نمی‌شود.
        await scheduleShadowComparison(shadowInput);
        res.json({ success: true, data: payload });
      } else {
        res.json({ success: true, data: payload });
        if (shadowModeEnabled()) void scheduleShadowComparison(shadowInput);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Decision analysis failed';
      res.status(422).json({ success: false, error: { code: 'ANALYSIS_NOT_READY', message } });
    }
  }));

  // ─── POST /api/decision-support/source-evidence ───────────
  // بستهٔ شواهد منابع زنده برای یک نقطه: امتیازهای آماده برای شاخص‌ها،
  // سطرهای دفتر شواهد، و کمبودهای داده. هیچ مقداری در نبود داده ساخته نمی‌شود.
  router.post('/source-evidence', asyncRoute(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { lat?: unknown; lng?: unknown; at?: unknown; sourceIds?: unknown; includeEvidenceOnly?: unknown; bbox?: unknown };
    const lat = typeof body.lat === 'number' ? body.lat : Number(body.lat);
    const lng = typeof body.lng === 'number' ? body.lng : Number(body.lng);
    const bbox = Array.isArray(body.bbox) && body.bbox.length === 4 && body.bbox.every(v => Number.isFinite(Number(v)))
      ? (body.bbox.map(Number) as [number, number, number, number])
      : undefined;
    if (!bbox && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
      res.status(422).json({ success: false, error: { code: 'INVALID_LOCATION', message: 'source-evidence requires lat/lng or a 4-number bbox' } });
      return;
    }
    if (!bbox && (lat < 24 || lat > 40.5 || lng < 43 || lng > 64)) {
      res.status(422).json({ success: false, error: { code: 'INVALID_LOCATION', message: 'coordinates are outside the supported Iran bounds' } });
      return;
    }
    const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.filter((v): v is string => typeof v === 'string') : undefined;
    const bundle = await collectSourceEvidence({
      runtime: sourceRuntime,
      connectors: options.sourceConnectors,
      point: bbox ? undefined : { lat, lng },
      bbox,
      at: typeof body.at === 'string' && body.at.trim() ? body.at.trim() : undefined,
      sourceIds,
      includeEvidenceOnly: body.includeEvidenceOnly === true,
    });
    res.json({ success: true, data: bundle });
  }));

  // ─── GET /api/decision-support/runs ───────────────────────
  router.get('/runs', asyncRoute(async (req: Request, res: Response) => {
    const neighborhood = typeof req.query.neighborhood === 'string' ? req.query.neighborhood : undefined;
    res.json({ success: true, data: store.listRuns(neighborhood) });
  }));

  // ─── GET /api/decision-support/runs/:runId ────────────────
  router.get('/runs/:runId', asyncRoute(async (req: Request, res: Response) => {
    const run = store.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ success: false, error: { code: 'RUN_NOT_FOUND', message: 'run not found' } });
      return;
    }
    res.json({ success: true, data: run });
  }));

  // کارت تصمیم
  router.get('/runs/:runId/card', asyncRoute(async (req: Request, res: Response) => {
    const run = store.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ success: false, error: { code: 'RUN_NOT_FOUND', message: 'run not found' } });
      return;
    }
    if (!run.card) {
      res.status(409).json({ success: false, error: { code: 'RUN_NOT_COMPLETED', message: run.errorMessage ?? 'run has no card yet' } });
      return;
    }
    res.json({ success: true, data: run.card });
  }));

  // زنجیره C-A-U-E-O
  router.get('/runs/:runId/chain', asyncRoute(async (req: Request, res: Response) => {
    const run = store.getRun(req.params.runId);
    if (!run?.card) {
      res.status(404).json({ success: false, error: { code: 'RUN_NOT_FOUND', message: 'run not found or not completed' } });
      return;
    }
    res.json({ success: true, data: { chainProfile: run.card.chainProfile, chainGaps: run.card.chainGaps } });
  }));

  // گلوگاه
  router.get('/runs/:runId/bottleneck', asyncRoute(async (req: Request, res: Response) => {
    const run = store.getRun(req.params.runId);
    if (!run?.card) {
      res.status(404).json({ success: false, error: { code: 'RUN_NOT_FOUND', message: 'run not found or not completed' } });
      return;
    }
    res.json({ success: true, data: run.card.bottleneck });
  }));

  // فرضیه‌های علّی
  router.get('/runs/:runId/causes', asyncRoute(async (req: Request, res: Response) => {
    const run = store.getRun(req.params.runId);
    if (!run?.card) {
      res.status(404).json({ success: false, error: { code: 'RUN_NOT_FOUND', message: 'run not found or not completed' } });
      return;
    }
    res.json({ success: true, data: run.card.hypotheses });
  }));

  // نقشه عدالت
  router.get('/runs/:runId/equity', asyncRoute(async (req: Request, res: Response) => {
    const run = store.getRun(req.params.runId);
    if (!run?.card) {
      res.status(404).json({ success: false, error: { code: 'RUN_NOT_FOUND', message: 'run not found or not completed' } });
      return;
    }
    res.json({ success: true, data: { equityMap: run.card.equityMap, equityDataStatus: run.card.equityDataStatus } });
  }));

  // سبد مداخله
  router.get('/runs/:runId/interventions', asyncRoute(async (req: Request, res: Response) => {
    const run = store.getRun(req.params.runId);
    if (!run?.card) {
      res.status(404).json({ success: false, error: { code: 'RUN_NOT_FOUND', message: 'run not found or not completed' } });
      return;
    }
    res.json({ success: true, data: { interventions: run.card.interventions, priorityRanking: run.card.priorityRanking } });
  }));

  // ثبت یادگیری از یک اجرا — دروازه S-I-F-A-M
  router.post('/runs/:runId/learn', asyncRoute(async (req: Request, res: Response) => {
    const { sensing, interpretation, feedback, adaptation, memory } = (req.body ?? {}) as Record<string, unknown>;
    const capabilities = [sensing, interpretation, feedback, adaptation, memory].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
      ? { sensing: sensing as number, interpretation: interpretation as number, feedback: feedback as number, adaptation: adaptation as number, memory: memory as number }
      : undefined;
    try {
      const result = store.learnFromRun(req.params.runId, capabilities);
      res.json({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'learn failed';
      res.status(404).json({ success: false, error: { code: 'RUN_NOT_FOUND', message } });
    }
  }));

  // ─── حافظه زنده ────────────────────────────────────────────
  router.get('/memory', asyncRoute(async (req: Request, res: Response) => {
    const capital = typeof req.query.capital === 'string' ? (req.query.capital as CapitalKey) : undefined;
    if (capital && !CAPITALS.includes(capital)) {
      res.status(422).json({ success: false, error: { code: 'INVALID_CAPITAL', message: `capital must be one of ${CAPITALS.join(', ')}` } });
      return;
    }
    res.json({ success: true, data: { entries: store.getMemoryEntries(capital), formatted: store.formatMemory() } });
  }));

  router.post('/memory', asyncRoute(async (req: Request, res: Response) => {
    const { capitalKey, trigger, outcome, rule, evidence } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof capitalKey !== 'string' || !CAPITALS.includes(capitalKey as CapitalKey)) {
      res.status(422).json({ success: false, error: { code: 'INVALID_CAPITAL', message: `capitalKey must be one of ${CAPITALS.join(', ')}` } });
      return;
    }
    if (typeof rule !== 'string' || !rule.trim() || typeof trigger !== 'string' || !trigger.trim()) {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'rule and trigger are required strings' } });
      return;
    }
    const validOutcome = outcome === 'success' || outcome === 'failure' || outcome === 'partial' ? outcome : 'partial';
    const entry = store.addMemoryEntry({
      capitalKey: capitalKey as CapitalKey,
      trigger,
      outcome: validOutcome,
      rule,
      evidence: typeof evidence === 'string' ? evidence : '',
    });
    res.status(201).json({ success: true, data: entry });
  }));

  router.delete('/memory/:entryId', asyncRoute(async (req: Request, res: Response) => {
    const deleted = store.deleteMemoryEntry(req.params.entryId);
    if (!deleted) {
      res.status(404).json({ success: false, error: { code: 'ENTRY_NOT_FOUND', message: 'memory entry not found' } });
      return;
    }
    res.json({ success: true, data: { deleted: true } });
  }));

  router.post('/memory/:entryId/supersede', asyncRoute(async (req: Request, res: Response) => {
    const { newRule } = (req.body ?? {}) as { newRule?: unknown };
    if (typeof newRule !== 'string' || !newRule.trim()) {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'newRule is required' } });
      return;
    }
    const ok = store.supersedeMemoryRule(req.params.entryId, newRule);
    if (!ok) {
      res.status(404).json({ success: false, error: { code: 'ENTRY_NOT_FOUND', message: 'memory entry not found' } });
      return;
    }
    res.json({ success: true, data: { superseded: true } });
  }));

  // ─── چرخه آزمایش ────────────────────────────────────────────
  router.get('/experiments', asyncRoute(async (_req: Request, res: Response) => {
    res.json({ success: true, data: { experiments: store.getExperiments(), protectiveIndicators: store.getProtectiveIndicators() } });
  }));

  router.post('/experiments', asyncRoute(async (req: Request, res: Response) => {
    const { hypothesis, capitalKey, baseline } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof hypothesis !== 'string' || !hypothesis.trim()) {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'hypothesis is required' } });
      return;
    }
    if (typeof capitalKey !== 'string' || !CAPITALS.includes(capitalKey as CapitalKey)) {
      res.status(422).json({ success: false, error: { code: 'INVALID_CAPITAL', message: `capitalKey must be one of ${CAPITALS.join(', ')}` } });
      return;
    }
    if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'baseline must be an object of indicatorCode → value' } });
      return;
    }
    const experiment = store.createExperiment(hypothesis, capitalKey as CapitalKey, baseline as Record<string, number>);
    res.status(201).json({ success: true, data: experiment });
  }));

  router.post('/experiments/:experimentId/complete', asyncRoute(async (req: Request, res: Response) => {
    const { outcomes, impacts } = (req.body ?? {}) as Record<string, unknown>;
    if (!outcomes || typeof outcomes !== 'object' || Array.isArray(outcomes)) {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'outcomes must be an object' } });
      return;
    }
    const experiment = store.completeExperiment(req.params.experimentId, outcomes as Record<string, number>, impacts as Record<string, number> | undefined);
    if (!experiment) {
      res.status(404).json({ success: false, error: { code: 'EXPERIMENT_NOT_FOUND', message: 'experiment not found' } });
      return;
    }
    res.json({ success: true, data: experiment });
  }));

  // ─── ردیابی مداخله ──────────────────────────────────────────
  router.get('/interventions', asyncRoute(async (_req: Request, res: Response) => {
    res.json({ success: true, data: { records: store.listInterventions() } });
  }));

  router.post('/interventions', asyncRoute(async (req: Request, res: Response) => {
    const { intervention, runId: sourceRunId } = (req.body ?? {}) as Record<string, unknown>;
    const candidate = typeof intervention === 'string'
      ? store.getRun(sourceRunId as string ?? '')?.card?.interventions.find(item => item.id === intervention)
      : (intervention as import('../src/algorithm/types').InterventionCandidate | undefined);
    if (!candidate) {
      res.status(404).json({ success: false, error: { code: 'INTERVENTION_NOT_FOUND', message: 'intervention id or object required (and runId when passing an id)' } });
      return;
    }
    const run = sourceRunId ? store.getRun(sourceRunId as string) : null;
    const record = store.createInterventionRecord(candidate, run?.card?.evaluationPlan ?? {
      baseline: [], targets: [], outputIndicators: [], outcomeIndicators: [], impactIndicators: [], sideEffects: [], stopRules: [],
    });
    res.status(201).json({ success: true, data: record });
  }));

  router.post('/interventions/:recordId/status', asyncRoute(async (req: Request, res: Response) => {
    const { status, description } = (req.body ?? {}) as { status?: unknown; description?: unknown };
    const validStatuses = ['planned', 'active', 'completed', 'suspended', 'cancelled'];
    if (typeof status !== 'string' || !validStatuses.includes(status)) {
      res.status(422).json({ success: false, error: { code: 'INVALID_STATUS', message: `status must be one of ${validStatuses.join(', ')}` } });
      return;
    }
    const record = store.updateIntervention(req.params.recordId, status as InterventionRecord['status'], typeof description === 'string' ? description : '');
    if (!record) {
      res.status(404).json({ success: false, error: { code: 'RECORD_NOT_FOUND', message: 'intervention record not found' } });
      return;
    }
    res.json({ success: true, data: record });
  }));

  router.post('/interventions/:recordId/metrics', asyncRoute(async (req: Request, res: Response) => {
    const { metrics } = (req.body ?? {}) as { metrics?: unknown };
    if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'metrics object is required' } });
      return;
    }
    const record = store.updateInterventionMetrics(req.params.recordId, metrics as Parameters<typeof store.updateInterventionMetrics>[1]);
    if (!record) {
      res.status(404).json({ success: false, error: { code: 'RECORD_NOT_FOUND', message: 'intervention record not found' } });
      return;
    }
    res.json({ success: true, data: record });
  }));

  router.get('/interventions/:recordId/report', asyncRoute(async (req: Request, res: Response) => {
    const report = store.getInterventionReport(req.params.recordId);
    if (!report) {
      res.status(404).json({ success: false, error: { code: 'RECORD_NOT_FOUND', message: 'intervention record not found' } });
      return;
    }
    res.json({ success: true, data: report });
  }));

  // ─── اجرای سایه: مقایسهٔ دو موتور (kernel در برابر TypeScript) ─────
  // خواندنی و بی‌اثر بر مسیر محصول. هیچ عددی از سایه به /analyze برنمی‌گردد.
  router.get('/shadow', asyncRoute(async (_req: Request, res: Response) => {
    const reports = listShadowReports();
    res.json({
      success: true,
      data: {
        mode: shadowModeSetting(),
        enabled: shadowModeEnabled(),
        rules: [...SHADOW_RULES],
        runtime: shadowRuntimeSummary(),
        reports: reports.map((r) => ({
          ts_run_id: r.ts_run_id,
          neighborhood: r.neighborhood,
          created_at: r.created_at,
          status: r.status,
          duration_ms: r.duration_ms,
          kernel_fingerprint: r.kernel_fingerprint,
          kernel_gate_open: r.kernel_gate_open,
          summary: r.summary,
          headline: r.headline,
          error: r.error,
        })),
      },
    });
  }));

  router.get('/shadow/:runId', asyncRoute(async (req: Request, res: Response) => {
    const report = getShadowReport(req.params.runId);
    if (!report) {
      res.status(404).json({
        success: false,
        error: {
          code: 'SHADOW_NOT_READY',
          message: shadowModeEnabled()
            ? 'گزارش سایه برای این اجرا ثبت نشده است (هنوز آماده نشده یا اجرای سایه خاموش بوده)'
            : 'حالت سایه خاموش است (ARA_KERNEL_SHADOW=off)',
        },
      });
      return;
    }
    res.json({ success: true, data: report });
  }));

  // بازاجرای اختیاری سایه برای یک اجرای موجود — فقط درخواست/کارت ذخیره‌شده را
  // دوباره از kernel عبور می‌دهد؛ نتیجهٔ محصول همچنان دست‌نخورده است.
  router.post('/shadow/:runId', asyncRoute(async (req: Request, res: Response) => {
    const input = shadowInputs.get(req.params.runId);
    if (!input) {
      res.status(404).json({
        success: false,
        error: { code: 'RUN_NOT_FOUND', message: 'ورودی این اجرا در دسترس نیست؛ ابتدا تحلیل را دوباره اجرا کنید' },
      });
      return;
    }
    const report = await scheduleShadowComparison(input);
    if (!report) {
      res.status(503).json({ success: false, error: { code: 'SHADOW_DISABLED', message: 'حالت سایه خاموش است' } });
      return;
    }
    res.json({ success: true, data: report });
  }));

  // ─── رجیستر ۱۶۴ شاخصی ──────────────────────────────────────
  // خلاصه رجیستر کنترل‌شده: موتور، کلاس اتوماسیون، فاز و سطح خروجی مجاز
  router.get('/registry', asyncRoute(async (_req: Request, res: Response) => {
    const registry = loadDecisionSupportRegistry164();
    res.json({
      success: true,
      data: {
        metadata: evidenceService.registryMetadata(),
        summary: summarizeDecisionSupportRegistry(registry),
      },
    });
  }));

  // فهرست شاخص‌های رجیستر با فیلتر سرور‌محور
  router.get('/registry/indicators', asyncRoute(async (req: Request, res: Response) => {
    const registry = loadDecisionSupportRegistry164();
    const engine = typeof req.query.engine === 'string' ? req.query.engine : undefined;
    const capital = typeof req.query.capital === 'string' ? req.query.capital.toUpperCase() : undefined;
    const phase = typeof req.query.phase === 'string' ? req.query.phase : undefined;
    const allowedOutput = typeof req.query.allowedOutput === 'string' ? req.query.allowedOutput : undefined;
    const coreOnly = req.query.core === 'true';
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const rows = registry.rows.filter((row) => {
      if (engine && row.engine !== engine) return false;
      if (capital && row.capitalKey !== capital) return false;
      if (phase && row.phase !== phase) return false;
      if (allowedOutput && row.allowedOutput !== allowedOutput) return false;
      if (coreOnly && !row.isCore) return false;
      if (query && !`${row.code} ${row.name} ${row.family} ${row.definition}`.toLowerCase().includes(query)) return false;
      return true;
    }).map((row) => ({
      code: row.code,
      name: row.name,
      engine: row.engine,
      family: row.family,
      capitalKey: row.capitalKey,
      legacyCode: row.legacyCode,
      isCore: row.isCore,
      direction: row.direction,
      phase: row.phase,
      automationClass: row.automationClass,
      allowedOutput: row.allowedOutput,
      sourceMethod: row.sourceMethod,
      spatialLevel: row.spatialLevel,
      equityBreakdown: row.equityBreakdown,
      usableWithoutFieldSurvey: row.usableWithoutFieldSurvey,
      currentGap: row.currentGap,
      nextAction: row.implementationMethod,
    }));
    res.json({ success: true, data: { version: registry.version, total: registry.rows.length, count: rows.length, rows } });
  }));

  // ارزیابی شواهد روی رجیستر ۱۶۴ — فقط measurement معتبر امتیاز می‌دهد
  router.post('/evidence/assess', asyncRoute(async (req: Request, res: Response) => {
    const request = (req.body ?? {}) as DecisionEvidenceAssessmentRequest;
    if (typeof request.neighborhoodName !== 'string' || !request.neighborhoodName.trim()) {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'neighborhoodName is required' } });
      return;
    }
    if (!Array.isArray(request.observations)) {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'observations must be an array' } });
      return;
    }
    try {
      const aoi = request.boundary?.bbox;
      const satelliteEvidence = options.satelliteCatalog && aoi
        ? collectSatelliteEvidence(options.satelliteCatalog, aoi)
        : undefined;
      const assessment = evidenceService.assess(request, satelliteEvidence);
      res.json({ success: true, data: assessment });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'evidence assessment failed';
      res.status(422).json({ success: false, error: { code: 'EVIDENCE_ASSESSMENT_FAILED', message } });
    }
  }));

  // ─── کالیبراسیون ────────────────────────────────────────────
  router.get('/calibration', asyncRoute(async (_req: Request, res: Response) => {
    res.json({ success: true, data: calibration.getConfig() });
  }));

  router.post('/calibration/sensitivity', asyncRoute(async (req: Request, res: Response) => {
    const { baseScores, weightVariation } = (req.body ?? {}) as { baseScores?: unknown; weightVariation?: unknown };
    if (!baseScores || typeof baseScores !== 'object' || Array.isArray(baseScores)) {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'baseScores object is required' } });
      return;
    }
    const variation = typeof weightVariation === 'number' && Number.isFinite(weightVariation) ? weightVariation : 0.1;
    const result = calibration.sensitivityAnalysis(baseScores as Record<string, number>, variation);
    res.json({ success: true, data: result });
  }));

  // ─── توضیح AI روی کارت تصمیم ────────────────────────────────
  router.post('/explain', asyncRoute(async (req: Request, res: Response) => {
    const { card, question, language } = req.body as { card?: unknown; question?: unknown; language?: unknown };
    if (!card || typeof card !== 'object') {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'card object is required' } });
      return;
    }
    const lang = language === 'en' ? 'en' : 'fa';
    const typedCard = card as import('../src/algorithm/types').DecisionCard;
    // تلاش برای AI؛ در نبود کلید، توضیح قطعی از خود کارت تولید می‌شود
    const aiResult = await generateCausalHypotheses({
      chainGaps: typedCard.chainGaps,
      bottleneck: typedCard.bottleneck,
      fourSourceEvidence: { objective: {}, spatial: {}, behavioral: {}, perceptual: {} },
      capitalScores: Object.fromEntries(typedCard.capitalScores.map(c => [c.capitalKey, c.score])),
      language: lang,
    });
    if (aiResult.ai_used && question) {
      res.json({ success: true, data: { text: aiResult.text, ai_used: true, source: 'anthropic' } });
      return;
    }
    // توضیح قطعی از اجزای کارت — بدون عددسازی
    const triad = typedCard.qualityVerdict;
    const lines = [
      `تحلیل محله ${typedCard.neighborhoodName}:`,
      `Q=${triad.Q} T=${triad.T} R=${triad.R} — تیپ ${typedCard.diagnosticType}`,
      `گلوگاه: سرمایه ${typedCard.bottleneck.capital} در گذار ${typedCard.bottleneck.transition[0]}→${typedCard.bottleneck.transition[1]} (${typedCard.bottleneck.location} — ${typedCard.bottleneck.group})`,
      typedCard.hypotheses.length > 0 ? `مهم‌ترین فرضیه علت: ${typedCard.hypotheses[0].hypothesis}` : 'فرضیه علّی معناداری تولید نشد',
      typedCard.priorityRanking[0] ? `اقدام اول: ${typedCard.interventions.find(i => i.id === typedCard.priorityRanking[0].id)?.name ?? '—'}` : 'اقدام اجرایی فعالی باقی نماند — همه با فیلتر عدم‌مداخله حذف شدند',
    ];
    if (question) lines.push(`درباره «${question}»: پاسخ بر اساس اجزای کارت بالا قابل استناد است؛ برای تحلیل عمیق‌تر کلید AI سرور را تنظیم کنید.`);
    res.json({ success: true, data: { text: lines.join('\n'), ai_used: false, source: 'deterministic_card_summary' } });
  }));

  // پیشنهاد مداخله با AI
  router.post('/ai/intervention-advice', asyncRoute(async (req: Request, res: Response) => {
    const { diagnosticType, chainGaps, capitalScores, constraints, language } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof diagnosticType !== 'string' || !chainGaps || typeof chainGaps !== 'object') {
      res.status(422).json({ success: false, error: { code: 'MISSING_FIELD', message: 'diagnosticType and chainGaps are required' } });
      return;
    }
    const result = await suggestInterventions({
      diagnosticType: diagnosticType as import('../src/algorithm/types').DiagnosticType,
      chainGaps: chainGaps as import('../src/algorithm/types').ChainGaps,
      capitalScores: (capitalScores ?? {}) as Record<string, number>,
      constraints: constraints as Record<string, string | number | undefined> | undefined,
      language: language === 'en' ? 'en' : 'fa',
    });
    res.json({ success: true, data: result });
  }));

  return router;
}
