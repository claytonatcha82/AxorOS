import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceLedgerRecorder } from './finance-ledger-recorder.js';
import type { FinanceLedgerEntry } from './finance-ledger-entry.js';

test('Finance ledger recorder creates deterministic immutable identity for trusted authority', async () => {
  const saved: FinanceLedgerEntry[] = [];
  const recorder = createFinanceLedgerRecorder({
    async save(entry) {
      saved.push(entry);
      return saved.length === 1 ? 'accepted' : 'duplicate';
    },
  });
  const input = {
    entryType: 'PAYMENT_REQUIREMENT_CREATED' as const,
    commercialRecordReference: 'commercial:ledger:1',
    authorityType: 'commercial_payment_requirement' as const,
    authorityReference: 'requirement:ledger:1',
    evidenceReferences: ['commercial-authority:requirement:ledger:1'],
    amountMinor: 12500,
    currency: 'ZAR',
    occurredAt: '2026-08-23T12:00:00.000Z',
  };

  const first = await recorder.record(input);
  const replay = await recorder.record(input);

  assert.equal(first.persistence, 'accepted');
  assert.equal(replay.persistence, 'duplicate');
  assert.equal(first.entry.entryId, replay.entry.entryId);
  assert.deepEqual(first.entry, replay.entry);
  assert.equal(first.entry.recordedAt, input.occurredAt);
});
