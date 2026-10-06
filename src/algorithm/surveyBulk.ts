/**
 * ورود دسته‌ای پرسشنامه‌های کاغذی/اکسل: تجزیهٔ CSV/TSV، نگاشت برچسب‌های فارسی و اعتبارسنجی سطری.
 * هیچ مقدار جاافتاده‌ای حدس زده نمی‌شود؛ خانهٔ خالی = بی‌پاسخ.
 */
import { ALL_ITEMS, BULK_COLUMNS, INSTRUMENT_VERSION, housingBurden, MAX_PLAUSIBLE_BURDEN, precheck, validNumber } from './surveyInstrument';
import type { SurveySubmission } from './dataCollectionApi';
import { toLatinDigits } from './dataCollectionApi';

export interface BulkRowIssue { row: number; level: 'error' | 'warning'; message: string }
export interface BulkParseResult { rows: SurveySubmission[]; rowNumbers: number[]; issues: BulkRowIssue[]; columns: string[]; unknownColumns: string[] }

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const YES = new Set(['1', 'yes', 'y', 'true', 'بله', 'آری', 'اره', 'آره', 'دارد']);
const NO = new Set(['0', 'no', 'n', 'false', 'خیر', 'نه', 'ندارد']);
const SEX: Record<string, 'male' | 'female'> = { male: 'male', m: 'male', 'مرد': 'male', '1': 'male', female: 'female', f: 'female', 'زن': 'female', '2': 'female' };
const TENURE: Record<string, 'owner' | 'renter' | 'other'> = { owner: 'owner', 'مالک': 'owner', renter: 'renter', 'مستاجر': 'renter', 'مستأجر': 'renter', other: 'other', 'سایر': 'other', 'دیگر': 'other' };
const AGES = ['18-29', '30-44', '45-64', '65+'] as const;

