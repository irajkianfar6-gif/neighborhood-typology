/**
 * دروازهٔ انتشار — سطح کل کارت، سطح هر سرمایه، و دروازه‌های بخشی (تیپ، عدالت، روند، علّی).
 *
 * کارت:
 *  PUBLISHABLE  پوشش معتبر ≥ ۸۰٪ (reliability ≥ ۰٫۶)، هر سرمایه ≥ ۳ شاخص معتبر، سهم proxy ≤ ۱۰٪،
 *               مرز official، پیمایش کافی، وزن و آستانهٔ کالیبره
 *  PROVISIONAL  پوشش امتیازدار ≥ ۵۰٪ (reliability ≥ ۰٫۴) و هر سرمایه ≥ ۱ شاخص
 *  INSUFFICIENT کمتر از آن؛ فقط پروفایل شواهد و فهرست دادهٔ لازم
 * سرمایه:
 *  PUBLISHABLE ≥۴ از ۵ معتبر و بدون proxy | PROVISIONAL ≥۳ امتیازدار | INSUFFICIENT
 */
import { ALGORITHM_INDICATORS } from '../../src/algorithm/algorithmIndicators';
import type { CapitalKey } from '../../src/algorithm/types';
import { reliabilityWeights } from './reliability';
import { thresholdRegistry } from './normalize';
import type { ScoredValue } from './types';

export type PublicationLevel = 'PUBLISHABLE' | 'PROVISIONAL' | 'INSUFFICIENT';
export const CAPITAL_KEYS: CapitalKey[] = ['H', 'S', 'E', 'P', 'N', 'C', 'G', 'R'];
export const RELIABLE = 0.6;
export const USABLE = 0.4;

export interface GateInput {
  values: Map<string, ScoredValue>;
  boundaryTier: 'official' | 'osm_admin' | 'derived';
  surveyAdequacy: 'ADEQUATE' | 'MINIMUM' | 'INSUFFICIENT' | 'NONE';
  surveyAlpha: number | null;
  groupValues: Record<string, Record<string, number>>;
  groupNs: Record<string, number>;
  previousRunVersions?: Record<string, string> | null;
  currentVersions: Record<string, string>;
}

export interface MissingItem { code: string; name: string; capital: CapitalKey; reason: string; nextAction: string; owner: string; template?: string }

export interface GateResult {
  level: PublicationLevel;
  reasons: string[];
  coverage: { total: number; scored: number; reliable: number; usable: number; proxyShare: number; byCapital: Record<CapitalKey, { scored: number; reliable: number; level: PublicationLevel }> };
  sections: {
    diagnosticType: { allowed: boolean; reason?: string };
    equity: { allowed: boolean; reason?: string };
    trend: { allowed: boolean; reason?: string };
    causal: { level: 'initial' | 'convergent' | 'tested' | 'none'; reason?: string };
  };
  usableCodes: string[];
  missing: MissingItem[];
}

