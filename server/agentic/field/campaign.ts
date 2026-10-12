/**
 * کارزار میدانی (A8) — FIELD-v1: از شکاف‌های کارت تا پیمایش میدانی و بازسنجی.
 * چرخه: draft → (تأیید انسانی شروع میدانی) → fielding → closed.
 * عامل هیچ پاسخی نمی‌سازد؛ پاسخ‌ها را پرسشگران/ساکنان از زبانهٔ «دادهٔ پیمایشی» وارد می‌کنند.
 * کنترل کیفیت: سهمیهٔ جنس و سن، نرخ رد به تفکیک دلیل و پرسشگر، حاشیهٔ خطا، روند روزانه.
 */
import { analysisFor, contextFor, invalidateNeighborhood, requireEntry, runAnalysis, ToolInputError, type CardResult } from '../state';
import { gapsFromCard } from '../research/research';
import { rakingTargetsFrom, surveyOptionsFor } from '../../neighborhood/channels';
import { loadResponses, summarizeSurvey } from '../../survey/perceptualSurvey';
import { listQuestionnaires, loadCustomResponses } from '../../survey/customSurvey';
import { summarizeAudits, MIN_POINTS } from '../../survey/fieldAudit';
import { recommendedSampleSize } from '../../survey/collectionPlan';
import { inScope, SURVEY_NATIVE } from '../../../src/algorithm/customSurveyModel';
import { load, list, newId, save } from './store';

export const FIELD_VERSION = 'FIELD-v1';
export const COLLECTOR_REJECT_FLAG = 0.3;

export interface Snapshot {
  at: string; analysisId: string; level: string; coverage: { scored: number; reliable: number; usable: number; total: number };
  scores: Record<string, { score: number | null; reliability: number; tier: string; channel: string }>;
  capitals: Record<string, number | null>; bottleneck: string | null; diagnosticType: string | null;
  surveyN: number; auditPoints: number;
}
export interface Campaign {
  id: string; version: string; createdAt: string; createdBy: string; neighborhoodId: string; nameFa: string; offline: boolean;
  status: 'draft' | 'fielding' | 'closed' | 'cancelled';
  approval: { status: 'pending' | 'approved' | 'rejected'; by: string | null; at: string | null; note: string | null };
  startedAt: string | null; closedAt: string | null;
  plan: { targetN: number; quotas: Record<string, Record<string, number>>; quotaNote: string; auditPoints: number; questionnaires: Array<{ id: string; title: string; status: string }>; targetCodes: string[]; otherGaps: string[]; days: number };
  baseline: Snapshot; after: Snapshot | null;
  outcome: null | { newlyScored: string[]; reliabilityGained: string[]; lost: string[]; levelBefore: string; levelAfter: string; coverageDelta: Record<string, number>; capitalDelta: Record<string, number | null>; bottleneckChanged: boolean | null; surveyVsPrior: Array<{ code: string; before: number; after: number; beforeTier: string; afterTier: string; diff: number }> };
}

export function snapshot(r: CardResult): Snapshot {
  const c = r.card;
  const scores: Snapshot['scores'] = {};
  for (const i of c.indicators) scores[i.code] = { score: i.score, reliability: i.reliability, tier: i.tier, channel: i.channel };
  const b = c.engine?.bottleneck;
  return {
    at: c.generatedAt, analysisId: c.fingerprint, level: c.publication.level,
    coverage: { scored: c.coverage.scored, reliable: c.coverage.reliable, usable: c.coverage.usable, total: c.coverage.total },
    scores, capitals: Object.fromEntries(c.capitals.map((x) => [x.capital, x.score])),
    bottleneck: b ? `${b.capital}:${b.transition.join('>')}` : null, diagnosticType: c.engine?.diagnosticType ?? null,
    surveyN: c.survey?.nAccepted ?? 0, auditPoints: c.fieldAudit?.points ?? 0,
  };
}

