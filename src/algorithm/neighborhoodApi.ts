/**
 * کلاینت API «تحلیل فقط با نام محله» (ARA-NB-2.0)
 * هیچ شاخصی در مرورگر ساخته نمی‌شود؛ همهٔ شواهد در سرور با منبع، تاریخ و پایایی تولید می‌شوند.
 */
import type { CapitalKey, DecisionCard } from './types';
import { apiUrl } from './realDataConnectors';

export type PublicationLevel = 'PUBLISHABLE' | 'PROVISIONAL' | 'EXPLORATORY' | 'INSUFFICIENT';

export interface NeighborhoodCandidate {
  neighborhoodId: string; nameFa: string; nameEn?: string | null; cityFa: string; districtFa?: string | null; provinceFa: string;
  centroid: { lat: number; lng: number }; boundaryTier: string; boundaryIsProxy: boolean; areaKm2: number; confidence?: number;
}

export interface MissingDataItem {
  code: string; name: string; capital: CapitalKey; reason: string; nextAction: string; owner: string; template?: string;
}

export interface DecisionCardV2Indicator {
  code: string; name: string; capital: CapitalKey; raw: number | null; unit: string; score: number | null; percentile: number | null;
  reliability: number; tier: string; channel: string; source: string; observedAt: string | null; method: string; scoringMethod: string;
  conflict: boolean; missingReason?: string; nextAction?: string; notes?: string[];
}

export interface DecisionCardV2 {
  schema: 'ara.decision-card.v2';
  generatedAt: string;
  publication: { level: PublicationLevel; reasons: string[] };
  neighborhood: NeighborhoodCandidate & { boundaryVersion: string; boundaryHash: string; boundarySource: string };
  context: { areaKm2: number; population: number | null; populationSource: string; populationYear: number | null; populationTier: string; density: number | null; gridWeighting: string; warnings: string[] };
  coverage: { total: number; scored: number; reliable: number; usable: number; proxyShare: number; byCapital: Record<CapitalKey, { scored: number; reliable: number; level: PublicationLevel }> };
  capitals: Array<{ capital: CapitalKey; level: PublicationLevel; score: number | null; indicatorsUsed: string[] }>;
  indicators: DecisionCardV2Indicator[];
  abstentions: Array<{ section: string; reason: string }>;
  engine: null | { runId: string; diagnosticType: string | null; causalLevel: string; finalStatement: string; equityDataStatus: string; qualityVerdict: DecisionCard['qualityVerdict']; bottleneck: DecisionCard['bottleneck']; interventions: DecisionCard['interventions'] };
  dataVintage: { oldest: string | null; newest: string | null; staleIndicators: string[] };
  benchmarks: Array<{ code: string; level: 'city'; value: number; source: string }>;
  whatWouldChangeThis: MissingDataItem[];
  survey: { nAccepted: number; adequacy: string; alpha: number | null; marginOfError: number | null; weighting: string } | null;
  fieldAudit: { points: number; kappa: number | null; adequacy: string } | null;
  localRegister?: { records: number; indicators: string[]; networkActors: number } | null;
  anomalies: Array<{ code: string; previousMean: number; current: number; z: number }>;
  reproducibilityKey: Record<string, string>;
  fingerprint: string;
}

export type AnalyzeByNameResponse =
  | { status: 'NEEDS_DISAMBIGUATION'; query: string; candidates: NeighborhoodCandidate[]; reason?: string }
  | { status: PublicationLevel; card: DecisionCardV2; engineCard: DecisionCard | null };

export class NeighborhoodApiError extends Error {
  constructor(message: string, public status = 0, public code = 'ERROR') { super(message); this.name = 'NeighborhoodApiError'; }
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = 180_000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new NeighborhoodApiError('سرویس تحلیل محله در دسترس نیست.');
  }
  const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; error?: { code?: string; message?: string } } | null;
  if (!response.ok || !payload?.success) {
    throw new NeighborhoodApiError(payload?.error?.message ?? `درخواست با کد ${response.status} ناموفق بود.`, response.status, payload?.error?.code ?? 'HTTP_ERROR');
  }
  return payload.data as T;
}

export function resolveNeighborhoodName(name: string, city?: string) {
  const q = new URLSearchParams({ name });
  if (city) q.set('city', city);
  return call<{ query: string; requiresUserChoice: boolean; reason?: string; best: NeighborhoodCandidate | null; candidates: NeighborhoodCandidate[] }>(`/api/decision-support/neighborhoods/resolve?${q}`, undefined, 15_000);
}

export function analyzeNeighborhoodByName(input: { name?: string; city?: string; neighborhoodId?: string; purpose?: 'baseline' | 'monitoring' | 'intervention_priority' }, signal?: AbortSignal) {
  return call<AnalyzeByNameResponse>('/api/decision-support/neighborhoods/analyze', { method: 'POST', body: JSON.stringify(input), signal });
}

export function templateUrl(name: string): string {
  return apiUrl(`/api/decision-support/ingestion/templates/${encodeURIComponent(name)}`);
}

export const LEVEL_FA: Record<PublicationLevel, { label: string; tone: string; description: string }> = {
  PUBLISHABLE: { label: 'قابل انتشار', tone: 'emerald', description: 'شواهد کافی و پایا؛ قابل استفاده در تصمیم رسمی.' },
  PROVISIONAL: { label: 'موقت', tone: 'amber', description: 'قابل استفاده با احتیاط؛ برخی بخش‌ها به دادهٔ رسمی نیاز دارند.' },
  EXPLORATORY: { label: 'اکتشافی', tone: 'orange', description: 'فقط برای گفت‌وگو و برنامه‌ریزی گردآوری داده؛ مبنای تصمیم نیست.' },
  INSUFFICIENT: { label: 'شواهد ناکافی', tone: 'rose', description: 'سامانه از صدور حکم خودداری کرد؛ فهرست دادهٔ لازم را ببینید.' },
};

