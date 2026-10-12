/**
 * ابزارهای پژوهش خودکار (فاز ۳) — A2 کاشف منابع، A4 استخراج از اسناد، A5 تطبیق فضایی.
 * هیچ ابزاری عدد وارد سنجه نمی‌کند: کارت منبع «پیشنهاد» است و دستهٔ استخراج‌شده PENDING_REVIEW می‌ماند.
 */
import type { ToolDef } from '../tools';
import type { JsonSchema } from '../schema';
import { analysisFor, ToolInputError } from '../state';
import { DISCOVERY_VERSION, discoverSources, getCard, listCards, verifyUrl, trustOf, type CardStatus } from './discovery';
import { EXTRACTOR_VERSION, getTable, ingestDocument, loadContent, loadDocument, listDocuments, type DocRecord } from './documents';
import { draftContractBatch, inferColumns, INDICATOR_LEXICON, MAPPER_VERSION, type ColumnRole } from './columns';
import { matchUnits, MATCHER_VERSION } from './spatialMatch';
import { indexItem, MEMORY_VERSION, searchMemory } from './memory';
import { gapsFromCard, GAP_RELIABILITY } from './research';

const OBJ = (required: string[], properties: Record<string, JsonSchema> = {}): JsonSchema => ({ type: 'object', required, properties });
const NB_ID: JsonSchema = { type: 'string', minLength: 3, maxLength: 80, pattern: '^[a-z0-9_-]+:[A-Za-z0-9_.-]+$' };
const CODES: JsonSchema = { type: 'array', minItems: 1, maxItems: 42, items: { type: 'string', pattern: '^[A-Za-z]{1,10}[0-9]{0,2}$' } };
const DOC_ID: JsonSchema = { type: 'string', pattern: '^doc_[a-z0-9]+_[a-f0-9]{8}$' };
const TABLE_ID: JsonSchema = { type: 'string', minLength: 1, maxLength: 40 };
const ROLES: JsonSchema = { type: 'array', maxItems: 80, items: { type: 'object', required: ['column', 'role'], properties: { column: { type: 'integer', minimum: 0 }, role: { enum: ['name', 'district', 'indicator', 'ignore'] }, code: { type: 'string' }, percent: { type: 'boolean' } } } };

/** ثبت سند + نمایه در حافظه (متن صفحه‌ها و جدول‌ها) */
export function ingestAndIndex(input: Parameters<typeof ingestDocument>[0]): DocRecord {
  const rec = ingestDocument(input);
  const content = loadContent(rec.docId);
  if (content) {
    const pages = content.pages.length ? content.pages : [];
    const tableText = content.tables.map((t) => `${t.header.join(' | ')}\n${t.rows.slice(0, 200).map((r) => r.map((c) => c.text).join(' | ')).join('\n')}`).join('\n\n');
    try { indexItem('document', rec.docId, rec.title || rec.filename, [...pages, ...(tableText ? [{ page: 0, text: tableText }] : [])]); } catch { /* اختیاری */ }
  }
  return rec;
}

const normRoles = (x: unknown): ColumnRole[] | undefined => Array.isArray(x) ? (x as ColumnRole[]).map((r) => ({ ...r, header: r.header ?? '', confidence: 1, method: 'manual', reason: 'تعیین کارشناس' })) : undefined;

