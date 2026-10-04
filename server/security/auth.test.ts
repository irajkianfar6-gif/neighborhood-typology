import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { authMiddleware, loadAuthConfig, requiredRole } from './auth';

const VIEWER = 'viewer-token-0123456789';
const ADMIN = 'admin-token-0123456789ab';

test('token config parses roles and ignores short tokens', () => {
  const c = loadAuthConfig({ ARA_API_TOKENS: `${VIEWER}:viewer,${ADMIN}:admin,short:admin`, NODE_ENV: 'production' } as NodeJS.ProcessEnv);
  assert.equal(c.tokens.size, 2);
  assert.equal(c.anonRole, 'viewer');
  assert.equal(loadAuthConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).anonRole, 'admin');
});

test('write routes need more than viewer', () => {
  assert.ok(['analyst', 'operator', 'admin'].includes(requiredRole('POST', '/api/decision-support/ingestion/upload')));
  assert.equal(requiredRole('GET', '/api/health'), 'none');
});

test('middleware enforces roles over HTTP', async (t) => {
  const app = express();
  app.use(authMiddleware(loadAuthConfig({ ARA_API_TOKENS: `${VIEWER}:viewer,${ADMIN}:admin`, ARA_ANON_ROLE: 'none', NODE_ENV: 'production' } as NodeJS.ProcessEnv)));
  app.post('/api/decision-support/ingestion/upload', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/decision-support/neighborhoods/cities', (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${base}/api/decision-support/neighborhoods/cities`)).status, 401);
  assert.equal((await fetch(`${base}/api/decision-support/neighborhoods/cities`, { headers: { Authorization: 'Bearer wrong-token-000000000' } })).status, 401);
  assert.equal((await fetch(`${base}/api/decision-support/neighborhoods/cities`, { headers: { Authorization: `Bearer ${VIEWER}` } })).status, 200);
  assert.equal((await fetch(`${base}/api/decision-support/ingestion/upload`, { method: 'POST', headers: { Authorization: `Bearer ${VIEWER}` } })).status, 403);
  assert.equal((await fetch(`${base}/api/decision-support/ingestion/upload`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` } })).status, 200);
});
