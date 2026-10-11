/**
 * قرارداد «بستهٔ شاهد» (ara.evidence-packet.v1) — واحد استاندارد تبادل داده میان عامل‌ها و ابزارها.
 * هر عدد در سامانه باید در یک بسته با منشأ کامل (منبع، زمان، سطح مکانی، روش، کانال، رده، اعتبار، هش) بیاید.
 * بسته‌ها از DocumentedValue/ScoredValue موجود ساخته می‌شوند؛ هیچ مقداری اینجا محاسبه یا ساخته نمی‌شود.
 */
import crypto from 'node:crypto';
import type { DocumentedValue, ScoredValue } from '../evidence/types';
import { canonicalJson, validate, type JsonSchema } from './schema';

export const EVIDENCE_PACKET_VERSION = 'ara.evidence-packet.v1';

export interface EvidencePacket {
  schema: typeof EVIDENCE_PACKET_VERSION;
  packetId: string;
  neighborhoodId: string;
  indicator: string;
  value: number | null;
  unit: string;
  numerator: number | null;
  denominator: number | null;
  spatialLevel: DocumentedValue['geographyLevel'];
  matchType: string | null;
  source: { label: string; ids: string[] };
  observedAt: string | null;
  fetchedAt: string;
  cadence: DocumentedValue['cadence'];
  method: string;
  methodQuality: number;
  sampleAdequacy: number;
  channel: DocumentedValue['channel'];
  tier: DocumentedValue['tier'];
  lowerIsBetter: boolean;
  /** فقط برای بستهٔ ارزیابی‌شده (پس از ادغام/نرمال‌سازی موتور شواهد) */
  assessment: null | {
    score: number | null; scoringMethod: ScoredValue['scoringMethod']; percentile: number | null;
    reliability: number; reliabilityParts: ScoredValue['reliabilityParts']; conflict: boolean; alternatives: number;
  };
  /** گروه‌های وابستگی: بسته‌های هم‌گروه شاهد مستقل شمرده نمی‌شوند */
  dependsOn: string[];
  missingReason: string | null;
  producedBy: string;
  hash: string;
}

const NUM_OR_NULL: JsonSchema = { type: ['number', 'null'] };
export const EVIDENCE_PACKET_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['schema', 'packetId', 'neighborhoodId', 'indicator', 'value', 'unit', 'spatialLevel', 'source', 'fetchedAt', 'method', 'channel', 'tier', 'dependsOn', 'producedBy', 'hash'],
  properties: {
    schema: { const: EVIDENCE_PACKET_VERSION },
    packetId: { type: 'string', minLength: 8 },
    neighborhoodId: { type: 'string', minLength: 1 },
    indicator: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,15}$' },
    value: NUM_OR_NULL, unit: { type: 'string' }, numerator: NUM_OR_NULL, denominator: NUM_OR_NULL,
    spatialLevel: { enum: ['block', 'neighborhood', 'district', 'city', 'province', 'national'] },
    matchType: { type: ['string', 'null'] },
    source: { type: 'object', required: ['label', 'ids'], properties: { label: { type: 'string', minLength: 1 }, ids: { type: 'array', items: { type: 'string' } } } },
    observedAt: { type: ['string', 'null'] }, fetchedAt: { type: 'string', minLength: 10 },
    cadence: { enum: ['realtime', 'hourly', 'daily', 'monthly', 'quarterly', 'annual', 'census', 'static'] },
    method: { type: 'string', minLength: 1 },
    methodQuality: { type: 'number', minimum: 0, maximum: 1 }, sampleAdequacy: { type: 'number', minimum: 0, maximum: 1 },
    channel: { enum: ['open_auto', 'contract', 'survey', 'field', 'satellite', 'expert'] },
    tier: { enum: ['official', 'contract', 'open_measured', 'open_model', 'survey', 'field', 'expert', 'proxy'] },
    lowerIsBetter: { type: 'boolean' },
    assessment: { type: ['object', 'null'] },
    dependsOn: { type: 'array', items: { type: 'string' } },
    missingReason: { type: ['string', 'null'] },
    producedBy: { type: 'string', minLength: 1 },
    hash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
  },
};

