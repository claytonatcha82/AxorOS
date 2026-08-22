import type {
  SalesInboundReplyClassificationRecord,
  SalesInboundReplyNextAction,
} from './sales-inbound-reply-classification-contract.js';

export type SalesInboundNextActionOwner =
  | 'sales_agent'
  | 'finance_agent'
  | 'human_executive'
  | 'appropriate_owner';

export interface SalesInboundNextActionResolution {
  inboundEvidenceId: string;
  providerMessageId: string;
  primaryCategory: SalesInboundReplyClassificationRecord['primaryCategory'];
  nextAction: SalesInboundReplyNextAction;
  owner: SalesInboundNextActionOwner;
  humanReviewRequired: boolean;
  autonomousResponseAuthorised: false;
  sendAuthorised: false;
  pricingAuthorised: false;
  discountAuthorised: false;
  commercialCommitmentAuthorised: false;
  contractAuthorised: false;
}

function resolveOwner(
  classification: SalesInboundReplyClassificationRecord,
): SalesInboundNextActionOwner {
  if (classification.primaryCategory === 'sensitive_or_high_risk') {
    return classification.commercialTopicDetected ? 'finance_agent' : 'human_executive';
  }

  return 'sales_agent';
}

export function resolveSalesInboundNextAction(
  classification: SalesInboundReplyClassificationRecord,
): SalesInboundNextActionResolution {
  if (
    classification.responseAuthorised !== false ||
    classification.pricingAuthorised !== false ||
    classification.discountAuthorised !== false ||
    classification.commercialCommitmentAuthorised !== false ||
    classification.contractAuthorised !== false
  ) {
    throw new Error('Inbound classification cannot carry consequential authority.');
  }

  const nextAction = classification.nextAction;

  return {
    inboundEvidenceId: classification.inboundEvidenceId,
    providerMessageId: classification.providerMessageId,
    primaryCategory: classification.primaryCategory,
    nextAction,
    owner: resolveOwner(classification),
    humanReviewRequired:
      classification.humanReviewRequired ||
      classification.primaryCategory === 'ambiguous' ||
      classification.primaryCategory === 'sensitive_or_high_risk',
    autonomousResponseAuthorised: false,
    sendAuthorised: false,
    pricingAuthorised: false,
    discountAuthorised: false,
    commercialCommitmentAuthorised: false,
    contractAuthorised: false,
  };
}
