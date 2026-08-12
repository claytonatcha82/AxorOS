export interface ClientSupportMemory {
  clientId: string;
  websites: string[];
  technology: string[];
  supportPlan: string;
  preferences: string[];
  knownIssues: string[];
  pastIncidents: string[];
  maintenanceHistory: string[];
  approvedContacts: string[];
  openRequests: string[];
  renewalDates: string[];
}

export function validateClientSupportMemory(memory: ClientSupportMemory): string[] {
  const errors: string[] = [];
  if (!memory.clientId.trim()) errors.push('clientId is required.');
  if (!memory.supportPlan.trim()) errors.push('supportPlan is required.');
  return errors;
}

export function mayAccessClientSupportMemory(requestingClientId: string, memory: ClientSupportMemory): boolean {
  return Boolean(requestingClientId.trim()) && requestingClientId === memory.clientId;
}

export interface CredentialAccessRequest {
  clientId: string;
  credentialReference: string;
  authorised: boolean;
}

export function credentialAccessMode(request: CredentialAccessRequest): 'deny' | 'temporary_authorised_access' {
  if (!request.authorised || !request.clientId.trim() || !request.credentialReference.trim()) return 'deny';
  return 'temporary_authorised_access';
}
