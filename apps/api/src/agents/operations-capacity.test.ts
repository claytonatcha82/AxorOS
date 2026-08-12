import assert from 'node:assert/strict';
import test from 'node:test';
import { capacityStatus, scoreOperationsPriority, shouldAcceptAggressiveDeadline } from './operations-capacity.js';

test('production at 94 percent is constrained and blocks aggressive deadlines', () => {
  assert.equal(capacityStatus(94), 'constrained');
  assert.equal(shouldAcceptAggressiveDeadline({ functionName: 'production', currentLoadPercent: 94 }), false);
});

test('available capacity may accept normal deadline pressure', () => {
  assert.equal(capacityStatus(48), 'available');
  assert.equal(shouldAcceptAggressiveDeadline({ functionName: 'marketing', currentLoadPercent: 48 }), true);
});

test('operational priority includes impact deadline revenue risk dependencies and capacity', () => {
  const outage = scoreOperationsPriority({ id: 'outage', businessImpact: 5, clientImpact: 5, deadlinePressure: 5, revenueImpact: 4, risk: 5, dependencyImpact: 5, agentCapacityAvailable: 4 });
  const blog = scoreOperationsPriority({ id: 'blog', businessImpact: 2, clientImpact: 1, deadlinePressure: 2, revenueImpact: 2, risk: 1, dependencyImpact: 1, agentCapacityAvailable: 5 });
  assert.ok(outage > blog);
});
