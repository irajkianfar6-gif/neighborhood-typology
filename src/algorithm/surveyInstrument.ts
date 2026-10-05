/**
 * ابزار پیمایش محله (نسخهٔ واحد برای فرم مرحله‌ای، ورود دسته‌ای و اعتبارسنجی سرور).
 *
 * سه بخش:
 *  ۱) ۱۵ گویهٔ ادراکی زنجیرهٔ C-A-U-E-O (kernel/registries/questionnaire_15.json)
 *  ۲) دو گویهٔ هسته‌ای S3X و C3X (questionnaire_core_extension.json)
 *  ۳) ماژول خانوار و مشارکت (Q-HH-v1) برای شاخص‌های H2، H3، H4، S4، C4، C5 طبق تعریف عملیاتی core_40
 *
 * هیچ عددی در این فایل ساخته نمی‌شود؛ فقط متن گویه، مقیاس و نگاشت گویه ← شاخص.
 */
export const INSTRUMENT_VERSION = 'Q15+EXT-v1+HH-v1';

export type ItemKind = 'likert' | 'binary' | 'choice';
export type ChainStageKey = 'CAPACITY' | 'ACCESS' | 'USE' | 'EXPERIENCE' | 'OUTCOME';

export interface InstrumentItem {
  code: string;
  text: string;
  kind: ItemKind;
  reversed?: boolean;
  stage?: ChainStageKey;
  /** شاخص‌های هسته‌ای که این گویه مستقیم می‌سازد */
  feeds?: string[];
  /** گویهٔ عینی هم‌سنجی (ادراک ↔ اندازه‌گیری) */
  checksAgainst?: string;
  followUp?: { operator: 'le' | 'ge'; threshold: number; text: string };
  options?: Array<{ value: number; label: string; hint?: string }>;
  /** شرط نمایش (منطق پرش) */
  showIf?: (answers: Record<string, number | undefined>) => boolean;
  help?: string;
}

export interface InstrumentSection {
  key: string;
  title: string;
  subtitle: string;
  items: InstrumentItem[];
}

export const LIKERT_LABELS = ['کاملاً مخالفم', 'مخالفم', 'نظری ندارم', 'موافقم', 'کاملاً موافقم'] as const;

export const EMPLOYMENT_OPTIONS = [
  { value: 1, label: 'شاغل با بیمه یا قرارداد', hint: 'بیمهٔ تأمین اجتماعی، قرارداد رسمی یا پیمانی' },
  { value: 2, label: 'شاغل بدون بیمه/قرارداد', hint: 'کار موقت، روزمزد، غیررسمی' },
  { value: 3, label: 'بیکار و جویای کار', hint: 'در یک ماه گذشته دنبال کار بوده‌ام' },
  { value: 4, label: 'غیرفعال', hint: 'خانه‌دار، دانشجو، بازنشسته، ...' },
];

const employed = (a: Record<string, number | undefined>) => a.EMP === 1 || a.EMP === 2;

