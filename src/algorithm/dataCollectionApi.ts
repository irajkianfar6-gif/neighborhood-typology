/** کلاینت API گردآوری داده (پیمایش ساکنان، ممیزی میدانی، ثبت‌های محلی) */
import { apiUrl } from './realDataConnectors';
import { NeighborhoodApiError } from './neighborhoodApi';

export interface SurveyIndicatorEstimate { code: string; label: string; score: number; ci95: [number, number]; n: number; nEffective: number; item: string; module: 'perceptual' | 'household' | 'economic'; unit: string; denominator?: string; benchmark?: string }
export interface SurveySummary {
  neighborhoodId: string; nReceived: number; nAccepted: number; rejectedByReason: Record<string, number>;
  weighting: 'raked' | 'unweighted'; weightingNote: string; alpha: number | null; alphaItems: string[];
  indicators: SurveyIndicatorEstimate[]; groupValues: Record<string, Record<string, number>>; groupNs: Record<string, number>;
  quotas: Record<string, Record<string, number>>; marginOfError: number | null; adequacy: 'ADEQUATE' | 'MINIMUM' | 'INSUFFICIENT';
  latestResponseAt: string | null; earliestResponseAt: string | null;
  pending: Array<{ code: string; label: string; eligibleN: number; required: number; denominator: string }>;
  chainProfile: Record<string, { score: number; n: number } | null>; itemScores: Record<string, number>;
  followUpSamples: Array<{ code: string; text: string; at: string }>; byMode: Record<string, number>; byCollector: Record<string, number>;
  instrumentVersion: string;
  economy?: {
    incomeN: number; medianIncomeMToman: number | null; tenure: Record<string, number>;
    burdenN: number; medianBurdenPct: number | null; overburdenSharePct: number | null; excludedImplausible: number;
    rentPerM2: { n: number; medianMToman: number | null };
    incomeBenchmark: { monthlyMToman: number; month: string; basis: string } | null; medianHouseholdSize: number | null;
  };
}
export interface OfficialMacroItem { key: string; value: number; unit: string; period: string; geo: string; source: string }
export interface OfficialDistrictProfile {
  district: number; level: 'district';
  population: { census1395: { pop: number; male: number; female: number; households: number; areaHa: number } | null; latestEstimate: { pop: number; year: string; source: string } | null; densityPerKm2: number | null; maleShare: number | null; householdSize: number | null };
  housing: {
    latest: { period: string; priceMRialPerM2: number; transactions: number; rank: number; ofDistricts: number; ratioToCity: number; source: string } | null;
    trend: { from: string; to: string; changePct: number } | null;
    monthlyTail: Array<{ period: string; priceMRialPerM2: number; transactions: number }>;
    priceToIncomeYears: { value: number; unitM2: number; basis: string } | null;
    marketRentBurdenRef: { value: number; unitM2: number; period: string; basis: string } | null;
  };
  neighborhoodPopCoverage: { matched: number; sum: number; shareOfDistrict1395: number | null };
  macro: OfficialMacroItem[]; notes: string[];
}
export interface OfficialPackStatus { id: string; title: string; indicator: string; rows: number; period: string; source: string; batch: null | { batchId: string; status: string; uploadedAt: string; accepted: number } }
export interface FieldAuditSummary {
  neighborhoodId: string; points: number; audits: number; auditors: number; p3: number | null; kappa: number | null;
  adequacy: 'ADEQUATE' | 'INSUFFICIENT'; reasons: string[]; itemMeans: Record<string, number>; latestAuditAt: string | null;
  pointList: Array<{ pointId: string; lat: number; lng: number; auditors: string[]; score: number; auditedAt: string }>;
}
export type RegisterKind = 'problem' | 'process' | 'project';
export interface RegisterSummary {
  neighborhoodId: string;
  records: Array<{ id: string; kind: RegisterKind; title: string; date: string; flag: boolean; evidenceRef?: string; recordedBy: string; receivedAt: string; inWindow: boolean }>;
  byKind: Record<RegisterKind, { indicator: string; total: number; inWindow: number; flagged: number; withEvidence: number; required: number; value: number | null }>;
  network: null | { id: string; actors: string[]; links: Array<[number, number]>; density: number; possible: number; assessedBy: string; assessedAt: string; centrality: Array<{ actor: string; degree: number }> };
  indicators: Array<{ code: string; label: string; value: number; n: number }>;
}
export type PlanStatus = 'ready' | 'partial' | 'empty';
export interface PlanIndicator { code: string; name: string; status: PlanStatus; value: number | null; progress: number; have: number; need: number; unit: string; card: { score: number | null; channel: string | null; tier: string | null; coveredElsewhere: boolean } }
export interface PlanModule { key: 'survey' | 'household' | 'economy' | 'audit' | 'register' | 'network'; title: string; progress: number; status: PlanStatus; indicators: PlanIndicator[]; guidance: string }
export interface CollectionStatus {
  neighborhood: { neighborhoodId: string; nameFa: string; cityFa: string; centroid: { lat: number; lng: number } };
  population: number | null;
  structure: { male: number | null; female: number | null; ageBands: Record<string, number> | null; source: string | null };
  survey: SurveySummary; audit: FieldAuditSummary; register: RegisterSummary;
  plan: { modules: PlanModule[]; recommendedN: number; gateN: number; overall: number; unlockable: string[] };
  indicatorNames: Record<string, string>;
  populationSource?: { source: string; year: number | null; tier: string } | null;
  official?: null | { district: number; profile: OfficialDistrictProfile | null; incomeBenchmark: { monthlyMToman: number; month: string; basis: string } | null; packs: OfficialPackStatus[] };
}

