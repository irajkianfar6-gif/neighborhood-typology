/**
 * برنامهٔ گردآوری داده: کدام ماژول کدام شاخص را پر می‌کند، چقدر مانده و نمونهٔ پیشنهادی چند است.
 * فقط از وضعیت واقعی پاسخ‌ها/ثبت‌ها ساخته می‌شود؛ هیچ مقداری برآورد یا جعل نمی‌شود.
 */
import { ALGORITHM_INDICATORS } from '../../src/algorithm/algorithmIndicators';
import { ECONOMIC_INDICATORS, HOUSEHOLD_INDICATORS } from '../../src/algorithm/surveyInstrument';
import { MIN_ELIGIBLE, SURVEY_INDICATORS, TARGET_N, type SurveySummary } from './perceptualSurvey';
import { MIN_POINTS, type FieldAuditSummary } from './fieldAudit';
import { MIN_ACTORS, MIN_RECORDS, REGISTER_KINDS, type RegisterSummary } from './localRegister';

export const CORE_40_NAMES: Record<string, string> = Object.fromEntries(ALGORITHM_INDICATORS.map((i) => [i.code, i.name]));

export type PlanStatus = 'ready' | 'partial' | 'empty';
export interface PlanIndicator {
  code: string; name: string; status: PlanStatus; value: number | null; progress: number; have: number; need: number; unit: string;
  /** وضعیت همین شاخص در آخرین کارت تصمیم */
  card: { score: number | null; channel: string | null; tier: string | null; coveredElsewhere: boolean };
}
export interface PlanModule { key: 'survey' | 'household' | 'economy' | 'audit' | 'register' | 'network'; title: string; progress: number; status: PlanStatus; indicators: PlanIndicator[]; guidance: string }

/** حجم نمونهٔ کوکران (p=۰٫۵، خطای ۵٪، اطمینان ۹۵٪) با تصحیح جامعهٔ محدود */
export function recommendedSampleSize(population: number | null): number {
  if (!population || population <= 0) return TARGET_N;
  return Math.ceil(TARGET_N / (1 + (TARGET_N - 1) / population));
}

