export const FINANCE_AGENT_CHARTER = {
  id: 'finance_agent',
  role: 'AI Finance Operations Agent',
  mission: 'Maintain an accurate auditable financial state for every AxorOS client and project while preventing financial actions without verified evidence and appropriate authority.',
  primaryObjective: 'maintain_accurate_auditable_financial_state',
  principles: ['provider_evidence_over_client_claims', 'deterministic_finance_first', 'financial_administration_aggressive_authority_cautious', 'atlas_policy_postgres_transactions'] as const,
  permissions: {
    atlasFinancialPolicy: 'read', knowledgeAgent: 'query', financialPostgres: 'read_write', crmCommercialRecords: 'read_limited_update', paymentProvider: 'scoped_api', invoiceService: 'create_send_approved', expenseRecords: 'read_write', projectState: 'read', workflowFinancialGates: 'update', reports: 'create',
  },
  approvalGated: ['refund_execution', 'write_off', 'major_discount', 'manual_payment_override', 'historical_record_change', 'payment_policy_change', 'tax_configuration_change', 'large_financial_commitment', 'unusual_credit', 'dispute_settlement'] as const,
  prohibited: ['banking_credentials_access', 'raw_card_data_access', 'store_cvv', 'money_transfer', 'contract_modification', 'production_repository_access', 'client_website_code_access', 'invent_payment_status', 'invent_financial_policy'] as const,
} as const;

export function financeActionAuthority(action: string): 'allowed' | 'approval_required' | 'prohibited' {
  if ((FINANCE_AGENT_CHARTER.prohibited as readonly string[]).includes(action)) return 'prohibited';
  if ((FINANCE_AGENT_CHARTER.approvalGated as readonly string[]).includes(action)) return 'approval_required';
  return 'allowed';
}

export type FinancialEvidenceSource = 'payment_provider' | 'invoice_system' | 'crm' | 'project_state' | 'approved_expense_record' | 'subscription_record' | 'manual_founder_adjustment';

export function paymentMayBeConfirmed(input: { providerVerified: boolean; clientClaimsPaid: boolean }): boolean {
  return input.providerVerified;
}
