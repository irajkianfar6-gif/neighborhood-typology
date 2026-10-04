// ============================================================
// سینک مرکز آمار — Backend API
// ------------------------------------------------------------
// یک لایهٔ سرویس‌دهی برخط روی داده‌های سنگین مرکز آمار که توسط
// اسکریپت‌های sync (scripts/sync_*.py / .ps1) از فایل‌های خام
// (سرشماری dbf + آمارگیری نیروی کار mdb) پردازش و به JSON فشرده
// تبدیل شده‌اند. این سرور آن‌ها را بارگذاری و با فیلتر/تجمیع
// به‌صورت API در اختیار برنامه قرار می‌دهد.
// اجرا:  npm run sci:server   (پورت پیش‌فرض 4001)
// ============================================================
import './loadEnv'; // باید نخستین import باشد — .env.local را قبل از خواندن process.env بار می‌کند
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { LOADED_ENV_FILES } from './loadEnv';
import { createTypologyRouter } from './typologyRouter';
import { buildDecisionSupportRouter } from './decisionSupportRouter';
import { createExternalDataProxyRouter } from './externalDataProxy';
import { buildKernelRouter } from './kernelRouter';
import { createSatelliteRouter, SatelliteMetadataStore, SatelliteStacService } from './satelliteStac';
import { createSatellitePipelineRouter } from './satellitePipeline';
import { createSourceRouter } from './sources/router';
import { SourceRuntime } from './sources/runtime';
import { findPython } from './kernelClient';
import { authMiddleware } from './security/auth';
import { corsMiddleware } from './security/cors';
import { rateLimit } from './security/rateLimit';
import { auditMiddleware } from './security/audit';
import { metricsMiddleware, metricsHandler } from './ops/metrics';
import { createNeighborhoodRouter } from './neighborhood/router';
import { startScheduler } from './scheduler';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PORT = Number(process.env.SCI_PORT || 4001);
// در استقرار تولیدی، UI ساخته‌شده (dist) و API روی یک origin سرو می‌شوند.
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

// ---------- types ----------
interface ProvinceInfo {
  code: string;
  alpha: string;
  fa: string;
}

/** سلول LFS فشرده: [province, wave, sex, ageBand, activity, weighted, raw] */
type LfsCell = [string, number, number, string, string, number, number];

interface LfsDataset {
  year: number;
  source: string;
  table: string;
  weightColumn: string;
  rows: number;
  skipRows: number;
  waves: number[];
  totalWeighted: number;
  cells: LfsCell[];
}

// ---------- load ----------
function loadJson<T>(file: string): T {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, '')) as T;
}

function loadDataset<T>(file: string): T | null {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return null;
  try {
    return loadJson<T>(p);
  } catch (e) {
    console.error(`[sci] failed to load ${file}:`, e);
    return null;
  }
}

const provinceMap = loadDataset<Record<string, ProvinceInfo>>('province-map.json') ?? {};
const census = loadDataset<unknown>('census-unknown.json');
const lfsFiles = fs.existsSync(DATA_DIR)
  ? fs.readdirSync(DATA_DIR).filter((f) => /^lfs-\d+\.json$/.test(f)).sort()
  : [];
const lfs = new Map<number, LfsDataset>();
for (const f of lfsFiles) {
  const d = loadDataset<LfsDataset>(f);
  if (!d) continue;
  // سال در دادهٔ خام دو رقمی است (84/96/99)؛ برای نمایش به شمسی چهاررقمی تبدیل می‌کنیم
  if (d.year < 100) d.year += 1300;
  lfs.set(d.year, d);
}

// ---------- helpers ----------
const LABOR_BANDS = new Set(['15-24', '25-34', '35-44', '45-54', '55-64', '65+']);
const ACT_FA: Record<string, string> = { '1': 'شاغل', '2': 'بیکار', '3': 'غیرفعال', unknown: 'نامشخص' };

interface ProvStats {
  employed: number;
  unemployed: number;
  inactive: number;
  unknown: number;
  pop15: number;
  popAll: number;
  employedRaw: number;
  unemployedRaw: number;
  inactiveRaw: number;
}

function emptyStats(): ProvStats {
  return { employed: 0, unemployed: 0, inactive: 0, unknown: 0, pop15: 0, popAll: 0, employedRaw: 0, unemployedRaw: 0, inactiveRaw: 0 };
}

