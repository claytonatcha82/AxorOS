import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOperationsProductionReadinessWorkflow,
  evaluateOperationsProductionReadiness,
  type OperationsProductionReadinessAssessment,
} from './operations-production-readiness-workflow.js';
import type { OperationsProductionReadinessDecision } from '../data/operations-production-readiness-postgres-store.js';
import type { OperationsProductionPrerequisiteEvidence } from './operations-production-prerequisite-evidence.js';

function assessment(overrides: Partial<OperationsProductionReadinessAssessment> = {}): OperationsProductionReadinessAssessment {
  return {
    readinessId: 'operations-readiness:test:1',
    commercialRecordReference: 'commercial:test:1',
    assessedAt: '2026-08-22T10:40:00.000Z',
    ...overrides,
  };
}

function prerequisites(overrides: Partial<OperationsProductionPrerequisiteEvidence> = {}): OperationsProductionPrerequisiteEvidence {
  return {
    commercialRecordReference: 'commercial:test:1',
    contractSigned: true,
    onboardingComplete: true,
    assetsAvailable: true,
    planningComplete: true,
    evidenceReferences: [
      'workflow-event:contract',
      'workflow-event:onboarding',
      'workflow-event:assets',
      'workflow-event:planning',
    ],
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

function workflowWithEvidence(evidence: OperationsProductionPrerequisiteEvidence) {
  const store = new MemoryReadinessStore();
  const workflow = createOperationsProductionReadinessWorkflow({
    readinessStore: store,
    prerequisiteEvidenceResolver: {
      async resolve(commercialRecordReference: string) {
        assert.equal(commercialRecordReference, evidence.commercialRecordReference);
        return evidence;
      },
    },
  });
  return { store, workflow };
}

test('Operations readiness evaluator marks complete persisted prerequisites OPERATIONS_READY', () => {
  const decision = evaluateOperationsProductionReadiness(assessment(), prerequisites());
  assert.equal(decision.state, 'OPERATIONS_READY');
  assert.equal(decision.approvedBy, 'operations_agent');
  assert.equal(decision.contractSigned, true);
  assert.equal(decision.onboardingComplete, true);
  assert.equal(decision.assetsAvailable, true);
  assert.equal(decision.planningComplete, true);
});

test('Operations readiness evaluator fails closed when any persisted prerequisite is incomplete', () => {
  for (const incomplete of ['contractSigned', 'onboardingComplete', 'assetsAvailable', 'planningComplete'] as const) {
    const decision = evaluateOperationsProductionReadiness(
      assessment(),
      prerequisites({ [incomplete]: false }),
    );
    assert.equal(decision.state, 'OPERATIONS_BLOCKED');
  }
});

test('Operations readiness evaluator requires governed evidence and valid identity fields', () => {
  assert.throws(() => evaluateOperationsProductionReadiness(assessment(), prerequisites({ evidenceReferences: [] })), /evidence is required/);
  assert.throws(() => evaluateOperationsProductionReadiness(assessment({ readinessId: ' ' }), prerequisites()), /readiness ID is required/);
  assert.throws(() => evaluateOperationsProductionReadiness(assessment({ commercialRecordReference: ' ' }), prerequisites()), /commercial record is required/);
  assert.throws(() => evaluateOperationsProductionReadiness(assessment({ assessedAt: 'invalid' }), prerequisites()), /timestamp is invalid/);
  assert.throws(
    () => evaluateOperationsProductionReadiness(assessment(), prerequisites({ commercialRecordReference: 'commercial:other' })),
    /does not belong to the requested commercial record/,
  );
});

test('Operations readiness workflow derives READY only from persisted prerequisite evidence', async () => {
  const { workflow } = workflowWithEvidence(prerequisites());
  const result = await workflow.assess(assessment());
  assert.equal(result.persistence, 'accepted');
  assert.equal(result.decision.state, 'OPERATIONS_READY');
  assert.deepEqual(result.decision.evidenceReferences, prerequisites().evidenceReferences);
});

test('Operations readiness workflow derives BLOCKED when persisted prerequisite evidence is incomplete', async () => {
  const { workflow } = workflowWithEvidence(prerequisites({ assetsAvailable: false }));
  const result = await workflow.assess(assessment());
  assert.equal(result.decision.state, 'OPERATIONS_BLOCKED');
  assert.equal(result.decision.assetsAvailable, false);
});

test('Operations readiness workflow persists and reloads authoritative immutable decision', async () => {
  const { workflow } = workflowWithEvidence(prerequisites());
  const first = await workflow.assess(assessment());
  assert.equal(first.persistence, 'accepted');
  assert.equal(first.decision.state, 'OPERATIONS_READY');

  const replay = await workflow.assess(assessment());
  assert.equal(replay.persistence, 'replayed');
  assert.deepEqual(replay.decision, first.decision);
});
