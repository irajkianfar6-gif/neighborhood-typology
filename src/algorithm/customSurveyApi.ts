/** فراخوانی‌های API پرسشنامهٔ سفارشی */
import { apiUrl } from './realDataConnectors';
import { NeighborhoodApiError } from './neighborhoodApi';
import type { CustomAnswers, CustomQuestionnaire, DefinitionIssue, Demographics } from './customSurveyModel';
import type { CustomSurveySummary } from '../../server/survey/customSurvey';
import type { AiInterpretation, ReviewIssue } from '../../server/survey/customSurveyAi';

export type { CustomSurveySummary, AiInterpretation, ReviewIssue };
export type QuestionnaireRow = CustomQuestionnaire & { counts: { total: number; accepted: number }; issues: DefinitionIssue[] };
export interface CustomSubmission { answers: CustomAnswers; demographics?: Demographics; consent: boolean; durationSec: number; deviceId?: string; mode?: 'self' | 'interviewer' | 'paper' | 'import'; collectedAt?: string; collectorId?: string }

async function call<T>(path: string, init?: RequestInit, timeoutMs = 60_000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/decision-support/custom-surveys${path}`), { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new NeighborhoodApiError('اتصال به سرور برقرار نشد یا پاسخ بیش از حد طول کشید.', 0, 'NETWORK');
  }
  const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!response.ok || !payload?.success) {
    const details = Array.isArray(payload?.error?.details) ? (payload!.error!.details as Array<{ message?: string; item?: string }>).map((d) => `${d.item ? `${d.item}: ` : ''}${d.message}`).join('؛ ') : '';
    throw new NeighborhoodApiError(`${payload?.error?.message ?? `درخواست با کد ${response.status} ناموفق بود.`}${details ? ` (${details})` : ''}`, response.status, payload?.error?.code ?? 'HTTP_ERROR');
  }
  return payload.data as T;
}
const enc = encodeURIComponent;
const body = (method: string, b?: unknown): RequestInit => ({ method, body: b === undefined ? undefined : JSON.stringify(b) });
const AI_TIMEOUT = 300_000;

export const listCustomSurveys = (nb?: string) => call<QuestionnaireRow[]>(nb ? `/?neighborhoodId=${enc(nb)}` : '/');
export const getCustomSurvey = (id: string) => call<{ questionnaire: CustomQuestionnaire; issues: DefinitionIssue[]; counts: Record<string, { total: number; accepted: number }> }>(`/${enc(id)}`);
export const createCustomSurvey = (q: Partial<CustomQuestionnaire>) => call<{ questionnaire: CustomQuestionnaire; issues: DefinitionIssue[] }>('/', body('POST', q));
export const saveCustomSurvey = (id: string, q: Partial<CustomQuestionnaire>) => call<{ questionnaire: CustomQuestionnaire; issues: DefinitionIssue[] }>(`/${enc(id)}`, body('PUT', q));
export const deleteCustomSurvey = (id: string) => call<{ deleted: boolean }>(`/${enc(id)}`, body('DELETE'));
export const publishCustomSurvey = (id: string) => call<CustomQuestionnaire>(`/${enc(id)}/publish`, body('POST', {}));
export const newCustomVersion = (id: string) => call<CustomQuestionnaire>(`/${enc(id)}/new-version`, body('POST', {}));
export const archiveCustomSurvey = (id: string) => call<CustomQuestionnaire>(`/${enc(id)}/archive`, body('POST', {}));
export const submitCustomResponses = (id: string, nb: string, responses: CustomSubmission[]) =>
  call<{ received: number; accepted: number; rejected: Array<{ responseId: string; reasons: string[] }> }>(`/${enc(id)}/responses/${enc(nb)}`, body('POST', { responses }));
export const customSummary = (id: string, nb: string) => call<{ summary: CustomSurveySummary; interpretation: AiInterpretation | null }>(`/${enc(id)}/summary/${enc(nb)}`);
export const customExportUrl = (id: string, nb: string) => apiUrl(`/api/decision-support/custom-surveys/${enc(id)}/export/${enc(nb)}`);
export const aiStatus = () => call<{ configured: boolean; model: string; host: string }>('/ai/status');
export const aiDraftSurvey = (b: { goal: string; neighborhoodId?: string; indicators?: string[]; nItems?: number; audience?: string }) =>
  call<{ questionnaire: CustomQuestionnaire; issues: DefinitionIssue[]; model: string }>('/ai/draft', body('POST', b), AI_TIMEOUT);
export const aiReviewSurvey = (id: string) => call<{ overall: string; issues: ReviewIssue[]; model: string; ruleIssues: DefinitionIssue[] }>(`/${enc(id)}/ai/review`, body('POST', {}), AI_TIMEOUT);
export const aiInterpretSurvey = (id: string, nb: string) => call<AiInterpretation>(`/${enc(id)}/ai/interpret/${enc(nb)}`, body('POST', {}), AI_TIMEOUT);
