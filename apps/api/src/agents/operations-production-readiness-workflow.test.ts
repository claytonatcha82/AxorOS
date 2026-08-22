import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOperationsProductionReadinessWorkflow,
  evaluateOperationsProductionReadiness,
  type OperationsProductionReadinessAssessment,
} from './operations-production-readiness-workflow.js';
import type { OperationsProductionReadinessDecision } from '../data/operations-production-readiness-postgres-store.js';

function assessment(overrides: Partial<OperationsProductionReadinessAssessment> = {}): OperationsProductionReadinessAssessment {
  return {
    readinessId: 'operations-readiness:test:1',
    commercialRecordReference: 'commercial:test:1',
    contractSigned: true,
    onboardingComplete: true,
    assetsAvailable: true,
    planningComplete: true,
    evidenceReferences: [
      'contract:commercial:test:1',
      'onboarding:commercial:test:1',
      'assets:commercial:test:1',
      'planning:commercial:test:1',
    ],
    assessedAt: '2026-08-22T10:40:00.000Z',
    ...overrides,
  };
}

class MemoryReadinessStore {
  private readonly rows = new Map<string, OperationsProductionReadinessDecision>();

  async save(decision: OperationsProductionReadinessDecision): Promise<'accepted' | 'replayed'> {
    const existing = this.rows.get(decision.readinessId);
    if (existing) {
      assert.deepEqual(existing, decision);
      return 'replayed';
    }
    this.rows.set(decision.readinessId, decision);
    return 'accepted';
  }

  async get(readinessId: string): Promise<OperationsProductionReadinessDecision | null> {
    return this.rows.get(readinessId) ?? null;
  }
}

test('Operations readiness evaluator marks complete governed prerequisites OPERATIONS_READY', () => {
  const decision = evaluateOperationsProductionReadiness(assessment());
  assert.equal(decision.state, 'OPERATIONS_READY');
  assert.equal(decision.approvedBy, 'operations_agent');
  assert.equal(decision.contractSigned, true);
  assert.equal(decision.onboardingComplete, true);
  assert.equal(decision.assetsAvailable, true);
  assert.equal(decision.planningComplete, true);
});

test('Operations readiness evaluator fails closed when any prerequisite is incomplete', () => {
  for (const incomplete of ['contractSigned', 'onboardingComplete', 'assetsAvailable', 'planningComplete'] as const) {
    const decision = evaluateOperationsProductionReadiness(assessment({ [incomplete]: false }));
    assert.equal(decision.state, 'OPERATIONS_BLOCKED');
  }
});

test('Operations readiness evaluator requires governed evidence and valid identity fields', () => {
  assert.throws(() => evaluateOperationsProductionReadiness(assessment({ evidenceReferences: [] })), /evidence is required/);
  assert.throws(() => evaluateOperationsProductionReadiness(assessment({ readinessId: ' ' })), /readiness ID is required/);
  assert.throws(() => evaluateOperationsProductionReadiness(assessment({ commercialRecordReference: ' ' })), /commercial record is required/);
  assert.throws(() => evaluateOperationsProductionReadiness(assessment({ assessedAt: 'invalid' })), /timestamp is invalid/);
});

test('Operations readiness workflow persists and reloads authoritative immutable decision', async () => {
  const store = new MemoryReadinessStore();
  const workflow = createOperationsProductionReadinessWorkflow({ readinessStore: store });
  const first = await workflow.assess(assessment());
  assert.equal(first.persistence, 'accepted');
  assert.equal(first.decision.state, 'OPERATIONS_READY');

  const replay = await workflow.assess(assessment());
  assert.equal(replay.persistence, 'replayed');
  assert.deepEqual(replay.decision, first.decision);
});
