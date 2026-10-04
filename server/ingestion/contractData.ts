/**
 * ورود دادهٔ قراردادی/ثبتی نهادها (مرکز آمار، تأمین اجتماعی، اصناف، شهرداری/۱۳۷، ...)
 *
 * چرخه: upload (operator) → اعتبارسنجی خودکار → PENDING_REVIEW → approve (admin، فرد دوم) → APPROVED
 * فقط ردیف‌های APPROVED وارد دفتر شواهد با tier=official می‌شوند.
 * الگوی ستون‌ها: templates/data-contracts/*.csv
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';
import { getNeighborhood } from '../neighborhood/gazetteer';

export const CONTRACT_COLUMNS = [
  'indicator_code', 'neighborhood_id', 'block_id', 'postal_prefix', 'numerator', 'denominator', 'value', 'unit',
  'period_start', 'period_end', 'group_key', 'group_value', 'source_org', 'dataset_id', 'extraction_date', 'contact',
] as const;

const CORE_40 = new Set('H1 H2 H3 H4 H5 S1 S2 S3 S4 S5 E1 E2 E3 E4 E5 P1 P2 P3 P4 P5 N1 N2 N3 N4 N5 C1 C2 C3 C4 C5 G1 G2 G3 G4 G5 R1 R2 R3 R4 R5'.split(' '));
/** متغیرهای بافت (مخرج‌ها) که از قرارداد هم پذیرفته می‌شوند */
export const CONTEXT_CODES = new Set(['POP', 'POP_25PLUS', 'POP_15_64', 'POP_15PLUS', 'POP_MALE', 'POP_FEMALE', 'POP_AGE_18_29', 'POP_AGE_30_44', 'POP_AGE_45_64', 'POP_AGE_65PLUS', 'HOUSEHOLDS']);
/** شاخص‌هایی که خروجی‌شان درصد است و باید ۰..۱۰۰ باشند */
const PERCENT_CODES = new Set('H1 H2 H3 H4 H5 S3 S4 S5 E3 E5 P1 P2 P4 P5 N1 N2 N4 C2 C4 C5 G1 G2 G4 G5 R4'.split(' '));
const MIN_CELL = Number(process.env.ARA_PRIVACY_MIN_CELL || 10);
const PII_COLUMN = /(national|melli|کد.?ملی|mobile|phone|تلفن|موبایل|email|ایمیل|address|نشانی|first.?name|last.?name|نام.?خانوادگی)/i;
const NATIONAL_ID = /\b\d{10}\b/;
const MOBILE = /\b09\d{9}\b/;

