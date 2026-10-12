// ============================================================
// ابزارهای مشترک «هوش مصنوعی حکیم» برای صفحهٔ گونه‌شناسی محلات:
//  - ساخت پرامپت توضیح واژه/بخش (هوور-هلپر)
//  - ساخت پرامپت بازبینی اعتبار گونه‌بندی (حالت JSON)
//  - ساخت پرامپت گزارش کارشناسی (حالت JSON)
//  - دیکشنری محلی برای حالت آفلاین (بدون کلید/خطای سرویس)
// همهٔ پرامپت‌ها بر پایهٔ «الگوریتم نهایی گونه‌بندی» و «کاتالوگ مادر
// شاخص‌ها» (لایهٔ دانش مرجع حکیم) ساخته می‌شوند.
// ============================================================
import type { CalibrationInfo, ZoneResult } from '../algorithm/types';
import type { FullExtract, IndicatorSample } from '../algorithm/liveExtract';
import type { PointIngest } from '../algorithm/ingest';
import { LAYER_FA } from '../algorithm/types';
import { extractSummary } from '../algorithm/liveExtract';
import { ALGORITHM_SPEC, sciDigestForChat, type HakimGrounding } from './hakimGrounding';

export interface ZoneAudit {
  verdict: 'agree' | 'conditional' | 'disagree' | string;
  aiConfidence: number;
  justification: string[];
  topDrivers: { indicator: string; effect: string }[];
  dataGaps: string[];
  refinedIntervention: string;
  risks: string[];
}

// ─── پرامپت توضیح واژه/بخش (هوور) ───────────────────────────
export function buildExplainMessages(
  subject: string,
  context: string,
  grounding?: HakimGrounding,
): { system: string; user: string } {
  const system =
    'تو «حکیم» هستی، دستیار هوشمند حکمرانی کشور در سامانه آرا (ISGP) و متخصص معماری، شهرسازی و مدل‌های پایش محله‌ای. ' +
    'به زبان فارسی، مختصر (حداکثر ۶–۸ خط)، دقیق و ساختارمند پاسخ بده. از واژگان تخصصی در حد نیاز استفاده کن و اصطلاح را ساده‌سازی کن. ' +
    'اگر در مورد موضوع مطمئن نیستی صادقانه بگو. خروجی فقط متن فارسی با خط‌های جداگانه؛ بدون مارک‌داون سنگین. ' +
    'توضیح باید بر پایهٔ الگوریتم مرجع گونه‌بندی محلات باشد نه تعاریف عام:\n\n' +
    `[الگوریتم مرجع گونه‌بندی محلات]\n${grounding?.algorithmSpec || ALGORITHM_SPEC}`;
  const user =
    `موضوعی که کاربر نشانگر را روی آن ثابت نگه داشته و درخواست توضیح دارد:\n«${subject}»\n` +
    (context ? `زمینه/بخش صفحه که این موضوع در آن قرار دارد:\n«${context}»\n` : '') +
    'لطفاً این بخش را به‌صورت حرفه‌ای و کاربردی برای یک تصمیم‌گیر حاکمیتی توضیح بده.';
  return { system, user };
}

