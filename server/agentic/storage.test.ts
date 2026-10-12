/** ذخیره‌سازی پایدار PostgreSQL (PGSYNC-v1) و حافظهٔ ترکیبی (MEM-HYB-v1) — با PostgreSQL درون‌فرایندی (PGlite + pgvector) از راه پروتکل واقعی */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-pg-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-pg-b-'));
process.env.ARA_SERVER_DATA_DIR = dirA;
process.env.ARA_ANTHROPIC_API_KEY = '';
let db: PGlite; let srv: PGLiteSocketServer;
const PORT = 55_000 + Math.floor(Math.random() * 3000);

before(async () => {
  db = await PGlite.create({ extensions: { vector } });
  srv = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' }); await srv.start();
  Object.assign(process.env, { ARA_STORAGE: 'postgres', DATABASE_URL: `postgres://postgres@127.0.0.1:${PORT}/postgres`, ARA_PG_POOL_MAX: '1', ARA_PG_LOCK: '0' });
});
after(async () => { const { stopPgSync } = await import('../db/pgSync'); await stopPgSync(); await srv.stop(); await db.close(); });

const w = (root: string, rel: string, data: string | Buffer) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

test('lexical + vector hybrid search finds morphological variants (local)', async () => {
  const { indexItem, searchMemory, _resetMemory } = await import('./research/memory');
  _resetMemory();
  indexItem('document', 'doc_a', 'گزارش بازار کار', [{ page: 1, text: 'نرخ بیکاری جوانان در محله یوسف‌آباد طبق سرشماری ۱۳۹۵ برابر ۱۴ درصد بوده است.' }]);
  indexItem('document', 'doc_b', 'فضای سبز', [{ page: 2, text: 'سرانهٔ فضای سبز و پارک‌های محله در طرح تفصیلی آمده است.' }]);
  const bm = searchMemory('بیکار جوان', { mode: 'bm25' });
  assert.equal(bm.length, 0, 'BM25 شکل‌های متفاوت واژه را نمی‌یابد');
  const hy = searchMemory('بیکار جوان');
  assert.equal(hy[0]?.refId, 'doc_a'); assert.ok((hy[0].similarity ?? 0) >= 0.2); assert.equal(hy[0].bm25, null);
  assert.equal(searchMemory('سرانه فضای سبز')[0].refId, 'doc_b');
});