export const SURVEY_SECTIONS: InstrumentSection[] = [
  {
    key: 'capacity', title: 'ظرفیت محیطی', subtitle: 'سبزینگی، هوا و صدا — آنچه محله در اختیار ساکن می‌گذارد',
    items: [
      { code: 'C1', text: 'محله از نظر فضای سبز و درختان غنی است', kind: 'likert', stage: 'CAPACITY', checksAgainst: 'N2' },
      { code: 'C2', text: 'کیفیت هوا در بیشتر روزها قابل قبول است', kind: 'likert', stage: 'CAPACITY', checksAgainst: 'N3' },
      { code: 'C3', text: 'آلودگی صوتی محله آزاردهنده است', kind: 'likert', stage: 'CAPACITY', reversed: true, followUp: { operator: 'ge', threshold: 4, text: 'منبع اصلی صدا چیست؟ (ترافیک، ساخت‌وساز، همسایگی، اصناف)' } },
    ],
  },
  {
    key: 'access', title: 'دسترسی', subtitle: 'رسیدن به حمل‌ونقل، خدمات روزمره و مسیرهای پیاده',
    items: [
      { code: 'A1', text: 'دسترسی به حمل‌ونقل عمومی از خانه آسان است', kind: 'likert', stage: 'ACCESS', checksAgainst: 'P5', followUp: { operator: 'le', threshold: 2, text: 'کدام وسیله در دسترس نیست یا کیفیت نامناسب دارد؟' } },
      { code: 'A2', text: 'دسترسی به خدمات روزمره آسان است', kind: 'likert', stage: 'ACCESS', checksAgainst: 'P4', followUp: { operator: 'le', threshold: 2, text: 'کدام خدمت دور یا ناکافی است؟' } },
      { code: 'A3', text: 'مسیرهای پیاده به هم متصل و جابه‌جایی آسان است', kind: 'likert', stage: 'ACCESS', checksAgainst: 'P2', followUp: { operator: 'le', threshold: 2, text: 'کدام مسیر یا مانع؟' } },
    ],
  },
  {
    key: 'use', title: 'استفاده از فضا', subtitle: 'پیاده‌رو، روشنایی و پارک‌ها در عمل',
    items: [
      { code: 'U1', text: 'پیاده‌روها هموار، پیوسته و بدون مانع‌اند', kind: 'likert', stage: 'USE', followUp: { operator: 'le', threshold: 2, text: 'نوع مانع چیست؟' } },
      { code: 'U2', text: 'روشنایی معابر در شب کافی است', kind: 'likert', stage: 'USE', checksAgainst: 'P3', followUp: { operator: 'le', threshold: 2, text: 'کدام معبر یا فضا بیشترین مشکل روشنایی را دارد؟' } },
      { code: 'U3', text: 'پارک‌ها و فضاهای سبز امن، تمیز، فعال و قابل استفاده‌اند', kind: 'likert', stage: 'USE', checksAgainst: 'N1', followUp: { operator: 'le', threshold: 2, text: 'مشکل اصلی نگهداری، امنیت، امکانات یا دسترسی است؟' } },
    ],
  },
  {
    key: 'experience', title: 'تجربهٔ زیسته', subtitle: 'امنیت، تعلق و اعتماد میان همسایگان',
    items: [
      { code: 'E1', text: 'در طول روز در محله احساس امنیت می‌کنم', kind: 'likert', stage: 'EXPERIENCE', followUp: { operator: 'le', threshold: 2, text: 'چه عامل یا مکانی احساس ناامنی ایجاد می‌کند؟' } },
      { code: 'E2', text: 'به محله خود تعلق دارم', kind: 'likert', stage: 'EXPERIENCE', feeds: ['S2'] },
      { code: 'E3', text: 'به همسایگان اعتماد دارم', kind: 'likert', stage: 'EXPERIENCE', feeds: ['S1'] },
    ],
  },
  {
    key: 'outcome', title: 'پیامد زندگی', subtitle: 'رضایت، تنهایی و تمایل به ماندن',
    items: [
      { code: 'O1', text: 'از زندگی در این محله راضی هستم', kind: 'likert', stage: 'OUTCOME' },
      { code: 'O2', text: 'در یک ماه گذشته احساس تنهایی داشته‌ام', kind: 'likert', stage: 'OUTCOME', reversed: true, followUp: { operator: 'ge', threshold: 4, text: 'علت بیشتر شخصی است یا نبود تعامل محله‌ای؟' } },
      { code: 'O3', text: 'اگر شرایط مالی اجازه دهد، مایل به ادامهٔ سکونت هستم', kind: 'likert', stage: 'OUTCOME', followUp: { operator: 'le', threshold: 2, text: 'دلیل اصلی تمایل به جابه‌جایی چیست؟' } },
    ],
  },
  {
    key: 'social', title: 'همکاری و هویت', subtitle: 'دو گویهٔ هسته‌ای برای شبکهٔ همکاری و هویت محله‌ای',
    items: [
      { code: 'S3X', text: 'در شش ماه گذشته با یکی از همسایگان در کاری (مراقبت، تعمیر، امور ساختمان یا محله) همکاری کرده‌ام', kind: 'binary', feeds: ['S3'] },
      { code: 'C3X', text: 'این محله هویت و شخصیت متمایزی دارد که برایم مهم است', kind: 'likert', feeds: ['C3'] },
    ],
  },
  {
    key: 'household', title: 'کار، مهارت و مشارکت', subtitle: 'ماژول کوتاه خانوار برای سرمایهٔ انسانی، اجتماعی و فرهنگی',
    items: [
      { code: 'EMP', text: 'وضعیت فعالیت شما در حال حاضر کدام است؟', kind: 'choice', options: EMPLOYMENT_OPTIONS, feeds: ['H3'] },
      { code: 'H2X', text: 'مهارت حرفه‌ای دارم که بتوانم با آن کار یا درآمد داشته باشم (مدرک فنی‌وحرفه‌ای، تجربهٔ کاری، هنر یا فن)', kind: 'binary', feeds: ['H2'] },
      { code: 'H4X', text: 'کار فعلی من با مهارت یا رشته‌ام مرتبط است', kind: 'binary', feeds: ['H4'], showIf: (a) => a.H2X === 1 && employed(a), help: 'فقط برای شاغلانی که مهارت حرفه‌ای دارند' },
      { code: 'S4X', text: 'در یک سال گذشته در حل یکی از مسائل محله (جلسه، پیگیری جمعی، اقدام داوطلبانه) شرکت کرده‌ام', kind: 'binary', feeds: ['S4'] },
      { code: 'C4X', text: 'در یک سال گذشته در یک فعالیت فرهنگی محله (مراسم، کلاس، نمایش، کتاب‌خوانی، فرهنگ‌سرا) شرکت کرده‌ام', kind: 'binary', feeds: ['C4'] },
      { code: 'C5X', text: 'در یک سال گذشته در روایت یا فعالیت محلی (تاریخ شفاهی، جشن محله، ثبت خاطرات، گروه جوانان) نقش داشته‌ام', kind: 'binary', feeds: ['C5'], help: 'برای شاخص C5 فقط پاسخ جوانان ۱۸ تا ۲۹ سال شمرده می‌شود' },
    ],
  },
];

