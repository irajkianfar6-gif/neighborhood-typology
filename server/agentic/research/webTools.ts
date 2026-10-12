/**
 * ابزارهای پژوهش وب (A2 و A4): جست‌وجوی وب، دریافت محتوای صفحه و ورود آن به حافظهٔ اسناد،
 * پژوهش شاخص‌محور با راستی‌آزمایی قطعی. تأیید نامزدها فقط از مسیر کارشناس است (ابزار عاملی ندارد).
 */
import type { ToolDef } from '../tools';
import type { JsonSchema } from '../schema';
import { ToolInputError } from '../state';
import { ingestAndIndex } from './researchTools';
import { EFFORTS, usageToday, WebServiceError, webConfig, youContents, youSearch } from './webClient';
import { getWebResearch, listWebResearch, runWebResearch, startWebResearch } from './webResearch';

const OBJ = (required: string[], properties: Record<string, JsonSchema> = {}): JsonSchema => ({ type: 'object', required, properties });
const NB_ID: JsonSchema = { type: 'string', minLength: 3, maxLength: 80, pattern: '^[a-z0-9_-]+:[A-Za-z0-9_.-]+$' };
const CODE: JsonSchema = { type: 'string', pattern: '^[A-Z]{1,10}[0-9]?$' };
const strict = (required: string[], properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', additionalProperties: false, required, properties });
const DOMAINS: JsonSchema = { type: 'array', maxItems: 50, items: { type: 'string', minLength: 3, maxLength: 120 } };
/** خطای سرویس بیرونی → خطای ابزار با کد روشن */
async function web<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) { if (e instanceof WebServiceError) throw new ToolInputError(e.code, e.message); throw e; }
}

