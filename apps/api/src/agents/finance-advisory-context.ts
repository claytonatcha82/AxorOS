import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';

export interface FinanceAdvisoryContext {
  financeBrief: string;
  financeContext: string;
  knowledgeReferences: string[];
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function buildFinanceAdvisoryContext(
  decision: FinanceGovernedOperationalDecision,
): FinanceAdvisoryContext {
  const commercialRecordReference = requireNonEmpty(
    decision.commercialRecordReference,
    'Finance commercial record reference',
  );

  const authoritativeState = {
    commercialRecordReference,
    gate: decision.gate,
    operationalDecision: decision.state,
    operationalReason: decision.reason,
    requirementReference: decision.requirementReference ?? null,
    clearanceId: decision.clearanceId ?? null,
    paymentEvidenceReference: decision.paymentEvidenceReference ?? null,
    paymentStatus: decision.paymentStatus ?? null,
    authorityState: decision.authorityState ?? null,
  };

  return {
    financeBrief: [
      'Analyse the supplied authoritative Finance operational assessment and provide advisory guidance only.',
      'Preserve the exact operational decision and payment authority state supplied in context.',
      'Do not reinterpret, upgrade, downgrade, replace, or authorize the deterministic Finance decision.',
      'Identify useful client communication, reconciliation follow-up, anomaly review, or operational next steps without changing financial state.',
    ].join(' '),
    financeContext: [
      'AUTHORITATIVE DETERMINISTIC FINANCE ASSESSMENT.',
      'The following state was derived from persisted AxorOS payment and commercial evidence, not from model reasoning.',
      JSON.stringify(authoritativeState),
      'The model is advisory only. It cannot confirm payment, create clearance, satisfy a commercial requirement, release a gate, alter a ledger, or move money.',
    ].join(' '),
    knowledgeReferences: [
      `finance:commercial-record:${commercialRecordReference}`,
      `finance:gate:${decision.gate}`,
      ...(decision.requirementReference ? [`finance:requirement:${decision.requirementReference}`] : []),
      ...(decision.paymentEvidenceReference ? [`finance:evidence:${decision.paymentEvidenceReference}`] : []),
      ...(decision.clearanceId ? [`finance:clearance:${decision.clearanceId}`] : []),
    ],
  };
}
