export type SupportIncidentState = 'detected' | 'confirmed' | 'contained' | 'diagnosing' | 'resolved' | 'validated' | 'communicated' | 'reviewed';

export const SUPPORT_INCIDENT_TRANSITIONS: Record<SupportIncidentState, readonly SupportIncidentState[]> = {
  detected: ['confirmed'], confirmed: ['contained', 'diagnosing'], contained: ['diagnosing'], diagnosing: ['resolved'],
  resolved: ['validated'], validated: ['communicated'], communicated: ['reviewed'], reviewed: [],
};

export function canTransitionSupportIncident(from: SupportIncidentState, to: SupportIncidentState): boolean {
  return SUPPORT_INCIDENT_TRANSITIONS[from].includes(to);
}

export interface RecoveryDecision {
  knownSafeRecovery: boolean;
  heavilyTested: boolean;
  authorised: boolean;
  securityIncident: boolean;
}

export function recoveryAuthority(input: RecoveryDecision): 'recommend_for_approval' | 'execute_and_verify' | 'mandatory_escalation' {
  if (input.securityIncident) return 'mandatory_escalation';
  if (input.knownSafeRecovery && input.heavilyTested && input.authorised) return 'execute_and_verify';
  return 'recommend_for_approval';
}

export function resolutionMayBeClaimed(verified: boolean): boolean {
  return verified;
}