export function parseSurveyCsv(text: string, defaults: { collectorId?: string } = {}): BulkParseResult {
  const clean = toLatinDigits(text.replace(/^\uFEFF/, '')).replace(/\r\n?/g, '\n');
  const lines = clean.split('\n').filter((l) => l.trim());
  const issues: BulkRowIssue[] = [];
  if (lines.length < 2) return { rows: [], rowNumbers: [], issues: [{ row: 0, level: 'error', message: 'فایل باید سطر عنوان و دست‌کم یک سطر پاسخ داشته باشد' }], columns: [], unknownColumns: [] };
  const first = lines[0];
  const delim = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const header = splitLine(first, delim).map((h) => h.trim());
  const known = new Set<string>(BULK_COLUMNS as readonly string[]);
  const unknownColumns = header.filter((h) => h && !known.has(h));
  const itemCodes = ALL_ITEMS.map((i) => i.code);
  if (!itemCodes.some((c) => header.includes(c))) issues.push({ row: 1, level: 'error', message: 'هیچ ستون گویه‌ای (C1، A1، ...) در سطر عنوان یافت نشد' });
  const rows: SurveySubmission[] = [];
  const rowNumbers: number[] = [];
  for (let li = 1; li < lines.length; li++) {
    const rowNo = li + 1;
    const cells = splitLine(lines[li], delim);
    const get = (col: string) => { const i = header.indexOf(col); return i >= 0 ? (cells[i] ?? '').trim() : ''; };
    const errs: string[] = [];
    const answers: Record<string, number> = {};
    for (const item of ALL_ITEMS) {
      const raw = get(item.code).toLowerCase();
      if (!raw) continue;
      if (item.kind === 'binary') {
        if (YES.has(raw)) answers[item.code] = 1; else if (NO.has(raw)) answers[item.code] = 0; else errs.push(`${item.code}: «${raw}» بله/خیر نیست`);
      } else if (item.kind === 'number') {
        const n = Number(raw.replace(/[,٬\s]/g, '').replace(/٫/g, '.'));
        if (validNumber(item, n)) answers[item.code] = n; else errs.push(`${item.code}: «${raw}» باید عددی بین ${item.min ?? 0} و ${item.max ?? '∞'} (${item.unit ?? ''}) باشد`);
      } else if (item.kind === 'choice') {
        const n = Number(raw);
        const opt = item.options?.find((o) => o.value === n || o.label === raw);
        if (opt) answers[item.code] = opt.value; else errs.push(`${item.code}: «${raw}» یکی از گزینه‌های ${item.options?.map((o) => o.value).join('، ')} نیست`);
      } else {
        const n = Number(raw);
        if (Number.isInteger(n) && n >= 1 && n <= 5) answers[item.code] = n; else errs.push(`${item.code}: «${raw}» باید عدد ۱ تا ۵ باشد`);
      }
    }
    const consentRaw = get('consent').toLowerCase();
    const consent = consentRaw ? YES.has(consentRaw) : false;
    if (!consentRaw) errs.push('ستون consent خالی است (رضایت آگاهانه)');
    const sexRaw = get('sex').toLowerCase();
    const ageRaw = get('age_band').replace(/\s/g, '');
    const tenureRaw = get('tenure').toLowerCase();
    const disRaw = get('disability').toLowerCase();
    const demographics: SurveySubmission['demographics'] = {};
    if (sexRaw) { if (SEX[sexRaw]) demographics.sex = SEX[sexRaw]; else errs.push(`sex: «${sexRaw}» نامعتبر`); }
    if (ageRaw) { if ((AGES as readonly string[]).includes(ageRaw)) demographics.ageBand = ageRaw as typeof AGES[number]; else errs.push(`age_band: «${ageRaw}» یکی از ${AGES.join('، ')} نیست`); }
    if (tenureRaw) { if (TENURE[tenureRaw]) demographics.tenure = TENURE[tenureRaw]; else errs.push(`tenure: «${tenureRaw}» نامعتبر`); }
    if (disRaw) { if (YES.has(disRaw)) demographics.disability = true; else if (NO.has(disRaw)) demographics.disability = false; else errs.push(`disability: «${disRaw}» نامعتبر`); }
    const durRaw = get('duration_sec');
    const durationSec = durRaw ? Number(durRaw) : NaN;
    if (!Number.isFinite(durationSec)) errs.push('duration_sec (مدت تکمیل به ثانیه) لازم است');
    const collectedAt = get('collected_at');
    if (collectedAt && !Number.isFinite(Date.parse(collectedAt))) errs.push(`collected_at: «${collectedAt}» تاریخ میلادی نیست`);
    if (errs.length) { errs.forEach((m) => issues.push({ row: rowNo, level: 'error', message: m })); continue; }
    if (demographics.tenure !== 'renter' && (answers.RENT !== undefined || answers.DEPOSIT !== undefined)) issues.push({ row: rowNo, level: 'warning', message: 'اجاره/ودیعه برای خانوار غیرمستأجر ثبت شده و در E4 شمرده نمی‌شود' });
    const hb = housingBurden(answers, demographics.tenure);
    if (hb && hb.burdenPct > MAX_PLAUSIBLE_BURDEN) issues.push({ row: rowNo, level: 'warning', message: `هزینهٔ مسکن ${hb.burdenPct}٪ درآمد است؛ ناممکن تلقی و از E4 کنار گذاشته می‌شود (واحد میلیون تومان را بررسی کنید)` });
    for (const w of precheck(answers, durationSec)) issues.push({ row: rowNo, level: 'warning', message: w === 'TOO_FAST' ? 'زمان تکمیل کوتاه است؛ سرور این پاسخ را رد می‌کند' : w === 'STRAIGHT_LINING' ? 'همهٔ پاسخ‌ها یکسان است؛ سرور رد می‌کند' : 'کمتر از ۸ گویهٔ ادراکی؛ سرور رد می‌کند' });
    rows.push({
      respondentId: get('respondent_id') || undefined, durationSec, answers, demographics, consent,
      collectedAt: collectedAt ? new Date(collectedAt).toISOString() : undefined,
      collectorId: get('collector_id') || defaults.collectorId || undefined, mode: 'paper', instrumentVersion: INSTRUMENT_VERSION,
    });
    rowNumbers.push(rowNo);
  }
  return { rows, rowNumbers, issues, columns: header, unknownColumns };
}

export function bulkTemplateCsv(): string {
  const example = ['R-001', '2025-05-01', 'enum-01', '420', '1', 'female', '30-44', 'renter', '0',
    ...ALL_ITEMS.map((i) => (i.kind === 'binary' ? '1' : i.kind === 'choice' ? (i.code === 'EDU' ? '3' : '1') : i.kind === 'number' ? ({ HHSIZE: '3', INC: '40', RENT: '12', DEPOSIT: '300', MORT: '', AREA: '75' } as Record<string, string>)[i.code] ?? '' : '4'))];
  return '\uFEFF' + [BULK_COLUMNS.join(','), example.join(',')].join('\n') + '\n';
}
