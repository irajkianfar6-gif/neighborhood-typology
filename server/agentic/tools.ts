/**
 * کاتالوگ ابزارهای استاندارد پلتفرم (TOOLS-v3؛ فاز ۳: پژوهش، فاز ۴: سناریو، نقاد، پیمایش و داشبورد) — پوشش ابزاری روی موتورهای قطعی موجود.
 * هر ابزار: نام، توضیح، ردهٔ کارکردی، طرح‌وارهٔ ورودی/خروجی JSON، نشانه‌های رفتاری (فقط‌خواندنی، باز به جهان)،
 * سقف زمان و پیاده‌سازی. هیچ ابزاری عدد نمی‌سازد؛ همه از موتورهای ARA-NB، evidence، LR و kernel می‌آیند.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../paths';
import { listCities, publicEntry } from '../neighborhood/gazetteer';
import { resolveNeighborhood } from '../neighborhood/resolver';
import { loadRuns } from '../neighborhood/history';
import { rakingTargetsFrom, surveyOptionsFor } from '../neighborhood/channels';
import { mergeDocumentedValues } from '../evidence/merge';
import { RELIABLE, USABLE } from '../evidence/publicationGate';
import { assessLayers } from '../official/tehranLayers';
import { tehranDistrictOf } from '../official/tehranReference';
import { summarizeSurvey } from '../survey/perceptualSurvey';
import { summarizeAudits } from '../survey/fieldAudit';
import { summarizeRegister } from '../survey/localRegister';
import { buildCollectionPlan } from '../survey/collectionPlan';
import { listManifests, toSummary, validateManifests } from '../sources/manifests';
import { EVIDENCE_PACKET_VERSION, independenceSummary, toEvidencePacket } from './evidencePacket';
import { verifyAnalysis, CRITIC_VERSION } from './critic';
import { renderReport } from './report';
import { AGENT_POLICY_VERSION } from './agents';
import { analysisFor, contextFor, evidenceFor, requireEntry, runAnalysis, ToolInputError, type RunOptions } from './state';
import type { JsonSchema } from './schema';
import { RESEARCH_TOOLS } from './research/researchTools';
import { PHASE4_TOOLS } from './phase4Tools';

export const TOOLS_VERSION = 'TOOLS-v3';

export type ToolCategory = 'identity' | 'data' | 'quality' | 'measurement' | 'diagnosis' | 'prescription' | 'survey' | 'governance' | 'report' | 'research';
export interface ToolContext { agentId: string; runId: string | null }
export interface ToolDef {
  name: string; title: string; description: string; category: ToolCategory;
  readOnly: boolean; idempotent: boolean; openWorld: boolean; timeoutMs: number;
  inputSchema: JsonSchema; outputSchema: JsonSchema;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<Record<string, unknown>>;
  summarize?: (output: Record<string, unknown>) => string;
}

// ---------- قطعه‌های مشترک طرح‌واره ----------
const NB_ID: JsonSchema = { type: 'string', minLength: 3, maxLength: 80, pattern: '^[a-z0-9_-]+:[A-Za-z0-9_.-]+$', description: 'شناسهٔ یکتای محله، مثل tehran:m605' };
const RUN_PROPS: Record<string, JsonSchema> = {
  offline: { type: 'boolean', default: false, description: 'فقط کش محلی؛ بدون درخواست شبکه' },
  useKernel: { type: 'boolean', default: false, description: 'استفاده از kernel پایتون (در صورت اجرا بودن)' },
  asOf: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'تاریخ مبنا YYYY-MM-DD' },
};
const ANALYSIS_INPUT: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: { analysisId: { type: 'string', minLength: 8, maxLength: 64, description: 'اثرانگشت تحلیل از run_analysis' }, neighborhoodId: NB_ID, ...RUN_PROPS },
};
const NB_INPUT = (extra: Record<string, JsonSchema> = {}): JsonSchema => ({ type: 'object', additionalProperties: false, required: ['neighborhoodId'], properties: { neighborhoodId: NB_ID, ...extra } });
const OBJ = (required: string[], properties: Record<string, JsonSchema> = {}): JsonSchema => ({ type: 'object', required, properties });
const runOpts = (i: Record<string, unknown>): RunOptions => ({ offline: Boolean(i.offline), useKernel: i.useKernel === true, asOf: i.asOf as string | undefined, purpose: i.purpose as RunOptions['purpose'] });
const anInput = (i: Record<string, unknown>) => ({ analysisId: i.analysisId as string | undefined, neighborhoodId: i.neighborhoodId as string | undefined, ...runOpts(i) });

function library(): { version: string; items: Array<Record<string, unknown> & { capital: string; transition: string }> } {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'kernel', 'registries', 'intervention_library_v1.json'), 'utf8')); } catch { return { version: 'none', items: [] }; }
}

export const TOOLS: ToolDef[] = [
  // ---------------- هویت و مرز ----------------
  {
    name: 'list_cities', title: 'فهرست شهرها', category: 'identity', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 5_000,
    description: 'شهرهای موجود در گزتیر و تعداد محلهٔ هر شهر.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    outputSchema: OBJ(['cities'], { cities: { type: 'array' } }),
    handler: async () => ({ cities: listCities() }),
    summarize: (o) => `${(o.cities as unknown[]).length} شهر`,
  },
  {
    name: 'resolve_neighborhood', title: 'شناسایی محله از نام', category: 'identity', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 5_000,
    description: 'نام فارسی محله (و شهر اختیاری) را به شناسهٔ یکتا تبدیل می‌کند. اگر نام مبهم یا اطمینان کم باشد requiresUserChoice=true و هرگز به‌تنهایی انتخاب نمی‌کند (دروازهٔ G1).',
    inputSchema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 2, maxLength: 120 }, city: { type: 'string', maxLength: 60 }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 } } },
    outputSchema: OBJ(['query', 'requiresUserChoice', 'best', 'candidates'], { requiresUserChoice: { type: 'boolean' }, best: { type: ['object', 'null'] }, candidates: { type: 'array' } }),
    handler: async (i) => {
      const r = resolveNeighborhood(String(i.name), i.city as string | undefined, Number(i.limit ?? 8));
      return { query: r.query, requiresUserChoice: r.requiresUserChoice, reason: r.reason ?? null, best: r.best ? publicEntry(r.best.entry, r.best.confidence) : null, candidates: r.candidates.map((c) => ({ ...publicEntry(c.entry, c.confidence), matchedOn: c.matchedOn })) };
    },
    summarize: (o) => (o.best ? `${(o.best as { nameFa: string }).nameFa} (${(o.best as { neighborhoodId: string }).neighborhoodId})${o.requiresUserChoice ? ' — نیازمند انتخاب کاربر' : ''}` : 'یافت نشد'),
  },
  {
    name: 'get_neighborhood_profile', title: 'شناسنامه و مرز محله', category: 'identity', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 5_000,
    description: 'مشخصات رسمی محله: نام، منطقه، استان، رده و نسخهٔ مرز، هش مرز و منطقهٔ شهرداری.',
    inputSchema: NB_INPUT(),
    outputSchema: OBJ(['neighborhood', 'boundary']),
    handler: async (i) => {
      const e = requireEntry(String(i.neighborhoodId));
      return { neighborhood: publicEntry(e), boundary: { tier: e.boundary.tier, isProxy: e.boundary.isProxy, version: e.boundary.version, hash: e.boundary.hash, source: e.boundary.source, areaKm2: e.boundary.areaKm2 }, tehranDistrict: tehranDistrictOf(e.neighborhoodId) ?? null };
    },
    summarize: (o) => `${(o.neighborhood as { nameFa: string }).nameFa} — مرز ${(o.boundary as { tier: string }).tier}`,
  },
  {
    name: 'build_context', title: 'بافت جمعیتی و مکانی', category: 'identity', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 60_000,
    description: 'مساحت، جمعیت (با منبع، سال و رده)، تراکم و شبکهٔ سلولی وزن‌دار محله؛ مخرج مشترک همهٔ سنجه‌ها.',
    inputSchema: NB_INPUT(RUN_PROPS),
    outputSchema: OBJ(['areaKm2', 'population', 'populationSource']),
    handler: async (i) => {
      const ctx = await contextFor(requireEntry(String(i.neighborhoodId)), runOpts(i));
      return { areaKm2: ctx.areaKm2, population: ctx.population.value, populationSource: ctx.population.source, populationYear: ctx.population.year, populationTier: ctx.population.tier, density: ctx.density, gridCells: ctx.gridOrigins.length, gridWeighting: ctx.gridWeighting, warnings: ctx.warnings };
    },
    summarize: (o) => `جمعیت ${o.population ?? '—'} (${o.populationSource})، ${o.areaKm2} کیلومترمربع`,
  },
  // ---------------- داده ----------------
  {
    name: 'list_data_sources', title: 'فهرست منابع داده', category: 'data', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 5_000,
    description: 'منابع دادهٔ ثبت‌شده با مجوز، تناوب، سطح مکانی، نقش (امتیازپذیر/فقط شاهد) و شاخص‌های پوشش‌داده. با indicator فیلتر می‌شود.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { indicator: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,15}$' } } },
    outputSchema: OBJ(['sources', 'validation']),
    handler: async (i) => {
      const all = listManifests().map(toSummary);
      const sources = i.indicator ? all.filter((s) => s.indicators.includes(String(i.indicator))) : all;
      const v = validateManifests();
      return { sources, validation: { ok: v.ok, errors: v.errors.length, warnings: v.warnings.length } };
    },
    summarize: (o) => `${(o.sources as unknown[]).length} منبع`,
  },
  {
    name: 'collect_evidence', title: 'گردآوری شواهد از همهٔ کانال‌ها', category: 'data', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 180_000,
    description: 'شواهد خام محله را از کانال‌های باز (OSM/ماهواره/دادهٔ باز)، قرارداد رسمی، پیمایش، ممیزی میدانی، ثبت محلی، پرسشنامهٔ سفارشی و لایه‌های محله‌ای جمع می‌کند و به بستهٔ شاهد استاندارد ara.evidence-packet.v1 تبدیل می‌کند.',
    inputSchema: NB_INPUT({ ...RUN_PROPS, channels: { type: 'array', items: { enum: ['open_auto', 'contract', 'survey', 'field', 'satellite', 'expert'] } } }),
    outputSchema: OBJ(['neighborhoodId', 'packets', 'byChannel'], { packets: { type: 'array' } }),
    handler: async (i, ctx) => {
      const e = requireEntry(String(i.neighborhoodId));
      const { gathered } = await evidenceFor(e, runOpts(i));
      const channels = (i.channels as string[] | undefined) ?? null;
      const packets = gathered.documented.filter((v) => !channels || channels.includes(v.channel)).map((v) => toEvidencePacket(v, e.neighborhoodId, `agent:${ctx.agentId}`));
      const byChannel: Record<string, number> = {};
      for (const p of packets) byChannel[p.channel] = (byChannel[p.channel] ?? 0) + (p.value !== null ? 1 : 0);
      return { neighborhoodId: e.neighborhoodId, contract: EVIDENCE_PACKET_VERSION, packets, withValue: packets.filter((p) => p.value !== null).length, byChannel, layerStatus: gathered.layerStatus };
    },
    summarize: (o) => `${o.withValue}/${(o.packets as unknown[]).length} بستهٔ دارای مقدار`,
  },
  // ---------------- کیفیت ----------------
  {
    name: 'assess_evidence', title: 'ارزیابی کیفیت و منشأ شواهد', category: 'quality', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 180_000,
    description: 'ادغام شواهد با سلسله‌مراتب کانال‌ها، نرمال‌سازی مرجع شهری و محاسبهٔ اعتبار (رده، سطح مکانی، تازگی، کفایت، هم‌گرایی). تضادها، شواهد کم‌اعتبار، کهنه و گروه‌های وابسته (منشأ مشترک) را گزارش می‌کند.',
    inputSchema: NB_INPUT({ ...RUN_PROPS, includePackets: { type: 'boolean', default: false } }),
    outputSchema: OBJ(['scored', 'reliable', 'usable', 'conflicts', 'independence']),
    handler: async (i, ctx) => {
      const e = requireEntry(String(i.neighborhoodId));
      const { gathered } = await evidenceFor(e, runOpts(i));
      const merged = [...mergeDocumentedValues(gathered.documented, e.citySlug).values()];
      const packets = merged.map((v) => toEvidencePacket(v, e.neighborhoodId, `agent:${ctx.agentId}`));
      const scored = merged.filter((v) => v.score !== null);
      const byTier: Record<string, number> = {};
      for (const v of scored) byTier[v.tier] = (byTier[v.tier] ?? 0) + 1;
      return {
        neighborhoodId: e.neighborhoodId, thresholds: { reliable: RELIABLE, usable: USABLE },
        assessed: merged.length, scored: scored.length, reliable: scored.filter((v) => v.reliability >= RELIABLE).length, usable: scored.filter((v) => v.reliability >= USABLE).length, byTier,
        lowReliability: scored.filter((v) => v.reliability < USABLE).map((v) => ({ code: v.code, reliability: v.reliability, tier: v.tier })),
        conflicts: merged.filter((v) => v.conflict).map((v) => ({ code: v.code, chosen: v.source, alternatives: v.alternatives })),
        stale: scored.filter((v) => v.reliabilityParts.F === 0).map((v) => v.code),
        independence: independenceSummary(packets),
        ...(i.includePackets ? { packets } : {}),
      };
    },
    summarize: (o) => `${o.scored} امتیازدار، ${o.reliable} قابل اتکا، ${(o.conflicts as unknown[]).length} تضاد`,
  },
  {
    name: 'evaluate_publication_gate', title: 'دروازهٔ انتشار', category: 'quality', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'سطح کارت (قابل انتشار/موقت/ناکافی)، پوشش هر سرمایه، مجوز بخش‌ها (تیپ، عدالت، روند، علّی) و فهرست دادهٔ گم‌شده با مسئول و اقدام بعدی.',
    inputSchema: ANALYSIS_INPUT,
    outputSchema: OBJ(['level', 'coverage', 'sections', 'missing']),
    handler: async (i) => {
      const { gate } = await analysisFor(anInput(i));
      return { level: gate.level, reasons: gate.reasons, coverage: gate.coverage, sections: gate.sections, usableCodes: gate.usableCodes, missing: gate.missing };
    },
    summarize: (o) => `سطح ${o.level}`,
  },
  // ---------------- سنجه ----------------
  {
    name: 'run_analysis', title: 'اجرای موتور سنجه (قطعی)', category: 'measurement', readOnly: false, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'موتور قطعی ARA-NB را اجرا می‌کند (همان «بازمحاسبه» در برنامه): ادغام، نرمال‌سازی، دروازهٔ انتشار، موتور تصمیم و لایه‌های محله‌ای. کارت در برنامه ذخیره می‌شود. خروجی analysisId برای ابزارهای بعدی است.',
    inputSchema: NB_INPUT({ ...RUN_PROPS, purpose: { enum: ['baseline', 'monitoring', 'intervention_priority'], default: 'baseline' }, persist: { type: 'boolean', default: true }, force: { type: 'boolean', default: false } }),
    outputSchema: OBJ(['analysisId', 'neighborhoodId', 'level', 'capitals', 'reproducibilityKey']),
    handler: async (i) => {
      const r = await runAnalysis(requireEntry(String(i.neighborhoodId)), { ...runOpts(i), persist: i.persist !== false, force: i.force === true });
      const c = r.card;
      return { analysisId: c.fingerprint, neighborhoodId: c.neighborhood.neighborhoodId, nameFa: c.neighborhood.nameFa, level: c.publication.level, reasons: c.publication.reasons, generatedAt: c.generatedAt, capitals: c.capitals, scoredIndicators: c.indicators.filter((x) => x.score !== null).length, engineAvailable: c.engine !== null, abstentions: c.abstentions, reproducibilityKey: c.reproducibilityKey };
    },
    summarize: (o) => `سطح ${o.level}، ${o.scoredIndicators} شاخص امتیازدار، تحلیل ${String(o.analysisId).slice(0, 8)}`,
  },
  // ---------------- تشخیص ----------------
  {
    name: 'locate_bottleneck', title: 'مکان‌یابی گلوگاه', category: 'diagnosis', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'گلوگاه زنجیرهٔ سرمایه (سرمایه × گذار)، سه‌گانهٔ کیفیت Q/T/R و تیپ تشخیصی؛ اگر شواهد کافی نباشد، دلیل امتناع را برمی‌گرداند.',
    inputSchema: ANALYSIS_INPUT,
    outputSchema: OBJ(['available']),
    handler: async (i) => {
      const { card } = await analysisFor(anInput(i));
      if (!card.engine) return { available: false, reason: card.abstentions.find((a) => a.section === 'engine')?.reason ?? 'موتور اجرا نشد' };
      return { available: true, bottleneck: card.engine.bottleneck, qualityVerdict: card.engine.qualityVerdict, diagnosticType: card.engine.diagnosticType, abstentions: card.abstentions.filter((a) => a.section === 'diagnosticType' || a.section === 'equity') };
    },
    summarize: (o) => (o.available ? `گلوگاه ${(o.bottleneck as { capital: string }).capital}: ${(o.bottleneck as { transition: string[] }).transition.join('→')}` : `امتناع: ${o.reason}`),
  },
  {
    name: 'test_hypotheses', title: 'آزمون فرضیه‌های علّی', category: 'diagnosis', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'فرضیه‌های علّی موتور با وضعیت شواهد، منابع و آزمون‌های لایه‌های محله‌ای (ناامنی/کیفیت/هزینه)؛ سطح علّی دروازه (اولیه/هم‌گرا/آزموده).',
    inputSchema: ANALYSIS_INPUT,
    outputSchema: OBJ(['causalLevel', 'hypotheses']),
    handler: async (i) => {
      const { card, gate } = await analysisFor(anInput(i));
      return { causalLevel: gate.sections.causal.level, reason: gate.sections.causal.reason ?? null, hypotheses: card.engine?.hypotheses ?? [], layerTests: card.localLayers?.hypothesisTests ?? [] };
    },
    summarize: (o) => `${(o.hypotheses as unknown[]).length} فرضیه، سطح ${o.causalLevel}`,
  },
  {
    name: 'assess_local_layers', title: 'لایه‌های محله‌ای (LR-v1)', category: 'diagnosis', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 15_000,
    description: 'سنجه‌ها، یافته‌ها، آزمون فرضیه و تجویزهای لایه‌های محله‌ای تهران (روشنایی، استطاعت مسکن، اشتغال پایدار، تحصیلات). با analysisId، نسخهٔ اصلاح‌شده با پیمایش/ممیزی و گلوگاه کارت را می‌دهد.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { neighborhoodId: NB_ID, analysisId: { type: 'string', minLength: 8, maxLength: 64 } } },
    outputSchema: OBJ(['available']),
    handler: async (i) => {
      if (i.analysisId) { const { card } = await analysisFor(anInput(i)); return { available: Boolean(card.localLayers), assessment: card.localLayers }; }
      if (!i.neighborhoodId) throw new ToolInputError('INVALID_INPUT', 'neighborhoodId یا analysisId لازم است');
      const a = assessLayers(requireEntry(String(i.neighborhoodId)).neighborhoodId);
      return { available: Boolean(a), assessment: a, note: a ? null : 'لایهٔ محله‌ای برای این شهر موجود نیست' };
    },
    summarize: (o) => (o.available ? `${((o.assessment as { findings: unknown[] }).findings).length} یافته، ${((o.assessment as { prescriptions: unknown[] }).prescriptions).length} تجویز` : 'لایه موجود نیست'),
  },
  // ---------------- تجویز ----------------
  {
    name: 'map_interventions', title: 'نگاشت به کتابخانهٔ مداخلات', category: 'prescription', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'مداخله‌های پیشنهادی موتور (رتبهٔ اول هم‌راستا با گلوگاه) و تجویزهای مبتنی بر یافتهٔ لایه‌ها با پیش‌نیاز، شاخص پایش، هزینه و مسئول. همه «پیشنهاد» و نیازمند تصویب کارشناس‌اند.',
    inputSchema: ANALYSIS_INPUT,
    outputSchema: OBJ(['approvalRequired', 'engineInterventions', 'layerPrescriptions']),
    handler: async (i) => {
      const { card } = await analysisFor(anInput(i));
      const b = card.engine?.bottleneck ?? null;
      const engineInterventions = (card.engine?.interventions ?? []).map((iv, rank) => ({
        rank: rank + 1, id: iv.id, name: iv.name, targetCapital: iv.targetCapital, targetTransition: iv.targetTransition,
        alignedWithBottleneck: Boolean(b && iv.targetCapital === b.capital && iv.targetTransition?.[0] === b.transition[0] && iv.targetTransition?.[1] === b.transition[1]),
        library: (iv as { library?: unknown }).library ?? null,
      }));
      return { libraryVersion: library().version, bottleneck: b, approvalRequired: true, engineInterventions, layerPrescriptions: card.localLayers?.prescriptions ?? [] };
    },
    summarize: (o) => `${(o.engineInterventions as unknown[]).length} مداخلهٔ موتور + ${(o.layerPrescriptions as unknown[]).length} تجویز لایه‌ها`,
  },
  {
    name: 'get_intervention_library', title: 'کتابخانهٔ مداخلات', category: 'prescription', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 5_000,
    description: 'اقلام کتابخانهٔ مداخلات نسخه‌دار، با فیلتر سرمایه (H,S,E,P,N,C,G,R) و گذار (مثل A>U).',
    inputSchema: { type: 'object', additionalProperties: false, properties: { capital: { enum: ['H', 'S', 'E', 'P', 'N', 'C', 'G', 'R'] }, transition: { type: 'string', pattern: '^[A-Z]>[A-Z]$' } } },
    outputSchema: OBJ(['version', 'items']),
    handler: async (i) => {
      const lib = library();
      return { version: lib.version, items: lib.items.filter((x) => (!i.capital || x.capital === i.capital) && (!i.transition || x.transition === i.transition)) };
    },
    summarize: (o) => `${o.version}: ${(o.items as unknown[]).length} قلم`,
  },
  // ---------------- پیمایش و میدان ----------------
  {
    name: 'get_collection_plan', title: 'برنامهٔ گردآوری داده', category: 'survey', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 60_000,
    description: 'وضعیت ماژول‌های گردآوری (پیمایش، خانوار، اقتصاد، ممیزی، ثبت محلی، شبکه)، حجم نمونهٔ توصیه‌شده و شاخص‌هایی که با تکمیل هر ماژول باز می‌شوند.',
    inputSchema: NB_INPUT(),
    outputSchema: OBJ(['modules', 'recommendedN']),
    handler: async (i) => {
      const e = requireEntry(String(i.neighborhoodId));
      const ctx = await contextFor(e, { useKernel: false });
      const survey = summarizeSurvey(e.neighborhoodId, rakingTargetsFrom(ctx), surveyOptionsFor(e.neighborhoodId));
      let cardIndicators: Array<{ code: string; score: number | null; channel: string; tier: string }> = [];
      try { cardIndicators = (await analysisFor({ neighborhoodId: e.neighborhoodId, offline: true, analysisId: undefined })).card.indicators; } catch { /* بدون کارت */ }
      return buildCollectionPlan({ survey, audit: summarizeAudits(e.neighborhoodId), register: summarizeRegister(e.neighborhoodId), population: ctx.population.value, cardIndicators }) as unknown as Record<string, unknown>;
    },
    summarize: (o) => `پیشرفت کل ${Math.round(Number(o.overall) * 100)}٪، نمونهٔ توصیه‌شده ${o.recommendedN}`,
  },
  {
    name: 'summarize_field_audits', title: 'خلاصهٔ ممیزی میدانی', category: 'survey', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'تعداد نقاط ممیزی، میانگین گویه‌ها (روشنایی، ایمنی، …)، توافق ممیزان (کاپا) و کفایت.',
    inputSchema: NB_INPUT(),
    outputSchema: OBJ(['points']),
    handler: async (i) => summarizeAudits(requireEntry(String(i.neighborhoodId)).neighborhoodId) as unknown as Record<string, unknown>,
    summarize: (o) => `${o.points} نقطه`,
  },
  // ---------------- حاکمیت ----------------
  {
    name: 'get_run_history', title: 'تاریخچهٔ اجراها', category: 'governance', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'اجراهای پیشین محله با سطح، اثرانگشت، نسخه‌ها و سه‌گانهٔ کیفیت؛ تغییر نسخه‌ها میان دو اجرای آخر را مشخص می‌کند.',
    inputSchema: NB_INPUT({ limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 } }),
    outputSchema: OBJ(['runs', 'versionChanges']),
    handler: async (i) => {
      const runs = loadRuns(requireEntry(String(i.neighborhoodId)).neighborhoodId, Number(i.limit ?? 20));
      const [a, b] = runs;
      const versionChanges = a && b ? Object.keys({ ...a.versions, ...b.versions }).filter((k) => a.versions[k] !== b.versions[k]).map((k) => ({ key: k, from: b.versions[k] ?? null, to: a.versions[k] ?? null })) : [];
      return { runs: runs.map((r) => ({ runAt: r.runAt, level: r.level, fingerprint: r.fingerprint, triad: r.triad ?? null, versions: r.versions })), versionChanges };
    },
    summarize: (o) => `${(o.runs as unknown[]).length} اجرا`,
  },
  {
    name: 'get_reproducibility_key', title: 'کلید بازتولید', category: 'governance', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'کلید کامل بازتولید تحلیل: نسخهٔ روش، آستانه‌ها، وزن‌ها، مرجع، لایه‌ها، کتابخانهٔ مداخلات، مرز، کد و هش داده؛ به‌علاوهٔ نسخهٔ ابزارها، سیاست عامل‌ها، قرارداد شاهد و نقاد.',
    inputSchema: ANALYSIS_INPUT,
    outputSchema: OBJ(['analysisId', 'key', 'framework']),
    handler: async (i) => {
      const { card } = await analysisFor(anInput(i));
      return { analysisId: card.fingerprint, key: card.reproducibilityKey, framework: { tools: TOOLS_VERSION, agentPolicy: AGENT_POLICY_VERSION, evidenceContract: EVIDENCE_PACKET_VERSION, critic: CRITIC_VERSION } };
    },
    summarize: (o) => `${Object.keys(o.key as object).length} مؤلفه`,
  },
  {
    name: 'verify_analysis', title: 'بازبینی نقاد', category: 'governance', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'بازبینی قطعی پیش از گزارش: منشأ هر عدد، اعتبار بسته‌های شاهد و هش، قاعدهٔ عدالت، اجرای موتور روی کارت ناکافی، سازگاری متن و عدد، هم‌راستایی با گلوگاه، استقلال شواهد، کلید بازتولید، تازگی، تضاد و سطح علّی.',
    inputSchema: ANALYSIS_INPUT,
    outputSchema: OBJ(['verdict', 'checks', 'officialPublicationAllowed']),
    handler: async (i) => verifyAnalysis(await analysisFor(anInput(i))) as unknown as Record<string, unknown>,
    summarize: (o) => `حکم نقاد: ${o.verdict}`,
  },
  // ---------------- گزارش ----------------
  {
    name: 'render_report', title: 'گزارش دولایه', category: 'report', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: 'گزارش فارسی Markdown از کارت تصمیم. لایهٔ analytical همیشه؛ لایهٔ official فقط اگر کارت قابل انتشار باشد و نقاد مجاز کند. هر عدد با منبع.',
    inputSchema: { ...ANALYSIS_INPUT, properties: { ...ANALYSIS_INPUT.properties, layer: { enum: ['analytical', 'official'], default: 'analytical' } } },
    outputSchema: OBJ(['layer', 'allowed', 'markdown']),
    handler: async (i) => {
      const r = await analysisFor(anInput(i));
      return renderReport(r, verifyAnalysis(r), (i.layer as 'analytical' | 'official') ?? 'analytical') as unknown as Record<string, unknown>;
    },
    summarize: (o) => (o.allowed ? `گزارش ${o.layer} (${String(o.markdown).length} نویسه)` : `گزارش ${o.layer} مجاز نیست: ${o.reason}`),
  },
  // ---------------- پژوهش خودکار (فاز ۳) ----------------
  ...RESEARCH_TOOLS,
  // ---------------- سناریو، نقاد، پیمایش و پایش (فاز ۴) ----------------
  ...PHASE4_TOOLS,
];
