export const FINANCE_AGENT_ACCEPTANCE_CASES = [
  ['deposit_success', 'Provider confirms deposit; record verified payment, update invoice and pass configured production gate.'],
  ['client_claim_no_confirmation', 'Client claims payment but provider has not confirmed; retain pending state and investigate.'],
  ['duplicate_webhook', 'Duplicate provider event is idempotently rejected without duplicate revenue.'],
  ['invoice_proposal_mismatch', 'Invoice request differing from approved commercial record is blocked and escalated.'],
  ['partial_payment', 'Partial payment is recorded and gate passes only when configured requirement is met.'],
  ['refund_request', 'Refund is policy checked and prepared but execution requires human approval.'],
  ['provider_failure', 'Provider failure preserves last known state, retries verification and escalates unresolved exceptions.'],
  ['change_request', 'Additional work follows change request, pricing, approval, invoice and finance clearance before gated production.'],
  ['foreign_currency', 'Original currency and amount are preserved and settlement data is recorded without LLM-estimated exchange rates.'],
  ['unprofitable_ai_spend', 'Poor margin caused by AI spend is flagged and fed to Pricing and Executive.'],
  ['subscription_failure', 'Failed recurring payment changes subscription state and notifies Support and Operations under policy.'],
  ['manual_payment', 'Manual payment requires evidence, authorised adjustment and immutable audit trail.'],
] as const;

export interface FinanceAcceptanceResult { caseId: string; passed: boolean; verified: boolean; }
export function evaluateFinanceAcceptanceSuite(results: FinanceAcceptanceResult[]): { passing: boolean; failedCases: string[] } {
  const byId = new Map(results.map((result) => [result.caseId, result]));
  const failedCases = FINANCE_AGENT_ACCEPTANCE_CASES.filter(([id]) => { const result = byId.get(id); return !result || !result.passed || !result.verified; }).map(([id]) => id);
  return { passing: failedCases.length === 0, failedCases };
}
