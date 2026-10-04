import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { explainTypologyReport } from './typologyExplain';
import { safeStoredPlaceText, TypologyService, TypologyError } from './typologyService';
import { FileTypologyStore } from './typologyStore';
import type { TypologyStore } from './typologyTypes';
import { buildLocalTypologyEvidence } from './typologyDataConnector';
import { localAdministrativeBoundaries, localNeighborhoodBoundaries, nearbyLocationCatalog, searchLocationCatalog } from './typologyRegistry';
import { auditIndicatorSemantics, getIndicatorSemantic } from './typologyIndicatorSemantics';
import { buildTypologySatelliteEvidence } from './satelliteConsumers';
import type { SatelliteCatalog } from './satelliteCatalog';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}

function actorFrom(req: Request): string {
  const actor = req.header('x-actor-id');
  return actor && actor.trim() ? actor.trim().slice(0, 200) : 'api-user';
}

function runSummary(run: Awaited<ReturnType<TypologyService['getRun']>>): Record<string, unknown> {
  const statusCounts = Object.fromEntries(
    [...new Set(run.tasks.map((task) => task.status))].sort().map((status) => [status, run.tasks.filter((task) => task.status === status).length]),
  );
  const computed = run.tasks.filter((task) => ['COMPUTED', 'APPROVED'].includes(task.status)).length;
  const request = {
    ...run.request,
    neighborhood_name: safeStoredPlaceText(run.request.neighborhood_name, 'محله ثبت شده بدون نام معتبر'),
    city_or_county: safeStoredPlaceText(run.request.city_or_county),
    province: safeStoredPlaceText(run.request.province),
  };
  const fallbackName = request.neighborhood_name;
  const candidates = run.candidates.map((candidate) => ({
    ...candidate,
    name: safeStoredPlaceText(candidate.name, fallbackName),
    canonical_name: safeStoredPlaceText(candidate.canonical_name, fallbackName),
    province: safeStoredPlaceText(candidate.province),
    city_or_county: safeStoredPlaceText(candidate.city_or_county),
  }));
  return {
    run_id: run.run_id,
    status: run.status,
    publication_level: run.publication_level,
    registry_version: run.registry_version,
    registry: { version: run.registry_version, indicator_count: run.tasks.length },
    code_version: run.code_version,
    created_at: run.created_at,
    updated_at: run.updated_at,
    selected_candidate_id: run.selected_candidate_id ?? null,
    boundary_confidence: run.boundary?.confidence ?? null,
    boundary: run.boundary ? { ...run.boundary, candidate_id: run.selected_candidate_id ?? null } : null,
    candidate_count: candidates.length,
    candidates,
    request,
    indicators: {
      total: run.tasks.length,
      computed: run.tasks.filter((task) => ['COMPUTED', 'APPROVED'].includes(task.status)).length,
      missing: run.missing.length,
    },
    coverage: {
      total: run.tasks.length,
      computed,
      approved: run.tasks.filter((task) => task.status === 'APPROVED').length,
      missing: run.missing.length,
      failed_qa: statusCounts.FAILED_QA ?? 0,
      waiting_public: statusCounts.DOWNLOADING_PUBLIC_DATA ?? 0,
      waiting_organizational: statusCounts.WAITING_FOR_ORGANIZATIONAL_DATA ?? 0,
      waiting_survey: statusCounts.WAITING_FOR_SURVEY ?? 0,
      waiting_field: statusCounts.WAITING_FOR_FIELD_AUDIT ?? 0,
      status_counts: statusCounts,
    },
    results: run.score ?? null,
    dual_layer_typology: run.dual_layer_typology ?? null,
  };
}