/** مالک داده و الگوی قرارداد هر شاخص برای «چه داده‌ای این حکم را تغییر می‌دهد» */
export const DATA_OWNERS: Record<string, { owner: string; template?: string }> = {
  H1: { owner: 'مرکز آمار ایران (سرشماری بلوکی)', template: 'sci.csv' }, H2: { owner: 'پیمایش محله (ماژول خانوار) / سازمان فنی‌وحرفه‌ای', template: 'education.csv' },
  H3: { owner: 'سازمان تأمین اجتماعی + LFS', template: 'tamin.csv' }, H4: { owner: 'پیمایش محله (ماژول خانوار) / پیمایش نیروی کار' },
  H5: { owner: 'آموزش‌وپرورش / فنی‌وحرفه‌ای', template: 'education.csv' },
  S1: { owner: 'پیمایش ادراکی محله' }, S2: { owner: 'پیمایش ادراکی محله' }, S3: { owner: 'پیمایش ادراکی محله' },
  S4: { owner: 'پیمایش محله (ماژول مشارکت) / شورایاری', template: 'municipality.csv' }, S5: { owner: 'ثبت محلی مسائل (گردآوری داده) / شورایاری', template: 'municipality.csv' },
  E1: { owner: 'مرکز آمار (HEIS) / سازمان امور مالیاتی', template: 'sci.csv' }, E2: { owner: 'اتاق اصناف + تأمین اجتماعی', template: 'asnaf.csv' },
  E3: { owner: 'اتاق اصناف', template: 'asnaf.csv' }, E4: { owner: 'مرکز آمار (اجاره‌بها) + بازار مسکن', template: 'sci.csv' },
  E5: { owner: 'شاپرک (POS تجمیعی) + ارزیابی خبره' },
  P1: { owner: 'شهرداری (پروانه و عمر بنا)', template: 'municipality.csv' }, P2: { owner: 'OSM / شبکهٔ معابر شهرداری' },
  P3: { owner: 'ممیزی میدانی (فرم P3)' }, P4: { owner: 'وزارت بهداشت + OSM', template: 'health.csv' }, P5: { owner: 'شرکت واحد / مترو (GTFS)' },
  N1: { owner: 'سازمان پارک‌ها + OSM' }, N2: { owner: 'Sentinel-2 NDVI (NDVI_COG_PATH)' }, N3: { owner: 'سازمان حفاظت محیط‌زیست / کنترل کیفیت هوا' },
  N4: { owner: 'JRC Flood + IIEES گسل (رستر)' }, N5: { owner: 'ERA5/Landsat LST + مدیریت بحران' },
  C1: { owner: 'میراث فرهنگی / ارشاد + OSM', template: 'culture.csv' }, C2: { owner: 'فرهنگ‌سراها', template: 'culture.csv' },
  C3: { owner: 'پیمایش ادراکی محله' }, C4: { owner: 'پیمایش محله (ماژول مشارکت) / فرهنگ‌سراها', template: 'culture.csv' }, C5: { owner: 'پیمایش محله (جوانان ۱۸–۲۹) / برنامه‌ها', template: 'culture.csv' },
  G1: { owner: 'ثبت محلی فرایندهای تصمیم / شورایاری (صورت‌جلسات)', template: 'municipality.csv' }, G2: { owner: 'سامانهٔ ۱۳۷', template: 'municipality.csv' },
  G3: { owner: 'ارزیابی شبکهٔ نهادی (گردآوری داده) / خبرگان' }, G4: { owner: 'سامانهٔ پروژه/بودجهٔ شهرداری', template: 'municipality.csv' }, G5: { owner: 'ثبت محلی پروژه‌ها (گردآوری داده) / گزارش‌های ارزیابی' },
  R1: { owner: 'GTFS + Valhalla' }, R2: { owner: 'اصناف/تأمین + Valhalla', template: 'asnaf.csv' }, R3: { owner: 'آموزش‌وپرورش + OSM', template: 'education.csv' },
  R4: { owner: 'شاپرک (POS تجمیعی)' }, R5: { owner: 'سازمان تنظیم مقررات / Ookla', template: 'cra.csv' },
};