// ─── حقایق داده‌ای مشترک (بازبینی اعتبار + گزارش کارشناسی) ─────
export function buildZoneFacts(
  zone: ZoneResult,
  samples: FullExtract | null,
  ingest: PointIngest | null,
  calibration?: CalibrationInfo | null,
): string {
  const summary = samples ? extractSummary(samples) : null;

  const topSamples = (samples?.samples ?? [])
    .filter((s) => s.value != null)
    .sort((a, b) => (b.confidence - a.confidence) || (a.uid < b.uid ? -1 : 1))
    .slice(0, 26)
    .map((s) => fmtSampleRow(s))
    .join('\n');

  const ingestFacts = ingest
    ? [
        `آدرس: ${ingest.address?.value.name ?? '—'} (${ingest.provinceFa})`,
        ingest.air?.status === 'live' ? `AQI: ${ingest.air.value.aqi} | PM2.5: ${ingest.air.value.pm25}` : null,
        ingest.weather?.status === 'live'
          ? `دما: ${ingest.weather.value.temperature}°C | بارش: ${ingest.weather.value.precipitation}mm`
          : null,
        ingest.osm?.status === 'live'
          ? `OSM: ${ingest.osm.value.buildings} بنا | ${ingest.osm.value.shops + ingest.osm.value.market} کسب‌وکار | ${ingest.osm.value.schools} مدرسه | ${ingest.osm.value.health} درمانی | ${ingest.osm.value.worship} مذهبی | ${ingest.osm.value.roads} معبر`
          : null,
      ].filter((x): x is string => !!x)
    : [];

  return (
    `نقطهٔ مورد بررسی: «${zone.zone.name}» — ${zone.zone.provinceFa} · ${zone.zone.city} · ${zone.zone.scale === 'urban' ? 'شهری' : 'روستایی'}\n` +
    `مختصات: ${zone.zone.lat.toFixed(4)}, ${zone.zone.lng.toFixed(4)}\n\n` +
    `— خروجی قطعی الگوریتم —\n` +
    `SI = ${zone.si.toFixed(2)} (مقیاس ۱–۵)\n` +
    `لایه‌ها: کالبد ${zone.layerScores.P.score.toFixed(2)} (پوشش ${(zone.layerScores.P.coverage * 100).toFixed(0)}٪${zone.layerScores.P.lowConfidence ? '، کم‌اعتماد' : ''}) | رفتار ${zone.layerScores.B.score.toFixed(2)} (پوشش ${(zone.layerScores.B.coverage * 100).toFixed(0)}٪${zone.layerScores.B.lowConfidence ? '، کم‌اعتماد' : ''}) | هنجار ${zone.layerScores.N.score.toFixed(2)} (پوشش ${(zone.layerScores.N.coverage * 100).toFixed(0)}٪${zone.layerScores.N.lowConfidence ? '، کم‌اعتماد' : ''})\n` +
    `گونه‌ها: ${zone.speciesFa.P} / ${zone.speciesFa.B} / ${zone.speciesFa.N}\n` +
    `رادار: مساحت ${zone.radar.area} | شکاف توازن ${zone.radar.balanceGap.toFixed(2)} | کشیدگی: ${zone.radar.skew ?? '—'}\n` +
    `حالت تجویز: ${zone.prescription.stateId} («${zone.prescription.diagnosis}») | اولویت بودجه ${zone.prescription.budgetPriority} | KPI خروج: ${zone.prescription.exitKpi}\n` +
    `اعتماد پایپلاین: ${(zone.confidence * 100).toFixed(0)}٪ | QC: ${zone.qcFlags.length ? zone.qcFlags.join('؛ ') : 'بدون هشدار'}\n` +
    (calibration
      ? `کالیبراسیون: ${calibration.cohortSize} پهنهٔ مرجع — ${calibration.frozen ? 'منجمد (پهنهٔ نقطه در محاسبهٔ وزن/بازه شرکت نکرده و فقط اعمال شده)' : 'همان جمعیت کامل'} | شناسه: ${calibration.runId}\n`
      : '') +
    (zone.hiddenCapacities.length ? `ظرفیت‌های پنهان: ${zone.hiddenCapacities.join('، ')}\n` : '') +
    `\n— دادهٔ استخراج‌شده —\n` +
    (summary
      ? `منابع: ${summary.live} برخط | ${summary.proxy} برآورد مستند | ${summary.simulated} شبیه‌سازی‌شده | ${summary.mappedRaw.length} فیلد خام نگاشت‌شده به موتور\n`
      : '') +
    (ingestFacts.length ? `${ingestFacts.join('\n')}\n` : '') +
    (topSamples ? `نمونهٔ شاخص‌های کلیدی:\n${topSamples}\n` : '')
  );
}

