import assert from 'node:assert/strict';
import test from 'node:test';
import { supportModelTier, validateSupportKpis } from './support-kpis.js';

test('support KPIs cover service reliability autonomy retention and expansion', () => {
  assert.deepEqual(validateSupportKpis({ firstResponseTimeMs: 1000, resolutionTimeMs: 5000, firstContactResolutionRate: 0.8, reopenRate: 0.05, escalationRate: 0.1, slaComplianceRate: 0.95, clientSatisfactionRate: 0.9, websiteUptimeRate: 0.999, recurringIncidentRate: 0.03, humanInterventionRate: 0.08, costPerResolvedTicket: 0.2, retentionRate: 0.96, expansionRevenue: 1000 }), []);
});

test('support reserves strong reasoning for unusual or sensitive cases', () => {
  assert.equal(supportModelTier({ deterministicCheckAvailable: true, unusualCase: false, securitySensitive: false }), 'deterministic');
  assert.equal(supportModelTier({ deterministicCheckAvailable: false, unusualCase: false, securitySensitive: false }), 'lightweight_ai');
  assert.equal(supportModelTier({ deterministicCheckAvailable: true, unusualCase: false, securitySensitive: true }), 'strong_reasoning');
});
