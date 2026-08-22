import type { OperationalRepository } from '../data/operational-repository.js';

export interface SalesCommercialCloseFinanceGateResult {
  eligible: boolean;
  salesCommercialCloseRecordId: string;
  financeClearanceRecordId: string | null;
  leadId: string;
  financeClearanceRequired: true;
  financeCleared: boolean;
  productionAuthorised: false;
  nextAction: 'await_finance_clearance' | 'request_operations_production_readiness';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

export function createSalesCommercialCloseFinanceGateService(
  repository: Pick<OperationalRepository, 'getWorkflowEventById'>,
) {
  return {
    async evaluate(
      salesCommercialCloseRecordId: string,
      financeClearanceRecordId?: string | null,
    ): Promise<SalesCommercialCloseFinanceGateResult> {
      const salesRecordId = requiredString(salesCommercialCloseRecordId, 'salesCommercialCloseRecordId');
      const salesRecord = await repository.getWorkflowEventById(salesRecordId);
      if (!salesRecord) throw new Error(`Sales commercial close record ${salesRecordId} was not found.`);
      if (salesRecord.eventType !== 'sales_commercial_close_recorded') {
        throw new Error('Finance gating requires a persisted Sales commercial close record.');
      }
      if (salesRecord.actorType !== 'agent' || salesRecord.actorId !== 'sales_agent') {
        throw new Error('Commercial close evidence must originate from the Sales Agent boundary.');
      }
      if (!salesRecord.payload || typeof salesRecord.payload !== 'object' || Array.isArray(salesRecord.payload)) {
        throw new Error('Sales commercial close payload is invalid.');
      }

      const salesPayload = salesRecord.payload as Record<string, unknown>;
      const leadId = requiredString(salesPayload.leadId, 'leadId');
      if (salesPayload.commercialOutcome !== 'accepted') {
        throw new Error('Finance gating requires an accepted commercial outcome.');
      }
      if (salesPayload.productionAuthorised !== false || salesPayload.paymentConfirmed !== false) {
        throw new Error('Sales commercial close must not grant payment confirmation or Production authority.');
      }

      const normalizedFinanceRecordId = financeClearanceRecordId?.trim() || null;
      if (!normalizedFinanceRecordId) {
        return {
          eligible: false,
          salesCommercialCloseRecordId: salesRecord.id,
          financeClearanceRecordId: null,
          leadId,
          financeClearanceRequired: true,
          financeCleared: false,
          productionAuthorised: false,
          nextAction: 'await_finance_clearance',
        };
      }

      const financeRecord = await repository.getWorkflowEventById(normalizedFinanceRecordId);
      if (!financeRecord) throw new Error(`Finance clearance record ${normalizedFinanceRecordId} was not found.`);
      if (financeRecord.eventType !== 'finance_clearance_recorded') {
        throw new Error('Production readiness requires a persisted Finance clearance record.');
      }
      if (financeRecord.actorType !== 'agent' || financeRecord.actorId !== 'finance_agent') {
        throw new Error('Finance clearance must originate from the Finance Agent boundary.');
      }
      if (!financeRecord.payload || typeof financeRecord.payload !== 'object' || Array.isArray(financeRecord.payload)) {
        throw new Error('Finance clearance payload is invalid.');
      }

      const financePayload = financeRecord.payload as Record<string, unknown>;
      if (requiredString(financePayload.leadId, 'finance leadId') !== leadId) {
        throw new Error('Finance clearance does not belong to the Sales commercial close lead.');
      }
      if (financePayload.clearanceStatus !== 'cleared' || financePayload.paymentConfirmed !== true) {
        throw new Error('Production readiness requires cleared Finance evidence with confirmed payment.');
      }

      return {
        eligible: true,
        salesCommercialCloseRecordId: salesRecord.id,
        financeClearanceRecordId: financeRecord.id,
        leadId,
        financeClearanceRequired: true,
        financeCleared: true,
        productionAuthorised: false,
        nextAction: 'request_operations_production_readiness',
      };
    },
  };
}

export type SalesCommercialCloseFinanceGateService = ReturnType<
  typeof createSalesCommercialCloseFinanceGateService
>;