// ─── پرامپت بازبینی اعتبار گونه‌بندی (JSON) ──────────────────
export function buildAuditMessages(
  zone: ZoneResult,
  samples: FullExtract | null,
  ingest: PointIngest | null,
  grounding?: HakimGrounding,
  calibration?: CalibrationInfo | null,
): { system: string; user: string } {
  const system =
    'تو «حکیم» هستی، کارشناس ارشد بازبینی مدل‌های پایش محله‌ای در سامانه آرا (ISGP). وظیفهٔ تو «بازبینی اعتبار» نتیجهٔ گونه‌بندیِ قطعیِ الگوریتم است: ' +
    'با استناد به اعداد واقعی داده‌شده و منطق الگوریتم مرجع، بررسی کن طبقه‌بندی (حالت ۱–۹، SI، امتیاز لایه‌ها، گونه‌ها) هماهنگ و قابل دفاع است یا خیر. ' +
    'پاسخ را فقط و فقط به‌صورت یک JSON معتبر برگردان (بدون متن اضافه یا قاب کد) با این ساختار دقیق:\n' +
    '{\n' +
    '  "verdict": "agree" | "conditional" | "disagree",\n' +
    '  "aiConfidence": عدد بین 0 و 1,\n' +
    '  "justification": ["نقطه‌ای که عدد X تأیید می‌کند...", "..."],  // ۳ تا ۶ مورد، هر مورد به یک عدد واقعی ارجاع دهد\n' +
    '  "topDrivers": [{"indicator": "نام شاخص", "effect": "نقش آن در نتیجه"}],\n' +
    '  "dataGaps": ["خلأ داده‌ای که اعتماد را کاهش می‌دهد"],\n' +
    '  "refinedIntervention": "تجویز مداخلهٔ اصلاح‌شده در یک پاراگراف کوتاه",\n' +
    '  "risks": ["ریسک یا سوگیری احتمالی در تفسیر"]\n' +
    '}\n\n' +
    '[الگوریتم مرجع گونه‌بندی محلات — برای انطباق بازبینی با مشخصات سند]\n' +
    `${grounding?.algorithmSpec || ALGORITHM_SPEC}\n\n` +
    '[کاتالوگ مادر شاخص‌ها — برای ارجاع دقیق شناسه‌ها در استدلال]\n' +
    (grounding?.catalogDigest || 'کاتالوگ مادر در دسترس نبود.') +
    '\n' +
    '[داده‌های رسمی مرکز آمار ایران — برای استناد به آمار جمعیت، تقسیمات، بلوک‌ها و توسعه]\n' +
    (sciDigestForChat(grounding, 'full') || 'داده‌های مرکز آمار در دسترس نبود.') +
    '\n' +
    'بازبینی خود را با ارجاع به همین اعداد، شناسه‌های کاتالوگ، داده‌های رسمی و منطق سند مرجع انجام بده.';

  const user = buildZoneFacts(zone, samples, ingest, calibration) + '\nتوصیهٔ کارشناسی خود را با ارجاع به همین اعداد بده.';
  return { system, user };
}

// ─── گزارش کارشناسی عملیاتی (JSON) ──────────────────────────
export interface ZoneReport {
  title: string;
  executiveSummary: string;
  currentSituation: string;
  intervention: string;
  actionSteps: string[];
  kpis: string[];
  risks: string[];
  conclusion: string;
}

export function buildReportMessages(
  zone: ZoneResult,
  samples: FullExtract | null,
  ingest: PointIngest | null,
  audit: ZoneAudit | null,
  grounding?: HakimGrounding,
  calibration?: CalibrationInfo | null,
): { system: string; user: string } {
  const system =
    'تو «حکیم» هستی، تحلیلگر ارشد حکمرانی محلی در سامانه آرا (ISGP) و تهیه‌کنندهٔ گزارش‌های کارشناسی برای مدیران اجرایی. ' +
    'وظیفه‌ات تولید «گزارش کارشناسی عملیاتی» برای یک پهنه است: حرفه‌ای، مستند به اعداد داده‌شده و منطق الگوریتم مرجع، قابل دفاع و در عین حال ساده و اجرایی. ' +
    'گزارش باید برای درج در پروندهٔ پهنه و ارائه به تصمیم‌گیر آماده باشد. ' +
    'پاسخ را فقط و فقط به‌صورت یک JSON معتبر برگردان (بدون متن اضافه یا قاب کد) با این ساختار دقیق:\n' +
    '{\n' +
    '  "title": "عنوان کوتاه و رسمی گزارش",\n' +
    '  "executiveSummary": "خلاصهٔ اجرایی در ۲ تا ۳ جمله",\n' +
    '  "currentSituation": "وضعیت فعلی پهنه با ارجاع به اعداد (SI، لایه‌ها، حالت، منابع داده)",\n' +
    '  "intervention": "مداخلهٔ پیشنهادی در یک پاراگراف",\n' +
    '  "actionSteps": ["گام اجرایی مشخص ۱", "گام ۲", ...],  // ۳ تا ۶ گام\n' +
    '  "kpis": ["KPI پایش قابل اندازه‌گیری", ...],  // ۲ تا ۴ مورد\n' +
    '  "risks": ["ریسک یا ملاحظهٔ اجرا", ...],\n' +
    '  "conclusion": "جمع‌بندی در یک پاراگراف"\n' +
    '}\n\n' +
    '[الگوریتم مرجع گونه‌بندی محلات — پایهٔ استدلال گزارش]\n' +
    `${grounding?.algorithmSpec || ALGORITHM_SPEC}\n\n` +
    '[کاتالوگ مادر شاخص‌ها — برای ارجاع دقیق شناسه‌ها]\n' +
    (grounding?.catalogDigest || 'کاتالوگ مادر در دسترس نبود.') +
    '\n' +
    '[داده‌های رسمی مرکز آمار ایران — برای استناد به آمار جمعیت، تقسیمات و توسعه]\n' +
    (sciDigestForChat(grounding, 'full') || 'داده‌های مرکز آمار در دسترس نبود.') +
    '\n' +
    'گزارش را بر پایهٔ همین اعداد، شناسه‌های کاتالوگ، داده‌های رسمی و مشخصات سند مرجع تولید کن.';

  const user =
    buildZoneFacts(zone, samples, ingest, calibration) +
    (audit
      ? `\n— نتیجهٔ بازبینی اعتبار حکیم —\n` +
        `رأی: ${audit.verdict} | اطمینان: ${Math.round((audit.aiConfidence || 0) * 100)}٪\n` +
        audit.justification.map((j) => `• ${j}`).join('\n') +
        (audit.refinedIntervention ? `\nمداخلهٔ اصلاح‌شده: ${audit.refinedIntervention}` : '') +
        `\n`
      : '') +
    '\nگزارش کارشناسی عملیاتی را بر پایهٔ همین اعداد تولید کن و برای درج در پروندهٔ پهنه آماده باشد.';
  return { system, user };
}

