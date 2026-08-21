import type { Pool } from 'pg';
import { SalesInboundReplyEvidencePostgresStore } from '../data/sales-inbound-reply-evidence-postgres-store.js';
import { createOperationalRepository } from '../data/operational-repository.js';
import type { GmailEmailIntegration } from '../integrations/gmail-draft-integration.js';
import { createSalesInboundReplyDetectionService } from './sales-inbound-reply-detection-service.js';
import { createSalesInboundReplyEvidenceService } from './sales-inbound-reply-evidence-service.js';

export function createPersistedSalesInboundReplyRuntime(
  pool: Pool,
  gmailIntegration: Pick<GmailEmailIntegration, 'readThread'>,
) {
  const repository = createOperationalRepository(pool);
  const evidenceStore = new SalesInboundReplyEvidencePostgresStore(pool);
  const detector = createSalesInboundReplyDetectionService(repository, gmailIntegration);
  const evidence = createSalesInboundReplyEvidenceService(detector, evidenceStore);

  return {
    repository,
    evidenceStore,
    detector,
    evidence,
    commands: {
      inspect(outboundRecordId: string) {
        return detector.detect(outboundRecordId);
      },
      inspectAndPersist(outboundRecordId: string) {
        return evidence.inspect(outboundRecordId);
      },
    },
  };
}

export type PersistedSalesInboundReplyRuntime = ReturnType<typeof createPersistedSalesInboundReplyRuntime>;