/** گروه‌های وابستگی شناخته‌شده (منشأ مشترک یا هم‌متغیر مشترک) */
export function dependencyGroups(v: Pick<DocumentedValue, 'sourceIds' | 'details' | 'channel' | 'tier'>): string[] {
  const groups = new Set<string>();
  for (const id of v.sourceIds ?? []) {
    // سه لایهٔ اجتماعی-اقتصادی تهران همگی هم‌متغیر «قیمت مسکن دیوار» دارند → مستقل نیستند
    if (/^layer:tehran-layers-[^:]+:(housing|employment|education)$/.test(id)) groups.add('covariate:divar-housing-price');
    if (/^layer:tehran-layers-[^:]+:lighting$/.test(id)) groups.add('sensor:viirs-night-lights');
    const head = id.split(':').slice(0, 2).join(':');
    if (head) groups.add(`source:${head}`);
  }
  if (v.channel === 'survey') groups.add('channel:perceptual-survey');
  return [...groups].sort();
}

function isScored(v: DocumentedValue | ScoredValue): v is ScoredValue {
  return 'reliability' in v && 'scoringMethod' in v;
}

export function packetHash(p: Omit<EvidencePacket, 'hash' | 'packetId'>): string {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(p)).digest('hex')}`;
}

/** تبدیل مقدار مستند/ارزیابی‌شدهٔ موجود به بستهٔ شاهد استاندارد */
export function toEvidencePacket(v: DocumentedValue | ScoredValue, neighborhoodId: string, producedBy: string): EvidencePacket {
  const body: Omit<EvidencePacket, 'hash' | 'packetId'> = {
    schema: EVIDENCE_PACKET_VERSION,
    neighborhoodId,
    indicator: v.code,
    value: v.raw ?? null,
    unit: v.unit ?? '',
    numerator: v.numerator ?? null,
    denominator: v.denominator ?? null,
    spatialLevel: v.geographyLevel,
    matchType: typeof v.details?.match === 'string' ? (v.details.match as string) : null,
    source: { label: v.source || '—', ids: [...(v.sourceIds ?? [])] },
    observedAt: v.observedAt ?? null,
    fetchedAt: v.fetchedAt,
    cadence: v.cadence,
    method: v.method || '—',
    methodQuality: Math.max(0, Math.min(1, v.methodQuality ?? 0)),
    sampleAdequacy: Math.max(0, Math.min(1, v.sampleAdequacy ?? 0)),
    channel: v.channel,
    tier: v.tier,
    lowerIsBetter: Boolean(v.lowerIsBetter),
    assessment: isScored(v)
      ? { score: v.score, scoringMethod: v.scoringMethod, percentile: v.percentile ?? null, reliability: v.reliability, reliabilityParts: v.reliabilityParts, conflict: v.conflict, alternatives: v.alternatives?.length ?? 0 }
      : null,
    dependsOn: dependencyGroups(v),
    missingReason: v.missingReason ?? null,
    producedBy,
  };
  const hash = packetHash(body);
  return { ...body, packetId: `ev_${neighborhoodId.replace(/[^\w]/g, '_')}_${v.code}_${hash.slice(7, 19)}`, hash };
}

export function validatePacket(p: unknown): string[] {
  const errors = validate(EVIDENCE_PACKET_SCHEMA, p);
  if (errors.length) return errors;
  const pk = p as EvidencePacket;
  const { hash, packetId: _id, ...body } = pk;
  if (packetHash(body) !== hash) errors.push('/hash: با محتوای بسته نمی‌خواند (بسته دست‌کاری شده است)');
  if (pk.value !== null && (!pk.source.label || pk.source.label === '—') && !pk.source.ids.length) errors.push('/source: مقدار بدون منشأ پذیرفته نمی‌شود');
  return errors;
}

/** خلاصهٔ استقلال شواهد: چند بستهٔ معتبر واقعاً مستقل‌اند؟ */
export function independenceSummary(packets: EvidencePacket[]): { packets: number; withValue: number; independentGroups: number; sharedGroups: Array<{ group: string; indicators: string[] }> } {
  const withValue = packets.filter((p) => p.value !== null);
  const byGroup = new Map<string, Set<string>>();
  for (const p of withValue) for (const g of p.dependsOn.filter((x) => x.startsWith('covariate:') || x.startsWith('sensor:'))) {
    (byGroup.get(g) ?? byGroup.set(g, new Set()).get(g)!).add(p.indicator);
  }
  const shared = [...byGroup.entries()].filter(([, s]) => s.size > 1).map(([group, s]) => ({ group, indicators: [...s].sort() }));
  const collapsed = shared.reduce((n, g) => n + g.indicators.length - 1, 0);
  return { packets: packets.length, withValue: withValue.length, independentGroups: Math.max(0, new Set(withValue.map((p) => p.indicator)).size - collapsed), sharedGroups: shared };
}
