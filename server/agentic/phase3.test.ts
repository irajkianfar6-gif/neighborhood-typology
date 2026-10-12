/** فاز ۳ فریمورک ایجنتیک: کشف منبع، استخراج از اسناد، تطبیق فضایی، حافظهٔ اسناد و گراف پژوهش */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.ARA_SERVER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-agentic-p3-'));
process.env.ARA_ANTHROPIC_API_KEY = '';
process.env.ARA_CRAWL_GAP_MS = '0';
process.env.ARA_SEARCH_PROVIDER = '';
const FIX = path.join(import.meta.dirname, 'fixtures');

// حقیقت زمینی جدول نمونه: [نام، منطقه، جمعیت، درصد دیپلم، نرخ اشتغال]
const TRUTH: Array<[string, number, number, number, number]> = [['یوسف آباد', 6, 45210, 78.4, 61.2], ['امیرآباد', 6, 38900, 82.1, 64.0], ['جنت آباد مرکزی', 5, 52300, 69.5, 55.3]];
const HEADER = ['نام محله', 'منطقه', 'جمعیت', 'درصد دیپلم و بالاتر', 'نرخ اشتغال بیمه‌شده'];
const fa = (s: string | number) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** دقت استخراج: سهم خانه‌های عددی که دقیقاً با حقیقت زمینی برابرند */
function accuracy(rows: Array<Array<{ num: number | null; text: string }>>): number {
  let ok = 0, n = 0;
  for (const truth of TRUTH) {
    const row = rows.find((r) => r.some((c) => c.text.replace(/\s/g, '').includes(truth[0].replace(/\s/g, ''))));
    for (const v of truth.slice(1) as number[]) { n++; if (row?.some((c) => c.num !== null && Math.abs(c.num - v) < 1e-9)) ok++; }
  }
  return ok / n;
}

test('numbers: Persian digits, separators, percent, negatives and periods', async () => {
  const { parseNumberFa, detectPeriod } = await import('./research/numbers');
  assert.equal(parseNumberFa('۴۵٬۲۱۰')?.value, 45210);
  assert.equal(parseNumberFa('۷۸٫۴')?.value, 78.4);
  const p = parseNumberFa('۶۱٫۲٪'); assert.equal(p?.value, 61.2); assert.equal(p?.percent, true);
  assert.equal(parseNumberFa('(1,250)')?.value, -1250);
  assert.equal(parseNumberFa('—'), null); assert.equal(parseNumberFa('یوسف آباد'), null);
  assert.equal(detectPeriod('سرشماری سال ۱۳۹۵')?.periodEnd, '2017-03');
  assert.equal(detectPeriod('report 2021')?.periodEnd, '2021-12');
});

test('documents: CSV (Persian digits), XLSX and HTML tables extracted at >=95% accuracy', async () => {
  const { extractBuffer } = await import('./research/documents');
  const { writeXlsx } = await import('./research/zip');
  const csv = [HEADER.join(','), ...TRUTH.map((r) => [r[0], fa(r[1]), `"${fa(r[2].toLocaleString('en-US')).replace(/,/g, '٬')}"`, fa(r[3]).replace('.', '٫'), `${fa(r[4].toFixed(1)).replace('.', '٫')}٪`].join(','))].join('\n');
  const a = extractBuffer('t.csv', Buffer.from('\uFEFF' + csv));
  assert.equal(a.kind, 'csv'); assert.ok(accuracy(a.content.tables[0].rows) >= 0.95, 'CSV');
  const x = extractBuffer('t.xlsx', writeXlsx({ Sheet1: [HEADER, ...TRUTH.map((r) => [r[0], r[1], r[2], r[3], r[4]])] }));
  assert.equal(x.kind, 'xlsx'); assert.equal(x.content.tables[0].header[0], 'نام محله'); assert.ok(accuracy(x.content.tables[0].rows) >= 0.95, 'XLSX');
  const h = extractBuffer('t.html', fs.readFileSync(path.join(FIX, 'district6.html')));
  assert.equal(h.kind, 'html'); assert.ok(accuracy(h.content.tables[0].rows) >= 0.95, 'HTML');
  assert.ok(h.content.tables[0].rows[0][0].ref.length > 0, 'هر خانه ارجاع دارد');
});