function shares(x: Record<string, number> | undefined): Record<string, number> | null {
  if (!x) return null; const t = Object.values(x).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  return t > 0 ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v / t])) : null;
}

export async function createCampaign(input: { neighborhoodId: string; offline?: boolean; days?: number; createdBy?: string }): Promise<Campaign> {
  const e = requireEntry(input.neighborhoodId);
  const open = list<Campaign>('campaigns', (c) => c.neighborhoodId === e.neighborhoodId && (c.status === 'draft' || c.status === 'fielding'));
  if (open.length) throw new ToolInputError('CAMPAIGN_OPEN', `برای این محله کارزار باز وجود دارد (${open[0].id})؛ ابتدا آن را ببندید یا لغو کنید`);
  const offline = input.offline ?? false;
  const r = await analysisFor({ neighborhoodId: e.neighborhoodId, offline });
  const ctx = await contextFor(e, { useKernel: false, offline });
  const gaps = gapsFromCard(r).map((g) => g.code);
  const targetN = recommendedSampleSize(ctx.population.value);
  const t = rakingTargetsFrom(ctx); const quotas: Record<string, Record<string, number>> = {};
  for (const k of ['sex', 'ageBand'] as const) { const s = shares(t[k]); if (s) quotas[k] = Object.fromEntries(Object.entries(s).map(([g, p]) => [g, Math.ceil(p * targetN)])); }
  const qs = listQuestionnaires().filter((q) => q.status !== 'archived' as never && inScope(q, e.neighborhoodId)).map((q) => ({ id: q.id, title: q.title, status: q.status }));
  const now = new Date().toISOString();
  const c: Campaign = {
    id: newId('fc'), version: FIELD_VERSION, createdAt: now, createdBy: input.createdBy ?? 'agent:A8', neighborhoodId: e.neighborhoodId, nameFa: `${e.nameFa}، ${e.cityFa}`, offline,
    status: 'draft', approval: { status: 'pending', by: null, at: null, note: null }, startedAt: null, closedAt: null,
    plan: {
      targetN, quotas, quotaNote: Object.keys(quotas).length ? (t.note ?? 'سهمیه از ترکیب جمعیتی محله') : 'ترکیب جمعیتی در دسترس نیست؛ سهمیه تعیین نشد (پیمایش بدون وزن‌دهی)',
      auditPoints: Math.max(MIN_POINTS, 10), questionnaires: qs, targetCodes: gaps.filter((g) => SURVEY_NATIVE.has(g)), otherGaps: gaps.filter((g) => !SURVEY_NATIVE.has(g)),
      days: Math.max(1, Math.min(120, Math.round(input.days ?? 21))),
    },
    baseline: snapshot(r), after: null, outcome: null,
  };
  return save('campaigns', c);
}

export const getCampaign = (id: string) => load<Campaign>('campaigns', id);
export const listCampaigns = (nb?: string) => list<Campaign>('campaigns', (c) => !nb || c.neighborhoodId === nb);
function must(id: string): Campaign { const c = getCampaign(id); if (!c) throw new ToolInputError('NOT_FOUND', 'کارزار یافت نشد'); return c; }

/** تأیید انسانی شروع میدانی (فقط کارشناس؛ عامل‌ها این مسیر را ندارند) */
export function decideCampaign(id: string, decision: 'approved' | 'rejected', by: string, note?: string): Campaign {
  const c = must(id);
  if (c.status !== 'draft') throw new ToolInputError('INVALID_STATE', 'فقط کارزار پیش‌نویس تأیید یا رد می‌شود');
  const now = new Date().toISOString();
  c.approval = { status: decision, by, at: now, note: note?.slice(0, 500) ?? null };
  if (decision === 'approved') { c.status = 'fielding'; c.startedAt = now; } else c.status = 'cancelled';
  return save('campaigns', c);
}