// ─── تحلیل مقایسه‌ای هوشمند دو پهنه (JSON) ──────────────────
export interface ZoneCompare {
  summary: string;
  similarities: string[];
  divergences: string[];
  radarReading: string;
  stateComparison: string;
  topDivergentIndicators: Array<{ indicator: string; a: string; b: string; note: string }>;
  implications: string[];
  recommendation: string;
  risks: string[];
}

export interface CompareDivergenceRow {
  uid: string;
  name: string;
  unit: string;
  va: number;
  vb: number;
  rel: number;
}

function zoneFactsBrief(zone: ZoneResult): string {
  return (
    `SI = ${zone.si.toFixed(2)} | لایه‌ها: کالبد ${zone.layerScores.P.score.toFixed(2)} (پوشش ${(zone.layerScores.P.coverage * 100).toFixed(0)}٪${zone.layerScores.P.lowConfidence ? '، کم‌اعتماد' : ''}) · رفتار ${zone.layerScores.B.score.toFixed(2)} (پوشش ${(zone.layerScores.B.coverage * 100).toFixed(0)}٪${zone.layerScores.B.lowConfidence ? '، کم‌اعتماد' : ''}) · هنجار ${zone.layerScores.N.score.toFixed(2)} (پوشش ${(zone.layerScores.N.coverage * 100).toFixed(0)}٪${zone.layerScores.N.lowConfidence ? '، کم‌اعتماد' : ''})\n` +
    `گونه‌ها: ${zone.speciesFa.P} / ${zone.speciesFa.B} / ${zone.speciesFa.N}\n` +
    `رادار: مساحت ${zone.radar.area} | شکاف توازن ${zone.radar.balanceGap.toFixed(2)} | کشیدگی ${zone.radar.skew ?? '—'}\n` +
    `حالت ${zone.prescription.stateId} («${zone.prescription.diagnosis}») | مداخله: ${zone.prescription.intervention} | اولویت بودجه ${zone.prescription.budgetPriority} | KPI خروج: ${zone.prescription.exitKpi}\n` +
    `اعتماد پایپلاین ${(zone.confidence * 100).toFixed(0)}٪ | QC: ${zone.qcFlags.length ? zone.qcFlags.join('؛ ') : 'بدون هشدار'}\n` +
    (zone.hiddenCapacities.length ? `ظرفیت‌های پنهان: ${zone.hiddenCapacities.join('، ')}` : '')
  );
}

