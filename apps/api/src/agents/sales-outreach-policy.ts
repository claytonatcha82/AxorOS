export type SalesResponseClassification =
  | 'positive'
  | 'interested'
  | 'needs_information'
  | 'not_now'
  | 'price_concern'
  | 'already_has_supplier'
  | 'not_interested'
  | 'unsubscribe'
  | 'wrong_contact'
  | 'out_of_office';

export interface SalesOutreachSafetyInput {
  recipientVerified: boolean;
  companyVerified: boolean;
  contextVerified: boolean;
  containsHallucinatedDetails: boolean;
  containsConfidentialInformation: boolean;
  signatureApproved: boolean;
  messagingCompliant: boolean;
  duplicateOutreach: boolean;
  priorOptOut: boolean;
  humanApproved: boolean;
}

export interface SalesOutreachSafetyResult {
  status: 'draft_ready' | 'blocked';
  sendAllowed: false;
  blockingReasons: string[];
}

export function evaluateSalesOutreachSafety(input: SalesOutreachSafetyInput): SalesOutreachSafetyResult {
  const blockingReasons: string[] = [];

  if (!input.recipientVerified) blockingReasons.push('recipient_not_verified');
  if (!input.companyVerified) blockingReasons.push('company_not_verified');
  if (!input.contextVerified) blockingReasons.push('context_not_verified');
  if (input.containsHallucinatedDetails) blockingReasons.push('hallucinated_details_detected');
  if (input.containsConfidentialInformation) blockingReasons.push('confidential_information_detected');
  if (!input.signatureApproved) blockingReasons.push('signature_not_approved');
  if (!input.messagingCompliant) blockingReasons.push('messaging_not_compliant');
  if (input.duplicateOutreach) blockingReasons.push('duplicate_outreach_detected');
  if (input.priorOptOut) blockingReasons.push('prior_opt_out');
  if (!input.humanApproved) blockingReasons.push('human_approval_required');

  return {
    status: blockingReasons.length === 0 ? 'draft_ready' : 'blocked',
    sendAllowed: false,
    blockingReasons,
  };
}

export function classifySalesResponse(value: string): SalesResponseClassification {
  const normalized = value.trim().toLowerCase();
  const allowed: SalesResponseClassification[] = [
    'positive',
    'interested',
    'needs_information',
    'not_now',
    'price_concern',
    'already_has_supplier',
    'not_interested',
    'unsubscribe',
    'wrong_contact',
    'out_of_office',
  ];

  if (!allowed.includes(normalized as SalesResponseClassification)) {
    throw new Error(`Unsupported sales response classification: ${value}`);
  }

  return normalized as SalesResponseClassification;
}

export function nextSalesActionForResponse(classification: SalesResponseClassification): string {
  switch (classification) {
    case 'positive':
    case 'interested':
      return 'prepare_discovery';
    case 'needs_information':
      return 'prepare_relevant_information';
    case 'not_now':
      return 'move_to_nurture';
    case 'price_concern':
      return 'clarify_value_and_scope';
    case 'already_has_supplier':
      return 'assess_complementary_fit';
    case 'not_interested':
      return 'close_lost';
    case 'unsubscribe':
      return 'do_not_contact';
    case 'wrong_contact':
      return 'research_correct_contact';
    case 'out_of_office':
      return 'reschedule_follow_up';
  }
}