export interface Progress {
  campaignId: string; status: Campaign['status']; since: string | null; daysElapsed: number; daysPlanned: number;
  perceptual: { received: number; accepted: number; target: number; progress: number; rejectionRate: number; rejectedByReason: Record<string, number>; marginOfError: number | null; adequacy: string };
  quotas: Record<string, Record<string, { target: number; got: number; fill: number }>>;
  collectors: Array<{ collectorId: string; received: number; accepted: number; rejectionRate: number; flagged: boolean }>;
  custom: Array<{ questionnaireId: string; title: string; received: number; accepted: number }>;
  audits: { points: number; target: number; kappa: number | null };
  daily: Array<{ day: string; accepted: number; rejected: number }>;
  warnings: string[]; readyToClose: boolean;
}

export async function campaignProgress(id: string): Promise<Progress> {
  const c = must(id);
  const since = c.startedAt; const inWin = (at: string) => Boolean(since && at >= since && (!c.closedAt || at <= c.closedAt));
  const rs = since ? loadResponses(c.neighborhoodId).filter((x) => inWin(x.receivedAt)) : [];
  const acc = rs.filter((x) => x.qc.accepted);
  const rej: Record<string, number> = {}; for (const x of rs) if (!x.qc.accepted) for (const why of x.qc.reasons) rej[why] = (rej[why] ?? 0) + 1;
  const e = requireEntry(c.neighborhoodId);
  const ctx = await contextFor(e, { useKernel: false, offline: true });
  const sum = summarizeSurvey(c.neighborhoodId, rakingTargetsFrom(ctx), surveyOptionsFor(c.neighborhoodId));
  const quotas: Progress['quotas'] = {};
  for (const [k, groups] of Object.entries(c.plan.quotas)) {
    quotas[k] = {};
    for (const [g, target] of Object.entries(groups)) { const got = acc.filter((x) => (x.demographics as Record<string, unknown>)[k] === g).length; quotas[k][g] = { target, got, fill: target ? Math.round((got / target) * 1000) / 1000 : 0 }; }
  }
  const byCol = new Map<string, { r: number; a: number }>();
  for (const x of rs) { const k = x.collectorId || '—'; const v = byCol.get(k) ?? { r: 0, a: 0 }; v.r++; if (x.qc.accepted) v.a++; byCol.set(k, v); }
  const collectors = [...byCol].map(([collectorId, v]) => { const rr = v.r ? 1 - v.a / v.r : 0; return { collectorId, received: v.r, accepted: v.a, rejectionRate: Math.round(rr * 1000) / 1000, flagged: v.r >= 10 && rr > COLLECTOR_REJECT_FLAG }; }).sort((a, b) => b.received - a.received);
  const custom = c.plan.questionnaires.map((q) => { const xs = since ? loadCustomResponses(q.id, c.neighborhoodId).filter((x) => inWin(x.receivedAt)) : []; return { questionnaireId: q.id, title: q.title, received: xs.length, accepted: xs.filter((x) => x.qc.accepted).length }; });
  const daily = new Map<string, { accepted: number; rejected: number }>();
  for (const x of rs) { const d = x.receivedAt.slice(0, 10); const v = daily.get(d) ?? { accepted: 0, rejected: 0 }; if (x.qc.accepted) v.accepted++; else v.rejected++; daily.set(d, v); }
  const audit = summarizeAudits(c.neighborhoodId);
  const daysElapsed = since ? Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 86_400_000)) : 0;
  const warnings: string[] = [];
  const rr = rs.length ? 1 - acc.length / rs.length : 0;
  if (rs.length >= 20 && rr > 0.25) warnings.push(`نرخ رد پاسخ‌ها ${Math.round(rr * 100)}٪ است؛ آموزش پرسشگران و طول پرسشنامه را بررسی کنید`);
  for (const col of collectors.filter((x) => x.flagged)) warnings.push(`پرسشگر ${col.collectorId}: نرخ رد ${Math.round(col.rejectionRate * 100)}٪ — پاسخ‌های او بازبینی شود`);
  for (const [k, gs] of Object.entries(quotas)) for (const [g, q] of Object.entries(gs)) if (acc.length >= c.plan.targetN * 0.5 && q.fill < 0.5) warnings.push(`سهمیهٔ ${k}=${g} کمتر از نیمه پر شده است (${q.got} از ${q.target})`);
  if (since && daysElapsed > c.plan.days && acc.length < c.plan.targetN) warnings.push('مهلت کارزار گذشته و نمونه کامل نشده است');
  return {
    campaignId: c.id, status: c.status, since, daysElapsed, daysPlanned: c.plan.days,
    perceptual: { received: rs.length, accepted: acc.length, target: c.plan.targetN, progress: Math.min(1, Math.round((acc.length / c.plan.targetN) * 1000) / 1000), rejectionRate: Math.round(rr * 1000) / 1000, rejectedByReason: rej, marginOfError: sum.marginOfError, adequacy: sum.adequacy },
    quotas, collectors, custom, audits: { points: audit.points, target: c.plan.auditPoints, kappa: audit.kappa },
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
    warnings, readyToClose: c.status === 'fielding' && (acc.length >= 30 || audit.points >= MIN_POINTS || custom.some((x) => x.accepted >= 30)),
  };
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const MEASURED = new Set(['survey', 'field']);

