/**
 * عامل نقاد (A12) — بازبینی قطعی و بدون هوش مصنوعی پیش از گزارش/انتشار.
 * هر بررسی وضعیت pass/warn/fail دارد؛ یک fail = توقف انتشار رسمی (فقط لایهٔ تحلیلی مجاز است).
 */
import { independenceSummary, toEvidencePacket, validatePacket } from './evidencePacket';
import type { CardResult } from './state';
import { renderReport } from './report';
import { ungroundedNumbers } from './grounding';
import { USABLE } from '../evidence/publicationGate';

export const CRITIC_VERSION = 'CR-v2';
export interface CriticCheck { id: string; title: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface CriticReport { version: string; verdict: 'pass' | 'pass_with_warnings' | 'fail'; checks: CriticCheck[]; independence: ReturnType<typeof independenceSummary>; officialPublicationAllowed: boolean }

export const REQUIRED_REPRO_KEYS = ['method', 'indicators', 'thresholds', 'reliabilityWeights', 'capitalWeights', 'reference', 'localLayers', 'interventionLibrary', 'boundary', 'code', 'data'];

export function verifyAnalysis(r: CardResult): CriticReport {
  const { card, gate, evidence } = r;
  const checks: CriticCheck[] = [];
  const add = (id: string, title: string, status: CriticCheck['status'], detail: string) => checks.push({ id, title, status, detail });

  // ۱) منشأ هر عدد امتیازدار
  const noSource = card.indicators.filter((i) => i.score !== null && (!i.source || i.source === '—' || i.tier === 'none'));
  add('C1', 'هر عدد امتیازدار منشأ دارد', noSource.length ? 'fail' : 'pass', noSource.length ? `بدون منشأ: ${noSource.map((i) => i.code).join('، ')}` : `${card.indicators.filter((i) => i.score !== null).length} شاخص امتیازدار، همه با منبع و رده`);

  // ۲) قرارداد بستهٔ شاهد و یکپارچگی هش
  const packets = evidence.map((v) => toEvidencePacket(v, card.neighborhood.neighborhoodId, 'agent:A3'));
  const bad = packets.map((p) => ({ p, e: validatePacket(p) })).filter((x) => x.e.length);
  add('C2', 'همهٔ شواهد با قرارداد ara.evidence-packet.v1 معتبرند', bad.length ? 'fail' : 'pass', bad.length ? bad.slice(0, 5).map((x) => `${x.p.indicator}: ${x.e[0]}`).join(' | ') : `${packets.length} بسته معتبر`);

  // ۳) قاعدهٔ عدالت: بدون دادهٔ گروهی، حکم «عادلانه» یا تیپ D ممنوع
  const eq = gate.sections.equity.allowed;
  const eqViolation = !eq && (card.engine?.diagnosticType === 'D' || /عادلانه/.test(card.engine?.finalStatement ?? ''));
  add('C3', 'بدون دادهٔ گروهی، حکم عدالت صادر نشده است', eqViolation ? 'fail' : 'pass', eq ? 'دادهٔ گروهی موجود است' : eqViolation ? 'حکم عدالت بدون دادهٔ گروهی' : 'حکم عدالت به‌درستی امتناع شده است');

  // ۴) موتور روی کارت ناکافی اجرا نشده باشد
  const engineOnInsufficient = card.publication.level === 'INSUFFICIENT' && card.engine !== null;
  add('C4', 'موتور فقط روی کارت با شواهد کافی اجرا شده است', engineOnInsufficient ? 'fail' : 'pass', engineOnInsufficient ? 'کارت INSUFFICIENT اما خروجی موتور صادر شده' : `سطح کارت: ${card.publication.level}`);

  // ۵) سازگاری متن و عدد: جملهٔ نهایی همان مداخلهٔ رتبهٔ اول را اعلام کند
  if (card.engine?.interventions?.[0]) {
    const first = card.engine.interventions[0].name;
    const mentions = card.engine.finalStatement.includes(first);
    add('C5', 'جملهٔ نهایی با مداخلهٔ رتبهٔ اول می‌خواند', mentions ? 'pass' : 'warn', mentions ? `«${first}»` : `جملهٔ نهایی مداخلهٔ «${first}» را نام نمی‌برد`);
    const b = card.engine.bottleneck;
    const iv = card.engine.interventions[0];
    const aligned = iv.targetCapital === b.capital && iv.targetTransition?.[0] === b.transition[0] && iv.targetTransition?.[1] === b.transition[1];
    add('C6', 'مداخلهٔ اول هم‌راستا با گلوگاه است', aligned ? 'pass' : 'warn', aligned ? `${b.capital}: ${b.transition.join('→')}` : `گلوگاه ${b.capital}:${b.transition.join('→')} ولی مداخلهٔ اول ${iv.targetCapital}`);
  } else {
    add('C5', 'جملهٔ نهایی با مداخلهٔ رتبهٔ اول می‌خواند', 'pass', 'مداخله‌ای صادر نشده است');
  }

  // ۷) استقلال شواهد
  const independence = independenceSummary(packets);
  add('C7', 'شواهد وابسته مستقل شمرده نشده‌اند', independence.sharedGroups.length ? 'warn' : 'pass',
    independence.sharedGroups.length ? independence.sharedGroups.map((g) => `${g.indicators.join('، ')} ← منشأ مشترک ${g.group}`).join(' | ') + ' — در تفسیر یک شاهد حساب شوند' : 'گروه وابستهٔ چندشاخصی یافت نشد');

  // ۸) کامل بودن کلید بازتولید
  const missingKeys = REQUIRED_REPRO_KEYS.filter((k) => !card.reproducibilityKey[k]);
  add('C8', 'کلید بازتولید کامل است', missingKeys.length ? 'fail' : 'pass', missingKeys.length ? `کلیدهای ناموجود: ${missingKeys.join('، ')}` : Object.entries(card.reproducibilityKey).map(([k, v]) => `${k}=${v}`).join('؛ '));

  // ۹) تازگی داده
  const stale = card.dataVintage.staleIndicators;
  add('C9', 'دادهٔ کهنه برچسب خورده است', stale.length > 5 ? 'warn' : 'pass', stale.length ? `${stale.length} شاخص کهنه: ${stale.slice(0, 10).join('، ')}` : 'شاخص کهنه‌ای نیست');

  // ۱۰) تضاد منابع
  const conflicts = card.indicators.filter((i) => i.conflict).map((i) => i.code);
  add('C10', 'تضاد حل‌نشدهٔ منابع', conflicts.length ? 'warn' : 'pass', conflicts.length ? `تضاد در ${conflicts.join('، ')} (منبع اولویت‌دار انتخاب شد)` : 'تضادی نیست');

  // ۱۱) سطح علّی
  const causal = gate.sections.causal.level;
  add('C11', 'فرضیه‌های علّی با سطح شواهد برچسب خورده‌اند', causal === 'convergent' || causal === 'tested' ? 'pass' : 'warn', `سطح علّی: ${causal}`);

  // ۱۲) بازهٔ مجاز مقادیر (امتیاز ۰..۱۰۰، اعتبار ۰..۱، عدد متناهی)
  const outOfRange = card.indicators.filter((i) => (i.score !== null && (!Number.isFinite(i.score) || i.score < 0 || i.score > 100)) || !Number.isFinite(i.reliability) || i.reliability < 0 || i.reliability > 1 || (i.raw !== null && !Number.isFinite(i.raw))).map((i) => i.code);
  const capOut = card.capitals.filter((c) => c.score !== null && (!Number.isFinite(c.score) || c.score < 0 || c.score > 100)).map((c) => c.capital);
  add('C12', 'مقادیر در بازهٔ مجازند', outOfRange.length || capOut.length ? 'fail' : 'pass', outOfRange.length || capOut.length ? `خارج از بازه: ${[...outOfRange, ...capOut].join('، ')}` : 'همهٔ امتیازها ۰ تا ۱۰۰ و اعتبارها ۰ تا ۱');

  // ۱۳) سازگاری سطح کارت با دروازه و شمارش پوشش
  const scored = card.indicators.filter((i) => i.score !== null).length;
  const usable = card.indicators.filter((i) => i.score !== null && i.reliability >= USABLE).length;
  const levelMismatch = card.publication.level !== gate.level;
  const countMismatch = card.coverage.scored !== scored || card.coverage.usable !== usable;
  add('C13', 'سطح کارت و شمارش پوشش با دروازه می‌خواند', levelMismatch || countMismatch ? 'fail' : 'pass',
    levelMismatch ? `سطح کارت ${card.publication.level} ولی دروازه ${gate.level}` : countMismatch ? `پوشش اعلام‌شده ${card.coverage.scored}/${card.coverage.usable} ولی شمارش واقعی ${scored}/${usable}` : `${scored} امتیازدار، ${usable} قابل‌استفاده`);

  // ۱۴) سرمایهٔ امتیازدار فقط با شاخص‌های امتیازدار همان سرمایه
  const byCode = new Map(card.indicators.map((i) => [i.code, i]));
  const badCaps = card.capitals.filter((c) => c.score !== null && (!c.indicatorsUsed.length || c.indicatorsUsed.some((code) => byCode.get(code)?.score === null || byCode.get(code)?.capital !== c.capital))).map((c) => c.capital);
  add('C14', 'امتیاز هر سرمایه از شاخص‌های سنجیدهٔ خودش آمده است', badCaps.length ? 'fail' : 'pass', badCaps.length ? `سرمایه‌های ناسازگار: ${badCaps.join('، ')}` : 'سازگار');

  // ۱۵) اتکای عددی گزارش تحلیلی: هر عدد گزارش در کارت هست
  try {
    const rep = renderReport(r, null, 'analytical');
    const { engine: eng, ...rest } = card;
    const pool = [rest, eng ? { ...eng, finalStatement: '' } : null, gate.coverage];
    const g = ungroundedNumbers(`${rep.markdown}\n${eng?.finalStatement ?? ''}`, pool);
    add('C15', 'هر عدد گزارش در کارت پشتوانه دارد', g.ungrounded.length ? 'fail' : 'pass', g.ungrounded.length ? `عدد بی‌پشتوانه: ${g.ungrounded.slice(0, 8).join('، ')}` : `${g.checked} عدد بررسی شد`);
  } catch (e) { add('C15', 'هر عدد گزارش در کارت پشتوانه دارد', 'warn', `گزارش ساخته نشد: ${e instanceof Error ? e.message : e}`); }

  // ۱۶) گلوگاه و مداخله روی سرمایه‌های دارای داده
  if (card.engine?.bottleneck) {
    const bc = card.capitals.find((c) => c.capital === card.engine!.bottleneck.capital);
    add('C16', 'گلوگاه روی سرمایهٔ سنجیده‌شده است', bc && bc.score !== null ? 'pass' : 'fail', bc && bc.score !== null ? `${bc.capital} (امتیاز ${bc.score})` : `گلوگاه ${card.engine.bottleneck.capital} بدون امتیاز سرمایه`);
  }

  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const verdict = fails ? 'fail' : warns ? 'pass_with_warnings' : 'pass';
  return { version: CRITIC_VERSION, verdict, checks, independence, officialPublicationAllowed: !fails && card.publication.level === 'PUBLISHABLE' };
}
