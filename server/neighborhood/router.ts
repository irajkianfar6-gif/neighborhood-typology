/**
 * API یکپارچهٔ «فقط با نام محله» + ورود داده (قرارداد، پیمایش، ممیزی).
 * زیر /api/decision-support نصب می‌شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { PROJECT_ROOT, serverDataDir } from '../paths';
import type { AuthedRequest } from '../security/auth';
import { CONTRACT_COLUMNS, createBatch, getBatch, listBatches, reviewBatch, tokenFingerprint } from '../ingestion/contractData';
import { persistRun, storageStatus } from '../db/store';
import { addResponses, LIKERT_ITEMS, summarizeSurvey, type SurveyResponseInput } from '../survey/perceptualSurvey';
import { addAudits, AUDIT_ITEM_LABELS, summarizeAudits, type AuditInput } from '../survey/fieldAudit';
import { addRecords, MIN_ACTORS, MIN_RECORDS, REGISTER_KINDS, saveNetwork, summarizeRegister, voidEntry, type NetworkInput, type RegisterRecordInput } from '../survey/localRegister';
import { HOUSEHOLD_INDICATORS, INSTRUMENT_VERSION, SURVEY_SECTIONS } from '../../src/algorithm/surveyInstrument';
import { CORE_40_NAMES, buildCollectionPlan } from '../survey/collectionPlan';
import { getNeighborhood, listCities, publicEntry } from './gazetteer';
import { loadRuns } from './history';
import { analyzeByName, type AnalyzeResult } from './orchestrator';
import { resolveNeighborhood } from './resolver';
import { rakingTargetsFrom, surveyOptionsFor } from './channels';
import { districtProfile, incomeBenchmark, listOfficialPacks, readOfficialPack, tehranDistrictOf } from '../official/tehranReference';
import { assessLayers } from '../official/tehranLayers';
import { buildNeighborhoodContext } from './context';
import { schedulerStatus } from '../scheduler';
import { createCustomSurveyRouter } from '../survey/customSurveyRouter';

const asyncRoute = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const fail = (res: Response, status: number, code: string, message: string, details?: unknown) => res.status(status).json({ success: false, error: { code, message, details } });

const TEMPLATE_DIR = path.join(PROJECT_ROOT, 'templates', 'data-contracts');
function cardFile(id: string) {
  const dir = path.join(serverDataDir(), 'neighborhood-cards');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id.replace(/[^\w.-]/g, '_')}.json`);
}
function latest(id: string): Extract<AnalyzeResult, { card: unknown }> | null {
  const f = cardFile(id);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

/** وضعیت هر بستهٔ رسمی: آیا با همان محتوا (sha256) دسته‌ای ساخته/تأیید شده است؟ */
function packStatus() {
  const batches = listBatches();
  return listOfficialPacks().map((p) => {
    const b = batches.find((x) => x.fileSha256 === p.sha256 && x.status !== 'REJECTED' && x.status !== 'INVALID');
    return { ...p, batch: b ? { batchId: b.batchId, status: b.status, uploadedAt: b.uploadedAt, accepted: b.stats.accepted } : null };
  });
}

