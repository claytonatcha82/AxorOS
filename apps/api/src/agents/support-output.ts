export interface SupportOutput {
  supportRequestId: string;
  clientId: string;
  classification: string;
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  entitlementStatus: 'included' | 'commercial_review' | 'not_entitled';
  issueSummary: string;
  evidence: string[];
  diagnosis: string;
  actionTaken: string;
  validationResult: string;
  clientCommunication: string;
  escalationStatus: 'none' | 'operations' | 'production' | 'sales' | 'executive' | 'human';
  followupRequired: boolean;
  commercialOpportunity: string | null;
  knowledgeReferences: string[];
  closed: boolean;
}

export function validateSupportOutput(output: SupportOutput): string[] {
  const errors: string[] = [];
  if (!output.supportRequestId.trim()) errors.push('supportRequestId is required.');
  if (!output.clientId.trim()) errors.push('clientId is required.');
  if (!output.issueSummary.trim()) errors.push('issueSummary is required.');
  if (output.closed && !output.validationResult.trim()) errors.push('closed support requests require validationResult.');
  if (output.closed && !output.clientCommunication.trim()) errors.push('closed support requests require clientCommunication.');
  return errors;
}

export interface MaintenanceDecision {
  changeType: 'content' | 'dependency' | 'security_patch' | 'configuration' | 'production_code';
  testPassed: boolean;
  approvalGranted: boolean;
}

export function maintenanceAction(input: MaintenanceDecision): 'block' | 'approval_required' | 'apply' {
  if (!input.testPassed) return 'block';
  if (input.changeType === 'production_code' || input.changeType === 'security_patch' || input.changeType === 'dependency') {
    return input.approvalGranted ? 'apply' : 'approval_required';
  }
  return 'apply';
}
