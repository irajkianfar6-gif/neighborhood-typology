/**
 * ابزارهای فاز ۵ — میدان و یادگیری: A8 کارزار میدانی، A14 پایش پس از مداخله و پیشنهاد واسنجی.
 * تصمیم‌های پرپیامد (شروع میدانی، ثبت مداخلهٔ اجراشده، پذیرش واسنجی) فقط از مسیر کارشناس است و ابزار عاملی ندارد.
 */
import type { ToolDef } from '../tools';
import type { JsonSchema } from '../schema';
import { campaignProgress, closeCampaign, createCampaign, getCampaign, listCampaigns } from './campaign';
import { evaluateMonitoring, getMonitoring, listMonitoring, targetSeries } from './monitoring';
import { generateProposals, listProposals } from './learning';
import { fieldCycle } from './cycle';
import { ToolInputError } from '../state';

const OBJ = (required: string[], properties: Record<string, JsonSchema> = {}): JsonSchema => ({ type: 'object', required, properties });
const NB_ID: JsonSchema = { type: 'string', minLength: 3, maxLength: 80, pattern: '^[a-z0-9_-]+:[A-Za-z0-9_.-]+$' };
const ID = (p: string): JsonSchema => ({ type: 'string', pattern: `^${p}_[a-z0-9]+_[a-f0-9]{8}$` });
const strict = (required: string[], properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', additionalProperties: false, required, properties });

export const FIELD_TOOLS: ToolDef[] = [
  {
    name: 'create_field_campaign', title: 'طرح کارزار میدانی', category: 'survey', readOnly: false, idempotent: false, openWorld: true, timeoutMs: 240_000,
    description: 'از کارت فعلی محله، کارزار پیمایش و ممیزی میدانی پیش‌نویس می‌کند: حجم نمونه، سهمیهٔ جنس و سن، پرسشنامه‌های مرتبط، شاخص‌های هدف و خط پایه. شروع میدانی تأیید کارشناس می‌خواهد.',
    inputSchema: strict(['neighborhoodId'], { neighborhoodId: NB_ID, offline: { type: 'boolean', default: false }, days: { type: 'integer', minimum: 1, maximum: 120, default: 21 } }),
    outputSchema: OBJ(['id', 'status', 'plan']),
    handler: async (i, ctx) => createCampaign({ neighborhoodId: String(i.neighborhoodId), offline: Boolean(i.offline), days: i.days as number, createdBy: `agent:${ctx.agentId}` }) as unknown as Promise<Record<string, unknown>>,
    summarize: (o) => `کارزار ${o.id}: نمونهٔ هدف ${(o.plan as { targetN: number }).targetN}`,
  },
  {
    name: 'get_field_campaign', title: 'پیشرفت و کیفیت کارزار', category: 'survey', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 60_000,
    description: 'پیشرفت کارزار: پاسخ پذیرفته در برابر هدف، پرشدن سهمیه‌ها، نرخ رد به تفکیک دلیل و پرسشگر، حاشیهٔ خطا، ممیزی، روند روزانه و هشدارهای کیفیت.',
    inputSchema: strict(['campaignId'], { campaignId: ID('fc') }),
    outputSchema: OBJ(['campaign', 'progress']),
    handler: async (i) => { const c = getCampaign(String(i.campaignId)); if (!c) throw new ToolInputError('NOT_FOUND', 'کارزار یافت نشد'); return { campaign: c, progress: await campaignProgress(c.id) }; },
    summarize: (o) => { const p = (o.progress as { perceptual: { accepted: number; target: number } }).perceptual; return `${p.accepted} از ${p.target} پاسخ`; },
  },
  {
    name: 'close_field_campaign', title: 'بستن کارزار و بازسنجی', category: 'survey', readOnly: false, idempotent: false, openWorld: true, timeoutMs: 240_000,
    description: 'کارزار در حال اجرا را می‌بندد، محله را با دادهٔ تازه دوباره می‌سنجد و پیش و پس را مقایسه می‌کند (شاخص‌های تازه، سطح انتشار، پوشش، سرمایه‌ها، گلوگاه، فاصلهٔ برآورد پیشین با سنجش میدانی).',
    inputSchema: strict(['campaignId'], { campaignId: ID('fc'), force: { type: 'boolean', default: false } }),
    outputSchema: OBJ(['id', 'status', 'outcome']),
    handler: async (i) => closeCampaign(String(i.campaignId), { force: i.force === true }) as unknown as Promise<Record<string, unknown>>,
    summarize: (o) => { const x = o.outcome as { newlyScored: string[]; levelBefore: string; levelAfter: string }; return `${x.newlyScored.length} شاخص تازه؛ سطح ${x.levelBefore} → ${x.levelAfter}`; },
  },
  {
    name: 'get_field_cycle', title: 'چرخهٔ میدان و یادگیری', category: 'survey', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 30_000,
    description: 'مرحلهٔ فعلی چرخهٔ کامل یک محله (پایه، کارزار، تأیید، میدان، بازسنجی، پایش، یادگیری) و اقدام بعدی.',
    inputSchema: strict(['neighborhoodId'], { neighborhoodId: NB_ID }),
    outputSchema: OBJ(['stages', 'next']),
    handler: async (i) => fieldCycle(String(i.neighborhoodId)) as unknown as Record<string, unknown>,
    summarize: (o) => `${(o.stages as Array<{ done: boolean }>).filter((s) => s.done).length}/7 مرحله؛ بعدی: ${o.next}`,
  },
  {
    name: 'list_field_campaigns', title: 'فهرست کارزارها', category: 'survey', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'کارزارهای میدانی (اختیاری برای یک محله) با وضعیت و نتیجه.',
    inputSchema: strict([], { neighborhoodId: NB_ID }),
    outputSchema: OBJ(['items']),
    handler: async (i) => ({ items: listCampaigns(i.neighborhoodId as string | undefined).map((c) => ({ id: c.id, neighborhoodId: c.neighborhoodId, nameFa: c.nameFa, status: c.status, createdAt: c.createdAt, targetN: c.plan.targetN, outcome: c.outcome })) }),
    summarize: (o) => `${(o.items as unknown[]).length} کارزار`,
  },
  {
    name: 'list_monitoring', title: 'پایش‌های مداخله', category: 'governance', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'مداخله‌های ثبت‌شده برای پایش، خط پایه، موعد و آخرین ارزیابی؛ با monitoringId سری زمانی شاخص‌های هدف هم برمی‌گردد.',
    inputSchema: strict([], { neighborhoodId: NB_ID, monitoringId: ID('mon') }),
    outputSchema: OBJ(['items']),
    handler: async (i) => {
      if (i.monitoringId) { const m = getMonitoring(String(i.monitoringId)); if (!m) throw new ToolInputError('NOT_FOUND', 'پایش یافت نشد'); return { items: [m], series: targetSeries(m) }; }
      return { items: listMonitoring(i.neighborhoodId as string | undefined) };
    },
    summarize: (o) => `${(o.items as unknown[]).length} پایش`,
  },
  {
    name: 'evaluate_monitoring', title: 'ارزیابی پایش مداخله', category: 'governance', readOnly: false, idempotent: false, openWorld: true, timeoutMs: 240_000,
    description: `محله را دوباره می‌سنجد و تغییر شاخص‌های هدف مداخله را با خط پایه داوری می‌کند (بهبود/بدتر ≥ ۵ امتیاز با اعتبار ≥ ۰٫۶؛ وگرنه بدون تغییر یا دادهٔ ناکافی). همبستگی زمانی است، نه اثبات علّی.`,
    inputSchema: strict(['monitoringId'], { monitoringId: ID('mon') }),
    outputSchema: OBJ(['id', 'evaluations']),
    handler: async (i) => evaluateMonitoring(String(i.monitoringId)) as unknown as Promise<Record<string, unknown>>,
    summarize: (o) => `ارزیابی: ${(o.evaluations as Array<{ overall: string }>).at(-1)?.overall}`,
  },
  {
    name: 'generate_calibration_proposals', title: 'پیشنهاد واسنجی', category: 'governance', readOnly: false, idempotent: true, openWorld: false, timeoutMs: 120_000,
    description: 'از کارزارهای بسته (فاصلهٔ برآورد پیشین با سنجش میدانی)، پرسشگران پرخطا، مداخله‌های بی‌اثر پس از موعد و ابزارهای پرخطا، پیشنهاد واسنجی می‌سازد. هیچ پیشنهادی خودکار اعمال نمی‌شود.',
    inputSchema: strict([], {}),
    outputSchema: OBJ(['created', 'total']),
    handler: async () => generateProposals() as unknown as Promise<Record<string, unknown>>,
    summarize: (o) => `${(o.created as unknown[]).length} پیشنهاد تازه (کل ${o.total})`,
  },
  {
    name: 'list_calibration_proposals', title: 'فهرست پیشنهادهای واسنجی', category: 'governance', readOnly: true, idempotent: true, openWorld: false, timeoutMs: 10_000,
    description: 'پیشنهادهای واسنجی با وضعیت (پیشنهادی، پذیرفته، ردشده) و شواهد.',
    inputSchema: strict([], { status: { enum: ['proposed', 'approved', 'rejected'] } }),
    outputSchema: OBJ(['items']),
    handler: async (i) => ({ items: listProposals(i.status as never) }),
    summarize: (o) => `${(o.items as unknown[]).length} پیشنهاد`,
  },
];