/** بستن کارزار: بازسنجی محله با دادهٔ تازه و مقایسهٔ پیش و پس (ورودی یادگیری A14) */
export async function closeCampaign(id: string, opts: { force?: boolean } = {}): Promise<Campaign> {
  const c = must(id);
  if (c.status !== 'fielding') throw new ToolInputError('INVALID_STATE', 'فقط کارزار در حال اجرا بسته می‌شود (ابتدا شروع میدانی باید تأیید شود)');
  const p = await campaignProgress(id);
  if (!p.readyToClose && !opts.force) throw new ToolInputError('NOT_READY', 'دادهٔ کافی ثبت نشده است (دست‌کم ۳۰ پاسخ پذیرفته یا ۵ نقطهٔ ممیزی)؛ برای بستن اجباری force بدهید');
  invalidateNeighborhood(c.neighborhoodId);
  const r = await runAnalysis(requireEntry(c.neighborhoodId), { offline: c.offline, force: true });
  const after = snapshot(r); const before = c.baseline;
  const codes = Object.keys(after.scores);
  const sc = (s: Snapshot, k: string) => s.scores[k]?.score ?? null;
  const surveyVsPrior = codes.flatMap((k) => {
    const b = before.scores[k], a = after.scores[k];
    if (!b || !a || b.score === null || a.score === null || b.tier === a.tier || !MEASURED.has(a.channel) || MEASURED.has(b.channel)) return [];
    return [{ code: k, before: b.score, after: a.score, beforeTier: b.tier, afterTier: a.tier, diff: r1(a.score - b.score) }];
  });
  c.after = after; c.status = 'closed'; c.closedAt = new Date().toISOString();
  c.outcome = {
    newlyScored: codes.filter((k) => sc(before, k) === null && sc(after, k) !== null),
    reliabilityGained: codes.filter((k) => (after.scores[k]?.reliability ?? 0) - (before.scores[k]?.reliability ?? 0) >= 0.1 && sc(before, k) !== null),
    lost: codes.filter((k) => sc(before, k) !== null && sc(after, k) === null),
    levelBefore: before.level, levelAfter: after.level,
    coverageDelta: Object.fromEntries((['scored', 'reliable', 'usable'] as const).map((k) => [k, after.coverage[k] - before.coverage[k]])),
    capitalDelta: Object.fromEntries(Object.keys(after.capitals).map((k) => [k, after.capitals[k] !== null && before.capitals[k] !== null ? r1(after.capitals[k]! - before.capitals[k]!) : null])),
    bottleneckChanged: before.bottleneck && after.bottleneck ? before.bottleneck !== after.bottleneck : null,
    surveyVsPrior,
  };
  return save('campaigns', c);
}
