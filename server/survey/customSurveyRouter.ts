/** API پرسشنامهٔ سفارشی — زیر /api/decision-support/custom-surveys */
import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  CORE_CODES, CORE_NAME, KIND_LABELS, METHOD_LABELS, SURVEY_NATIVE, validateDefinition, type CustomQuestionnaire,
} from '../../src/algorithm/customSurveyModel';
import {
  addCustomResponses, archiveQuestionnaire, createQuestionnaire, deleteQuestionnaire, exportCsv, getQuestionnaire, listQuestionnaires,
  newVersion, publishQuestionnaire, responseCounts, summarizeCustom, SurveyError, updateQuestionnaire, type CustomResponseInput,
} from './customSurvey';
import { aiDraft, aiInterpret, aiReview, loadInterpretation } from './customSurveyAi';
import { llmConfig, LlmError } from '../ai/llm';
import { getNeighborhood } from '../neighborhood/gazetteer';
import { buildNeighborhoodContext } from '../neighborhood/context';
import { rakingTargetsFrom } from '../neighborhood/channels';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const fail = (res: Response, status: number, code: string, message: string, details?: unknown) => res.status(status).json({ success: false, error: { code, message, details } });
const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve().then(() => fn(req, res)).catch((e) => {
    if (e instanceof SurveyError) fail(res, e.status, e.code, e.message, e.details);
    else if (e instanceof LlmError) fail(res, e.code === 'AI_NOT_CONFIGURED' ? 503 : 502, e.code, e.message);
    else next(e);
  });
};
function mustGet(id: string): CustomQuestionnaire {
  const q = getQuestionnaire(id);
  if (!q) throw new SurveyError(404, 'NOT_FOUND', 'پرسشنامه یافت نشد');
  return q;
}
function mustNb(id: string) {
  const e = getNeighborhood(id);
  if (!e) throw new SurveyError(404, 'NOT_FOUND', 'محله یافت نشد');
  return e;
}
async function targetsFor(nb: string) {
  try { return rakingTargetsFrom(await buildNeighborhoodContext(mustNb(nb), { useKernel: false })); } catch (e) { if (e instanceof SurveyError) throw e; return {}; }
}

export function createCustomSurveyRouter(): Router {
  const r = Router();

  r.get('/meta/indicators', (_req, res) => ok(res, {
    indicators: CORE_CODES.map((c) => ({ code: c, name: CORE_NAME[c], surveyNative: SURVEY_NATIVE.has(c) })),
    kinds: KIND_LABELS, methods: METHOD_LABELS,
  }));
  r.get('/ai/status', (_req, res) => { const c = llmConfig(); ok(res, { configured: c.configured, model: c.model, host: new URL(c.baseUrl).host }); });

  r.get('/', route((req, res) => {
    const nb = typeof req.query.neighborhoodId === 'string' ? req.query.neighborhoodId : '';
    ok(res, listQuestionnaires().map((q) => {
      const counts = responseCounts(q.id);
      const total = Object.values(counts).reduce((a, c) => ({ total: a.total + c.total, accepted: a.accepted + c.accepted }), { total: 0, accepted: 0 });
      return { ...q, counts: nb ? counts[nb] ?? { total: 0, accepted: 0 } : total, issues: q.status === 'draft' ? validateDefinition(q) : [] };
    }));
  }));
  r.post('/', route((req, res) => ok(res, createQuestionnaire(req.body ?? {}), 201)));
  r.post('/ai/draft', route(async (req, res) => {
    const b = req.body ?? {};
    const nb = typeof b.neighborhoodId === 'string' && b.neighborhoodId ? mustNb(b.neighborhoodId) : null;
    ok(res, await aiDraft({ goal: String(b.goal ?? ''), neighborhoodId: nb?.neighborhoodId, neighborhoodName: nb ? `${nb.nameFa}، ${nb.cityFa}` : undefined,
      indicators: Array.isArray(b.indicators) ? b.indicators.map(String) : undefined, nItems: Number(b.nItems) || undefined, audience: typeof b.audience === 'string' ? b.audience : undefined }), 201);
  }));
  r.get('/:id', route((req, res) => { const q = mustGet(req.params.id); ok(res, { questionnaire: q, issues: validateDefinition(q), counts: responseCounts(q.id) }); }));
  r.put('/:id', route((req, res) => ok(res, updateQuestionnaire(req.params.id, req.body ?? {}))));
  r.delete('/:id', route((req, res) => { deleteQuestionnaire(req.params.id); ok(res, { deleted: true }); }));
  r.post('/:id/publish', route((req, res) => ok(res, publishQuestionnaire(req.params.id))));
  r.post('/:id/new-version', route((req, res) => ok(res, newVersion(req.params.id), 201)));
  r.post('/:id/archive', route((req, res) => ok(res, archiveQuestionnaire(req.params.id))));
  r.post('/:id/ai/review', route(async (req, res) => {
    const q = mustGet(req.params.id);
    const out = await aiReview(q);
    if (q.status === 'draft') updateQuestionnaire(q.id, { ...q, ai: { ...q.ai, reviewedAt: new Date().toISOString() } });
    ok(res, out);
  }));

  r.post('/:id/responses/:nb', route((req, res) => {
    mustNb(req.params.nb);
    const list = (Array.isArray(req.body) ? req.body : req.body?.responses) as CustomResponseInput[];
    const stored = addCustomResponses(req.params.id, req.params.nb, list);
    ok(res, { received: stored.length, accepted: stored.filter((s) => s.qc.accepted).length, rejected: stored.filter((s) => !s.qc.accepted).map((s) => ({ responseId: s.responseId, reasons: s.qc.reasons })) }, 201);
  }));
  r.get('/:id/summary/:nb', route(async (req, res) => {
    const q = mustGet(req.params.id);
    mustNb(req.params.nb);
    ok(res, { summary: summarizeCustom(q, req.params.nb, await targetsFor(req.params.nb)), interpretation: loadInterpretation(q.id, req.params.nb) });
  }));
  r.post('/:id/ai/interpret/:nb', route(async (req, res) => {
    const q = mustGet(req.params.id);
    mustNb(req.params.nb);
    ok(res, await aiInterpret(q, summarizeCustom(q, req.params.nb, await targetsFor(req.params.nb))));
  }));
  r.get('/:id/export/:nb', route((req, res) => {
    const q = mustGet(req.params.id);
    mustNb(req.params.nb);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${q.id}_${req.params.nb.replace(/[^\w.-]/g, '_')}.csv"`);
    res.send(exportCsv(q, req.params.nb));
  }));
  return r;
}
