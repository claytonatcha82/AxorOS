import type {
  FinanceGovernedOperationalDecision,
  FinanceOperationalDecisionState,
} from './finance-governed-operational-coordinator.js';

export type FinanceCommunicationIntent =
  | 'INTERNAL_REVIEW_ONLY'
  | 'DRAFT_PAYMENT_VERIFICATION_REQUEST'
  | 'DRAFT_PAYMENT_ISSUE_NOTICE'
  | 'INTERNAL_BINDING_PENDING'
  | 'DRAFT_PAYMENT_CONFIRMATION';

export interface FinanceGovernedCommunicationDecision {
  commercialRecordReference: string;
  gate: FinanceGovernedOperationalDecision['gate'];
  operationalState: FinanceOperationalDecisionState;
  intent: FinanceCommunicationIntent;
  clientCommunicationAllowed: boolean;
  modelDraftAllowed: boolean;
  humanApprovalRequired: true;
  sendAuthorised: false;
  reason: string;
  evidenceReferences: string[];
}

function evidence(decision: FinanceGovernedOperationalDecision): string[] {
  return [decision.paymentEvidenceReference, decision.clearanceId]
    .filter((reference): reference is string => typeof reference === 'string' && Boolean(reference.trim()));
}

export function decideFinanceGovernedCommunication(
  decision: FinanceGovernedOperationalDecision,
): FinanceGovernedCommunicationDecision {
  const base = {
    commercialRecordReference: decision.commercialRecordReference,
    gate: decision.gate,
    operationalState: decision.state,
    humanApprovalRequired: true as const,
    sendAuthorised: false as const,
    evidenceReferences: evidence(decision),
  };

  switch (decision.state) {
    case 'AWAITING_VERIFIED_PAYMENT':
      return {
        ...base,
        intent: 'DRAFT_PAYMENT_VERIFICATION_REQUEST',
        clientCommunicationAllowed: true,
        modelDraftAllowed: true,
        reason: 'A cautious verification request may be drafted, but payment must remain explicitly unverified.',
      };
    case 'PAYMENT_BLOCKED':
      return {
        ...base,
        intent: 'DRAFT_PAYMENT_ISSUE_NOTICE',
        clientCommunicationAllowed: true,
        modelDraftAllowed: true,
        reason: 'A payment-status issue notice may be drafted from authoritative state without asserting clearance.',
      };
    case 'REQUIREMENT_SATISFIED':
      if (!decision.clearanceId) {
        throw new Error('Finance payment confirmation requires persisted clearance evidence.');
      }
      return {
        ...base,
        intent: 'DRAFT_PAYMENT_CONFIRMATION',
        clientCommunicationAllowed: true,
        modelDraftAllowed: true,
        reason: 'A payment confirmation may be drafted because the governed commercial requirement is satisfied by persisted Finance clearance.',
      };
    case 'READY_TO_BIND_REQUIREMENT':
      return {
        ...base,
        intent: 'INTERNAL_BINDING_PENDING',
        clientCommunicationAllowed: false,
        modelDraftAllowed: false,
        reason: 'Verified evidence exists, but Finance has not yet persisted commercial requirement satisfaction; no client confirmation may be drafted.',
      };
    case 'MANUAL_REVIEW':
    case 'BLOCKED_MISSING_REQUIREMENT':
    case 'BLOCKED_REQUIREMENT_INACTIVE':
      return {
        ...base,
        intent: 'INTERNAL_REVIEW_ONLY',
        clientCommunicationAllowed: false,
        modelDraftAllowed: false,
        reason: 'Finance state requires internal resolution before any client-facing communication is drafted.',
      };
  }
}
