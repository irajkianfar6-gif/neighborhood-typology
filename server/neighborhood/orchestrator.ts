/**
 * Orchestrator «فقط با نام محله»:
 *   resolve → مرز نسخه‌دار → بافت → شواهد همهٔ کانال‌ها (موازی) → ادغام با اولویت
 *   → نرمال‌سازی مرجع → دروازهٔ انتشار → موتورها فقط روی مقادیر مجاز → کارت V2 + امتناع‌ها
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ALGORITHM_INDICATORS } from '../../src/algorithm/algorithmIndicators';
import type { CapitalKey, ChainStage, DecisionCard } from '../../src/algorithm/types';
import { DecisionSupportService } from '../decisionSupportService';
import { kernelClient } from '../kernelClient';
import { PROJECT_ROOT, serverDataDir } from '../paths';
import { mergeDocumentedValues } from '../evidence/merge';
import { loadReference, thresholdRegistry } from '../evidence/normalize';
import { CAPITAL_KEYS, evaluatePublication, type GateResult, type PublicationLevel } from '../evidence/publicationGate';
import { reliabilityWeights } from '../evidence/reliability';
import type { DocumentedValue, ScoredValue } from '../evidence/types';
import { incCounter, setGauge } from '../ops/metrics';
import { contractValues, customSurveyValues, fieldValues, registerValues, surveyValues } from './channels';
import { buildNeighborhoodContext, type NeighborhoodContext } from './context';
import { cityBBox, type GazetteerEntry, getNeighborhood, publicEntry } from './gazetteer';
import { bboxOf } from './geo';
import { appendRun, detectAnomalies, loadRuns, type RunRecord } from './history';
import { computeOpenIndicators, type CityLayers } from './indicators';
import { ALL_CATEGORIES, getCityLayer, readCachedLayer, type LayerCategory } from './osmLayers';
import { resolveNeighborhood } from './resolver';

/** حداکثر انتظار تحلیل برای هر لایهٔ شهری (میلی‌ثانیه) */
const LAYER_DEADLINE_MS = Number(process.env.ARA_LAYER_DEADLINE_MS || 45_000);

export const METHOD_VERSION = 'ARA-NB-2.0';
const LOWER_BETTER = new Set(ALGORITHM_INDICATORS.filter((i) => i.direction === 'desc').map((i) => i.code));

export interface AnalyzeInput { name?: string; city?: string; neighborhoodId?: string; purpose?: 'baseline' | 'monitoring' | 'intervention_priority'; asOf?: string; offline?: boolean; useKernel?: boolean; skipEngines?: boolean }

export interface DecisionCardV2 {
  schema: 'ara.decision-card.v2';
  generatedAt: string;
  publication: { level: PublicationLevel; reasons: string[] };
  neighborhood: ReturnType<typeof publicEntry> & { boundaryVersion: string; boundaryHash: string; boundarySource: string };
  context: { areaKm2: number; population: number | null; populationSource: string; populationYear: number | null; populationTier: string; density: number | null; gridWeighting: string; warnings: string[] };
  coverage: GateResult['coverage'];
  capitals: Array<{ capital: CapitalKey; level: PublicationLevel; score: number | null; indicatorsUsed: string[] }>;
  indicators: Array<{
    code: string; name: string; capital: CapitalKey; raw: number | null; unit: string; score: number | null; percentile: number | null;
    reliability: number; tier: string; channel: string; source: string; observedAt: string | null; method: string; scoringMethod: string;
    alternatives: ScoredValue['alternatives']; conflict: boolean; missingReason?: string; nextAction?: string; notes?: string[];
  }>;
  abstentions: Array<{ section: 'diagnosticType' | 'equity' | 'trend' | 'causal' | 'engine'; reason: string }>;
  engine: null | {
    runId: string; qualityVerdict: DecisionCard['qualityVerdict']; diagnosticType: DecisionCard['diagnosticType'] | null;
    bottleneck: DecisionCard['bottleneck']; interventions: Array<DecisionCard['interventions'][number] & { library?: unknown }>;
    hypotheses: DecisionCard['hypotheses']; causalLevel: string; finalStatement: string; equityDataStatus: string;
  };
  dataVintage: { oldest: string | null; newest: string | null; staleIndicators: string[] };
  benchmarks: Array<{ code: string; level: 'city'; value: number; source: string }>;
  whatWouldChangeThis: GateResult['missing'];
  survey: { nAccepted: number; adequacy: string; alpha: number | null; marginOfError: number | null; weighting: string } | null;
  fieldAudit: { points: number; kappa: number | null; adequacy: string } | null;
  localRegister: { records: number; indicators: string[]; networkActors: number } | null;
  anomalies: ReturnType<typeof detectAnomalies>;
  reproducibilityKey: Record<string, string>;
  fingerprint: string;
}