export function buildCollectionPlan(input: {
  survey: SurveySummary; audit: FieldAuditSummary; register: RegisterSummary; population: number | null;
  cardIndicators: Array<{ code: string; score: number | null; channel: string; tier: string }>;
}): { modules: PlanModule[]; recommendedN: number; gateN: number; overall: number; unlockable: string[] } {
  const { survey, audit, register } = input;
  const cardBy = new Map(input.cardIndicators.map((i) => [i.code, i]));
  const cardOf = (code: string, ownChannels: string[]) => {
    const c = cardBy.get(code);
    return { score: c?.score ?? null, channel: c?.channel ?? null, tier: c?.tier ?? null, coveredElsewhere: Boolean(c && c.score !== null && !ownChannels.includes(c.channel)) };
  };
  const est = new Map(survey.indicators.map((i) => [i.code, i]));
  const pend = new Map(survey.pending.map((p) => [p.code, p]));
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const status = (p: number, hasValue: boolean): PlanStatus => (hasValue && p >= 1 ? 'ready' : p > 0 || hasValue ? 'partial' : 'empty');
  const recommendedN = recommendedSampleSize(input.population);

  const perceptual: PlanIndicator[] = Object.keys(SURVEY_INDICATORS).map((code) => {
    const e = est.get(code);
    const p = clamp(survey.nAccepted / recommendedN);
    return { code, name: CORE_40_NAMES[code] ?? code, status: status(p, Boolean(e)), value: e?.score ?? null, progress: p, have: survey.nAccepted, need: recommendedN, unit: 'پاسخ معتبر', card: cardOf(code, ['survey']) };
  });
  const household: PlanIndicator[] = Object.keys(HOUSEHOLD_INDICATORS).map((code) => {
    const e = est.get(code);
    const have = e ? e.n : pend.get(code)?.eligibleN ?? 0;
    const p = clamp(have / MIN_ELIGIBLE);
    return { code, name: CORE_40_NAMES[code] ?? code, status: status(p, Boolean(e)), value: e?.score ?? null, progress: p, have, need: MIN_ELIGIBLE, unit: `پاسخ واجد شرایط (${HOUSEHOLD_INDICATORS[code].denominator})`, card: cardOf(code, ['survey']) };
  });
  const economic: PlanIndicator[] = Object.keys(ECONOMIC_INDICATORS).map((code) => {
    const e = est.get(code);
    const have = e ? e.n : pend.get(code)?.eligibleN ?? 0;
    const p = clamp(have / MIN_ELIGIBLE);
    return { code, name: CORE_40_NAMES[code] ?? code, status: status(p, Boolean(e)), value: e?.score ?? null, progress: p, have, need: MIN_ELIGIBLE, unit: `پاسخ واجد شرایط (${ECONOMIC_INDICATORS[code].denominator})`, card: cardOf(code, ['survey']) };
  });
  const auditP = clamp(audit.points / MIN_POINTS) * (audit.kappa !== null && audit.kappa >= 0.6 ? 1 : 0.9);
  const auditInd: PlanIndicator[] = [{ code: 'P3', name: CORE_40_NAMES.P3 ?? 'P3', status: status(audit.points >= MIN_POINTS ? 1 : auditP, audit.p3 !== null), value: audit.p3, progress: clamp(audit.points / MIN_POINTS), have: audit.points, need: MIN_POINTS, unit: 'نقطهٔ ممیزی', card: cardOf('P3', ['field']) }];
  const regInd: PlanIndicator[] = (Object.keys(REGISTER_KINDS) as Array<keyof typeof REGISTER_KINDS>).map((kind) => {
    const k = register.byKind[kind];
    const p = clamp(k.inWindow / MIN_RECORDS);
    return { code: k.indicator, name: CORE_40_NAMES[k.indicator] ?? k.indicator, status: status(p, k.value !== null), value: k.value, progress: p, have: k.inWindow, need: MIN_RECORDS, unit: 'پرونده (۳ سال اخیر)', card: cardOf(k.indicator, ['field']) };
  });
  const actors = register.network?.actors.length ?? 0;
  const g3 = register.indicators.find((i) => i.code === 'G3');
  const netInd: PlanIndicator[] = [{ code: 'G3', name: CORE_40_NAMES.G3 ?? 'G3', status: status(clamp(actors / MIN_ACTORS), Boolean(g3)), value: g3?.value ?? null, progress: clamp(actors / MIN_ACTORS), have: actors, need: MIN_ACTORS, unit: 'نهاد در شبکه', card: cardOf('G3', ['expert']) }];

  const n = (x: number) => x.toLocaleString('fa-IR');
  const mod = (key: PlanModule['key'], title: string, inds: PlanIndicator[], guidance: string): PlanModule => {
    const progress = inds.reduce((a, i) => a + i.progress, 0) / inds.length;
    return { key, title, progress: Math.round(progress * 100) / 100, status: inds.every((i) => i.status === 'ready') ? 'ready' : inds.some((i) => i.status !== 'empty') ? 'partial' : 'empty', indicators: inds, guidance };
  };
  const modules: PlanModule[] = [
    mod('survey', 'پیمایش ادراکی ساکنان', perceptual, `نمونهٔ پیشنهادی ${n(recommendedN)} پاسخ معتبر (خطای ۵٪)؛ دروازهٔ انتشار به ${n(TARGET_N)} پاسخ و آلفای کرونباخ ≥ ۰٫۷ نیاز دارد.`),
    mod('household', 'ماژول کار، مهارت و مشارکت', household, `هر شاخص با دست‌کم ${n(MIN_ELIGIBLE)} پاسخ واجد شرایط برآورد می‌شود؛ C5 فقط از جوانان ۱۸–۲۹ و H4 فقط از شاغلان ماهر.`),
    mod('economy', 'ماژول اقتصاد و هزینهٔ مسکن خانوار', economic, `درآمد، اجاره/ودیعه و قسط مسکن؛ هر شاخص با دست‌کم ${n(MIN_ELIGIBLE)} پاسخ واجد شرایط. E1 با متوسط درآمد خانوار شهری استان تهران (HEIS) مقایسه می‌شود.`),
    mod('audit', 'ممیزی میدانی فضای عمومی', auditInd, `دست‌کم ${n(MIN_POINTS)} نقطه و یک نقطه با دو ممیز مستقل برای پایایی (κ ≥ ۰٫۶).`),
    mod('register', 'ثبت پرونده‌های محلی', regInd, `برای هر شاخص دست‌کم ${n(MIN_RECORDS)} پرونده از سه سال اخیر؛ ارجاع سند کیفیت روش را بالا می‌برد.`),
    mod('network', 'شبکهٔ همکاری نهادها', netInd, `دست‌کم ${n(MIN_ACTORS)} نهاد فعال در محله و پیوندهای همکاری عملی میان آن‌ها.`),
  ];
  const all = modules.flatMap((m) => m.indicators);
  const overall = Math.round((all.reduce((a, i) => a + i.progress, 0) / all.length) * 100) / 100;
  const unlockable = all.filter((i) => i.status !== 'ready' && !i.card.coveredElsewhere).map((i) => i.code);
  return { modules, recommendedN, gateN: TARGET_N, overall, unlockable };
}