export interface ContractRow {
  indicator_code: string; neighborhood_id: string; block_id?: string; postal_prefix?: string;
  numerator?: number | null; denominator?: number | null; value: number;
  unit?: string; period_start?: string; period_end: string;
  group_key?: string; group_value?: string; source_org: string; dataset_id?: string; extraction_date?: string;
}
export interface RowIssue { row: number; field?: string; code: string; message: string; severity: 'error' | 'warning' }
export type BatchStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'INVALID';
export interface ContractBatch {
  batchId: string; template: string; fileSha256: string; uploadedAt: string; uploadedBy: string;
  status: BatchStatus; rows: ContractRow[]; issues: RowIssue[];
  stats: { total: number; accepted: number; rejected: number; neighborhoods: number; indicators: string[] };
  review?: { by: string; at: string; decision: 'APPROVED' | 'REJECTED'; note?: string };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cur.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      cur.push(field); field = '';
      if (cur.some((c) => c.trim() !== '')) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  if (cur.some((c) => c.trim() !== '')) rows.push(cur);
  return rows;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const isDate = (v: string | undefined) => Boolean(v && /^\d{4}-\d{2}(-\d{2})?$/.test(v.trim()));

/** نگاشت اختیاری بلوک آماری → محله: data/gazetteer/block_map.csv (block_id,neighborhood_id) */
function loadBlockMap(): Map<string, string> {
  const file = path.join(process.cwd(), 'data', 'gazetteer', 'block_map.csv');
  const m = new Map<string, string>();
  if (!fs.existsSync(file)) return m;
  for (const [b, n] of parseCsv(fs.readFileSync(file, 'utf8')).slice(1)) if (b && n) m.set(b.trim(), n.trim());
  return m;
}

export function validateContractCsv(text: string): { rows: ContractRow[]; issues: RowIssue[] } {
  const table = parseCsv(text);
  const issues: RowIssue[] = [];
  const rows: ContractRow[] = [];
  if (table.length < 2) return { rows, issues: [{ row: 0, code: 'EMPTY', message: 'فایل خالی است', severity: 'error' }] };
  const header = table[0].map((h) => h.trim().toLowerCase());
  for (const h of header) if (PII_COLUMN.test(h)) issues.push({ row: 0, field: h, code: 'PII_COLUMN', message: `ستون شناسهٔ شخصی «${h}» مجاز نیست`, severity: 'error' });
  for (const required of ['indicator_code', 'period_end', 'source_org']) {
    if (!header.includes(required)) issues.push({ row: 0, field: required, code: 'MISSING_COLUMN', message: `ستون الزامی ${required} وجود ندارد`, severity: 'error' });
  }
  if (!header.includes('neighborhood_id') && !header.includes('block_id')) issues.push({ row: 0, code: 'MISSING_COLUMN', message: 'neighborhood_id یا block_id لازم است', severity: 'error' });
  if (issues.some((i) => i.row === 0 && i.severity === 'error')) return { rows, issues };
  const col = (r: string[], name: string) => { const i = header.indexOf(name); return i >= 0 ? (r[i] ?? '').trim() : ''; };
  const blockMap = loadBlockMap();
  const blockAgg = new Map<string, ContractRow>();

  table.slice(1).forEach((r, idx) => {
    const rowNo = idx + 2;
    const err = (code: string, message: string, field?: string) => issues.push({ row: rowNo, field, code, message, severity: 'error' });
    // شناسهٔ شخصی: شمارهٔ موبایل در هر ستون، یا عدد ۱۰ رقمی (کد ملی) در ستون‌های متنی
    const NUMERIC_COLS = new Set(['block_id', 'postal_prefix', 'numerator', 'denominator', 'value']);
    if (r.some((c, i) => MOBILE.test(c) || (NATIONAL_ID.test(c) && !NUMERIC_COLS.has(header[i])))) {
      err('PII_VALUE', 'مقدار شبیه کد ملی/شمارهٔ تلفن یافت شد'); return;
    }
    const code = col(r, 'indicator_code').toUpperCase();
    if (!CORE_40.has(code) && !CONTEXT_CODES.has(code)) { err('UNKNOWN_INDICATOR', `کد شاخص ${code} در هستهٔ ۴۰ یا متغیرهای بافت نیست`, 'indicator_code'); return; }
    let nid = col(r, 'neighborhood_id');
    const block = col(r, 'block_id');
    if (!nid && block) {
      nid = blockMap.get(block) ?? '';
      if (!nid) { err('UNMAPPED_BLOCK', `بلوک ${block} در data/gazetteer/block_map.csv نگاشت نشده`, 'block_id'); return; }
    }
    if (!getNeighborhood(nid)) { err('UNKNOWN_NEIGHBORHOOD', `شناسهٔ محله ${nid} در گزتیر نیست`, 'neighborhood_id'); return; }
    const numerator = num(col(r, 'numerator'));
    const denominator = num(col(r, 'denominator'));
    let value = num(col(r, 'value'));
    if ([numerator, denominator, value].some((x) => Number.isNaN(x))) { err('NOT_NUMERIC', 'مقدار عددی نامعتبر'); return; }
    if (numerator !== null && denominator !== null) {
      if (denominator <= 0) { err('BAD_DENOMINATOR', 'مخرج باید مثبت باشد', 'denominator'); return; }
      if (PERCENT_CODES.has(code) && numerator > denominator) { err('NUM_GT_DEN', 'صورت بزرگ‌تر از مخرج است', 'numerator'); return; }
      const computed = PERCENT_CODES.has(code) ? (numerator / denominator) * 100 : numerator / denominator;
      if (value !== null && Math.abs(value - computed) > Math.max(0.5, Math.abs(computed) * 0.01)) {
        issues.push({ row: rowNo, field: 'value', code: 'VALUE_MISMATCH', message: `value با صورت/مخرج (${computed.toFixed(2)}) ناسازگار است؛ مقدار محاسبه‌شده جایگزین شد`, severity: 'warning' });
      }
      value = computed;
    }
    if (value === null) { err('NO_VALUE', 'value یا صورت/مخرج لازم است', 'value'); return; }
    if (PERCENT_CODES.has(code) && (value < 0 || value > 100)) { err('OUT_OF_RANGE', `مقدار ${value} خارج از ۰..۱۰۰ است`, 'value'); return; }
    const groupKey = col(r, 'group_key');
    if (groupKey && denominator !== null && denominator < MIN_CELL) { err('PRIVACY_MIN_CELL', `سلول گروهی با n<${MIN_CELL} منتشر نمی‌شود`, 'denominator'); return; }
    if (!isDate(col(r, 'period_end'))) { err('BAD_DATE', 'period_end باید YYYY-MM یا YYYY-MM-DD (میلادی) باشد', 'period_end'); return; }
    const source = col(r, 'source_org');
    if (!source) { err('NO_SOURCE', 'source_org الزامی است', 'source_org'); return; }
    const row: ContractRow = {
      indicator_code: code, neighborhood_id: nid, block_id: block || undefined, postal_prefix: col(r, 'postal_prefix') || undefined,
      numerator, denominator, value: Math.round(value * 1000) / 1000, unit: col(r, 'unit') || undefined,
      period_start: col(r, 'period_start') || undefined, period_end: col(r, 'period_end'),
      group_key: groupKey || undefined, group_value: col(r, 'group_value') || undefined,
      source_org: source, dataset_id: col(r, 'dataset_id') || undefined, extraction_date: col(r, 'extraction_date') || undefined,
    };
    // ردیف‌های بلوکی با صورت/مخرج روی محله جمع زده می‌شوند (نه میانگین درصدها)
    if (block && numerator !== null && denominator !== null) {
      const k = [code, nid, row.period_end, row.group_key ?? '', row.group_value ?? ''].join('|');
      const prev = blockAgg.get(k);
      if (prev) {
        prev.numerator = (prev.numerator ?? 0) + numerator;
        prev.denominator = (prev.denominator ?? 0) + denominator;
        prev.value = Math.round(((PERCENT_CODES.has(code) ? 100 : 1) * prev.numerator / prev.denominator) * 1000) / 1000;
      } else blockAgg.set(k, { ...row, block_id: undefined });
      return;
    }
    rows.push(row);
  });
  rows.push(...blockAgg.values());
  return { rows, issues };
}

function batchDir(): string {
  const d = path.join(serverDataDir(), 'ingestion');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function tokenFingerprint(authHeader: string | undefined, role: string): string {
  const token = (authHeader ?? '').replace(/^Bearer\s+/i, '');
  return token ? `${role}:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 12)}` : `${role}:anonymous`;
}

export function createBatch(text: string, template: string, uploadedBy: string): ContractBatch {
  const { rows, issues } = validateContractCsv(text);
  const errors = issues.filter((i) => i.severity === 'error');
  const batch: ContractBatch = {
    batchId: `cb-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`,
    template, fileSha256: crypto.createHash('sha256').update(text).digest('hex'),
    uploadedAt: new Date().toISOString(), uploadedBy,
    status: rows.length === 0 ? 'INVALID' : 'PENDING_REVIEW',
    rows, issues,
    stats: {
      total: rows.length + errors.filter((e) => e.row > 0).length,
      accepted: rows.length,
      rejected: errors.filter((e) => e.row > 0).length,
      neighborhoods: new Set(rows.map((r) => r.neighborhood_id)).size,
      indicators: [...new Set(rows.map((r) => r.indicator_code))].sort(),
    },
  };
  fs.writeFileSync(path.join(batchDir(), `${batch.batchId}.json`), JSON.stringify(batch, null, 1));
  return batch;
}

export function getBatch(batchId: string): ContractBatch | null {
  if (!/^cb-[\w-]+$/.test(batchId)) return null;
  const file = path.join(batchDir(), `${batchId}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as ContractBatch : null;
}

export function listBatches(): Array<Omit<ContractBatch, 'rows' | 'issues'>> {
  return fs.readdirSync(batchDir()).filter((f) => f.endsWith('.json')).map((f) => {
    const { rows: _r, issues: _i, ...meta } = JSON.parse(fs.readFileSync(path.join(batchDir(), f), 'utf8')) as ContractBatch;
    return meta;
  }).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function reviewBatch(batchId: string, reviewer: string, decision: 'APPROVED' | 'REJECTED', note?: string): ContractBatch {
  const batch = getBatch(batchId);
  if (!batch) throw Object.assign(new Error('batch not found'), { status: 404 });
  if (batch.status !== 'PENDING_REVIEW') throw Object.assign(new Error(`batch status is ${batch.status}`), { status: 409 });
  if (reviewer === batch.uploadedBy && !reviewer.endsWith(':anonymous')) {
    throw Object.assign(new Error('تأیید باید توسط فردی غیر از بارگذار انجام شود (اصل چهار چشم)'), { status: 403 });
  }
  batch.status = decision;
  batch.review = { by: reviewer, at: new Date().toISOString(), decision, note };
  fs.writeFileSync(path.join(batchDir(), `${batchId}.json`), JSON.stringify(batch, null, 1));
  invalidateApproved();
  return batch;
}

export interface ApprovedValue extends ContractRow { batchId: string; approvedAt: string }
let approvedCache: ApprovedValue[] | null = null;
function invalidateApproved() { approvedCache = null; }

/** همهٔ مقادیر تأییدشده؛ برای هر (محله، شاخص، گروه) جدیدترین دوره */
export function approvedValuesFor(neighborhoodId: string, asOf?: string): ApprovedValue[] {
  if (!approvedCache) {
    approvedCache = [];
    for (const f of fs.readdirSync(batchDir()).filter((x) => x.endsWith('.json'))) {
      const b = JSON.parse(fs.readFileSync(path.join(batchDir(), f), 'utf8')) as ContractBatch;
      if (b.status !== 'APPROVED') continue;
      for (const r of b.rows) approvedCache.push({ ...r, batchId: b.batchId, approvedAt: b.review?.at ?? b.uploadedAt });
    }
  }
  const latest = new Map<string, ApprovedValue>();
  for (const v of approvedCache) {
    if (v.neighborhood_id !== neighborhoodId) continue;
    if (asOf && v.period_end > asOf) continue;
    const k = `${v.indicator_code}|${v.group_key ?? ''}|${v.group_value ?? ''}`;
    const prev = latest.get(k);
    if (!prev || v.period_end > prev.period_end || (v.period_end === prev.period_end && v.approvedAt > prev.approvedAt)) latest.set(k, v);
  }
  return [...latest.values()];
}

/**
 * توزیع شهری یک شاخص از قراردادهای تأییدشده (جدیدترین مقدار بدون گروه برای هر محلهٔ شهر).
 * وقتی دستگاه داده‌دار مقدار همهٔ محلات را بفرستد، امتیاز صدکی بدون نیاز به ساخت مجدد مرجع ممکن می‌شود.
 */
export function approvedCityDistribution(citySlug: string, code: string, asOf?: string): { values: number[]; neighborhoods: number; newest: string | null } {
  approvedValuesFor('__warm_cache__');
  const latest = new Map<string, ApprovedValue>();
  for (const v of approvedCache ?? []) {
    if (v.indicator_code !== code || v.group_key || !v.neighborhood_id.startsWith(`${citySlug}:`)) continue;
    if (asOf && v.period_end > asOf) continue;
    const prev = latest.get(v.neighborhood_id);
    if (!prev || v.period_end > prev.period_end || (v.period_end === prev.period_end && v.approvedAt > prev.approvedAt)) latest.set(v.neighborhood_id, v);
  }
  const vals = [...latest.values()];
  return { values: vals.map((v) => v.value).sort((a, b) => a - b), neighborhoods: vals.length, newest: vals.map((v) => v.period_end).sort().at(-1) ?? null };
}