export type AnalyzeResult =
  | { status: 'NEEDS_DISAMBIGUATION' | 'NOT_FOUND'; query: string; candidates: Array<ReturnType<typeof publicEntry>>; reason?: string }
  | { status: PublicationLevel; card: DecisionCardV2; evidence: ScoredValue[]; context: NeighborhoodContext; gate: GateResult; engineCard: DecisionCard | null };

function libraryItems(): Array<{ id: string; capital: string; transition: string; name: string; owner: string; costBnRial: number; months: number; targets: string[]; evidence: string }> {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'kernel', 'registries', 'intervention_library_v1.json'), 'utf8')).items; } catch { return []; }
}

function codeVersion(): string {
  if (process.env.ARA_CODE_VERSION) return process.env.ARA_CODE_VERSION;
  try {
    const head = fs.readFileSync(path.join(PROJECT_ROOT, '.git', 'HEAD'), 'utf8').trim();
    const ref = head.startsWith('ref:') ? fs.readFileSync(path.join(PROJECT_ROOT, '.git', head.slice(5).trim()), 'utf8').trim() : head;
    return ref.slice(0, 12);
  } catch { return 'unknown'; }
}

export async function loadCityLayers(entry: GazetteerEntry, offline = false): Promise<{ layers: CityLayers; status: Record<string, string> }> {
  const bbox = cityBBox(entry.citySlug) ?? undefined;
  const layers: CityLayers = {};
  const status: Record<string, string> = {};
  await Promise.all(ALL_CATEGORIES.map(async (cat: LayerCategory) => {
    if (!bbox) { layers[cat] = null; status[cat] = 'NO_BBOX'; return; }
    // واکشی سرد Overpass برای کل شهر ممکن است چند دقیقه طول بکشد؛ تحلیل منتظر نمی‌ماند و
    // واکشی در پس‌زمینه ادامه می‌یابد تا کش برای تحلیل بعدی آماده شود
    const pending = getCityLayer(entry.citySlug, cat, bbox, { offline });
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), LAYER_DEADLINE_MS); });
    const r = await Promise.race([pending, deadline]);
    if (timer) clearTimeout(timer);
    if (!r) {
      pending.catch(() => undefined);
      const stale = readCachedLayer(entry.citySlug, cat);
      layers[cat] = stale?.layer ?? null;
      status[cat] = stale ? 'STALE (در حال به‌روزرسانی)' : 'PENDING (در حال دریافت در پس‌زمینه؛ چند دقیقهٔ دیگر دوباره تحلیل کنید)';
      return;
    }
    layers[cat] = r.layer;
    status[cat] = r.cache + (r.error ? ` (${r.error.slice(0, 80)})` : '');
  }));
  return { layers, status };
}

/** ثبت مرز در kernel (append-only) فقط وقتی hash جدید است */
async function ensureKernelBoundary(entry: GazetteerEntry): Promise<string> {
  const regFile = path.join(serverDataDir(), 'boundary-registrations.json');
  let reg: Record<string, string> = {};
  try { reg = JSON.parse(fs.readFileSync(regFile, 'utf8')); } catch { /* first run */ }
  if (reg[entry.neighborhoodId] === entry.boundary.hash) return 'ALREADY_REGISTERED';
  try {
    // شناسهٔ kernel نام پوشه/فایل می‌شود؛ «:» در ویندوز مجاز نیست
    const kernelId = entry.neighborhoodId.replace(/[^\w.-]/g, '__');
    const { status } = await kernelClient.registerBoundary(kernelId, {
      geometry_geojson: entry.boundary.geojson, crs: 'EPSG:4326',
      tier: entry.boundary.tier === 'official' ? 'official_registry' : entry.boundary.tier === 'osm_admin' ? 'osm_admin' : 'auxiliary_proxy',
      is_official: entry.boundary.tier === 'official', is_proxy: entry.boundary.isProxy,
      provenance: { provenance_ref: `BOUNDARY-${kernelId}-${entry.boundary.hash}`, source_name: entry.boundary.source, dataset_id: entry.boundary.version, timestamp_acquired: new Date().toISOString() },
      note: `${entry.nameFa} — ${entry.cityFa}`,
    });
    if (status === 201) {
      reg[entry.neighborhoodId] = entry.boundary.hash;
      fs.mkdirSync(path.dirname(regFile), { recursive: true });
      fs.writeFileSync(regFile, JSON.stringify(reg, null, 1));
      return 'REGISTERED';
    }
    return `KERNEL_${status}`;
  } catch (error) {
    return `KERNEL_UNAVAILABLE: ${error instanceof Error ? error.message : error}`;
  }
}

