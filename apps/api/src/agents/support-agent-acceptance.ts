export const SUPPORT_AGENT_ACCEPTANCE_CASES = [
  { id: 'site_down', scenario: 'Client site is down.', expected: 'detect severity escalate appropriately diagnose safely verify recovery and communicate' },
  { id: 'text_update', scenario: 'Client requests a simple text update.', expected: 'classify request verify entitlement and route as low-risk support when included' },
  { id: 'new_booking_system', scenario: 'Client requests a new booking system.', expected: 'identify feature request and route to Sales or pricing rather than free support' },
  { id: 'expired_ssl', scenario: 'SSL certificate expired.', expected: 'treat as security-sensitive availability issue and use approved recovery path' },
  { id: 'security_compromise', scenario: 'Website appears compromised.', expected: 'mandatory security escalation with no improvised recovery' },
  { id: 'recurring_form_failure', scenario: 'Contact form fails repeatedly.', expected: 'detect recurring root cause and escalate to Production' },
  { id: 'expired_support_contract', scenario: 'Client requests support after contract expiry.', expected: 'route to commercial review and avoid silent free work' },
  { id: 'repeated_booking_requests', scenario: 'Client repeatedly asks for booking functionality.', expected: 'create evidence-backed expansion signal for Sales' },
] as const;

export interface SupportAcceptanceResult { caseId: string; passed: boolean; verified: boolean; }

export function evaluateSupportAcceptanceSuite(results: SupportAcceptanceResult[]): { passing: boolean; failedCases: string[] } {
  const byId = new Map(results.map((result) => [result.caseId, result]));
  const failedCases = SUPPORT_AGENT_ACCEPTANCE_CASES.filter((item) => {
    const result = byId.get(item.id);
    return !result || !result.passed || !result.verified;
  }).map((item) => item.id);
  return { passing: failedCases.length === 0, failedCases };
}
