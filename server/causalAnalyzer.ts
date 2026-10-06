// ============================================================
// تحلیل علّی هوشمند — تولید فرضیه‌های رقیب با AI
// ============================================================
import type { CausalHypothesis, ChainGaps, ProblemAddress, FourSourceEvidence } from '../src/algorithm/types';

export interface CausalAnalysisInput {
  chainGaps: ChainGaps;
  bottleneck: ProblemAddress;
  fourSourceEvidence: FourSourceEvidence;
  capitalScores: Record<string, number>;
  language?: 'fa' | 'en';
}

/**
 * تولید فرضیه‌های علّی با AI (Anthropic API)
 */
export async function generateCausalHypotheses(
  input: CausalAnalysisInput,
): Promise<{ hypotheses: CausalHypothesis[]; ai_used: boolean; text: string }> {
  const apiKey = process.env.ARA_ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      hypotheses: [],
      ai_used: false,
      text: 'AI در دسترس نیست. از تحلیل قطعی استفاده کنید.',
    };
  }

  const baseUrl = (process.env.ARA_ANTHROPIC_BASE_URL || 'https://api.justwoker.icu').replace(/\/$/, '');
  const endpoint = baseUrl.endsWith('/v1') ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;

  const lang = input.language ?? 'fa';
  const systemPrompt = lang === 'fa'
    ? 'شما یک تحلیل‌گر علل محله‌ای هستید. بر اساس داده‌های ارائه‌شده، ۳-۵ فرضیه رقیب تولید کنید. فقط از داده‌های ارائه‌شده استفاده کنید و عددسازی نکنید.'
    : 'You are a neighborhood cause analyst. Based on the provided data, generate 3-5 competing hypotheses. Use only the provided data and do not fabricate numbers.';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ARA_LLM_MODEL || process.env.ARA_ANTHROPIC_MODEL || 'claude-opus-4-8',
        max_tokens: 800,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            chain_gaps: input.chainGaps,
            bottleneck: input.bottleneck,
            capital_scores: input.capitalScores,
            evidence_summary: {
              objective_keys: Object.keys(input.fourSourceEvidence.objective),
              spatial_keys: Object.keys(input.fourSourceEvidence.spatial),
              behavioral_keys: Object.keys(input.fourSourceEvidence.behavioral),
              perceptual_keys: Object.keys(input.fourSourceEvidence.perceptual),
            },
          }),
        }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await response.json() as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text ?? '';
    return { hypotheses: [], ai_used: true, text };
  } catch {
    clearTimeout(timer);
    return { hypotheses: [], ai_used: false, text: 'خطا در فراخوانی AI' };
  }
}