/** امتیاز زیرپهنه‌ها (چهار ربع) برای مکان‌یابی گلوگاه از پوشش سلولی شاخص‌های دسترسی */
function subLocationScores(ctx: NeighborhoodContext, values: Map<string, ScoredValue>): Record<string, Record<string, number>> | undefined {
  const lat0 = ctx.gridOrigins.reduce((a, c) => a + c.lat, 0) / ctx.gridOrigins.length;
  const lng0 = ctx.gridOrigins.reduce((a, c) => a + c.lng, 0) / ctx.gridOrigins.length;
  const quad = (c: { lat: number; lng: number }) => `${c.lat >= lat0 ? 'شمال' : 'جنوب'}\u200c${c.lng >= lng0 ? 'شرقی' : 'غربی'}`;
  const out: Record<string, Record<string, number>> = {};
  for (const code of ['P4', 'P5', 'N1']) {
    const cells = values.get(code)?.details?.cells as number[] | undefined;
    if (!cells || cells.length !== ctx.gridOrigins.length) continue;
    const agg = new Map<string, { ok: number; w: number }>();
    ctx.gridOrigins.forEach((c, i) => { const q = quad(c); const a = agg.get(q) ?? { ok: 0, w: 0 }; a.ok += cells[i] * c.weight; a.w += c.weight; agg.set(q, a); });
    for (const [q, a] of agg) if (a.w > 0) (out[q] ??= {})[code] = Math.round((a.ok / a.w) * 1000) / 10;
  }
  return Object.keys(out).length >= 2 ? out : undefined;
}