function sumStats(ds: LfsDataset, prov?: string): ProvStats {
  const s = emptyStats();
  for (const [p, , , band, act, w, raw] of ds.cells) {
    if (prov && p !== prov) continue;
    s.popAll += w;
    if (!LABOR_BANDS.has(band)) continue;
    s.pop15 += w;
    if (act === '1') { s.employed += w; s.employedRaw += raw; }
    else if (act === '2') { s.unemployed += w; s.unemployedRaw += raw; }
    else if (act === '3') { s.inactive += w; s.inactiveRaw += raw; }
    else s.unknown += w;
  }
  return s;
}

function rateRow(prov: string, s: ProvStats) {
  const lf = s.employed + s.unemployed;
  const info = provinceMap[prov] ?? { code: prov, alpha: '', fa: prov };
  return {
    province: prov,
    alpha: info.alpha,
    fa: info.fa,
    employed: Math.round(s.employed),
    unemployed: Math.round(s.unemployed),
    inactive: Math.round(s.inactive),
    laborForce: Math.round(lf),
    pop15: Math.round(s.pop15),
    popAll: Math.round(s.popAll),
    unemploymentRate: lf > 0 ? +(s.unemployed / lf * 100).toFixed(2) : null,
    participationRate: s.pop15 > 0 ? +(lf / s.pop15 * 100).toFixed(2) : null,
    unknown: Math.round(s.unknown),
  };
}

// ---------- app ----------
const app = express();
// CORS با فهرست مجاز (ARA_ALLOWED_ORIGINS) — دیگر «*» نیست
app.use(corsMiddleware());
app.use(express.json({ limit: '2mb' }));
// پشت nginx/Cloudflare باید قبل از rate limit تنظیم شود تا req.ip واقعی باشد
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
// احراز هویت و نقش (ARA_API_TOKENS) + لاگ ممیزی نوشتنی‌ها + محدودیت نرخ
app.use(authMiddleware());
app.use(auditMiddleware());
app.use('/api/decision-support/analyze', rateLimit({ name: 'analyze', windowMs: 60_000, max: Number(process.env.ARA_RATE_ANALYZE_PER_MIN || 60) }));
app.use('/api/decision-support/neighborhoods/analyze', rateLimit({ name: 'neighborhood-analyze', windowMs: 60_000, max: Number(process.env.ARA_RATE_ANALYZE_PER_MIN || 60) }));
app.use('/api/anthropic', rateLimit({ name: 'anthropic', windowMs: 60_000, max: Number(process.env.ARA_RATE_AI_PER_MIN || 10) }));
app.use(metricsMiddleware());

// ---------- سلامت سرویس (برای Docker healthcheck / PaaS / مانیتورینگ) ----------
const SERVICE_STARTED_AT = new Date().toISOString();
app.get('/metrics', metricsHandler);
app.get('/api/health', (_req, res) => {
  const distIndex = fs.existsSync(path.join(DIST_DIR, 'index.html'));
  res.json({
    ok: true,
    service: 'ara-decision-platform',
    startedAt: SERVICE_STARTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    port: PORT,
    envFiles: LOADED_ENV_FILES,
    ui: distIndex ? 'built' : 'missing (dev mode: run `npm run dev`)',
    python: findPython(),
    integrations: {
      anthropicProxy: Boolean(ANTHROPIC_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openaq: Boolean(process.env.OPENAQ_API_KEY),
      healthsites: Boolean(process.env.HEALTHSITES_API_KEY),
      kernelServiceUrl: process.env.KERNEL_SERVICE_URL || `http://127.0.0.1:${process.env.KERNEL_SERVICE_PORT || 4105}`,
      sourceCacheDir: process.env.SOURCE_CACHE_DIR || path.join(DATA_DIR, 'source-cache'),
    },
  });
});

// ---------- پراکسی یکسان‌مبدأ سرویس مدل (کلید فقط روی سرور می‌ماند) ----------
// در حالت توسعه، vite.config.ts این کار را می‌کند؛ در استقرار تولیدی (dist + Express)
// همین مسیر جایگزین آن است تا باندل فرانت‌اند هرگز کلید را نبیند.
const ANTHROPIC_BASE_URL = (process.env.ARA_ANTHROPIC_BASE_URL || 'https://tabitoken.com').replace(/\/+$/, '');
const ANTHROPIC_API_KEY = process.env.ARA_ANTHROPIC_API_KEY || '';
const ANTHROPIC_VERSION = process.env.ARA_ANTHROPIC_VERSION || '2023-06-01';

const ANTHROPIC_MAX_TOKENS = Number(process.env.ARA_ANTHROPIC_MAX_TOKENS || 4000);
/** فقط فیلدهای مجاز به سرویس مدل می‌رود؛ max_tokens سقف دارد تا پراکسی قابل سوءاستفاده نباشد */
function sanitizeAnthropicBody(body: unknown): Record<string, unknown> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['model', 'messages', 'system', 'temperature', 'stream', 'stop_sequences']) {
    if (b[key] !== undefined) out[key] = b[key];
  }
  const requested = Number(b.max_tokens);
  out.max_tokens = Number.isFinite(requested) && requested > 0 ? Math.min(requested, ANTHROPIC_MAX_TOKENS) : Math.min(1024, ANTHROPIC_MAX_TOKENS);
  return out;
}