function buildRoutes(service: TypologyService, options: { satelliteCatalog?: Pick<SatelliteCatalog, 'listFeatures'> } = {}): Router {
  const router = express.Router();

  router.get('/data-catalog', (_req, res) => {
    const catalogPath = path.resolve(process.env.ARA_PUBLIC_DATA_DIR || path.join(process.cwd(), 'public', 'data'), 'typology', 'source_catalog.json');
    if (!fs.existsSync(catalogPath)) {
      res.status(404).json({ success: false, error: { code: 'CATALOG_NOT_BUILT', message: 'Run scripts/build_typology_catalog.py first.' } });
      return;
    }
    try {
      res.json({ success: true, data: JSON.parse(fs.readFileSync(catalogPath, 'utf8')) });
    } catch {
      res.status(500).json({ success: false, error: { code: 'CATALOG_INVALID', message: 'The local source catalog could not be read.' } });
    }
  });

  router.get('/data-catalog/summary', (_req, res) => {
    const catalogPath = path.resolve(process.env.ARA_PUBLIC_DATA_DIR || path.join(process.cwd(), 'public', 'data'), 'typology', 'source_catalog.json');
    if (!fs.existsSync(catalogPath)) {
      res.status(404).json({ success: false, error: { code: 'CATALOG_NOT_BUILT', message: 'Run scripts/build_typology_catalog.py first.' } });
      return;
    }
    try {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as Record<string, unknown>;
      const links = catalog.indicator_links && typeof catalog.indicator_links === 'object'
        ? Object.fromEntries(Object.entries(catalog.indicator_links as Record<string, Record<string, unknown>>).map(([code, link]) => [code, {
          source_tags: Array.isArray(link.source_tags) ? link.source_tags : [],
          direct_local_candidate: Boolean(link.direct_local_candidate),
          availability: String(link.availability ?? 'no_automatic_local_match'),
          candidate_paths: Array.isArray(link.candidate_paths) ? link.candidate_paths.slice(0, 8) : [],
        }]))
        : {};
      res.json({ success: true, data: {
        schema_version: catalog.schema_version,
        generated_at: catalog.generated_at,
        file_count: catalog.file_count,
        total_bytes: catalog.total_bytes,
        extension_counts: catalog.extension_counts,
        theme_counts: catalog.theme_counts,
        province_count: Array.isArray(catalog.province_index) ? catalog.province_index.length : 0,
        indicator_count: Object.keys(links).length,
        indicator_links: links,
      } });
    } catch {
      res.status(500).json({ success: false, error: { code: 'CATALOG_INVALID', message: 'The local source catalog could not be summarized.' } });
    }
  });

  router.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        ok: true,
        service: 'neighborhood-typology',
        registry: service.getRegistryMetadata(),
        ai_role: 'optional_explanation_only',
      },
    });
  });

  router.get('/indicator-semantics', (req, res) => {
    const code = req.query.code ? String(req.query.code).trim().toUpperCase() : '';
    if (code) {
      const semantic = getIndicatorSemantic(code);
      if (!semantic) {
        res.status(404).json({ success: false, error: { code: 'INDICATOR_NOT_FOUND', message: `Indicator ${code} is not in the approved registry.` } });
        return;
      }
      res.json({ success: true, data: semantic });
      return;
    }
    const audit = auditIndicatorSemantics();
    res.json({ success: true, data: audit });
  });

  router.get('/locations/search', (req, res) => {
    const query = String(req.query.q ?? req.query.query ?? '').trim();
    const limit = Number(req.query.limit ?? 20);
    res.json({
      success: true,
      data: {
        query,
        results: searchLocationCatalog(query, Number.isFinite(limit) ? limit : 20),
        source: 'public/data/pbf/places.json + local administrative centroids',
      },
    });
  });

  router.get('/locations/nearby', (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const limit = Number(req.query.limit ?? 12);
    res.json({ success: true, data: { lat, lng, results: nearbyLocationCatalog(lat, lng, Number.isFinite(limit) ? limit : 12) } });
  });

  router.get('/locations/boundaries', (req, res) => {
    const city = req.query.city ? String(req.query.city) : undefined;
    res.json({
      success: true,
      data: {
        type: 'FeatureCollection',
        source: 'mahalat/ Tehran and Karaj municipal/neighborhood GeoJSON',
        features: localNeighborhoodBoundaries(city),
      },
    });
  });

  router.get('/locations/administrative-boundaries', (req, res) => {
    const city = req.query.city ? String(req.query.city) : undefined;
    res.json({
      success: true,
      data: {
        type: 'FeatureCollection',
        source: 'mahalat/ Karaj municipal district context boundaries',
        features: localAdministrativeBoundaries(city),
      },
    });
  });

  router.post('/runs', asyncRoute(async (req, res) => {
    const run = await service.createRun(req.body, actorFrom(req));
    res.status(201).json({
      success: true,
      data: {
        ...runSummary(run),
        next_action: 'Confirm one candidate and upload a versioned Polygon or MultiPolygon boundary.',
      },
    });
  }));

  router.get('/runs', asyncRoute(async (req, res) => {
    const requested = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(requested) ? requested : 20;
    const runs = await service.listRuns(limit);
    res.json({
      success: true,
      data: {
        runs: runs.map(runSummary),
        total: runs.length,
      },
    });
  }));

  router.get('/runs/:runId', asyncRoute(async (req, res) => {
    const run = await service.getRun(req.params.runId);
    res.json({ success: true, data: runSummary(run) });
  }));

  router.get('/runs/:runId/candidates', asyncRoute(async (req, res) => {
    res.json({ success: true, data: await service.getCandidates(req.params.runId) });
  }));

  router.post('/runs/:runId/boundary-confirmation', asyncRoute(async (req, res) => {
    const run = await service.confirmBoundary(req.params.runId, req.body, actorFrom(req));
    res.json({
      success: true,
      data: {
        ...runSummary(run),
        boundary: run.boundary,
        next_action: 'Start the run to assign all 419 data-supply tasks.',
      },
    });
  }));

  router.post('/runs/:runId/start', asyncRoute(async (req, res) => {
    const run = await service.startRun(req.params.runId, actorFrom(req));
    res.status(202).json({
      success: true,
      data: {
        ...runSummary(run),
        coverage: await service.coverage(run.run_id),
      },
    });
  }));

  router.get('/runs/:runId/coverage', asyncRoute(async (req, res) => {
    res.json({ success: true, data: await service.coverage(req.params.runId) });
  }));

  router.post('/runs/:runId/evidence', asyncRoute(async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? { ...(req.body as Record<string, unknown>), ...(req.header('idempotency-key') ? { idempotency_key: req.header('idempotency-key') } : {}) }
      : req.body;
    const result = await service.addEvidence(req.params.runId, body, actorFrom(req));
    res.status(201).json({
      success: true,
      data: {
        ...runSummary(result.run),
        accepted: result.accepted,
        coverage: await service.coverage(result.run.run_id),
      },
    });
  }));

  router.post('/runs/:runId/auto-evidence', asyncRoute(async (req, res) => {
    const run = await service.getRun(req.params.runId);
    if (!run.boundary) {
      res.status(409).json({ success: false, error: { code: 'BOUNDARY_REQUIRED', message: 'A confirmed boundary is required before local extraction.' } });
      return;
    }
    const localExtracted = buildLocalTypologyEvidence(run, {
      rootDirectory: process.cwd(),
      maxRecords: req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Number.isFinite(Number((req.body as Record<string, unknown>).max_records))
        ? Number((req.body as Record<string, unknown>).max_records)
        : undefined,
    });
    let satelliteExtracted: { records: Array<Record<string, unknown>>; bundle?: unknown; mappedIndicators?: string[] } = { records: [] };
    if (options.satelliteCatalog && req.body?.include_satellite !== false) {
      try {
        satelliteExtracted = buildTypologySatelliteEvidence(run, options.satelliteCatalog, {
          maxRecords: req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Number.isFinite(Number((req.body as Record<string, unknown>).max_satellite_records))
            ? Number((req.body as Record<string, unknown>).max_satellite_records)
            : 40,
        });
      } catch (error) {
        // Satellite evidence is an optional enrichment. A missing or stale
        // catalog must not prevent local evidence collection from completing.
        console.warn('[typology] satellite evidence extraction skipped:', error instanceof Error ? error.message : error);
      }
    }
    const records = [...localExtracted.records, ...satelliteExtracted.records].slice(0, 419);
    const accepted = records.length
      ? await service.addEvidence(run.run_id, { records, idempotency_key: req.header('idempotency-key') ?? `local-catalog:${run.run_id}` }, actorFrom(req))
      : { run, accepted: [] };
    res.status(201).json({
      success: true,
      data: {
        ...runSummary(accepted.run),
        extraction: {
          local: { ...localExtracted, records: undefined },
          satellite: { ...satelliteExtracted, records: undefined },
          total_records: records.length,
        },
        accepted: accepted.accepted,
        coverage: await service.coverage(accepted.run.run_id),
      },
    });
  }));

  router.post('/runs/:runId/recompute', asyncRoute(async (req, res) => {
    const run = await service.recompute(req.params.runId, actorFrom(req));
    res.json({
      success: true,
      data: {
        ...runSummary(run),
        verification_gates: (await service.report(run.run_id)).verification_gates,
      },
    });
  }));

  router.post('/runs/:runId/approve', asyncRoute(async (req, res) => {
    const result = await service.approve(req.params.runId, req.body);
    res.json({
      success: true,
      data: {
        ...runSummary(result.run),
        verification_gates: result.gates,
      },
    });
  }));

  router.get('/runs/:runId/report', asyncRoute(async (req, res) => {
    res.json({ success: true, data: await service.report(req.params.runId) });
  }));

  router.get('/runs/:runId/dual-layer', asyncRoute(async (req, res) => {
    const run = await service.getRun(req.params.runId);
    res.json({ success: true, data: {
      run_id: run.run_id,
      registry_version: run.registry_version,
      boundary_version: run.boundary?.version ?? null,
      data_vintage: run.request.reference_year,
      dual_layer_typology: run.dual_layer_typology ?? null,
    } });
  }));

  router.post('/runs/:runId/explain', asyncRoute(async (req, res) => {
    const report = await service.report(req.params.runId);
    const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const explanation = await explainTypologyReport(report, input);
    res.json({
      success: true,
      data: {
        ...explanation,
        generated_by: explanation.ai_used ? 'ai' : 'deterministic',
        caveats: [explanation.warning],
      },
    });
  }));

  return router;
}

export function createTypologyRouter(options: {
  store?: TypologyStore;
  registryPath?: string;
  runsDirectory?: string;
  codeVersion?: string;
  satelliteCatalog?: Pick<SatelliteCatalog, 'listFeatures'>;
} = {}): Router {
  const store = options.store ?? new FileTypologyStore(
    options.runsDirectory ?? process.env.TYPOLOGY_RUNS_DIR ?? path.resolve(process.cwd(), 'server', 'data', 'typology-runs'),
  );
  const service = new TypologyService(store, {
    registryPath: options.registryPath,
    codeVersion: options.codeVersion,
  });
  const api = express.Router();
  api.use(express.json({ limit: '15mb', strict: true }));

  // Keep unversioned paths for the current UI and /v1 aliases for the public contract.
  api.use(buildRoutes(service, { satelliteCatalog: options.satelliteCatalog }));
  api.use('/v1', buildRoutes(service, { satelliteCatalog: options.satelliteCatalog }));

  api.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof TypologyError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' },
      });
      return;
    }
    console.error('[typology] unhandled API error', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'The typology service could not complete the request.' },
    });
  });
  return api;
}