export interface SurveySubmission {
  respondentId?: string; deviceId?: string; durationSec: number; answers: Record<string, number>;
  demographics: { sex?: 'male' | 'female'; ageBand?: '18-29' | '30-44' | '45-64' | '65+'; tenure?: 'owner' | 'renter' | 'other'; disability?: boolean };
  consent: boolean; collectedAt?: string; collectorId?: string; followUps?: Record<string, string>; mode?: 'self' | 'interviewer' | 'paper'; instrumentVersion?: string;
}
export interface AuditSubmission { auditorId: string; pointId: string; lat: number; lng: number; items: Record<string, number>; photoRef?: string; auditedAt?: string }
export interface RegisterRecordSubmission { kind: RegisterKind; title: string; date: string; flag: boolean; evidenceRef?: string; recordedBy: string; note?: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new NeighborhoodApiError('اتصال به سرور برقرار نشد.', 0, 'NETWORK');
  }
  const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; error?: { code?: string; message?: string } } | null;
  if (!response.ok || !payload?.success) {
    const message = response.status === 401 || response.status === 403
      ? 'برای ثبت داده به توکن «اپراتور» نیاز است.'
      : payload?.error?.message ?? `درخواست با کد ${response.status} ناموفق بود.`;
    throw new NeighborhoodApiError(message, response.status, payload?.error?.code ?? 'HTTP_ERROR');
  }
  return payload.data as T;
}
const enc = encodeURIComponent;
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const getCollectionStatus = (id: string) => call<CollectionStatus>(`/api/decision-support/data-collection/${enc(id)}/status`);
export const stageOfficialPack = (packId: string) =>
  call<{ batchId: string; status: string; stats: { accepted: number; rejected: number; neighborhoods: number }; issues: Array<{ code: string; message: string; severity: string }> }>(`/api/decision-support/ingestion/official-packs/${enc(packId)}/stage`, post({}));
export const submitSurveyResponses = (id: string, responses: SurveySubmission[]) =>
  call<{ received: number; accepted: number; rejected: Array<{ responseId: string; reasons: string[] }> }>(`/api/decision-support/survey/${enc(id)}/responses`, post({ responses }));
export const submitAudits = (id: string, audits: AuditSubmission[]) =>
  call<{ stored: number; errors: Array<{ index: number; errors: string[] }> }>(`/api/decision-support/field-audit/${enc(id)}`, post({ audits }));
export const submitRegisterRecords = (id: string, records: RegisterRecordSubmission[]) =>
  call<{ stored: number; ids: string[]; errors: Array<{ index: number; errors: string[] }> }>(`/api/decision-support/local-register/${enc(id)}/records`, post({ records }));
export const submitNetwork = (id: string, network: { actors: string[]; links: Array<[number, number]>; assessedBy: string; assessedAt?: string; note?: string }) =>
  call<{ stored: boolean; id: string }>(`/api/decision-support/local-register/${enc(id)}/network`, post(network));
export const voidRegisterEntry = (id: string, entryId: string, by: string) =>
  call<{ voided: boolean }>(`/api/decision-support/local-register/${enc(id)}/void`, post({ id: entryId, by }));

// ─── صف آفلاین: پاسخ‌هایی که به سرور نرسیدند در مرورگر می‌مانند تا دوباره ارسال شوند ───
const queueKey = (id: string) => `ara_survey_queue_${id}`;
export function loadQueue(id: string): SurveySubmission[] {
  try { return JSON.parse(localStorage.getItem(queueKey(id)) ?? '[]') as SurveySubmission[]; } catch { return []; }
}
export function saveQueue(id: string, list: SurveySubmission[]): void {
  try { if (list.length) localStorage.setItem(queueKey(id), JSON.stringify(list)); else localStorage.removeItem(queueKey(id)); } catch { /* storage optional */ }
}
export function deviceId(): string {
  try {
    let id = localStorage.getItem('ara_device_id');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('ara_device_id', id); }
    return id;
  } catch { return ''; }
}

/** تبدیل ارقام فارسی/عربی به لاتین */
export function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