app.use('/api/anthropic', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(503).json({
      error: {
        code: 'AI_NOT_CONFIGURED',
        message: 'کلید ARA_ANTHROPIC_API_KEY تنظیم نشده است؛ دستیار هوشمند در حالت پاسخ محلی کار می‌کند.',
      },
    });
    return;
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'فقط POST/GET پشتیبانی می‌شود.' } });
    return;
  }
  const relative = req.originalUrl.replace(/^\/api\/anthropic/, '') || '/messages';
  const target = `${ANTHROPIC_BASE_URL}/v1${relative}`;
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        'content-type': 'application/json',
        'accept': typeof req.headers.accept === 'string' ? req.headers.accept : 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: req.method === 'POST' ? JSON.stringify(sanitizeAnthropicBody(req.body)) : undefined,
      signal: AbortSignal.timeout(Number(process.env.ARA_ANTHROPIC_TIMEOUT_MS || 180_000)),
    });
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type') || 'application/json';
    // اگر سرویس مدل پاسخ غیر JSON بدهد (مثلاً صفحهٔ خطای HTML پشت CDN)، آن را عبور نمی‌دهیم
    // تا کلاینت با JSON خراب مواجه نشود؛ به‌جایش خطای شفاف می‌گیرد.
    if (!contentType.includes('json') && !contentType.includes('text/event-stream')) {
      await upstream.text();
      res.status(502).json({
        error: { code: 'AI_UPSTREAM_BAD_RESPONSE', message: `سرویس مدل پاسخ غیر JSON (وضعیت ${upstream.status}) برگرداند.` },
      });
      return;
    }
    res.setHeader('content-type', contentType);
    if (upstream.headers.get('cache-control')) res.setHeader('cache-control', upstream.headers.get('cache-control') as string);
    // پاسخ استریم (SSE) و پاسخ معمولی هر دو پشتیبانی می‌شوند
    if (!upstream.body) {
      res.end(await upstream.text());
      return;
    }
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI upstream failed';
    res.status(502).json({ error: { code: 'AI_UPSTREAM_ERROR', message } });
  }
});

// همهٔ مسیرها هم با پیشوند /api/sci (از طریق پراکسی Vite) و هم مستقیم در دسترس‌اند
const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'sci-sync-backend',
    datasets: {
      lfs: [...lfs.keys()].sort(),
      census: census ? 'census-unknown' : null,
      provinces: Object.keys(provinceMap).length,
    },
  });
});

router.get('/meta', (_req, res) => {
  const lfsMeta = [...lfs.values()].map((d) => ({
    year: d.year,
    rows: d.rows,
    waves: d.waves,
    weightColumn: d.weightColumn,
    totalWeighted: d.totalWeighted,
    source: d.source,
  }));
  res.json({
    service: 'سینک مرکز آمار — داده‌های سنگین',
    generatedAt: new Date().toISOString(),
    lfs: lfsMeta,
    census: census,
    provinces: provinceMap,
    note: 'lfs-97 zip duplicate of 1396 (no distinct 1397 data); census file indices are not provinces (see census.codebookNote).',
  });
});

