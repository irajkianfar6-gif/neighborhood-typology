import assert from 'node:assert/strict';
import test from 'node:test';
import { computeReliability, convergence, freshness } from './reliability';
import { evaluatePublication } from './publicationGate';
import type { DocumentedValue, ScoredValue } from './types';

const NOW = Date.parse('2026-01-01T00:00:00Z');
function dv(over: Partial<DocumentedValue> = {}): DocumentedValue {
  return {
    code: 'P4', raw: 80, unit: '%', source: 'test', sourceIds: ['t'], channel: 'open_auto', tier: 'open_measured', geographyLevel: 'neighborhood',
    observedAt: '2025-12-01', fetchedAt: '2025-12-01', method: 'test', methodQuality: 1, sampleAdequacy: 1, cadence: 'monthly', ...over,
  };
}

test('reliability ranks official neighborhood data above national proxies', () => {
  const official = computeReliability(dv({ tier: 'official' }), 0.5, NOW).reliability;
  const proxy = computeReliability(dv({ tier: 'proxy', geographyLevel: 'national' }), 0.5, NOW).reliability;
  assert.ok(official > proxy, `${official} > ${proxy}`);
  assert.ok(official <= 1 && proxy >= 0);
});

test('stale observations lose freshness; unknown dates are penalised', () => {
  assert.ok(freshness({ observedAt: '2025-12-15', cadence: 'monthly' }, NOW) > freshness({ observedAt: '2020-01-01', cadence: 'monthly' }, NOW));
  assert.ok(freshness({ observedAt: null, observedAtUnknown: true, cadence: 'annual' }, NOW) < 1);
});

test('conflicting sources are flagged', () => {
  assert.equal(convergence([20, 85]).conflict, true);
  assert.equal(convergence([70, 72]).conflict, false);
});

test('publication gate returns INSUFFICIENT and a missing-data list when nothing is measured', () => {
  const gate = evaluatePublication({
    values: new Map<string, ScoredValue>(), boundaryTier: 'official', surveyAdequacy: 'NONE', surveyAlpha: null,
    groupValues: {}, groupNs: {}, currentVersions: { method: 'x' },
  });
  assert.equal(gate.level, 'INSUFFICIENT');
  assert.equal(gate.usableCodes.length, 0);
  assert.equal(gate.sections.diagnosticType.allowed, false);
  assert.equal(gate.sections.equity.allowed, false);
  assert.ok(gate.missing.length >= 40);
  assert.ok(gate.missing.every((m) => m.owner && m.nextAction));
});
