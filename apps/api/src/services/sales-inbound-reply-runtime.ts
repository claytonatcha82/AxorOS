import type { Pool } from 'pg';
import { SalesInboundReplyClassificationPostgresStore } from '../data/sales-inbound-reply-classification-postgres-store.js';
import { SalesInboundReplyEvidencePostgresStore } from '../data/sales-inbound-reply-evidence-postgres-store.js';
import { createOperationalRepository } from '../data/operational-repository.js';
import type { GmailEmailIntegration } from '../integrations/gmail-draft-integration.js';
import { classifySalesInboundDeterministically } from './sales-inbound-deterministic-classification-service.js';
import type { SalesInboundPersistedEvidenceForClassification } from './sales-inbound-model-classification-service.js';
import { createSalesInboundReplyDetectionService } from './sales-inbound-reply-detection-service.js';
import { createSalesInboundReplyEvidenceService } from './sales-inbound-reply-evidence-service.js';

interface SalesInboundModelClassifier {
  classify(evidence: SalesInboundPersistedEvidenceForClassification): ReturnType<
    SalesInboundReplyClassificationPostgresStore['record']
  >;
}

export function createPersistedSalesInboundReplyRuntime(
  pool: Pool,
  gmailIntegration: Pick<GmailEmailIntegration, 'readThread'>,
  modelClassifier?: SalesInboundModelClassifier,
) {
  const repository = createOperationalRepository(pool);
  const evidenceStore = new SalesInboundReplyEvidencePostgresStore(pool);
  const classificationStore = new SalesInboundReplyClassificationPostgresStore(pool);
  const detector = createSalesInboundReplyDetectionService(repository, gmailIntegration);
  const evidence = createSalesInboundReplyEvidenceService(detector, evidenceStore);

  async function inspectPersistAndClassify(outboundRecordId: string) {
    const evidenceResult = await evidence.inspect(outboundRecordId);
    if (!evidenceResult.evidenceRecorded || !evidenceResult.evidence) {
      return {
        ...evidenceResult,
        classificationRecorded: false as const,
      };
    }

    const persistedEvidence = evidenceResult.evidence;
    const deterministic = classifySalesInboundDeterministically({
      inboundEvidenceId: persistedEvidence.inboundEvidenceId,
      outboundRecordId: persistedEvidence.outboundRecordId,
      leadId: persistedEvidence.leadId,
      providerMessageId: persistedEvidence.providerMessageId,
      ...(persistedEvidence.textBody ? { textBody: persistedEvidence.textBody } : {}),
      ...(persistedEvidence.snippet ? { snippet: persistedEvidence.snippet } : {}),
      classifiedAt: new Date().toISOString(),
    });

    if (deterministic.classificationApplied) {
      const classification = await classificationStore.record(deterministic.classification);
      return {
        ...evidenceResult,
        classificationRecorded: true as const,
        classification,
      };
    }

    if (!modelClassifier) {
      throw new Error('Sales inbound reply requires model.openai classification after deterministic safety checks.');
    }

    const bodyOrSnippet = persistedEvidence.textBody?.trim() || persistedEvidence.snippet?.trim();
    if (!persistedEvidence.senderAddress?.trim() || !bodyOrSnippet) {
      throw new Error('Persisted Sales inbound evidence is insufficient for model classification.');
    }

    const modelClassification = await modelClassifier.classify({
      inboundEvidenceId: persistedEvidence.inboundEvidenceId,
      outboundRecordId: persistedEvidence.outboundRecordId,
      leadId: persistedEvidence.leadId,
      providerMessageId: persistedEvidence.providerMessageId,
      senderAddress: persistedEvidence.senderAddress,
      ...(persistedEvidence.subject ? { subject: persistedEvidence.subject } : {}),
      bodyOrSnippet,
    });
    const classification = await classificationStore.record(modelClassification);

    return {
      ...evidenceResult,
      classificationRecorded: true as const,
      classification,
    };
  }

  return {
    repository,
    evidenceStore,
    classificationStore,
    detector,
    evidence,
    commands: {
      inspect(outboundRecordId: string) {
        return detector.detect(outboundRecordId);
      },
      inspectAndPersist(outboundRecordId: string) {
        return evidence.inspect(outboundRecordId);
      },
      inspectPersistAndClassify,
    },
  };
}

export type PersistedSalesInboundReplyRuntime = ReturnType<typeof createPersistedSalesInboundReplyRuntime>;
