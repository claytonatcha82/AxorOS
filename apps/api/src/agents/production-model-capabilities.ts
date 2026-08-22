import type { Pool } from 'pg';
import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerModelRuntimeCapability } from './model-runtime-registration.js';
import {
  assertProductionProjectPlanContext,
  PRODUCTION_PROJECT_PLAN_CAPABILITY,
  PRODUCTION_PROJECT_PLAN_SYSTEM_INSTRUCTION,
} from './production-project-plan-capability.js';
import { DEFAULT_PRODUCTION_MODEL_POLICY, type ProductionModelPolicy } from './production-model-policy.js';
import { assertTrustedProductionFinanceGate } from './trusted-production-finance-gate.js';
import { assertTrustedProductionOperationsGate } from './trusted-production-operations-gate.js';
import { assertTrustedProductionPlanGate } from './trusted-production-plan-gate.js';
import type { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import type { FinancePaymentCurrentStatePostgresStore } from '../data/finance-payment-current-state-postgres-store.js';
import type { CommercialPaymentRequirementPostgresStore } from '../data/commercial-payment-requirement-postgres-store.js';
import type { CommercialPaymentSatisfactionPostgresStore } from '../data/commercial-payment-satisfaction-postgres-store.js';
import type { OperationsProductionReadinessPostgresStore } from '../data/operations-production-readiness-postgres-store.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export const PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY = 'draft_technical_implementation';

export function registerProductionModelCapabilities(
  handlers: AgentRuntimeHandlerRegistry,
  integrations: IntegrationRegistry,
  financeClearanceStore: Pick<FinanceClearancePostgresStore, 'get'>,
  financePaymentStateStore: Pick<FinancePaymentCurrentStatePostgresStore, 'get'>,
  commercialPaymentRequirementStore: Pick<CommercialPaymentRequirementPostgresStore, 'get'>,
  commercialPaymentSatisfactionStore: Pick<CommercialPaymentSatisfactionPostgresStore, 'get'>,
  operationsReadinessStore?: Pick<OperationsProductionReadinessPostgresStore, 'get'>,
  runtimeEvidencePool?: Pick<Pool, 'query'>,
  modelPolicy: ProductionModelPolicy = DEFAULT_PRODUCTION_MODEL_POLICY,
): void {
  const assertProductionStartGate = async (task: Parameters<typeof assertTrustedProductionFinanceGate>[0]) => {
    await assertTrustedProductionFinanceGate(task, financeClearanceStore, financePaymentStateStore, commercialPaymentRequirementStore, commercialPaymentSatisfactionStore);
    await assertTrustedProductionOperationsGate(task, operationsReadinessStore);
  };

  registerModelRuntimeCapability(handlers, integrations, {
    agentId: 'production_agent',
    capabilityId: PRODUCTION_PROJECT_PLAN_CAPABILITY,
    integrationId: modelPolicy.projectPlanningIntegrationId,
    mode: 'draft',
    promptInputKey: 'projectPackage',
    contextInputKey: 'atlasContext',
    beforeExecute: async (task) => {
      await assertProductionStartGate(task);
      assertProductionProjectPlanContext(task);
    },
    systemInstruction: PRODUCTION_PROJECT_PLAN_SYSTEM_INSTRUCTION,
    maxOutputTokens: 1400,
    temperature: 0.15,
  });

  registerModelRuntimeCapability(handlers, integrations, {
    agentId: 'production_agent',
    capabilityId: PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY,
    integrationId: modelPolicy.technicalImplementationIntegrationId,
    mode: 'draft',
    promptInputKey: 'implementationBrief',
    contextInputKey: 'technicalContext',
    beforeExecute: async (task) => {
      await assertProductionStartGate(task);
      await assertTrustedProductionPlanGate(task, runtimeEvidencePool ? { pool: runtimeEvidencePool } : {});
    },
    systemInstruction: [
      'You are the AxorOS Production Agent operating in governed draft mode.',
      'Draft technical implementation only after a trusted completed Production project plan has been verified from persisted runtime evidence.',
      'Provide implementation guidance, code drafts, content drafts, test ideas, and delivery analysis only from the supplied requirements, approved plan, and governed context.',
      'Do not invent client facts, requirements, assets, credentials, approvals, integrations, domains, hosting details, legal claims, commercial terms, or deployment state.',
      'Do not deploy, publish, merge, push, modify production infrastructure, rotate credentials, purchase services, register domains, or trigger any external side effect.',
      'Do not claim QA passed, security passed, deployment succeeded, a site is live, or a production gate is satisfied unless verified evidence is supplied.',
      'Respect the Production start gate: do not treat work as authorized for delivery unless trusted Finance and Operations evidence confirms the required commercial and operational prerequisites.',
      'Prefer approved AxorOS templates and component patterns when they are explicitly supplied in context; otherwise identify the missing reference rather than inventing one.',
      'Clearly identify assumptions, missing requirements, risks, and validation steps before any production action.',
      'Return only the requested technical draft or implementation analysis for governed downstream execution.',
    ].join(' '),
    maxOutputTokens: 1024,
    temperature: 0.2,
  });
}