test('postgres sync: backfill → change/delete via scan → restore into empty data dir (exact bytes, tombstones, exclusions)', async () => {
  const sync = await import('../db/pgSync');
  w(dirA, 'agentic/runs/r1.json', JSON.stringify({ runId: 'r1', neighborhoodId: 'tehran:m605', status: 'completed' }, null, 1));
  w(dirA, 'agentic/docs/d1/original.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]));
  w(dirA, 'ingestion/batches/b1.json', JSON.stringify({ batchId: 'b1', status: 'PENDING_REVIEW' }));
  w(dirA, 'agentic/webresearch/cache/x.json', '{"cached":true}');
  w(dirA, 'agentic/trace.jsonl', '{"a":1}\n');
  w(dirA, 'osm-cache/tile.json', '{}'); w(dirA, 'satellite-catalog.sqlite', 'SQLite'); w(dirA, 'satellite-catalog.sqlite-wal', 'w');
  const st = await sync.startPgSync({ watch: false });
  assert.equal(st.active, true, String(st.lastError)); assert.equal(st.vector, true);
  assert.ok(st.backfilled >= 5);
  const rows = (await db.query<{ rel_path: string; collection: string; neighborhood_id: string | null; status: string | null }>('SELECT rel_path, collection, neighborhood_id, status FROM ara.server_files ORDER BY 1')).rows;
  const paths = rows.map((r) => r.rel_path);
  assert.ok(paths.includes('agentic/runs/r1.json') && paths.includes('agentic/docs/d1/original.pdf') && paths.includes('ingestion/batches/b1.json'));
  assert.ok(!paths.some((p) => p.includes('webresearch/cache') || p.startsWith('osm-cache/') || p.includes('.sqlite')), 'حافظهٔ نهان و SQLite زنده همگام نمی‌شوند');
  const r1 = rows.find((r) => r.rel_path === 'agentic/runs/r1.json')!;
  assert.equal(r1.collection, 'agentic/runs'); assert.equal(r1.neighborhood_id, 'tehran:m605'); assert.equal(r1.status, 'completed');
  const q = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM ara.server_files WHERE doc->>'status' = 'PENDING_REVIEW'");
  assert.equal(q.rows[0].n, 1, 'سند JSON با SQL قابل پرس‌وجوست');
  // تغییر، حذف، افزودن
  await new Promise((r) => setTimeout(r, 15));
  w(dirA, 'agentic/runs/r1.json', JSON.stringify({ runId: 'r1', neighborhoodId: 'tehran:m605', status: 'failed' }));
  fs.rmSync(path.join(dirA, 'ingestion/batches/b1.json'));
  w(dirA, 'agentic/field/campaigns/c1.json', JSON.stringify({ id: 'c1', neighborhoodId: 'karaj:x', status: 'draft' }));
  const changed = await sync.scan(); assert.ok(changed >= 3);
  const del = await db.query<{ deleted: boolean }>("SELECT deleted_at IS NOT NULL AS deleted FROM ara.server_files WHERE rel_path = 'ingestion/batches/b1.json'");
  assert.equal(del.rows[0].deleted, true);
  assert.equal((await db.query<{ s: string }>("SELECT status AS s FROM ara.server_files WHERE rel_path = 'agentic/runs/r1.json'")).rows[0].s, 'failed');
  const summary = await sync.pgCollectionSummary(); assert.ok(summary.some((x) => x.collection === 'agentic/field' && x.n === 1));
  await sync.stopPgSync();
  // استقرار تازه با دیسک خالی
  process.env.ARA_SERVER_DATA_DIR = dirB;
  const st2 = await sync.startPgSync({ watch: false });
  assert.equal(st2.active, true); assert.ok(st2.hydrated >= 4); assert.equal(st2.backfilled, 0);
  assert.deepEqual(fs.readFileSync(path.join(dirB, 'agentic/docs/d1/original.pdf')), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dirB, 'agentic/runs/r1.json'), 'utf8')).status, 'failed');
  assert.equal(fs.readFileSync(path.join(dirB, 'agentic/trace.jsonl'), 'utf8'), '{"a":1}\n');
  assert.ok(!fs.existsSync(path.join(dirB, 'ingestion/batches/b1.json')), 'فایل حذف‌شده بازگردانده نمی‌شود');
  assert.ok(!fs.existsSync(path.join(dirB, 'agentic/webresearch/cache/x.json')));
  // ماژول‌های واقعی دادهٔ بازیابی‌شده را می‌خوانند
  const { load } = await import('./field/store');
  assert.equal((load('campaigns' as never, 'c1') as { status: string }).status, 'draft');
});

test('pgvector memory: chunks mirrored with embeddings; async search uses pgvector', async () => {
  const sync = await import('../db/pgSync');
  if (!sync.pgSyncStatus().active) await sync.startPgSync({ watch: false });
  const { indexItem, searchMemoryAsync, syncChunksToPg, _resetMemory, memoryStats } = await import('./research/memory');
  _resetMemory();
  indexItem('document', 'doc_c', 'بازار کار', [{ page: 3, text: 'نرخ بیکاری جوانان در محله یوسف‌آباد ۱۴ درصد است و سهم شاغلان بیمه‌شده ۵۲ درصد است.' }]);
  await syncChunksToPg();
  const n = await db.query<{ n: number; dims: number }>("SELECT count(*)::int AS n, max(vector_dims(embedding))::int AS dims FROM ara.research_chunks WHERE ref_id = 'doc_c'");
  assert.equal(n.rows[0].n, 1); assert.equal(n.rows[0].dims, 256);
  const r = await searchMemoryAsync('بیکار جوان');
  assert.equal(r.engine, 'pgvector'); assert.equal(r.hits[0]?.refId, 'doc_c'); assert.equal(r.hits[0].page, 3);
  assert.equal(memoryStats().vectorStore, 'pgvector');
});

test('sync is inert without configuration and reports database errors without breaking local files', async () => {
  const sync = await import('../db/pgSync');
  await sync.stopPgSync();
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:1/none';
  const st = await sync.startPgSync({ watch: false });
  assert.equal(st.active, false); assert.ok(st.lastError);
  process.env.ARA_STORAGE = 'json';
  assert.equal(sync.pgSyncEnabled(), false);
  process.env.ARA_STORAGE = 'postgres'; process.env.DATABASE_URL = saved;
});
