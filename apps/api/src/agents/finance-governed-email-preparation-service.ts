import type { EmailRecipient } from '../integrations/email-integration.js';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { applyFinanceEmailRuntimeApprovalPolicy } from './finance-email-runtime-approval.js';
import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';

export interface FinanceGovernedEmailPreparationDependencies {
  communicationDraftService: {
    draft(input: {
      executionId: string;
      correlationId: string;
      decision: FinanceGovernedOperationalDecision;
    }): Promise<{
      policy: {
        intent: string;
        operationalState: string;
        humanApprovalRequired: true;
        sendAuthorised: false;
        evidenceReferences: string[];
      };
      draftText: string;
      evidenceReferences: string[];
      knowledgeReferences: string[];
    }>;
  };
}

export interface FinanceGovernedEmailPreparationInput {
  executionId: string;
  correlationId: string;
  decision: FinanceGovernedOperationalDecision;
  to: readonly EmailRecipient[];
  subject: string;
  fromIdentity?: string;
  createdAt?: string;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function createFinanceGovernedEmailPreparationService(
  dependencies: FinanceGovernedEmailPreparationDependencies,
) {
  return {
    async prepare(input: FinanceGovernedEmailPreparationInput): Promise<AgentRuntimeTask> {
      if (!Array.isArray(input.to) || input.to.length === 0) {
        throw new Error('Finance governed email preparation requires at least one recipient.');
      }

      const executionId = required(input.executionId, 'Finance email executionId');
      const correlationId = required(input.correlationId, 'Finance email correlationId');
      const subject = required(input.subject, 'Finance email subject');
      const fromIdentity = required(input.fromIdentity ?? 'finance', 'Finance email identity');
      const createdAt = input.createdAt ?? new Date().toISOString();

      const drafted = await dependencies.communicationDraftService.draft({
        executionId: `model:${executionId}`,
        correlationId,
        decision: input.decision,
      });

      if (!drafted.policy.humanApprovalRequired || drafted.policy.sendAuthorised) {
        throw new Error('Finance governed communication policy must require Human Executive approval and forbid direct send.');
      }

      const rawTask: AgentRuntimeTask = {
        taskId: `task:${executionId}`,
        executionId,
        originAgent: 'finance_agent',
        destinationAgent: 'finance_agent',
        objective: `Create governed Finance Gmail draft for ${drafted.policy.intent}.`,
        priority: 'normal',
        context: {
          financeGovernedCommunication: {
            operationalState: drafted.policy.operationalState,
            intent: drafted.policy.intent,
            evidenceReferences: drafted.policy.evidenceReferences,
            sourceCommercialRecordReference: input.decision.commercialRecordReference,
            gate: input.decision.gate,
            sendAuthorised: false,
          },
        },
        knowledgeReferences: [...drafted.knowledgeReferences],
        inputs: {
          fromIdentity,
          to: [...input.to],
          subject,
          textBody: drafted.draftText,
        },
        expectedOutput: 'One Human Executive-approved Finance Gmail draft',
        dependencies: [],
        risks: [],
        confidence: 1,
        approvalRequired: false,
        status: 'ready',
        nextAction: 'apply_finance_email_policy',
        attempt: 1,
        maxAttempts: 1,
        correlationId,
        createdAt,
        updatedAt: createdAt,
      };

      return applyFinanceEmailRuntimeApprovalPolicy(rawTask);
    },
  };
}
