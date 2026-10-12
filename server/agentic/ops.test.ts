/** عملیات (OPS-v1، BACKUP-v1): هزینه، هشدار با جلوگیری از تکرار، انفجار خطا، پشتیبان/راستی‌آزمایی/بازگردانی، متریک */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ara-ops-'));
const data = path.join(root, 'data');
process.env.ARA_SERVER_DATA_DIR = data;
process.env.ARA_BACKUP_DIR = path.join(root, 'backups');
const w = (rel: string, d: string | Buffer) => { const f = path.join(data, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d); };

test('cost report combines web research and AI usage (priced tokens)', async () => {
  const ops = await import('../ops/ops');
  const today = new Date().toISOString().slice(0, 10);
  w('agentic/webresearch/usage.json', JSON.stringify({ [today]: { research: 3, search: 5, contents: 2, costUsd: 0.15, cacheHits: 1 } }));
  ops.recordAiUsage('primary', true, { input_tokens: 1000, output_tokens: 500 });
  ops.recordAiUsage('fallback', true, { prompt_tokens: 2000, completion_tokens: 1000 });
  ops.recordAiUsage('primary', false);
  process.env.ARA_AI_PRICE_IN_PER_MTOK = '3'; process.env.ARA_AI_PRICE_OUT_PER_MTOK = '15';
  const r = ops.costReport(7);
  assert.equal(r.rows.length, 7);
  const t = r.rows.at(-1)!;
  assert.equal(t.day, today); assert.equal(t.web.research, 3); assert.equal(t.ai.calls, 3); assert.equal(t.ai.failures, 1);
  assert.equal(t.ai.inputTokens, 3000); assert.equal(t.ai.outputTokens, 1500);
  assert.equal(t.ai.costUsd, Math.round(((3000 * 3 + 1500 * 15) / 1e6) * 1000) / 1000);
  assert.equal(r.totals.webUsd, 0.15); assert.equal(r.aiPriced, true);
  delete process.env.ARA_AI_PRICE_IN_PER_MTOK; delete process.env.ARA_AI_PRICE_OUT_PER_MTOK;
  assert.equal(ops.costReport(1).totals.aiUsd, null, 'بدون قیمت، هزینهٔ هوش مصنوعی برآورد نمی‌شود');
});

test('alerts: webhook delivery, debounce per key, 5xx burst detection', async () => {
  const ops = await import('../ops/ops');
  const sent: Array<{ url: string; body: { text: string; key: string } }> = [];
  ops._setAlertFetch((async (url: string, init: RequestInit) => { sent.push({ url, body: JSON.parse(String(init.body)) }); return new Response('ok', { status: 200 }); }) as typeof fetch);
  process.env.ARA_ALERT_WEBHOOK_URL = 'https://hooks.test/x';
  const a = await ops.alert('k1', 'عنوان', 'جزئیات');
  assert.equal(a?.delivered, true); assert.match(sent[0].body.text, /عنوان/);
  assert.equal(await ops.alert('k1', 'عنوان', 'دوباره'), null, 'تکرار در بازهٔ جلوگیری فرستاده نمی‌شود');
  process.env.ARA_ALERT_5XX_BURST = '3';
  for (let i = 0; i < 3; i++) ops.recordError({ method: 'GET', route: '/api/x', status: 500, code: 'INTERNAL_ERROR', message: `boom ${i}` });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.some((s) => s.body.key === 'http_5xx_burst'));
  assert.equal(ops.listErrors(10)[0].message, 'boom 2');
  assert.ok(ops.listAlerts(10).some((x) => x.key === 'k1'));
  ops._setAlertFetch(null); delete process.env.ARA_ALERT_WEBHOOK_URL; delete process.env.ARA_ALERT_5XX_BURST;
});

test('backup: excludes caches/live SQLite, verifies, detects tampering, prunes, restores via script', async () => {
  const b = await import('../ops/backup');
  w('agentic/runs/r1.json', '{"runId":"r1"}'); w('agentic/docs/d1/original.pdf', Buffer.from([1, 2, 3, 0, 255]));
  w('osm-cache/tile.json', '{}'); w('satellite.sqlite', 'db'); w('agentic/webresearch/cache/c.json', '{}');
  const m = b.createBackup();
  const paths = m.entries.map((e) => e.path);
  assert.ok(paths.includes('agentic/runs/r1.json') && paths.includes('agentic/docs/d1/original.pdf'));
  assert.ok(!paths.some((p) => p.includes('cache') || p.endsWith('.sqlite')));
  assert.deepEqual(b.verifyBackup(m.name).ok, true);
  assert.equal(b.listBackups()[0].name, m.name);
  // بازگردانی با اسکریپت: آزمایشی سپس اعمال
  const target = path.join(root, 'restored');
  const archive = path.join(process.env.ARA_BACKUP_DIR!, m.name);
  const dry = spawnSync('node', ['scripts/restore-backup.mjs', archive, '--target', target], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr); assert.ok(!fs.existsSync(target), 'اجرای آزمایشی چیزی نمی‌نویسد');
  const app = spawnSync('node', ['scripts/restore-backup.mjs', archive, '--target', target, '--apply'], { encoding: 'utf8' });
  assert.equal(app.status, 0, app.stderr);
  assert.deepEqual(fs.readFileSync(path.join(target, 'agentic/docs/d1/original.pdf')), Buffer.from([1, 2, 3, 0, 255]));
  // دست‌کاری
  fs.appendFileSync(archive, 'x');
  const v = b.verifyBackup(m.name); assert.equal(v.ok, false); assert.match(v.reasons.join(' '), /هش/);
  const bad = spawnSync('node', ['scripts/restore-backup.mjs', archive, '--target', path.join(root, 'r2'), '--apply'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  // نگه‌داری
  process.env.ARA_BACKUP_KEEP = '2';
  b.createBackup(); b.createBackup();
  assert.equal(b.listBackups().length, 2);
  assert.throws(() => b.verifyBackup('../../etc/passwd'), /نامعتبر/);
  process.env.ARA_BACKUP_DIR = path.join(data, 'inside');
  assert.throws(() => b.createBackup(), /داخل پوشهٔ داده/);
  process.env.ARA_BACKUP_DIR = path.join(root, 'backups'); delete process.env.ARA_BACKUP_KEEP;
});

test('metrics collectors render live gauges', async () => {
  const { addCollector, renderMetrics } = await import('../ops/metrics');
  addCollector(() => ['ara_test_gauge 7']);
  addCollector(() => { throw new Error('x'); });
  assert.match(renderMetrics(), /ara_test_gauge 7/);
});