export const ALL_ITEMS: InstrumentItem[] = SURVEY_SECTIONS.flatMap((s) => s.items);
export const ITEM_BY_CODE: Record<string, InstrumentItem> = Object.fromEntries(ALL_ITEMS.map((i) => [i.code, i]));
export const LIKERT_CODES = ALL_ITEMS.filter((i) => i.kind === 'likert').map((i) => i.code);
export const BINARY_CODES = ALL_ITEMS.filter((i) => i.kind === 'binary').map((i) => i.code);
export const CHOICE_CODES = ALL_ITEMS.filter((i) => i.kind === 'choice').map((i) => i.code);

/** شاخص‌های ماژول خانوار با جامعهٔ واجد شرایط (مخرج) طبق core_40 */
export const HOUSEHOLD_INDICATORS: Record<string, { label: string; item: string; numerator: string; denominator: string }> = {
  H2: { label: 'مهارت قابل عرضه', item: 'H2X', numerator: 'دارای مهارت حرفه‌ای', denominator: 'پاسخگویان در سن کار (۱۸ تا ۶۴)' },
  H3: { label: 'اشتغال پایدار', item: 'EMP', numerator: 'شاغل با بیمه/قرارداد', denominator: 'جمعیت فعال (شاغل + بیکار جویای کار)' },
  H4: { label: 'انطباق مهارت و شغل', item: 'H4X', numerator: 'شغل مرتبط با مهارت', denominator: 'شاغلان دارای مهارت' },
  S4: { label: 'اقدام جمعی', item: 'S4X', numerator: 'مشارکت در حل مسئلهٔ محله', denominator: 'همهٔ پاسخگویان' },
  C4: { label: 'مشارکت فرهنگی', item: 'C4X', numerator: 'مشارکت در فعالیت فرهنگی', denominator: 'همهٔ پاسخگویان' },
  C5: { label: 'انتقال هویت', item: 'C5X', numerator: 'جوانان دارای نقش در روایت/فعالیت محلی', denominator: 'جوانان ۱۸ تا ۲۹ سال' },
};

export type Answers = Record<string, number | undefined>;

export function visibleItems(section: InstrumentSection, answers: Answers): InstrumentItem[] {
  return section.items.filter((i) => !i.showIf || i.showIf(answers));
}

export function followUpActive(item: InstrumentItem, value: number | undefined): boolean {
  if (!item.followUp || value === undefined) return false;
  return item.followUp.operator === 'le' ? value <= item.followUp.threshold : value >= item.followUp.threshold;
}

/** پیش‌بررسی کیفیت در مرورگر — همان قواعد سرور (فقط برای هشدار به پرسشگر) */
export function precheck(answers: Answers, durationSec: number, minDurationSec = 90): string[] {
  const warnings: string[] = [];
  const likert = LIKERT_CODES.map((c) => answers[c]).filter((v): v is number => typeof v === 'number');
  if (likert.length < 8) warnings.push('INCOMPLETE');
  if (likert.length >= 10 && new Set(likert).size === 1) warnings.push('STRAIGHT_LINING');
  if (durationSec < minDurationSec) warnings.push('TOO_FAST');
  return warnings;
}

export const QC_REASON_FA: Record<string, string> = {
  NO_CONSENT: 'رضایت آگاهانه ثبت نشده',
  TOO_FAST: 'زمان تکمیل کمتر از حد مجاز (پاسخ شتاب‌زده)',
  INVALID_LIKERT: 'مقدار لیکرت خارج از ۱ تا ۵',
  STRAIGHT_LINING: 'همهٔ پاسخ‌ها یکسان (پاسخ خطی)',
  INCOMPLETE: 'کمتر از ۸ گویهٔ ادراکی پاسخ داده شده',
  INVALID_BINARY: 'پاسخ بله/خیر نامعتبر',
  INVALID_CHOICE: 'گزینهٔ وضعیت فعالیت نامعتبر',
  DUPLICATE_DEVICE: 'پاسخ تکراری از همان دستگاه',
};

/** ستون‌های فایل ورود دسته‌ای (CSV/اکسل) */
export const BULK_COLUMNS = [
  'respondent_id', 'collected_at', 'collector_id', 'duration_sec', 'consent', 'sex', 'age_band', 'tenure', 'disability',
  ...ALL_ITEMS.map((i) => i.code),
] as const;