router.get('/provinces', (_req, res) => {
  res.json(provinceMap);
});

router.get('/lfs/years', (_req, res) => {
  res.json(
    [...lfs.values()]
      .map((d) => ({ year: d.year, rows: d.rows, waves: d.waves, totalWeighted: d.totalWeighted, source: d.source }))
      .sort((a, b) => a.year - b.year)
  );
});

/** خلاصهٔ نیروی کار — به تفکیک استان (یا یک استان) */
router.get('/lfs/summary', (req, res) => {
  const year = Number(req.query.year);
  const ds = lfs.get(year);
  if (!ds) return res.status(404).json({ error: `سال ${year} موجود نیست`, years: [...lfs.keys()].sort() });
  const prov = req.query.province ? String(req.query.province) : undefined;
  if (prov) {
    if (!provinceMap[prov]) return res.status(400).json({ error: `کد استان نامعتبر: ${prov}` });
    return res.json({ year, province: prov, ...rateRow(prov, sumStats(ds, prov)) });
  }
  const rows = Object.keys(provinceMap)
    .sort()
    .map((p) => ({ year, ...rateRow(p, sumStats(ds, p)) }));
  res.json({ year, rows });
});

/** تفکیک وزن‌دار بر اساس بعد (sex | age | wave) برای یک استان یا کل کشور */
router.get('/lfs/breakdown', (req, res) => {
  const year = Number(req.query.year);
  const ds = lfs.get(year);
  if (!ds) return res.status(404).json({ error: `سال ${year} موجود نیست` });
  const dim = String(req.query.dim || 'age');
  const prov = req.query.province ? String(req.query.province) : undefined;
  if (prov && !provinceMap[prov]) return res.status(400).json({ error: `کد استان نامعتبر: ${prov}` });

  const key = dim === 'sex' ? 2 : dim === 'wave' ? 1 : 3;
  const order = dim === 'sex' ? ['1', '2'] : dim === 'wave' ? ['1', '2', '3', '4'] : [...LABOR_BANDS];
  const acc = new Map<string, ProvStats>();
  for (const [p, wave, sex, band, act, w, raw] of ds.cells) {
    if (prov && p !== prov) continue;
    const k = dim === 'sex' ? String(sex) : dim === 'wave' ? String(wave) : band;
    if (!acc.has(k)) acc.set(k, emptyStats());
    const s = acc.get(k)!;
    s.popAll += w;
    if (!LABOR_BANDS.has(band)) continue;
    s.pop15 += w;
    if (act === '1') { s.employed += w; s.employedRaw += raw; }
    else if (act === '2') { s.unemployed += w; s.unemployedRaw += raw; }
    else if (act === '3') { s.inactive += w; s.inactiveRaw += raw; }
    else s.unknown += w;
  }
  const rows = order
    .filter((k) => acc.has(k))
    .map((k) => {
      const s = acc.get(k)!;
      const lf = s.employed + s.unemployed;
      return {
        [dim === 'sex' ? 'sex' : dim === 'wave' ? 'wave' : 'ageBand']: k,
        label: dim === 'sex' ? (k === '1' ? 'مرد' : 'زن') : k,
        employed: Math.round(s.employed),
        unemployed: Math.round(s.unemployed),
        inactive: Math.round(s.inactive),
        pop15: Math.round(s.pop15),
        unemploymentRate: lf > 0 ? +(s.unemployed / lf * 100).toFixed(2) : null,
        participationRate: s.pop15 > 0 ? +(lf / s.pop15 * 100).toFixed(2) : null,
      };
    });
  res.json({ year, dim, province: prov ?? 'IR', rows });
});

/** سری زمانی ملی (همهٔ سال‌های موجود) */
router.get('/lfs/timeseries', (_req, res) => {
  const rows = [...lfs.values()]
    .sort((a, b) => a.year - b.year)
    .map((ds) => ({ year: ds.year, ...rateRow('IR', sumStats(ds)) }));
  res.json({ rows });
});