function fmtCmpVal(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export function buildCompareMessages(
  nameA: string,
  a: ZoneResult,
  nameB: string,
  b: ZoneResult,
  divergence: CompareDivergenceRow[],
  grounding?: HakimGrounding,
): { system: string; user: string } {
  const system =
    'تو «حکیم» هستی، تحلیلگر ارشد حکمرانی محلی در سامانه آرا (ISGP) و کارشناس تحلیل مقایسه‌ای پهنه‌ها. وظیفه‌ات «روایت مقایسه‌ای» دو پهنهٔ ذخیره‌شده است: همگرایی‌ها، واگرایی‌ها، خوانش رادار، مقایسهٔ حالات ماتریس ۹ حالته — همه مستند به اعداد واقعی داده‌شده و منطق الگوریتم مرجع. ' +
    'پاسخ را فقط و فقط به‌صورت یک JSON معتبر برگردان (بدون متن اضافه یا قاب کد) با این ساختار دقیق:\n' +
    '{\n' +
    '  "summary": "خلاصهٔ کلی مقایسه در ۲ تا ۳ جمله",\n' +
    '  "similarities": ["همگرایی/شباهت مستند به عدد"],\n' +
    '  "divergences": ["واگرایی/تفاوت مستند به عدد"],\n' +
    '  "radarReading": "خوانش رادار دو پهنه: مساحت، شکاف توازن و جهت کشیدگی هر کدام و معنای آن",\n' +
    '  "stateComparison": "مقایسهٔ حالت‌های ماتریس ۹ حالته و دلالت آن",\n' +
    '  "topDivergentIndicators": [{"indicator": "نام شاخص", "a": "مقدار پهنهٔ اول", "b": "مقدار پهنهٔ دوم", "note": "تفسیر واگرایی"}],\n' +
    '  "implications": ["دلالت حاکمیتی/برنامه‌ای"],\n' +
    '  "recommendation": "توصیهٔ نهایی برای تصمیم‌گیر",\n' +
    '  "risks": ["ریسک یا ملاحظه در تفسیر"]\n' +
    '}\n\n' +
    '[الگوریتم مرجع گونه‌بندی محلات — برای انطباق روایت با مشخصات سند]\n' +
    `${grounding?.algorithmSpec || ALGORITHM_SPEC}\n\n` +
    '[کاتالوگ مادر شاخص‌ها — گزیده برای ارجاع شناسه‌ها]\n' +
    (grounding?.catalogDigestForChat || 'کاتالوگ مادر در دسترس نبود.');

  const user =
    `تحلیل مقایسه‌ای هوشمند دو پهنهٔ ذخیره‌شده:\n\n` +
    `— پهنهٔ اول: «${nameA}» —\n${zoneFactsBrief(a)}\n\n` +
    `— پهنهٔ دوم: «${nameB}» —\n${zoneFactsBrief(b)}\n\n` +
    (divergence.length
      ? `— ۱۰ شاخص با بیشترین واگرایی (محاسبه‌شده از دادهٔ واقعی استخراج‌شده) —\n` +
        divergence.map((d) => `- ${d.uid} ${d.name}: اول=${fmtCmpVal(d.va)} | دوم=${fmtCmpVal(d.vb)} | واگرایی نسبی ${(d.rel * 100).toFixed(0)}٪`).join('\n') +
        `\n\n`
      : '') +
    `روایت مقایسه‌ای را دقیقاً بر پایهٔ همین اعداد، شناسه‌های کاتالوگ و منطق سند مرجع بنویس؛ هیچ عددی را جعل نکن و به هر ادعا عددی پیوست کن.`;
  return { system, user };
}

// ─── تحلیل مقایسه‌ای محلی قطعی (وقتی سرویس برخط در دسترس نیست) ──
export function localCompareFallback(
  nameA: string,
  a: ZoneResult,
  nameB: string,
  b: ZoneResult,
  divergence: CompareDivergenceRow[],
): ZoneCompare {
  const fa: Record<string, string> = { P: 'کالبد', B: 'رفتار', N: 'هنجار' };
  const similarities: string[] = [];
  const divergences: string[] = [];
  for (const l of ['P', 'B', 'N'] as const) {
    const diff = a.layerScores[l].score - b.layerScores[l].score;
    const gap = Math.abs(diff);
    if (gap < 0.25) {
      similarities.push(`لایهٔ ${fa[l]} دو پهنه نزدیک است: ${a.layerScores[l].score.toFixed(2)} در برابر ${b.layerScores[l].score.toFixed(2)}.`);
    } else {
      divergences.push(`لایهٔ ${fa[l]}: ${a.layerScores[l].score.toFixed(2)} در برابر ${b.layerScores[l].score.toFixed(2)} (تفاوت ${diff > 0 ? '+' : ''}${diff.toFixed(2)}).`);
    }
  }
  if (a.si !== b.si) {
    if (Math.abs(a.si - b.si) < 0.25) similarities.push(`شاخص پایداری SI هر دو نزدیک است: ${a.si.toFixed(2)} در برابر ${b.si.toFixed(2)}.`);
    else divergences.push(`شاخص پایداری SI: ${a.si.toFixed(2)} در برابر ${b.si.toFixed(2)} (تفاوت ${(a.si - b.si) > 0 ? '+' : ''}${(a.si - b.si).toFixed(2)}).`);
  }
  const radarReading =
    `پهنهٔ «${nameA}»: مساحت رادار ${a.radar.area}، شکاف توازن ${a.radar.balanceGap.toFixed(2)}، کشیدگی ${a.radar.skew ?? '—'} — پهنهٔ «${nameB}»: مساحت رادار ${b.radar.area}، شکاف توازن ${b.radar.balanceGap.toFixed(2)}، کشیدگی ${b.radar.skew ?? '—'}. ` +
    `مساحت بزرگ‌تر به‌معنای سطح پایداری بالاتر و شکاف توازن بزرگ‌تر به‌معنای ناترازی بیشتر بین لایه‌هاست.`;
  const stateComparison =
    `پهنهٔ اول در حالت ${a.prescription.stateId} («${a.prescription.diagnosis}») و پهنهٔ دوم در حالت ${b.prescription.stateId} («${b.prescription.diagnosis}») قرار دارد. ` +
    (a.prescription.stateId === b.prescription.stateId
      ? 'هر دو پهنه در یک حالت ماتریس قرار دارند؛ اولویت مداخله مشابه اما شدت آن بر اساس SI و لایه‌ها متفاوت است.'
      : 'حالت‌های متفاوت، اولویت‌های مداخله‌ای متفاوتی را ایجاب می‌کنند؛ ترکیب لایه‌ها را مقایسه کنید.') +
    ` KPI خروج: «${a.prescription.exitKpi}» در برابر «${b.prescription.exitKpi}».`;
  const topDivergentIndicators = divergence.slice(0, 10).map((d) => ({
    indicator: d.name,
    a: fmtCmpVal(d.va),
    b: fmtCmpVal(d.vb),
    note: `واگرایی نسبی ${(d.rel * 100).toFixed(0)}٪ — یکی از عوامل اصلی تفاوت لایه‌ها.`,
  }));
  return {
    summary: `مقایسهٔ «${nameA}» (SI=${a.si.toFixed(2)}) و «${nameB}» (SI=${b.si.toFixed(2)}) نشان می‌دهد ${a.si >= b.si ? 'پهنهٔ اول وضعیت پایدارتری دارد' : 'پهنهٔ دوم وضعیت پایدارتری دارد'}؛ تفاوت اصلی در لایه‌های ${divergences.map((d) => d.split(':')[0]).filter(Boolean).join('، ') || '—'} است.`,
    similarities,
    divergences,
    radarReading,
    stateComparison,
    topDivergentIndicators,
    implications: [
      'تفاوت در لایهٔ غالب ضعیف، جهت مداخله را برای هر پهنه مشخص می‌کند.',
      'تخصیص بودجه باید بر اساس اولویت حالت هر پهنه (به‌ویژه اولویت لایهٔ هنجاری) انجام شود.',
    ],
    recommendation:
      `برای پهنهٔ «${a.si >= b.si ? nameB : nameA}» (پهنهٔ ضعیف‌تر)، اجرای مداخلهٔ متناظر با حالت ${a.si >= b.si ? b.prescription.stateId : a.prescription.stateId} با پایش KPI خروج توصیه می‌شود.`,
    risks: ['سرویس برخط در دسترس نبود؛ این تحلیل بر پایهٔ دادهٔ قطعی و به‌صورت محلی تولید شد.'],
  };
}

// ─── گزارش کارشناسی محلی (وقتی سرویس هوش مصنوعی در دسترس نیست) ──────
export function localReportFallback(zone: ZoneResult): ZoneReport {
  const low = (['P', 'B', 'N'] as const).filter((l) => zone.layerScores[l].score < 2.5);
  const layerText = low.length
    ? `لایهٔ غالب ضعیف: ${low.map((l) => LAYER_FA[l]).join(' و ')} با امتیاز ${low.map((l) => zone.layerScores[l].score.toFixed(2)).join(' و ')}.`
    : 'هر سه لایه بالای آستانهٔ ۲٫۵ هستند و وضعیت نسبتاً متوازن است.';
  return {
    title: `گزارش کارشناسی پهنهٔ ${zone.zone.name} — ${zone.zone.provinceFa}`,
    executiveSummary:
      `پهنهٔ «${zone.zone.name}» با شاخص پایداری ${zone.si.toFixed(2)} (از ۵) در حالت ${zone.prescription.stateId} («${zone.prescription.diagnosis}») طبقه‌بندی شده و اولویت بودجهٔ آن ${zone.prescription.budgetPriority} است.`,
    currentSituation: `کالبد ${zone.layerScores.P.score.toFixed(2)} · رفتار ${zone.layerScores.B.score.toFixed(2)} · هنجار ${zone.layerScores.N.score.toFixed(2)} (پوشش وزنی: ${(['P', 'B', 'N'] as const).map((l) => `${(zone.layerScores[l].coverage * 100).toFixed(0)}٪`).join('، ')}). ${layerText} اعتماد پایپلاین ${(zone.confidence * 100).toFixed(0)}٪ است.`,
    intervention: zone.prescription.intervention,
    actionSteps: [
      'تشکیل جلسهٔ هماندیشی محلی و فعال‌سازی ظرفیت‌های پنهان پهنه',
      low.length ? `طراحی برنامهٔ تقویت ${low.map((l) => LAYER_FA[l]).join(' و ')}` : 'تثبیت وضعیت فعلی و پایش مستمر',
      'تخصیص اعتبار مطابق اولویت بودجهٔ مصوب و تعیین مسئول اجرا',
      'راه‌اندازی پایش دوره‌ای با KPI خروج مصوب',
    ],
    kpis: [zone.prescription.exitKpi, `ارتقای SI به ${Math.min(5, zone.si + 0.5).toFixed(2)}`, 'افزایش پوشش وزنی لایه‌ها به بالای ۶۰٪'],
    risks: ['سرویس برخط در دسترس نبود؛ این گزارش بر پایهٔ خروجی قطعی الگوریتم و به‌صورت محلی تولید شد.'],
    conclusion: `اجرای مداخلهٔ پیشنهادی با اولویت بودجهٔ ${zone.prescription.budgetPriority} و پایش با شاخص «${zone.prescription.exitKpi}» توصیه می‌شود؛ پیش از تصمیم نهایی، تکمیل پیمایش میدانی در صورت وجود خلأ داده ضروری است.`,
  };
}

function fmtSampleRow(s: IndicatorSample): string {
  const v = s.value == null ? '—' : Number.isInteger(s.value) ? String(s.value) : s.value.toFixed(2);
  const statusFa = s.status === 'live' ? 'برخط' : s.status === 'proxy' ? 'برآورد' : 'شبیه‌سازی';
  return `- ${s.uid} ${s.name} = ${v} ${s.unit} [${statusFa}، اعتماد ${(s.confidence * 100).toFixed(0)}٪]${s.detail ? ' — ' + s.detail : ''}`;
}

// ─── دیکشنری محلی (حالت آفلاین) ─────────────────────────────
const FALLBACK_DICT: Array<{ keys: RegExp; text: string }> = [
  { keys: /\bSI\b|شاخص پایداری/i, text: 'شاخص پایداری (SI) میانگین وزنی امتیاز سه لایهٔ کالبدی–رفتاری–هنجاری هر پهنه در مقیاس ۱ تا ۵ است. مقدار بالاتر = وضعیت پایدارتر. مقادیر زیر ۳ به‌عنوان «نیازمند مداخله» رده‌بندی می‌شوند.' },
  { keys: /کالبد|کالبدی/i, text: 'لایهٔ کالبدی–زیرساختی (P) کیفیت ابنیه، نفوذپذیری معابر، دسترسی به خدمات، آلودگی هوا، دمای سطح و ریسک مخاطرات طبیعی را در بر می‌گیرد. امتیاز آن از دادهٔ برخط OSM، Open-Meteo و پایهٔ استانی محاسبه می‌شود.' },
  { keys: /رفتار/i, text: 'لایهٔ رفتاری–اجتماعی (B) رفتار اقتصادی و اجتماعی ساکنان را نشان می‌دهد: اشتغال، تنوع کسب‌وکار، سواد، ترک تحصیل، مهاجرت و پویایی اقتصادی. منبع اصلی آن برآورد مستند از پایهٔ استانی و مشاهدات OSM است.' },
  { keys: /هنجار|هنجاری/i, text: 'لایهٔ هنجاری–ادراکی (N) سرمایهٔ اجتماعی و هنجارهای محله را می‌سنجد: مشارکت انتخاباتی، ثبات سکونت، نهادهای مذهبی و خیریه، حس تعلق و سرمایهٔ معنوی. بالاترین حساسیت را به پیمایش میدانی دارد.' },
  { keys: /آنتروپی|شانون/i, text: 'وزن‌دهی آنتروپی شانون بر مبنای میزان «اطلاع» هر شاخص انجام می‌شود: شاخصی که بین پهنه‌ها پراکندگی بیشتری دارد وزن بالاتری می‌گیرد؛ شاخص یکنواخت وزن کمتری. این روش از سوگیری خبره می‌کاهد.' },
  { keys: /\bAHP\b|تحلیل سلسله‌مراتبی/i, text: 'AHP (تحلیل سلسله‌مراتبی) وزن اولیهٔ هر شاخص را از مقایسهٔ زوجی خبرگان به‌دست می‌دهد. سازگاری ماتریس با نسبت سازگاری CR بررسی می‌شود؛ CR < ۰٫۱ معتبر است.' },
  { keys: /ماتریس|۹ حالته|حالت \d/i, text: 'ماتریس تصمیم ۹ حالته ترکیب سه لایه را به یک تجویز عملیاتی نگاشت می‌کند: از «محرومیت مطلق» تا «سرمایهٔ معنوی». هر حالت دارای تشخیص، مداخله، KPI خروج و اولویت بودجه است.' },
  { keys: /\bKPI\b|شاخص کلیدی/i, text: 'KPI خروج، شاخص قابل اندازه‌گیری برای سنجش موفقیت مداخله در هر حالت است؛ پس از اجرای طرح، پیشرفت از طریق همین شاخص پایش و گزارش می‌شود.' },
  { keys: /ظرفیت.{0,3}پنهان/i, text: 'ظرفیت‌های پنهان، قوت‌های کمتر دیده‌شدهٔ پهنه هستند (مثل نهادهای فعال، موقوفات یا مهارت‌های محلی) که در مداخله می‌توانند به‌عنوان نقطهٔ اتکا عمل کنند و از سوگیری تأییدی جلوگیری می‌کنند.' },
  { keys: /تزریق هم‌زمان|twin/i, text: 'پروتکل تزریق هم‌زمان مخصوص حالت ۹ (سرمایهٔ معنوی) است: هم‌زمان با تقویت کالبد و اقتصاد، سرمایهٔ اجتماعی از قبل موجود نباید تضعیف شود؛ مداخلات به‌صورت موازی و هم‌راستا تزریق می‌شوند.' },
  { keys: /رادار|توازن/i, text: 'رادار توازن سه‌لایه، امتیاز کالبد/رفتار/هنجار را در یک مثلث نمایش می‌دهد؛ مساحت مثلث نشان‌دهندهٔ سطح کلی و کشیدگی آن جهت ضعف غالب را مشخص می‌کند.' },
  { keys: /ضریب تلفیق|\u03b1|alpha/i, text: 'ضریب تلفیق (α) وزن نسبی بین وزن‌دهی عینی (آنتروپی شانون) و وزن خبره (AHP) را تعیین می‌کند: α = ۰٫۵ یعنی هر دو به‌یک اندازه مؤثرند.' },
  { keys: /اعتمادپذیری|اعتماد/i, text: 'اعتمادپذیری هر نتیجه بر مبنای سهم وزنی شاخص‌های پوشش‌داده‌شده (بدون خلأ داده) محاسبه می‌شود؛ پوشش بالای ۶۰٪ نتیجه را قابل اتکا می‌کند.' },
];

export function localExplainFallback(subject: string): string | null {
  const s = subject.trim();
  if (!s) return null;
  for (const { keys, text } of FALLBACK_DICT) {
    if (keys.test(s)) return text;
  }
  return null;
}

// ─── بازبینی محلی قطعی (وقتی سرویس هوش مصنوعی در دسترس نیست) ──────
export function localAuditFallback(zone: ZoneResult, samples: FullExtract | null): ZoneAudit {
  const gaps = zone.qcFlags.slice();
  if (zone.layerScores.P.lowConfidence) gaps.push('پوشش وزنی لایهٔ کالبدی زیر ۶۰٪');
  if (zone.layerScores.B.lowConfidence) gaps.push('پوشش وزنی لایهٔ رفتاری زیر ۶۰٪');
  if (zone.layerScores.N.lowConfidence) gaps.push('پوشش وزنی لایهٔ هنجاری زیر ۶۰٪ — نیازمند پیمایش میدانی');
  if (zone.radar.balanceGap > 1.5) gaps.push('شکاف توازن زیاد بین لایه‌ها');

  const low = (['P', 'B', 'N'] as const).filter((l) => zone.layerScores[l].score < 2.5);
  const justification = [
    `امتیاز SI = ${zone.si.toFixed(2)} با میانگین لایه‌ها سازگار است (${(zone.si / 5 * 100).toFixed(0)}٪ از سقف).`,
    low.length
      ? `لایهٔ ضعیف غالب: ${low.map((l) => LAYER_FA[l]).join('، ')} با امتیاز ${low.map((l) => zone.layerScores[l].score.toFixed(2)).join('، ')}.`
      : 'هر سه لایه بالای آستانهٔ ۲٫۵ هستند؛ وضعیت متوازن.',
    `اعتماد پایپلاین ${(zone.confidence * 100).toFixed(0)}٪ بر اساس پوشش ${(['P', 'B', 'N'] as const).map((l) => `${(zone.layerScores[l].coverage * 100).toFixed(0)}٪`).join('/')}٪.`,
    samples ? `${extractSummary(samples).live} شاخص به‌صورت برخط و ${extractSummary(samples).proxy} برآورد مستند وارد محاسبه شدند.` : 'دادهٔ کاتالوگ مادر در دسترس نبود.',
  ];

  return {
    verdict: gaps.length > 0 ? 'conditional' : 'agree',
    aiConfidence: zone.confidence,
    justification,
    topDrivers: low.map((l) => ({
      indicator: LAYER_FA[l],
      effect: `امتیاز پایین این لایه ($) بیشترین سهم را در کاهش SI دارد`,
    })),
    dataGaps: gaps,
    refinedIntervention: zone.prescription.intervention,
    risks: ['سرویس برخط در دسترس نبود؛ این بازبینی بر پایهٔ منطق قطعی الگوریتم تولید شد.'],
  };
}
