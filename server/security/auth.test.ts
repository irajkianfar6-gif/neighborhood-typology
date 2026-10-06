import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { authMiddleware, loadAuthConfig } from './auth';

test('open access: everyone gets full role, tokens are not required', () => {
  assert.equal(loadAuthConfig({} as NodeJS.ProcessEnv).anonRole, 'admin');
  assert.equal(loadAuthConfig({ ARA_API_TOKENS: 'viewer-token-0123456789:viewer' } as NodeJS.ProcessEnv).anonRole, 'admin');
});

test('middleware never blocks: no token, wrong token, any write route', async (t) => {
  const app = express();
  app.use(authMiddleware(loadAuthConfig({ ARA_API_TOKENS: 'viewer-token-0123456789:viewer' } as NodeJS.ProcessEnv)));
  app.post('/api/decision-support/ingestion/:id/approve', (req, res) => { res.json({ role: (req as { araRole?: string }).araRole }); });
  app.post('/api/decision-support/calibration/run', (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/api/decision-support/ingestion/b1/approve`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).role, 'admin');
  assert.equal((await fetch(`${base}/api/decision-support/calibration/run`, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 200);
});