export function evaluatePublication(input: GateInput): GateResult {
  const reasons: string[] = [];
  const total = ALGORITHM_INDICATORS.length;
  const byCapital = Object.fromEntries(CAPITAL_KEYS.map((k) => [k, { scored: 0, reliable: 0, level: 'INSUFFICIENT' as PublicationLevel }])) as GateResult['coverage']['byCapital'];
  let scored = 0, reliable = 0, usable = 0, proxy = 0;
  const usableCodes: string[] = [];
  const proxyByCapital: Record<string, number> = {};
  const missing: MissingItem[] = [];
  for (const ind of ALGORITHM_INDICATORS) {
    const v = input.values.get(ind.code);
    const has = v && v.score !== null;
    if (has) {
      scored++;
      byCapital[ind.capitalKey].scored++;
      if (v!.reliability >= RELIABLE) { reliable++; byCapital[ind.capitalKey].reliable++; }
      if (v!.reliability >= USABLE) { usable++; usableCodes.push(ind.code); }
      if (v!.tier === 'proxy') { proxy++; proxyByCapital[ind.capitalKey] = (proxyByCapital[ind.capitalKey] ?? 0) + 1; }
    }
    if (!has || v!.reliability < RELIABLE) {
      const own = DATA_OWNERS[ind.code] ?? { owner: 'نامشخص' };
      missing.push({
        code: ind.code, name: ind.name, capital: ind.capitalKey,
        reason: !v ? 'هیچ منبعی متصل نیست' : v.score === null ? (v.missingReason ?? 'بدون امتیاز') : `اعتماد ${v.reliability} < ${RELIABLE} (${v.tier})`,
        nextAction: v?.nextAction ?? (own.template ? `بارگذاری فایل قرارداد ${own.template}` : `تأمین داده از ${own.owner}`),
        owner: own.owner, template: own.template,
      });
    }
  }
  for (const k of CAPITAL_KEYS) {
    const c = byCapital[k];
    c.level = c.reliable >= 4 && !proxyByCapital[k] ? 'PUBLISHABLE' : c.scored >= 3 ? 'PROVISIONAL' : 'INSUFFICIENT';
  }
  const proxyShare = scored ? proxy / scored : 0;
  const calibrated = Boolean(thresholdRegistry().calibrated) && Boolean((reliabilityWeights() as { calibrated?: boolean }).calibrated);
  const allCap3 = CAPITAL_KEYS.every((k) => byCapital[k].reliable >= 3);
  const allCap1 = CAPITAL_KEYS.every((k) => byCapital[k].scored >= 1);

  let level: PublicationLevel;
  const pubChecks: Array<[boolean, string]> = [
    [reliable / total >= 0.8, `پوشش معتبر ${reliable}/${total} کمتر از ۸۰٪`],
    [allCap3, 'همهٔ سرمایه‌ها ≥۳ شاخص معتبر ندارند'],
    [proxyShare <= 0.1, `سهم پروکسی ${(proxyShare * 100).toFixed(0)}% بیش از ۱۰٪`],
    [input.boundaryTier === 'official', `مرز ${input.boundaryTier} است، نه رسمی`],
    [input.surveyAdequacy === 'ADEQUATE' && (input.surveyAlpha ?? 0) >= 0.7, 'پیمایش ادراکی کافی (n≥۳۸۴، α≥۰٫۷) نیست'],
    [calibrated, 'آستانه‌ها و وزن‌ها هنوز کالیبره و تأیید کمیتهٔ روش‌شناسی نشده‌اند'],
  ];
  if (pubChecks.every(([ok]) => ok)) level = 'PUBLISHABLE';
  else if (usable / total >= 0.5 && allCap1) {
    level = 'PROVISIONAL';
    reasons.push(...pubChecks.filter(([ok]) => !ok).map(([, m]) => m));
  } else {
    level = 'INSUFFICIENT';
    reasons.push(`پوشش قابل‌استفاده ${usable}/${total} (${Math.round((usable / total) * 100)}٪) کمتر از ۵۰٪ است`);
    const empty = CAPITAL_KEYS.filter((k) => byCapital[k].scored === 0);
    if (empty.length) reasons.push(`سرمایه‌های بدون هیچ شاخص: ${empty.join('، ')}`);
  }
  if (input.boundaryTier === 'derived' && level === 'PUBLISHABLE') { level = 'PROVISIONAL'; reasons.push('مرز مشتق (پروکسی) سقف انتشار را PROVISIONAL می‌کند'); }

  // ---- دروازه‌های بخشی ----
  const capsForType = CAPITAL_KEYS.every((k) => byCapital[k].reliable >= 2);
  const diag = level !== 'INSUFFICIENT' && reliable / total >= 0.6 && capsForType
    ? { allowed: true }
    : { allowed: false, reason: `تیپ تشخیصی نیازمند ≥۶۰٪ شاخص معتبر و ≥۲ شاخص معتبر در هر سرمایه است (اکنون ${reliable}/${total})` };
  const qualifyingGroups = Object.entries(input.groupNs).filter(([, n]) => n >= 30).map(([g]) => g);
  const groupsWithValues = new Set(Object.values(input.groupValues).flatMap((g) => Object.keys(g)));
  const eqGroups = qualifyingGroups.filter((g) => groupsWithValues.has(g));
  const equity = eqGroups.length >= 2
    ? { allowed: true }
    : { allowed: false, reason: 'حکم عدالت نیازمند دادهٔ گروهی دست‌کم ۲ گروه با n≥۳۰ است؛ واژهٔ «عادلانه» و تیپ D صادر نمی‌شود' };
  let trend: GateResult['sections']['trend'];
  if (!input.previousRunVersions) trend = { allowed: false, reason: 'اجرای قبلی برای مقایسه وجود ندارد' };
  else {
    const diff = Object.keys(input.currentVersions).filter((k) => input.previousRunVersions![k] !== input.currentVersions[k]);
    trend = diff.length ? { allowed: false, reason: `نسخهٔ ${diff.join('، ')} با اجرای قبلی متفاوت است؛ مقایسهٔ زمانی معتبر نیست` } : { allowed: true };
  }
  const channels = new Set([...input.values.values()].filter((v) => v.score !== null).map((v) => v.channel === 'satellite' ? 'open_auto' : v.channel));
  const streams = ['open_auto', 'contract', 'survey', 'field'].filter((c) => channels.has(c as never)).length;
  // هم‌گرایی علّی: دست‌کم دو جریان مستقل و یکی از آن‌ها شواهد ادراکی/میدانی (سازوکار را از زبان ساکنان/مشاهده تأیید کند)
  const lived = channels.has('survey' as never) || channels.has('field' as never);
  const causal: GateResult['sections']['causal'] = level === 'INSUFFICIENT'
    ? { level: 'none', reason: 'کارت ناکافی' }
    : streams >= 2 && lived ? { level: 'convergent' }
    : { level: 'initial', reason: streams < 2 ? 'فقط یک جریان شواهد' : 'سازوکار علّی بدون پیمایش ادراکی یا ممیزی میدانی تأیید نشده است' };

  return {
    level, reasons,
    coverage: { total, scored, reliable, usable, proxyShare: Math.round(proxyShare * 1000) / 1000, byCapital },
    sections: { diagnosticType: diag, equity, trend, causal },
    usableCodes, missing,
  };
}