export const WEB_TOOLS: ToolDef[] = [
  {
    name: 'web_search', title: 'جست‌وجوی وب', category: 'research', readOnly: true, idempotent: true, openWorld: true, timeoutMs: 40_000,
    description: 'جست‌وجوی وب با نتایج ساخت‌یافته (نشانی، عنوان، تکه‌متن) برای یافتن منبع داده؛ قابل محدودسازی به دامنه، کشور و تازگی. خروجی فقط سرنخ است و عدد آن وارد سنجه نمی‌شود.',
    inputSchema: strict(['query'], { query: { type: 'string', minLength: 2, maxLength: 400 }, count: { type: 'integer', minimum: 1, maximum: 20, default: 8 }, country: { type: 'string', pattern: '^[A-Z]{2}$' }, freshness: { type: 'string', maxLength: 30 }, includeDomains: DOMAINS }),
    outputSchema: OBJ(['hits']),
    handler: async (i) => ({ hits: await web(() => youSearch(String(i.query), { count: i.count as number, country: i.country as string, freshness: i.freshness as string, includeDomains: i.includeDomains as string[] })) }),
    summarize: (o) => `${(o.hits as unknown[]).length} نتیجه`,
  },
  {
    name: 'fetch_web_contents', title: 'دریافت محتوای صفحه', category: 'research', readOnly: false, idempotent: true, openWorld: true, timeoutMs: 120_000,
    description: 'محتوای کامل صفحه‌های وب را می‌گیرد (حتی صفحه‌هایی که سرور مستقیم به آن‌ها دسترسی ندارد). با ingest=true هر صفحه به‌صورت سند HTML وارد حافظهٔ اسناد می‌شود تا A4 جدول‌هایش را با ارجاع سلولی استخراج کند.',
    inputSchema: strict(['urls'], { urls: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', pattern: '^https?://', maxLength: 2000 } }, ingest: { type: 'boolean', default: false } }),
    outputSchema: OBJ(['pages']),
    handler: async (i, ctx) => {
      const pages = await web(() => youContents(i.urls as string[], { formats: i.ingest ? ['markdown', 'html'] : ['markdown'] }));
      const out = [];
      for (const p of pages) {
        let docId: string | null = null; let tables = 0;
        if (i.ingest && p.html) {
          const host = (() => { try { return new URL(p.url).hostname; } catch { return 'page'; } })();
          const rec = ingestAndIndex({ filename: `${host}.html`, content: Buffer.from(`<html><head><title>${(p.title ?? host).replace(/</g, '')}</title></head><body>${p.html}</body></html>`, 'utf8'), uploadedBy: `agent:${ctx.agentId}`, sourceUrl: p.url });
          docId = rec.docId; tables = rec.tables.length;
        }
        out.push({ url: p.url, title: p.title, chars: (p.markdown ?? '').length, excerpt: (p.markdown ?? '').slice(0, 1500), docId, tables });
      }
      const missing = (i.urls as string[]).filter((u) => !pages.some((p) => p.url === u));
      return { pages: out, missing };
    },
    summarize: (o) => `${(o.pages as unknown[]).length} صفحه${(o.missing as unknown[]).length ? `؛ ${(o.missing as unknown[]).length} در دسترس نبود` : ''}`,
  },
  {
    name: 'web_research_indicators', title: 'پژوهش وب شاخص‌ها', category: 'research', readOnly: false, idempotent: false, openWorld: true, timeoutMs: 1_500_000,
    description: `برای شاخص‌های بی‌داده (یا فهرست داده‌شده) پژوهش چندمرحله‌ای وب با خروجی ساخت‌یافته اجرا می‌کند و هر عدد را قطعی راستی‌آزمایی می‌کند: ارجاع، وجود عدد در متن منبع، دامنه، سطح مکانی و دوره. شاخص‌های ادراکی پژوهش نمی‌شوند. نامزدها فقط پیشنهادند؛ ورود به سنجه پس از تأیید کارشناس و بازبینی دستهٔ قراردادی. سطح تلاش: ${EFFORTS.join('/')}.`,
    inputSchema: strict(['neighborhoodId'], { neighborhoodId: NB_ID, codes: { type: 'array', maxItems: 10, items: CODE }, effort: { type: 'string', enum: [...EFFORTS], default: 'standard' }, maxIndicators: { type: 'integer', minimum: 1, maximum: 10, default: 5 }, offline: { type: 'boolean', default: true } }),
    outputSchema: OBJ(['id', 'status', 'findings', 'summary']),
    handler: async (i, ctx) => {
      const rec = await startWebResearch({ neighborhoodId: String(i.neighborhoodId), codes: i.codes as string[] | undefined, effort: i.effort as never, maxIndicators: i.maxIndicators as number, offline: i.offline !== false, createdBy: `agent:${ctx.agentId}` });
      return await runWebResearch(rec.id) as unknown as Record<string, unknown>;
    },
    summarize: (o) => { const s = o.summary as { acceptable: number; needsReview: number; notFound: number; costUsd: number }; return `پذیرفتنی ${s.acceptable}، نیازمند بازبینی ${s.needsReview}، بی‌نتیجه ${s.notFound}؛ هزینه ≈ ${s.costUsd} دلار`; },
  },
  {
    name: 'get_web_research', title: 'نتیجهٔ پژوهش وب', category: 'research', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'یک پژوهش وب (با researchId) یا فهرست پژوهش‌های یک محله، به‌همراه مصرف و سقف روزانهٔ سرویس.',
    inputSchema: strict([], { researchId: { type: 'string', pattern: '^wr_[a-z0-9]+_[a-f0-9]{6}$' }, neighborhoodId: NB_ID }),
    outputSchema: OBJ(['items', 'usage']),
    handler: async (i) => {
      if (i.researchId) { const r = getWebResearch(String(i.researchId)); if (!r) throw new ToolInputError('NOT_FOUND', 'پژوهش وب یافت نشد'); return { items: [r], usage: usageToday(), configured: webConfig().configured }; }
      return { items: listWebResearch(i.neighborhoodId as string | undefined).map((r) => ({ id: r.id, createdAt: r.createdAt, status: r.status, neighborhoodId: r.neighborhoodId, nameFa: r.nameFa, effort: r.effort, codes: r.codes, summary: r.summary })), usage: usageToday(), configured: webConfig().configured };
    },
    summarize: (o) => `${(o.items as unknown[]).length} پژوهش`,
  },
];