test('documents: text PDF table extracted with dual-method agreement', async (t) => {
  const { extractBuffer, pdftotextAvailable } = await import('./research/documents');
  if (!pdftotextAvailable()) { t.skip('pdftotext نصب نیست'); return; }
  const r = extractBuffer('district6.pdf', fs.readFileSync(path.join(FIX, 'district6.pdf')));
  assert.equal(r.kind, 'pdf');
  const tb = r.content.tables[0];
  assert.ok(tb, 'جدول یافت شد');
  assert.ok(accuracy(tb.rows) >= 0.95, `دقت PDF ${accuracy(tb.rows)}`);
  assert.ok((r.verification.agreement ?? 0) >= 0.95, `توافق ${r.verification.agreement}`);
});

test('spatial matching: exact, alias, ambiguous, composite, district fallback', async () => {
  const { matchUnit, matchUnits } = await import('./research/spatialMatch');
  const e = matchUnit({ name: 'یوسف آباد' }, 'تهران');
  assert.equal(e.matchType, 'exact'); assert.deepEqual(e.targets, ['tehran:m605']);
  assert.equal(matchUnit({ name: 'تختی' }, 'تهران').matchType, 'ambiguous');
  const c = matchUnit({ name: 'امیرآباد و یوسف آباد', district: 6 }, 'تهران');
  assert.equal(c.matchType, 'composite_unit'); assert.ok(c.targets.includes('tehran:m605') && c.targets.length === 2);
  const d = matchUnit({ name: 'منطقه ۶' }, 'تهران'); assert.equal(d.matchType, 'district_fallback'); assert.ok(d.targets.length > 5);
  const u = matchUnit({ name: 'محله‌ای که وجود ندارد', district: 6 }, 'تهران'); assert.equal(u.matchType, 'district_fallback'); assert.equal(u.needsReview, true);
  const all = matchUnits([{ name: 'یوسف آباد' }, { name: 'تختی' }], 'تهران');
  assert.equal(all.total, 2); assert.equal(all.autoMatched, 1); assert.equal(all.needsReview, 1);
});

test('columns + draft: document → PENDING_REVIEW contract batch with cell provenance; memory finds it', async () => {
  const { ingestAndIndex } = await import('./research/researchTools');
  const { inferColumns, draftContractBatch } = await import('./research/columns');
  const { getTable } = await import('./research/documents');
  const { searchMemory } = await import('./research/memory');
  const doc = ingestAndIndex({ filename: 'district6_1395.html', content: fs.readFileSync(path.join(FIX, 'district6.html')) });
  assert.equal(ingestAndIndex({ filename: 'again.html', content: fs.readFileSync(path.join(FIX, 'district6.html')) }).docId, doc.docId, 'تکراری با هش یکسان');
  assert.equal(doc.period?.periodEnd, '2017-03');
  const tb = getTable(doc.docId, doc.tables[0].tableId)!;
  const roles = inferColumns(tb, 'تهران');
  assert.equal(roles[0].role, 'name'); assert.equal(roles[1].role, 'district');
  assert.deepEqual(roles.filter((r) => r.role === 'indicator').map((r) => r.code), ['POP', 'H1', 'H3']);
  const dry = await draftContractBatch(doc.docId, tb.tableId, { city: 'تهران', sourceOrg: 'آزمون', dryRun: true });
  assert.equal(dry.batch?.status, 'DRY_RUN'); assert.equal(dry.rows, 9); assert.equal(dry.provenanceFile, null);
  const real = await draftContractBatch(doc.docId, tb.tableId, { city: 'تهران', sourceOrg: 'آزمون', dryRun: false });
  assert.equal(real.batch?.status, 'PENDING_REVIEW'); assert.equal(real.batch?.accepted, 9);
  const prov = JSON.parse(fs.readFileSync(path.join(process.env.ARA_SERVER_DATA_DIR!, 'agentic', 'doc-provenance', real.provenanceFile!), 'utf8'));
  assert.ok(JSON.stringify(prov).includes(tb.rows[0][2].ref), 'ارجاع سلولی ذخیره شد');
  const hits = searchMemory('نرخ اشتغال یوسف آباد', { kind: 'document' });
  assert.equal(hits[0]?.refId, doc.docId);
});