export function createNeighborhoodRouter(): Router {
  const router = Router();
  router.use('/custom-surveys', createCustomSurveyRouter());

  // ---------- Resolver ----------
  router.get('/neighborhoods/resolve', (req, res) => {
    const name = String(req.query.name ?? '').trim();
    if (!name) { fail(res, 400, 'INVALID_INPUT', 'پارامتر name لازم است'); return; }
    const r = resolveNeighborhood(name, req.query.city ? String(req.query.city) : undefined);
    ok(res, { query: r.query, requiresUserChoice: r.requiresUserChoice, reason: r.reason, best: r.best ? publicEntry(r.best.entry, r.best.confidence) : null, candidates: r.candidates.map((c) => publicEntry(c.entry, c.confidence)) });
  });
  router.get('/neighborhoods/cities', (_req, res) => { ok(res, listCities()); });
  router.get('/neighborhoods/:id/boundary', (req, res) => {
    const e = getNeighborhood(req.params.id);
    if (!e) { fail(res, 404, 'NOT_FOUND', 'محله یافت نشد'); return; }
    ok(res, { ...publicEntry(e), boundary: { source: e.boundary.source, tier: e.boundary.tier, version: e.boundary.version, hash: e.boundary.hash, isProxy: e.boundary.isProxy, geojson: e.boundary.geojson } });
  });

  // ---------- Analyze ----------
  router.post('/neighborhoods/analyze', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as { name?: string; city?: string; neighborhoodId?: string; asOf?: string; purpose?: 'baseline' | 'monitoring' | 'intervention_priority' };
    if (!body.name && !body.neighborhoodId) { fail(res, 400, 'INVALID_INPUT', 'name یا neighborhoodId لازم است'); return; }
    if (body.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(body.asOf)) { fail(res, 400, 'INVALID_INPUT', 'asOf باید YYYY-MM-DD باشد'); return; }
    const result = await analyzeByName({ name: body.name, city: body.city, neighborhoodId: body.neighborhoodId, asOf: body.asOf, purpose: body.purpose });
    if (result.status === 'NOT_FOUND') { fail(res, 404, 'NOT_FOUND', 'محله‌ای با این نام در گزتیر یافت نشد', result); return; }
    if (!('card' in result)) { ok(res, result); return; }
    fs.writeFileSync(cardFile(result.card.neighborhood.neighborhoodId), JSON.stringify(result));
    const entry = getNeighborhood(result.card.neighborhood.neighborhoodId);
    if (entry) void persistRun(`${entry.neighborhoodId}@${result.card.generatedAt}`, entry, result.card, result.evidence, (req as AuthedRequest).araRole);
    ok(res, { status: result.status, card: result.card, engineCard: result.engineCard });
  }));
  router.get('/neighborhoods/:id/card', (req, res) => {
    const l = latest(req.params.id);
    if (!l) { fail(res, 404, 'NO_RUN', 'برای این محله هنوز تحلیلی اجرا نشده است'); return; }
    ok(res, l.card);
  });
  router.get('/neighborhoods/:id/evidence', (req, res) => {
    const l = latest(req.params.id);
    if (!l) { fail(res, 404, 'NO_RUN', 'برای این محله هنوز تحلیلی اجرا نشده است'); return; }
    ok(res, { generatedAt: l.card.generatedAt, evidence: l.evidence, context: { ...l.context, gridOrigins: undefined, gridCells: l.context.gridOrigins.length } });
  });
  router.get('/neighborhoods/:id/missing-data', (req, res) => {
    const l = latest(req.params.id);
    if (!l) { fail(res, 404, 'NO_RUN', 'برای این محله هنوز تحلیلی اجرا نشده است'); return; }
    ok(res, { level: l.card.publication.level, missing: l.card.whatWouldChangeThis, templates: fs.existsSync(TEMPLATE_DIR) ? fs.readdirSync(TEMPLATE_DIR) : [] });
  });
  router.get('/neighborhoods/:id/history', (req, res) => { ok(res, loadRuns(req.params.id, Number(req.query.limit ?? 50))); });
  router.get('/neighborhoods/system/status', (_req, res) => { ok(res, { scheduler: schedulerStatus(), storage: storageStatus() }); });

  // ---------- ورود دادهٔ قراردادی ----------
  router.get('/ingestion/templates', (_req, res) => { ok(res, { columns: CONTRACT_COLUMNS, files: fs.existsSync(TEMPLATE_DIR) ? fs.readdirSync(TEMPLATE_DIR) : [] }); });
  router.get('/ingestion/templates/:file', (req, res) => {
    const f = path.join(TEMPLATE_DIR, path.basename(req.params.file));
    if (!f.endsWith('.csv') || !fs.existsSync(f)) { fail(res, 404, 'NOT_FOUND', 'الگو یافت نشد'); return; }
    res.type('text/csv; charset=utf-8').attachment(path.basename(f)).send(fs.readFileSync(f));
  });
  router.post('/ingestion/upload', express.text({ type: ['text/csv', 'text/plain'], limit: '20mb' }), (req: AuthedRequest, res) => {
    const csv = typeof req.body === 'string' ? req.body : (req.body?.csv as string | undefined);
    const template = String(req.query.template ?? (typeof req.body === 'object' ? req.body?.template : '') ?? 'generic');
    if (!csv) { fail(res, 400, 'INVALID_INPUT', 'بدنهٔ CSV (text/csv) یا {csv, template} لازم است'); return; }
    const batch = createBatch(csv, template, tokenFingerprint(req.header('authorization'), req.araRole ?? 'unknown'));
    ok(res, { ...batch, rows: batch.rows.slice(0, 20), rowsTruncated: batch.rows.length > 20 }, batch.status === 'INVALID' ? 422 : 201);
  });
  router.get('/ingestion/batches', (_req, res) => { ok(res, listBatches()); });
  // ---------- بستهٔ دادهٔ رسمی آماده (همان چرخهٔ بازبینی: stage → PENDING_REVIEW → تأیید admin) ----------
  router.get('/ingestion/official-packs', (_req, res) => { ok(res, packStatus()); });
  router.post('/ingestion/official-packs/:packId/stage', (req: AuthedRequest, res) => {
    const p = readOfficialPack(req.params.packId);
    if (!p) { fail(res, 404, 'NOT_FOUND', 'بستهٔ رسمی یافت نشد'); return; }
    const open = packStatus().find((x) => x.id === p.pack.id)?.batch;
    if (open && open.status === 'APPROVED') { fail(res, 409, 'ALREADY_STAGED', `این بسته قبلاً بارگذاری شده است (${open.batchId}، ${open.status})`, open); return; }
    let batch = createBatch(p.text, `official-pack:${p.pack.id}`, tokenFingerprint(req.header('authorization'), req.araRole ?? 'unknown'));
    // بستهٔ رسمی از پیش اعتبارسنجی شده است؛ در دسترسی باز بی‌درنگ فعال می‌شود
    if (batch.status === 'PENDING_REVIEW') batch = reviewBatch(batch.batchId, 'system:official-pack', 'APPROVED', `بستهٔ رسمی ${p.pack.id}`);
    ok(res, { ...batch, rows: batch.rows.slice(0, 20), rowsTruncated: batch.rows.length > 20 }, batch.status === 'INVALID' ? 422 : 201);
  });
  router.get('/official/district/:neighborhoodId', (req, res) => {
    const d = tehranDistrictOf(req.params.neighborhoodId);
    if (!d) { fail(res, 404, 'NO_OFFICIAL_CONTEXT', 'بافت رسمی فقط برای محلات تهران موجود است'); return; }
    ok(res, { district: d, profile: districtProfile(d), incomeBenchmark: incomeBenchmark() });
  });
  // لایه‌های محله‌ای تهران (روشنایی v3، استطاعت مسکن، اشتغال پایدار، تحصیلات) + یافته‌ها و تجویز قواعد LR-v1
  router.get('/official/layers/:neighborhoodId', (req, res) => {
    const a = assessLayers(req.params.neighborhoodId);
    if (!a) { fail(res, 404, 'NO_LAYERS', 'لایهٔ محله‌ای برای این محله موجود نیست (فقط محلات تهران)'); return; }
    ok(res, a);
  });
  router.get('/ingestion/:batchId', (req, res) => {
    const b = getBatch(req.params.batchId);
    if (!b) { fail(res, 404, 'NOT_FOUND', 'دسته یافت نشد'); return; }
    ok(res, b);
  });
  router.post(['/ingestion/:batchId/approve', '/ingestion/batches/:batchId/approve'], (req: AuthedRequest, res) => {
    const decision = req.body?.decision === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    try {
      ok(res, reviewBatch(req.params.batchId, tokenFingerprint(req.header('authorization'), req.araRole ?? 'unknown'), decision, req.body?.note));
    } catch (error) {
      const e = error as Error & { status?: number };
      fail(res, e.status ?? 400, 'REVIEW_FAILED', e.message);
    }
  });

  // ---------- پیمایش ادراکی ----------
  router.get('/survey/questionnaire', (_req, res) => {
    const base = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'kernel', 'registries', 'questionnaire_15.json'), 'utf8'));
    const ext = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'kernel', 'registries', 'questionnaire_core_extension.json'), 'utf8'));
    const instrument = SURVEY_SECTIONS.map((sec) => ({ ...sec, items: sec.items.map(({ showIf: _s, ...item }) => ({ ...item, conditional: Boolean(_s) })) }));
    ok(res, { base, extension: ext, likertItems: LIKERT_ITEMS, minDurationSec: Number(process.env.ARA_SURVEY_MIN_SECONDS || 90), targetN: 384, instrumentVersion: INSTRUMENT_VERSION, instrument, householdIndicators: HOUSEHOLD_INDICATORS });
  });
  router.post('/survey/:neighborhoodId/responses', (req, res) => {
    if (!getNeighborhood(req.params.neighborhoodId)) { fail(res, 404, 'NOT_FOUND', 'محله یافت نشد'); return; }
    const list = (Array.isArray(req.body) ? req.body : req.body?.responses) as SurveyResponseInput[] | undefined;
    if (!Array.isArray(list) || !list.length) { fail(res, 400, 'INVALID_INPUT', 'آرایهٔ responses لازم است'); return; }
    const stored = addResponses(req.params.neighborhoodId, list.slice(0, 5000));
    ok(res, { received: stored.length, accepted: stored.filter((s) => s.qc.accepted).length, rejected: stored.filter((s) => !s.qc.accepted).map((s) => ({ responseId: s.responseId, reasons: s.qc.reasons })) }, 201);
  });
  router.get('/survey/:neighborhoodId/summary', asyncRoute(async (req, res) => {
    const e = getNeighborhood(req.params.neighborhoodId);
    if (!e) { fail(res, 404, 'NOT_FOUND', 'محله یافت نشد'); return; }
    const ctx = await buildNeighborhoodContext(e, { useKernel: false });
    ok(res, summarizeSurvey(e.neighborhoodId, rakingTargetsFrom(ctx), surveyOptionsFor(e.neighborhoodId)));
  }));

  // ---------- ممیزی میدانی P3 ----------
  router.get('/field-audit/checklist', (_req, res) => { ok(res, { items: AUDIT_ITEM_LABELS, scale: { 0: 'نامطلوب/ندارد', 1: 'متوسط', 2: 'مطلوب' }, minPoints: 5 }); });
  router.post('/field-audit/:neighborhoodId', (req, res) => {
    if (!getNeighborhood(req.params.neighborhoodId)) { fail(res, 404, 'NOT_FOUND', 'محله یافت نشد'); return; }
    const list = (Array.isArray(req.body) ? req.body : req.body?.audits) as AuditInput[] | undefined;
    if (!Array.isArray(list) || !list.length) { fail(res, 400, 'INVALID_INPUT', 'آرایهٔ audits لازم است'); return; }
    const r = addAudits(req.params.neighborhoodId, list);
    ok(res, { stored: r.stored.length, errors: r.errors }, r.stored.length ? 201 : 422);
  });
  router.get('/field-audit/:neighborhoodId/summary', (req, res) => { ok(res, summarizeAudits(req.params.neighborhoodId)); });

  // ---------- ثبت‌های محلی (S5، G1، G5، G3) ----------
  router.get('/local-register/schema', (_req, res) => { ok(res, { kinds: REGISTER_KINDS, minRecords: MIN_RECORDS, minActors: MIN_ACTORS, windowYears: 3 }); });
  router.post('/local-register/:neighborhoodId/records', (req, res) => {
    if (!getNeighborhood(req.params.neighborhoodId)) { fail(res, 404, 'NOT_FOUND', 'محله یافت نشد'); return; }
    const list = (Array.isArray(req.body) ? req.body : req.body?.records) as RegisterRecordInput[] | undefined;
    if (!Array.isArray(list) || !list.length) { fail(res, 400, 'INVALID_INPUT', 'آرایهٔ records لازم است'); return; }
    const r = addRecords(req.params.neighborhoodId, list);
    ok(res, r, r.stored ? 201 : 422);
  });
  router.post('/local-register/:neighborhoodId/network', (req, res) => {
    if (!getNeighborhood(req.params.neighborhoodId)) { fail(res, 404, 'NOT_FOUND', 'محله یافت نشد'); return; }
    const r = saveNetwork(req.params.neighborhoodId, req.body as NetworkInput);
    if (!r.stored) { fail(res, 422, 'INVALID_NETWORK', r.errors.join('؛ '), r.errors); return; }
    ok(res, r, 201);
  });
  router.post('/local-register/:neighborhoodId/void', (req, res) => {
    const done = voidEntry(req.params.neighborhoodId, String(req.body?.id ?? ''), String(req.body?.by ?? ''));
    if (!done) { fail(res, 404, 'NOT_FOUND', 'پرونده یافت نشد'); return; }
    ok(res, { voided: true });
  });
  router.get('/local-register/:neighborhoodId/summary', (req, res) => { ok(res, summarizeRegister(req.params.neighborhoodId)); });

  // ---------- وضعیت یکپارچهٔ گردآوری داده ----------
  router.get('/data-collection/:neighborhoodId/status', asyncRoute(async (req, res) => {
    const e = getNeighborhood(req.params.neighborhoodId);
    if (!e) { fail(res, 404, 'NOT_FOUND', 'محله یافت نشد'); return; }
    const ctx = await buildNeighborhoodContext(e, { useKernel: false });
    const survey = summarizeSurvey(e.neighborhoodId, rakingTargetsFrom(ctx), surveyOptionsFor(e.neighborhoodId));
    const district = tehranDistrictOf(e.neighborhoodId);
    const audit = summarizeAudits(e.neighborhoodId);
    const register = summarizeRegister(e.neighborhoodId);
    const card = latest(e.neighborhoodId)?.card as { indicators?: Array<{ code: string; score: number | null; channel: string; tier: string }> } | undefined;
    ok(res, {
      neighborhood: publicEntry(e),
      population: ctx.population?.value ?? null,
      structure: { male: ctx.structure.male ?? null, female: ctx.structure.female ?? null, ageBands: ctx.structure.ageBands ?? null, source: ctx.structure.source },
      survey, audit, register,
      plan: buildCollectionPlan({ survey, audit, register, population: ctx.population?.value ?? null, cardIndicators: card?.indicators ?? [] }),
      indicatorNames: CORE_40_NAMES,
      populationSource: ctx.population ? { source: ctx.population.source, year: ctx.population.year, tier: ctx.population.tier } : null,
      official: district ? {
        district, profile: districtProfile(district), incomeBenchmark: incomeBenchmark(), packs: packStatus(),
        layers: assessLayers(e.neighborhoodId, { surveyItemScores: survey.itemScores, surveyN: survey.nAccepted, fieldItemMeans: audit.itemMeans, fieldPoints: audit.points }),
      } : null,
    });
  }));

  return router;
}
