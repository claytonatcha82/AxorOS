export type ScopeClassification = 'inside_scope' | 'outside_scope' | 'unclear';

export interface ProductionScopeRequest {
  request: string;
  approvedScope: string[];
  excludedScope: string[];
}

export interface ChangeRequestDraft {
  request: string;
  scopeStatus: 'outside_scope';
  pricingRequired: true;
  approvalRequired: true;
  status: 'pending_review';
}

export interface ProductionScopeDecision {
  classification: ScopeClassification;
  allowedToExecute: boolean;
  matchedApprovedScope: string[];
  matchedExcludedScope: string[];
  changeRequest?: ChangeRequestDraft;
  reason: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matches(request: string, scopeItem: string): boolean {
  const normalizedRequest = normalize(request);
  const normalizedScope = normalize(scopeItem);
  if (!normalizedRequest || !normalizedScope) return false;
  return normalizedRequest.includes(normalizedScope) || normalizedScope.includes(normalizedRequest);
}

export function evaluateProductionScope(input: ProductionScopeRequest): ProductionScopeDecision {
  const request = input.request.trim();
  if (!request) throw new Error('request is required.');

  const matchedExcludedScope = input.excludedScope.filter((item) => matches(request, item));
  if (matchedExcludedScope.length > 0) {
    return {
      classification: 'outside_scope',
      allowedToExecute: false,
      matchedApprovedScope: [],
      matchedExcludedScope,
      changeRequest: {
        request,
        scopeStatus: 'outside_scope',
        pricingRequired: true,
        approvalRequired: true,
        status: 'pending_review',
      },
      reason: 'Request matches explicitly excluded scope and requires a priced, approved change request.',
    };
  }

  const matchedApprovedScope = input.approvedScope.filter((item) => matches(request, item));
  if (matchedApprovedScope.length > 0) {
    return {
      classification: 'inside_scope',
      allowedToExecute: true,
      matchedApprovedScope,
      matchedExcludedScope: [],
      reason: 'Request matches approved scope.',
    };
  }

  return {
    classification: 'unclear',
    allowedToExecute: false,
    matchedApprovedScope: [],
    matchedExcludedScope: [],
    reason: 'Request is not traceable to approved scope and must be reviewed before implementation.',
  };
}
