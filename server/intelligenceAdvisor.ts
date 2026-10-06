// ============================================================
// پیشنهادگر مداخله هوشمند — استفاده از AI
// ============================================================
import type { DiagnosticType, ChainGaps, InterventionCandidate } from '../src/algorithm/types';

export interface AdvisorRequest {
  diagnosticType: DiagnosticType;
  chainGaps: ChainGaps;
  capitalScores: Record<string, number>;
  constraints?: {
    budget?: number;
    timeline?: string;
    capacity?: string;
  };
  language?: 'fa' | 'en';
}

export async function suggestInterventions(
  input: AdvisorRequest,
): Promise<{ suggestions: string[]; ai_used: boolean; text: string }> {
  const apiKey = process.env.ARA_ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      suggestions: [],
      ai_used: false,
      text: 'AI در دسترس نیست.',
    };
  }

  const baseUrl = (process.env.ARA_ANTHROPIC_BASE_URL || 'https://api.justwoker.icu').replace(/\/$/, '');
  const endpoint = baseUrl.endsWith('/v1') ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;

  const lang = input.language ?? 'fa';
  const systemPrompt = lang === 'fa'
    ? 'شما مشاور مداخله محله‌ای هستید. بر اساس تیپ تشخیصی و شکاف‌های موجود، سبدی از اقدامات پیشنهاد دهید. فقط از داده‌های ارائه‌شده استفاده کنید.'
    : 'You are a neighborhood intervention advisor. Based on diagnostic type and gaps, suggest an intervention basket. Use only provided data.';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ARA_LLM_MODEL || process.env.ARA_ANTHROPIC_MODEL || 'claude-opus-4-8',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            diagnostic_type: input.diagnosticType,
            chain_gaps: input.chainGaps,
            capital_scores: input.capitalScores,
            constraints: input.constraints,
          }),
        }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await response.json() as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text ?? '';
    return { suggestions: [], ai_used: true, text };
  } catch {
    clearTimeout(timer);
    return { suggestions: [], ai_used: false, text: 'خطا در فراخوانی AI' };
  }
}
