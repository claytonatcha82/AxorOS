import type { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { AgentRuntimeHandler } from './agent-runtime-handlers.js';
import type { AgentRuntimeResult, AgentRuntimeTask } from './agent-runtime-contract.js';
import type { EmailDraftOutput, EmailMessageInput, EmailRecipient } from '../integrations/email-integration.js';
import { assertAgentMayUseEmailIdentity } from '../integrations/email-identity-policy.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export const SALES_EMAIL_DRAFT_CAPABILITY = 'create_sales_email_draft';

interface SalesEmailDraftInputs {
  fromIdentity: string;
  to: readonly EmailRecipient[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  replyTo?: string;
  threadReference?: string;
}

function readInputs(task: AgentRuntimeTask): SalesEmailDraftInputs {
  const { fromIdentity, to, subject, textBody, htmlBody, replyTo, threadReference } = task.inputs as Record<string, unknown>;
  if (typeof fromIdentity !== 'string' || !fromIdentity.trim()) throw new Error('fromIdentity is required.');
  if (!Array.isArray(to) || to.length === 0) throw new Error('to is required.');
  if (typeof subject !== 'string' || !subject.trim()) throw new Error('subject is required.');
  if (typeof textBody !== 'string' || !textBody.trim()) throw new Error('textBody is required.');

  return {
    fromIdentity,
    to: to as readonly EmailRecipient[],
    subject,
    textBody,
    ...(typeof htmlBody === 'string' ? { htmlBody } : {}),
    ...(typeof replyTo === 'string' ? { replyTo } : {}),
    ...(typeof threadReference === 'string' ? { threadReference } : {}),
  };
}

export function createSalesEmailDraftHandler(integrations: IntegrationRegistry): AgentRuntimeHandler {
  return {
    agentId: 'sales_agent',
    capabilityId: SALES_EMAIL_DRAFT_CAPABILITY,
    async execute(task: AgentRuntimeTask): Promise<AgentRuntimeResult> {
      if (task.destinationAgent !== 'sales_agent') {
        throw new Error('Sales email draft capability requires destinationAgent sales_agent.');
      }

      const input = readInputs(task);
      assertAgentMayUseEmailIdentity('sales_agent', input.fromIdentity);

      const response = await integrations.execute<EmailMessageInput, EmailDraftOutput>({
        integrationId: 'email.draft',
        operation: 'create_draft',
        requestedBy: 'sales_agent',
        executionId: task.executionId,
        correlationId: task.correlationId,
        mode: 'draft',
        risk: 'low',
        input,
        idempotencyKey: `sales-email-draft:${task.executionId}:${task.attempt}`,
      });

      if (response.status === 'blocked' || response.status === 'failed') {
        throw new Error(`sales email draft integration ${response.status}.`);
      }

      return {
        executionId: task.executionId,
        taskId: task.taskId,
        agentId: 'sales_agent',
        status: 'completed',
        output: {
          integrationId: response.integrationId,
          provider: response.provider,
          mode: response.mode,
          integrationStatus: response.status,
          draftId: response.output.draftId,
          fromIdentity: response.output.fromIdentity,
          recipients: response.output.recipients,
          subject: response.output.subject,
          preview: response.output.preview,
        },
        evidenceReferences: response.evidenceReferences,
        knowledgeReferences: task.knowledgeReferences,
        confidence: task.confidence,
        completedAt: new Date().toISOString(),
      };
    },
  };
}

export function registerSalesEmailCapabilities(
  handlers: AgentRuntimeHandlerRegistry,
  integrations: IntegrationRegistry,
): void {
  handlers.register(createSalesEmailDraftHandler(integrations));
}
