/** «مقدار مستند» — واحد پایهٔ همهٔ شاخص‌ها در مسیر جدید */
export type EvidenceTier = 'official' | 'contract' | 'open_measured' | 'open_model' | 'survey' | 'field' | 'expert' | 'proxy';
export type GeographyLevel = 'block' | 'neighborhood' | 'district' | 'city' | 'province' | 'national';
export type Channel = 'open_auto' | 'contract' | 'survey' | 'field' | 'satellite' | 'expert';

export interface DocumentedValue {
  code: string;
  raw: number | null;
  unit: string;
  numerator?: number | null;
  denominator?: number | null;
  denominatorKind?: 'population' | 'area' | 'population_active' | 'none';
  source: string;
  sourceIds: string[];
  channel: Channel;
  tier: EvidenceTier;
  geographyLevel: GeographyLevel;
  observedAt: string | null;
  observedAtUnknown?: boolean;
  fetchedAt: string;
  method: string;
  /** ضریب کیفیت روش ۰..۱ (مثلاً فاصلهٔ اقلیدسی×ضریب پیچش به‌جای مسیر شبکه‌ای = ۰٫۸) */
  methodQuality: number;
  /** کفایت نمونه/پوشش ۰..۱ (n/384، valid_fraction، ...) */
  sampleAdequacy: number;
  cadence: 'realtime' | 'hourly' | 'daily' | 'monthly' | 'annual' | 'census' | 'static';
  missingReason?: string;
  nextAction?: string;
  notes?: string[];
  /** شاخص نوع «کمتر بهتر» است */
  lowerIsBetter?: boolean;
  details?: Record<string, unknown>;
}

export interface ScoredValue extends DocumentedValue {
  score: number | null;
  scoringMethod: 'normative' | 'percentile' | 'contract_scale' | 'survey_scale' | 'none';
  scoringRef?: string;
  percentile?: number | null;
  reliability: number;
  reliabilityParts: { T: number; S: number; F: number; N: number; C: number };
  alternatives: Array<{ source: string; tier: EvidenceTier; raw: number | null; score: number | null }>;
  conflict: boolean;
}