test('discovery: robots, unreachable, hallucinated LLM URLs and registered-domain dedupe', async () => {
  const { discoverSources, robotsAllows, registeredDomains, _resetDiscoveryCaches } = await import('./research/discovery');
  _resetDiscoveryCaches();
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private', '/private/x'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/open', '/private/open/a'), true);
  const calls: string[] = [];
  const res = (status: number, body = '<title>منبع</title>', type = 'text/html') => ({ ok: status < 400, status, url: '', headers: { get: (n: string) => (n === 'content-type' ? type : null) }, text: async () => body });
  const fetchFn = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === '/robots.txt') return u.hostname === 'github.com' ? res(200, 'User-agent: *\nDisallow: /teamookla', 'text/plain') : res(404);
    if (u.hostname.includes('nonexistent')) throw new Error('getaddrinfo ENOTFOUND');
    if (u.hostname.includes('worldpop')) return res(404);
    return res(200);
  };
  const llm = async () => ({ text: JSON.stringify({ sources: [{ url: 'https://data.nonexistent-iran-stats.example/neigh', title: 'منبع خیالی', indicators: ['E1'], spatialLevel: 'neighborhood' }] }) });
  const d = await discoverSources({ indicators: ['E1', 'POP', 'R5'], city: 'تهران', useLlm: true, verify: true }, { fetch: fetchFn as never, llm });
  const by = (frag: string) => d.cards.find((c) => c.url.includes(frag));
  assert.equal(by('ookla')?.status, 'blocked_by_robots');
  assert.equal(by('worldpop')?.status, 'unreachable');
  assert.equal(by('nonexistent')?.status, 'unreachable');
  assert.equal(d.llm.proposed, 1); assert.equal(d.llm.rejected, 1);
  assert.ok(d.cards.filter((c) => c.status === 'verified').length >= 2);
  assert.ok(d.cards.every((c) => c.trust.score >= 0 && c.trust.score <= 1));
  const verified = d.cards.find((c) => c.status === 'verified')!;
  const unr = by('nonexistent')!;
  assert.ok(verified.trust.score > unr.trust.score, 'منبع دردسترس اعتماد بیشتری دارد');
  for (const c of d.cards) assert.ok(!registeredDomains().has(c.domain), 'دامنهٔ ثبت‌شده دوباره پیشنهاد نمی‌شود');
});

test('research graph: gaps → discovery → briefs; tools are least-privilege', async () => {
  const { createResearch, runResearch } = await import('./research/research');
  const { callTool } = await import('./registry');
  const { AGENTS } = await import('./agents');
  for (const id of ['A2', 'A4', 'A5']) assert.equal(AGENTS.find((a) => a.id === id)?.status, 'active');
  const forbidden = await callTool('draft_contract_batch', { docId: 'doc_x_00000000', tableId: 't1', city: 'تهران', sourceOrg: 'x' }, { agentId: 'A2' });
  assert.equal(forbidden.error?.code, 'FORBIDDEN');
  const sm = await callTool('match_spatial_units', { city: 'تهران', units: [{ name: 'یوسف آباد' }] }, { agentId: 'A5' });
  assert.ok(sm.ok, JSON.stringify(sm.error));
  const r = createResearch({ neighborhoodId: 'tehran:m605', offline: true, verify: false }, null);
  const out = await runResearch(r.researchId, { deps: { fetch: (async () => { throw new Error('no network'); }) as never } });
  assert.equal(out.status, 'done', out.error ?? '');
  assert.ok(out.gaps.length > 0);
  assert.equal(out.briefs.length, out.gaps.length);
  assert.ok(out.briefs.some((b) => b.candidates.length > 0));
  const withDocs = out.briefs.filter((b) => b.documents.length > 0).map((b) => b.code);
  assert.ok(withDocs.includes('H1') && withDocs.includes('H3'), `سند بارگذاری‌شده فقط برای شاخص‌های مرتبط: ${withDocs}`);
  assert.ok(!withDocs.includes('N3') && withDocs.length <= 4, `سند نباید برای شاخص نامرتبط بیاید: ${withDocs}`);
  assert.deepEqual(out.steps.map((s) => s.name), ['resolve', 'run_analysis', 'find_data_gaps', 'discover_sources', 'search_documents']);
});