/** سری زمانی یک استان (همهٔ سال‌های موجود) — برای نمودار پنل جزئیات شاخص */
router.get('/lfs/province-series', (req, res) => {
  const prov = String(req.query.province || '');
  if (!provinceMap[prov]) return res.status(400).json({ error: `کد استان نامعتبر: ${prov}` });
  const rows = [...lfs.values()]
    .sort((a, b) => a.year - b.year)
    .map((ds) => ({ year: ds.year, ...rateRow(prov, sumStats(ds, prov)) }));
  res.json({ province: prov, fa: provinceMap[prov].fa, rows });
});

router.get('/census/summary', (_req, res) => {
  if (!census) return res.status(404).json({ error: 'دادهٔ سرشماری موجود نیست' });
  res.json(census);
});

app.use('/api/sci', router);
// The neighborhood typology workflow shares this service process so the Vite
// proxy can reach both data modules through the same local backend.
app.use('/api/external-data', createExternalDataProxyRouter());
const satelliteMetadataStore = new SatelliteMetadataStore();
const satelliteStacService = new SatelliteStacService({ store: satelliteMetadataStore });
app.use('/api/typology', createTypologyRouter({ satelliteCatalog: satelliteMetadataStore.catalog }));
// مسیر یکپارچهٔ «فقط با نام محله» (resolve → مرز → بافت → شواهد → دروازه → کارت V2)
app.use('/api/decision-support', createNeighborhoodRouter());
app.use('/api/decision-support', buildDecisionSupportRouter({ satelliteCatalog: satelliteMetadataStore.catalog }));
// دروازهٔ عمومی منابع (P0): منیفست اعلانی + کانکتور مشترک + کش دو‌لایه.
// یک route برای همهٔ transport‌ها؛ افزودن منبع جدید فقط منیفست/کانکتور می‌خواهد.
app.use('/api/sources', createSourceRouter({
  runtime: new SourceRuntime({
    diskCacheDir: process.env.SOURCE_CACHE_DIR ?? path.join(DATA_DIR, 'source-cache'),
  }),
}));
// هستهٔ محاسبات kernel: مرجع رسمی محاسبات — سرویس Python در صورت نیاز خودکار راه‌اندازی می‌شود
app.use('/api/kernel', buildKernelRouter());
app.use('/api/satellite', createSatelliteRouter({ store: satelliteMetadataStore, service: satelliteStacService }));
app.use('/api/satellite', createSatellitePipelineRouter(satelliteMetadataStore, { stac: satelliteStacService, catalog: satelliteMetadataStore.catalog }));
app.use(router);

// In production the API and the compiled UI share one origin. This keeps
// VITE_API_BASE_URL optional and avoids a second static web server.
// مسیرهای ناشناختهٔ /api باید JSON 404 بدهند، نه HTML سپی‌ای.
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'مسیر API یافت نشد.' } });
});
if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR, { index: 'index.html' }));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

app.listen(PORT, () => {
  startScheduler();
  console.log(`[sci] backend listening on http://localhost:${PORT}`);
  console.log(`[sci] lfs years: ${[...lfs.keys()].sort().join(', ')}; provinces: ${Object.keys(provinceMap).length}`);
  console.log(`[sci] ui: ${fs.existsSync(path.join(DIST_DIR, 'index.html')) ? 'dist (production build)' : 'served by vite dev server'}`);
  console.log(`[sci] env files: ${LOADED_ENV_FILES.length ? LOADED_ENV_FILES.join(', ') : 'none (using process env only)'}`);
});

// ---------- مدیریت خطای یکپارچه ----------
// هر خطای API به‌صورت JSON برگردانده می‌شود و در تولید، پشته/مسیر فایل‌ها افشا نمی‌شود.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const rawStatus = (err as { status?: unknown; statusCode?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode;
  const status = typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  const type = (err as { type?: unknown })?.type;
  const isApi = req.path.startsWith('/api/') || req.path === '/health' || req.path === '/meta';
  const rawMessage = err instanceof Error ? err.message : 'unexpected error';
  if (type === 'entity.parse.failed') {
    res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'بدنهٔ درخواست JSON معتبر نیست.' } });
    return;
  }
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, rawMessage);
  if (!isApi) {
    res.status(status).type('text/plain').send(status >= 500 ? 'Internal Server Error' : rawMessage);
    return;
  }
  res.status(status).json({
    success: false,
    error: {
      code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
      message: status >= 500 && process.env.NODE_ENV === 'production' ? 'خطای داخلی سرور' : rawMessage,
    },
  });
});
