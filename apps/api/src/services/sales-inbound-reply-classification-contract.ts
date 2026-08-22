export const SALES_INBOUND_REPLY_CATEGORIES = [
  'positive_interest',
  'information_request',
  'pricing_or_commercial_question',
  'meeting_request',
  'objection',
  'not_interested',
  'opt_out',
  'automated_response',
  'delivery_failure',
  'ambiguous',
  'sensitive_or_high_risk',
] as const;

export type SalesInboundReplyCategory = (typeof SALES_INBOUND_REPLY_CATEGORIES)[number];

export const SALES_INBOUND_REPLY_NEXT_ACTIONS = [
  'prepare_sales_response',
  'retrieve_authoritative_information',
  'retrieve_approved_pricing_authority',
  'prepare_scheduling_action',
  'prepare_bounded_objection_response',
  'stop_active_sales_progression',
  'record_suppression',
  'await_or_schedule_governed_evaluation',
  'verify_contact_data_or_escalate',
  'human_review_required',
  'route_to_human_executive_or_appropriate_owner',
] as const;

export type SalesInboundReplyNextAction = (typeof SALES_INBOUND_REPLY_NEXT_ACTIONS)[number];

export type SalesInboundReplyClassificationSource =
  | 'deterministic'
  | 'model_assisted'
  | 'human';

export interface SalesInboundReplyClassificationEvidenceReason {
  reason: string;
}

export interface SalesInboundReplyDeterministicSignals {
  optOutDetected: boolean;
  automatedResponseDetected: boolean;
  deliveryFailureDetected: boolean;
}

export interface SalesInboundReplyClassificationRecord {
  inboundEvidenceId: string;
  outboundRecordId: string;
  leadId: string;
  providerMessageId: string;
  confidence?: number;
  primaryCategory: SalesInboundReplyCategory;
  evidenceReasons: readonly SalesInboundReplyClassificationEvidenceReason[];
  deterministicSignals: SalesInboundReplyDeterministicSignals;
  commercialTopicDetected: boolean;
  sensitiveTopicDetected: boolean;
  uncertaintyDetected: boolean;
  classificationSource: SalesInboundReplyClassificationSource;
  modelReference?: string;
  responseAuthorised: false;
  pricingAuthorised: false;
  discountAuthorised: false;
  commercialCommitmentAuthorised: false;
  contractAuthorised: false;
  nextAction: SalesInboundReplyNextAction;
  humanReviewRequired: boolean;
  classifiedAt: string;
}

export type SalesInboundReplyClassificationInput = Omit<
  SalesInboundReplyClassificationRecord,
  | 'responseAuthorised'
  | 'pricingAuthorised'
  | 'discountAuthorised'
  | 'commercialCommitmentAuthorised'
  | 'contractAuthorised'
>;

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export function createSalesInboundReplyClassificationRecord(
  input: SalesInboundReplyClassificationInput,
): SalesInboundReplyClassificationRecord {
  if (input.confidence !== undefined && !Number.isFinite(input.confidence)) {
    throw new Error('confidence must be finite when supplied.');
  }
  if (input.evidenceReasons.length === 0) {
    throw new Error('At least one evidence reason is required.');
  }

  const evidenceReasons = input.evidenceReasons.map(({ reason }) => ({
    reason: requireNonEmpty(reason, 'evidence reason'),
  }));
  const modelReference = input.modelReference?.trim();

  return {
    ...input,
    inboundEvidenceId: requireNonEmpty(input.inboundEvidenceId, 'inboundEvidenceId'),
    outboundRecordId: requireNonEmpty(input.outboundRecordId, 'outboundRecordId'),
    leadId: requireNonEmpty(input.leadId, 'leadId'),
    providerMessageId: requireNonEmpty(input.providerMessageId, 'providerMessageId'),
    evidenceReasons,
    ...(modelReference ? { modelReference } : {}),
    classifiedAt: requireNonEmpty(input.classifiedAt, 'classifiedAt'),
    responseAuthorised: false,
    pricingAuthorised: false,
    discountAuthorised: false,
    commercialCommitmentAuthorised: false,
    contractAuthorised: false,
  };
}