export const RESEARCH_TOOLS: ToolDef[] = [
  {
    name: 'find_data_gaps', title: 'شکاف‌های داده', category: 'research', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 240_000,
    description: `شاخص‌های بدون امتیاز یا با اعتبار کمتر از ${GAP_RELIABILITY} در کارت تحلیل محله را برمی‌گرداند تا کاشف منابع برایشان منبع بیابد.`,
    inputSchema: { type: 'object', additionalProperties: false, properties: { analysisId: { type: 'string', minLength: 8, maxLength: 64 }, neighborhoodId: NB_ID, offline: { type: 'boolean', default: false } } },
    outputSchema: OBJ(['gaps', 'threshold'], { gaps: { type: 'array' } }),
    handler: async (i) => { const r = await analysisFor({ analysisId: i.analysisId as string | undefined, neighborhoodId: i.neighborhoodId as string | undefined, offline: Boolean(i.offline) }); return { analysisId: r.card.fingerprint, threshold: GAP_RELIABILITY, gaps: gapsFromCard(r) }; },
    summarize: (o) => `${(o.gaps as unknown[]).length} شکاف داده`,
  },
  {
    name: 'discover_sources', title: 'کشف و راستی‌آزمایی منبع', category: 'research', readOnly: false, idempotent: true, openWorld: true, timeoutMs: 180_000,
    description: 'برای شاخص‌های بی‌داده منبع عمومی پیدا می‌کند (کاتالوگ نسخه‌دار، جست‌وجوی وب در صورت پیکربندی، پیشنهاد مدل زبانی) و هر نشانی را با robots.txt و درخواست واقعی راستی‌آزمایی می‌کند. خروجی کارت منبع «پیشنهادی» است؛ افزودن دائمی تأیید انسانی می‌خواهد.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['indicators'], properties: { indicators: CODES, city: { type: 'string', maxLength: 60 }, neighborhoodName: { type: 'string', maxLength: 120 }, verify: { type: 'boolean', default: true }, useSearch: { type: 'boolean', default: false }, useLlm: { type: 'boolean', default: false } } },
    outputSchema: OBJ(['cards', 'byIndicator', 'uncovered']),
    handler: async (i) => {
      const d = await discoverSources({ indicators: i.indicators as string[], city: i.city as string | undefined, neighborhoodName: i.neighborhoodName as string | undefined, verify: i.verify !== false, useSearch: i.useSearch === true, useLlm: i.useLlm === true });
      return { ...d, cards: d.cards.map((c) => ({ cardId: c.cardId, title: c.title, url: c.url, status: c.status, trust: c.trust.score, indicators: c.indicators, spatialLevel: c.spatialLevel, origin: c.origin })) };
    },
    summarize: (o) => `${(o.cards as unknown[]).length} منبع؛ ${(o.uncovered as unknown[]).length} شاخص بی‌منبع`,
  },
  {
    name: 'verify_source', title: 'راستی‌آزمایی یک نشانی', category: 'research', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 30_000,
    description: 'یک نشانی را بررسی می‌کند: اجازهٔ robots.txt، پاسخ HTTP، نوع محتوا و عنوان صفحه؛ میزبان‌های داخلی مسدودند.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', pattern: '^https?://', maxLength: 600 } } },
    outputSchema: OBJ(['verification', 'trust']),
    handler: async (i) => {
      const url = String(i.url); const v = await verifyUrl(url); const domain = new URL(url).hostname;
      return { verification: v, trust: trustOf({ origin: 'search', verification: v, license: null, url, domain, spatialLevel: 'unknown', role: 'unknown', domestic: /\.ir$/.test(domain) }) };
    },
    summarize: (o) => { const v = o.verification as { reachable: boolean | null; httpStatus: number | null; robotsAllowed: boolean | null }; return v.robotsAllowed === false ? 'robots.txt اجازه نمی‌دهد' : v.reachable ? `در دسترس (HTTP ${v.httpStatus})` : 'در دسترس نیست'; },
  },
  {
    name: 'list_source_cards', title: 'کارت‌های منبع', category: 'research', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 5_000,
    description: 'کارت‌های منبع کشف‌شده با وضعیت راستی‌آزمایی، امتیاز اعتماد و تصمیم کارشناس؛ قابل فیلتر با وضعیت یا شاخص.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { status: { enum: ['proposed', 'verified', 'unreachable', 'blocked_by_robots', 'approved', 'rejected'] }, indicator: { type: 'string', maxLength: 12 }, cardId: { type: 'string', maxLength: 40 } } },
    outputSchema: OBJ(['cards']),
    handler: async (i) => ({ version: DISCOVERY_VERSION, cards: i.cardId ? [getCard(String(i.cardId))].filter(Boolean) : listCards({ status: i.status as CardStatus | undefined, indicator: i.indicator as string | undefined }) }),
    summarize: (o) => `${(o.cards as unknown[]).length} کارت منبع`,
  },
  {
    name: 'get_document', title: 'سند و جدول‌های استخراج‌شده', category: 'research', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'فرادادهٔ سند بارگذاری‌شده، جدول‌های استخراج‌شده با پیش‌نمایش ردیف‌ها و نتیجهٔ بررسی دوروشی (برای PDF). بدون docId فهرست اسناد را برمی‌گرداند.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { docId: DOC_ID, tableId: TABLE_ID, maxRows: { type: 'integer', minimum: 1, maximum: 200, default: 20 } } },
    outputSchema: OBJ([]),
    handler: async (i) => {
      if (!i.docId) return { documents: listDocuments(30).map((d) => ({ docId: d.docId, filename: d.filename, kind: d.kind, tables: d.tables.length, agreement: d.verification.agreement })) };
      const d = loadDocument(String(i.docId)); if (!d) throw new ToolInputError('NOT_FOUND', 'سند یافت نشد');
      const c = loadContent(d.docId); const max = Number(i.maxRows ?? 20);
      const tables = (c?.tables ?? []).filter((t) => !i.tableId || t.tableId === i.tableId).map((t) => ({ tableId: t.tableId, origin: t.origin, header: t.header, rows: t.rows.slice(0, max).map((r) => r.map((x) => x.text)), totalRows: t.rows.length }));
      return { document: d, tables };
    },
    summarize: (o) => (o.document ? `${(o.document as DocRecord).filename}: ${(o.tables as unknown[]).length} جدول` : `${(o.documents as unknown[]).length} سند`),
  },
  {
    name: 'map_document_columns', title: 'نگاشت ستون‌ها به شاخص', category: 'research', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'نقش هر ستون جدول (نام محله، منطقه، شاخص با کد استاندارد) را با واژه‌نامهٔ شاخص‌ها و الگوی مقادیر پیشنهاد می‌کند؛ با اطمینان و دلیل.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['docId', 'tableId', 'city'], properties: { docId: DOC_ID, tableId: TABLE_ID, city: { type: 'string', minLength: 2, maxLength: 60 } } },
    outputSchema: OBJ(['roles']),
    handler: async (i) => { const t = getTable(String(i.docId), String(i.tableId)); if (!t) throw new ToolInputError('NOT_FOUND', 'جدول یافت نشد'); return { version: MAPPER_VERSION, roles: inferColumns(t, String(i.city)) }; },
    summarize: (o) => `${(o.roles as Array<{ role: string }>).filter((r) => r.role === 'indicator').length} ستون شاخص`,
  },
  {
    name: 'draft_contract_batch', title: 'پیش‌نویس دستهٔ قراردادی از سند', category: 'research', readOnly: false, idempotent: false, openWorld: false, timeoutMs: 60_000,
    description: 'از یک جدول سند، ردیف‌های قراردادی (شاخص × محله) با تطبیق فضایی و ارجاع سلولی می‌سازد و فقط به‌صورت دستهٔ PENDING_REVIEW ثبت می‌کند؛ ورود به سنجه فقط پس از تأیید کارشناس. با dryRun=true فقط پیش‌نمایش.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['docId', 'tableId', 'city', 'sourceOrg'], properties: { docId: DOC_ID, tableId: TABLE_ID, city: { type: 'string', minLength: 2, maxLength: 60 }, sourceOrg: { type: 'string', minLength: 2, maxLength: 120 }, periodEnd: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, roles: ROLES, includeReview: { type: 'boolean', default: false }, dryRun: { type: 'boolean', default: true } } },
    outputSchema: OBJ(['rows', 'matches']),
    handler: async (i, ctx) => {
      const r = await draftContractBatch(String(i.docId), String(i.tableId), { city: String(i.city), sourceOrg: String(i.sourceOrg), periodEnd: i.periodEnd as string | undefined, roles: normRoles(i.roles), includeReview: i.includeReview === true, dryRun: i.dryRun !== false, uploadedBy: `agent:${ctx.agentId}` });
      return r as unknown as Record<string, unknown>;
    },
    summarize: (o) => (o.batch ? `دستهٔ ${(o.batch as { batchId: string }).batchId} در انتظار بازبینی (${o.rows} ردیف)` : `پیش‌نمایش ${o.rows} ردیف`),
  },
  {
    name: 'match_spatial_units', title: 'تطبیق واحدهای مکانی', category: 'research', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 15_000,
    description: 'نام‌ها/مختصات واحدهای یک فهرست بیرونی را به محله‌های گزتیر تطبیق می‌دهد: دقیق، نام دیگر، نقطه در چندضلعی، واحد ترکیبی، فقط منطقه، مبهم یا ناموفق؛ موارد مشکوک needsReview دارند.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['city', 'units'], properties: { city: { type: 'string', minLength: 2, maxLength: 60 }, units: { type: 'array', minItems: 1, maxItems: 2000, items: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 160 }, district: { type: ['string', 'integer', 'null'] }, lat: { type: ['number', 'null'] }, lng: { type: ['number', 'null'] } } } } } },
    outputSchema: OBJ(['matches', 'byType']),
    handler: async (i) => matchUnits(i.units as never, String(i.city)) as unknown as Record<string, unknown>,
    summarize: (o) => `${o.autoMatched}/${o.total} خودکار؛ ${o.needsReview} نیازمند بازبینی`,
  },
  {
    name: 'search_documents', title: 'جست‌وجو در حافظهٔ اسناد', category: 'research', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'جست‌وجوی واژگانی (BM25) در اسناد بارگذاری‌شده و کارت‌های منبع؛ با شناسهٔ سند، صفحه و تکهٔ متن برای ارجاع.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 2, maxLength: 300 }, kind: { enum: ['document', 'source_card'] }, limit: { type: 'integer', minimum: 1, maximum: 30, default: 8 } } },
    outputSchema: OBJ(['hits']),
    handler: async (i) => ({ version: MEMORY_VERSION, hits: searchMemory(String(i.query), { limit: Number(i.limit ?? 8), kind: i.kind as never }) }),
    summarize: (o) => `${(o.hits as unknown[]).length} اصابت`,
  },
];

export const RESEARCH_VERSIONS = { discovery: DISCOVERY_VERSION, extractor: EXTRACTOR_VERSION, mapper: MAPPER_VERSION, matcher: MATCHER_VERSION, memory: MEMORY_VERSION };
export const KNOWN_INDICATORS = Object.keys(INDICATOR_LEXICON);
