import assert from 'node:assert/strict';
import test from 'node:test';
import { createPilotReadinessAssessmentService } from './pilot-readiness-assessment-service.js';
import type { PilotVerificationEvidenceRecord } from '../data/pilot-verification-evidence-postgres-store.js';

const categories = [
  'SYNTHETIC_LIFECYCLE',
  'PERSISTED_RUNTIME',
  'FINANCE_INTEGRITY',
  'CONTROL_PLANE',
  'DEPLOYMENT_SAFETY',
] as const;

function evidence(overrides: Partial<PilotVerificationEvidenceRecord> = {}): PilotVerificationEvidenceRecord {
  return {
    evidenceId: 'evidence:test',
    category: 'SYNTHETIC_LIFECYCLE',
    outcome: 'PASS',
    verifier: 'test-verifier',
    sourceReference: 'test://source',
    details: {},
    verifiedAt: '2026-08-26T15:00:00.000Z',
    ...overrides,
  };
}

function records(outcomeByCategory: Partial<Record<typeof categories[number], 'PASS' | 'FAIL'>> = {}) {
  return new Map(categories.map((category, index) => {
    const record = evidence({
      evidenceId: `evidence:${index}`,
      category,
      outcome: outcomeByCategory[category] ?? 'PASS',
      sourceReference: `test://${category.toLowerCase()}`,
    });
    return [record.evidenceId, record] as const;
  }));
}

test('all five PASS receipts produce PILOT_ACTIVATION_READY', async () => {
  const source = records();
  let savedState = '';
  const service = createPilotReadinessAssessmentService({
    evidenceStore: { async get(id) { return source.get(id) ?? null; } },
    readinessStore: { async save(record) { savedState = record.state; return 'accepted'; } },
  });

  const result = await service.assess({
    readinessId: 'readiness:1',
    evidenceIds: [...source.keys()],
    assessedBy: 'operations_agent',
    assessedAt: '2026-08-26T15:01:00.000Z',
  });

  assert.equal(result.state, 'PILOT_ACTIVATION_READY');
  assert.equal(savedState, 'PILOT_ACTIVATION_READY');
});

test('a failed receipt produces PILOT_ACTIVATION_BLOCKED', async () => {
  const source = records({ FINANCE_INTEGRITY: 'FAIL' });
  let savedState = '';
  const service = createPilotReadinessAssessmentService({
    evidenceStore: { async get(id) { return source.get(id) ?? null; } },
    readinessStore: { async save(record) { savedState = record.state; return 'accepted'; } },
  });

  const result = await service.assess({
    readinessId: 'readiness:2',
    evidenceIds: [...source.keys()],
    assessedBy: 'operations_agent',
  });

  assert.equal(result.state, 'PILOT_ACTIVATION_BLOCKED');
  assert.equal(savedState, 'PILOT_ACTIVATION_BLOCKED');
});

test('missing or duplicate evidence fails closed before persistence', async () => {
  const source = records();
  let saveCalls = 0;
  const service = createPilotReadinessAssessmentService({
    evidenceStore: { async get(id) { return source.get(id) ?? null; } },
    readinessStore: { async save() { saveCalls += 1; return 'accepted'; } },
  });

  await assert.rejects(service.assess({
    readinessId: 'readiness:3',
    evidenceIds: [...source.keys()].slice(0, 4),
    assessedBy: 'operations_agent',
  }), /requires exactly 5 evidence records/);

  const ids = [...source.keys()];
  await assert.rejects(service.assess({
    readinessId: 'readiness:4',
    evidenceIds: [ids[0]!, ids[0]!, ids[2]!, ids[3]!, ids[4]!],
    assessedBy: 'operations_agent',
  }), /must be unique/);

  assert.equal(saveCalls, 0);
});