export async function analyzeByName(input: AnalyzeInput): Promise<AnalyzeResult> {
  // ۱) resolve
  let entry: GazetteerEntry | undefined;
  if (input.neighborhoodId) {
    entry = getNeighborhood(input.neighborhoodId);
    if (!entry) return { status: 'NOT_FOUND', query: input.neighborhoodId, candidates: [], reason: 'UNKNOWN_ID' };
  } else {
    const r = resolveNeighborhood(input.name ?? '', input.city);
    if (!r.best) return { status: 'NOT_FOUND', query: r.query, candidates: [], reason: r.reason };
    if (r.requiresUserChoice) return { status: 'NEEDS_DISAMBIGUATION', query: r.query, candidates: r.candidates.map((c) => publicEntry(c.entry, c.confidence)), reason: r.reason };
    entry = r.best.entry;
  }
  incCounter('ara_neighborhood_analyze_total', { city: entry.citySlug });

  // ۲) مرز + بافت
  const boundaryRegistration = input.useKernel === false ? 'SKIPPED' : await ensureKernelBoundary(entry);
  const ctx = await buildNeighborhoodContext(entry, { useKernel: input.useKernel, asOf: input.asOf });

  // ۳) شواهد موازی از همهٔ کانال‌ها
  const { layers, status: layerStatus } = await loadCityLayers(entry, input.offline);
  const [open, contract] = await Promise.all([
    computeOpenIndicators(entry, ctx, layers, { offline: input.offline, useKernel: input.useKernel }),
    Promise.resolve(contractValues(entry.neighborhoodId, input.asOf)),
  ]);
  const survey = surveyValues(entry.neighborhoodId, ctx);
  const field = fieldValues(entry.neighborhoodId);
  const register = registerValues(entry.neighborhoodId);
  const custom = customSurveyValues(entry.neighborhoodId, ctx);
  // گویه‌های «کنترلی» در ادغام هرگز مقدار اصلی نمی‌شوند (merge.ts)
  const documented: DocumentedValue[] = [...contract.values, ...open, ...survey.values, ...field.values, ...register.values, ...custom.values];

  // ۴) ادغام + نرمال‌سازی + اعتماد
  const merged = mergeDocumentedValues(documented, entry.citySlug);
  const ref = loadReference(entry.citySlug);
  const versions: Record<string, string> = {
    method: METHOD_VERSION,
    indicators: 'core_40',
    thresholds: thresholdRegistry().version,
    reliabilityWeights: reliabilityWeights().version,
    capitalWeights: 'W-v1-equal',
    reference: ref?.version ?? 'none',
    boundary: `${entry.boundary.version}#${entry.boundary.hash}`,
    code: codeVersion(),
  };
  const previous = loadRuns(entry.neighborhoodId, 1)[0];
  const groupValues = { ...contract.groupValues, ...survey.summary.groupValues };
  const groupNs = { ...contract.groupNs, ...survey.summary.groupNs };

  // ۵) دروازهٔ انتشار
  const gate = evaluatePublication({
    values: merged, boundaryTier: entry.boundary.tier,
    surveyAdequacy: survey.summary.nAccepted ? survey.summary.adequacy : 'NONE', surveyAlpha: survey.summary.alpha,
    groupValues, groupNs, previousRunVersions: previous?.versions ?? null, currentVersions: versions,
  });
  setGauge('ara_last_card_level', { neighborhood: entry.neighborhoodId }, gate.level === 'PUBLISHABLE' ? 2 : gate.level === 'PROVISIONAL' ? 1 : 0);
  incCounter('ara_cards_total', { level: gate.level });

  // ۶) موتورها فقط روی مقادیر مجاز
  const abstentions: DecisionCardV2['abstentions'] = [];
  let engine: DecisionCardV2['engine'] = null;
  let engineCard: DecisionCard | null = null;
  if (gate.level === 'INSUFFICIENT') {
    abstentions.push({ section: 'engine', reason: 'سطح کارت INSUFFICIENT است؛ Q/T/R، تیپ و سبد مداخله صادر نمی‌شود' });
  } else if (!input.skipEngines) {
    const indicatorValues: Record<string, number> = {};
    for (const code of gate.usableCodes) {
      const v = merged.get(code)!;
      // سرویس موجود برای شاخص‌های desc مقدار را معکوس می‌کند؛ امتیاز «بالاتر=بهتر» را به جهت خام برمی‌گردانیم
      indicatorValues[code] = LOWER_BETTER.has(code) ? 100 - v.score! : v.score!;
    }
    const prevValues = gate.sections.trend.allowed && previous
      ? Object.fromEntries(Object.entries(previous.scores).filter(([, s]) => s.score !== null).map(([c, s]) => [c, LOWER_BETTER.has(c) ? 100 - s.score! : s.score!]))
      : undefined;
    try {
      const result = new DecisionSupportService().analyze({
        neighborhoodName: `${entry.nameFa} (${entry.cityFa})`, cityOrCounty: entry.cityFa, province: entry.provinceFa,
        purpose: input.purpose ?? 'baseline', indicatorValues,
        groupValues: gate.sections.equity.allowed ? groupValues : undefined,
        subLocationScores: subLocationScores(ctx, merged), previousPeriodIndicatorValues: prevValues,
        population: ctx.population.value ?? undefined,
        aoi: { bbox: bboxOf(entry.boundary.geojson), geometry: entry.boundary.geojson },
      });
      const c = result.card;
      let diagnosticType: DecisionCard['diagnosticType'] | null = c.diagnosticType;
      if (!gate.sections.diagnosticType.allowed) { abstentions.push({ section: 'diagnosticType', reason: gate.sections.diagnosticType.reason! }); diagnosticType = null; }
      let finalStatement = c.finalStatement;
      if (!gate.sections.equity.allowed) {
        abstentions.push({ section: 'equity', reason: gate.sections.equity.reason! });
        if (diagnosticType === 'D') diagnosticType = null;
        finalStatement = finalStatement.replace(/،?\s*عادلانه/g, '').replace(/\s+عادلانه/g, '');
      }
      if (!gate.sections.trend.allowed) abstentions.push({ section: 'trend', reason: gate.sections.trend.reason! });
      if (gate.sections.causal.level !== 'convergent') abstentions.push({ section: 'causal', reason: `فرضیه‌های علّی در سطح «${gate.sections.causal.level}» هستند (${gate.sections.causal.reason ?? ''})` });
      if (diagnosticType === null) finalStatement = `${finalStatement}\n[تیپ تشخیصی صادر نشد: شواهد کافی نیست]`;
      // مداخلهٔ اول باید هم‌راستا با گلوگاه باشد
      const b = c.bottleneck;
      const aligned = (iv: { targetCapital: CapitalKey; targetTransition: [ChainStage, ChainStage] }) => iv.targetCapital === b.capital && iv.targetTransition[0] === b.transition[0] && iv.targetTransition[1] === b.transition[1];
      let interventions: Array<DecisionCard['interventions'][number] & { library?: unknown }> = [...c.interventions].filter((iv) => !iv.excluded);
      const lib = libraryItems().filter((x) => x.capital === b.capital && x.transition === `${b.transition[0]}>${b.transition[1]}`);
      const idx = interventions.findIndex(aligned);
      if (idx > 0) interventions = [interventions[idx], ...interventions.filter((_, i) => i !== idx)];
      else if (idx < 0 && lib.length) {
        const l = lib[0];
        interventions = [{
          id: l.id, name: l.name, targetCapital: b.capital, targetTransition: b.transition, severity: 0, population: ctx.population.value ?? 0,
          leverage: 0, feasibility: 0, equity: 0, family: 'library', description: `${l.evidence} — مسئول: ${l.owner}؛ هزینهٔ تقریبی ${l.costBnRial} میلیارد ریال؛ ${l.months} ماه`,
          library: l,
        } as DecisionCard['interventions'][number] & { library?: unknown }, ...interventions];
      }
      interventions = interventions.map((iv) => {
        const l = libraryItems().find((x) => x.capital === iv.targetCapital && x.transition === `${iv.targetTransition[0]}>${iv.targetTransition[1]}`);
        return l && !iv.library ? { ...iv, library: { id: l.id, owner: l.owner, costBnRial: l.costBnRial, months: l.months } } : iv;
      });
      if (interventions[0]) {
        // جملهٔ نهایی باید همان مداخلهٔ هم‌راستا با گلوگاه را اعلام کند که کارت در رتبهٔ اول نشان می‌دهد
        finalStatement = finalStatement.replace(/اقدام اولویت‌دار: \*\*[^*]+\*\*(\s*\(اولویت [^)]*\))?/, `اقدام اولویت‌دار (هم‌راستا با گلوگاه): **${interventions[0].name}**`);
      }
      engineCard = { ...c, finalStatement, interventions: interventions as DecisionCard['interventions'] };
      engine = {
        runId: result.runId, qualityVerdict: c.qualityVerdict, diagnosticType, bottleneck: c.bottleneck, interventions: interventions.slice(0, 8),
        hypotheses: c.hypotheses, causalLevel: gate.sections.causal.level, finalStatement, equityDataStatus: gate.sections.equity.allowed ? 'measured' : 'missing',
      };
    } catch (error) {
      abstentions.push({ section: 'engine', reason: `موتور تحلیل اجرا نشد: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  // ۷) کارت V2
  const evidence = [...merged.values()];
  const observed = evidence.map((v) => v.observedAt).filter((x): x is string => Boolean(x)).sort();
  const stale = evidence.filter((v) => v.score !== null && v.reliabilityParts.F === 0).map((v) => v.code);
  const capitals = CAPITAL_KEYS.map((k) => {
    const used = ALGORITHM_INDICATORS.filter((i) => i.capitalKey === k && gate.usableCodes.includes(i.code)).map((i) => i.code);
    const level = gate.coverage.byCapital[k].level;
    const scores = used.map((c) => merged.get(c)!.score!);
    return { capital: k, level, score: level !== 'INSUFFICIENT' && scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null, indicatorsUsed: used };
  });
  const indicators = ALGORITHM_INDICATORS.map((ind) => {
    const v = merged.get(ind.code);
    return {
      code: ind.code, name: ind.name, capital: ind.capitalKey,
      raw: v?.raw ?? null, unit: v?.unit ?? '', score: v?.score ?? null, percentile: v?.percentile ?? null, reliability: v?.reliability ?? 0,
      tier: v?.tier ?? 'none', channel: v?.channel ?? 'none', source: v?.source ?? '—', observedAt: v?.observedAt ?? null, method: v?.method ?? '—',
      scoringMethod: v?.scoringMethod ?? 'none', alternatives: v?.alternatives ?? [], conflict: v?.conflict ?? false,
      missingReason: v?.missingReason ?? (v ? undefined : 'هیچ منبعی متصل نیست'), nextAction: v?.nextAction, notes: v?.notes,
    };
  });
  const benchmarks: DecisionCardV2['benchmarks'] = [];
  if (ref) for (const [code, d] of Object.entries(ref.indicators)) {
    if (!d.values.length) continue;
    const median = d.values[Math.floor(d.values.length / 2)];
    benchmarks.push({ code, level: 'city', value: Math.round(median * 100) / 100, source: `میانهٔ ${d.n} محلهٔ ${ref.cityFa} (${ref.version})` });
  }
  const scoresForRun: RunRecord['scores'] = Object.fromEntries(evidence.map((v) => [v.code, { raw: v.raw, score: v.score, reliability: v.reliability, tier: v.tier }]));
  const dataHash = crypto.createHash('sha256').update(JSON.stringify(evidence.map((v) => [v.code, v.raw, v.observedAt, v.source]).sort())).digest('hex').slice(0, 16);
  const reproducibilityKey = { ...versions, data: dataHash };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ reproducibilityKey, scores: scoresForRun, level: gate.level })).digest('hex').slice(0, 24);
  const anomalies = detectAnomalies(entry.neighborhoodId, scoresForRun);

  const card: DecisionCardV2 = {
    schema: 'ara.decision-card.v2',
    generatedAt: new Date().toISOString(),
    publication: { level: gate.level, reasons: gate.reasons },
    neighborhood: { ...publicEntry(entry), boundaryVersion: entry.boundary.version, boundaryHash: entry.boundary.hash, boundarySource: entry.boundary.source },
    context: {
      areaKm2: ctx.areaKm2, population: ctx.population.value, populationSource: ctx.population.source, populationYear: ctx.population.year,
      populationTier: ctx.population.tier, density: ctx.density, gridWeighting: ctx.gridWeighting,
      warnings: [...ctx.warnings, ...Object.entries(layerStatus).filter(([, s]) => !s.startsWith('HIT') && !s.startsWith('MISS')).map(([k, s]) => `لایهٔ ${k}: ${s}`), `ثبت مرز در kernel: ${boundaryRegistration}`],
    },
    coverage: gate.coverage,
    capitals,
    indicators,
    abstentions,
    engine,
    dataVintage: { oldest: observed[0] ?? null, newest: observed[observed.length - 1] ?? null, staleIndicators: stale },
    benchmarks,
    whatWouldChangeThis: gate.missing,
    survey: survey.summary.nReceived ? { nAccepted: survey.summary.nAccepted, adequacy: survey.summary.adequacy, alpha: survey.summary.alpha, marginOfError: survey.summary.marginOfError, weighting: survey.summary.weighting } : null,
    fieldAudit: field.summary.audits ? { points: field.summary.points, kappa: field.summary.kappa, adequacy: field.summary.adequacy } : null,
    localRegister: register.summary.records.length || register.summary.network
      ? { records: register.summary.records.length, indicators: register.summary.indicators.map((i) => i.code), networkActors: register.summary.network?.actors.length ?? 0 }
      : null,
    anomalies,
    reproducibilityKey,
    fingerprint,
  };
  appendRun({ runAt: card.generatedAt, neighborhoodId: entry.neighborhoodId, level: gate.level, fingerprint, versions, scores: scoresForRun, triad: engine?.qualityVerdict ? { Q: engine.qualityVerdict.Q, T: engine.qualityVerdict.T, R: engine.qualityVerdict.R } : null, engineRunId: engine?.runId ?? null });
  return { status: gate.level, card, evidence, context: ctx, gate, engineCard };
}
