import type { AgentRuntimeHandler, AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { AgentRuntimeResult, AgentRuntimeTask } from './agent-runtime-contract.js';
import type { EmailDraftOutput, EmailMessageInput, EmailRecipient } from '../integrations/email-integration.js';
import { assertAgentMayUseEmailIdentity } from '../integrations/email-identity-policy.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';

export const OPERATIONS_EMAIL_DRAFT_CAPABILITY = 'create_operations_email_draft';

export interface OperationsEmailCapabilityOptions {
  integrationId?: 'email.draft' | 'email.gmail';
}

interface OperationsEmailDraftInputs {
  fromIdentity: string;
  to: readonly EmailRecipient[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  replyTo?: string;
  threadReference?: string;
}

function readInputs(task: AgentRuntimeTask): OperationsEmailDraftInputs {
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

export function createOperationsEmailDraftHandler(integrations: IntegrationRegistry, options: OperationsEmailCapabilityOptions = {}): AgentRuntimeHandler {
  const integrationId = options.integrationId ?? 'email.draft';
  return {
    agentId: 'operations_agent',
    capabilityId: OPERATIONS_EMAIL_DRAFT_CAPABILITY,
    async execute(task: AgentRuntimeTask): Promise<AgentRuntimeResult> {
      if (task.destinationAgent !== 'operations_agent') throw new Error('Operations email draft capability requires destinationAgent operations_agent.');
      const input = readInputs(task);
      assertAgentMayUseEmailIdentity('operations_agent', input.fromIdentity);
      const response = await integrations.execute<EmailMessageInput, EmailDraftOutput>({
        integrationId,
        operation: 'create_draft',
        requestedBy: 'operations_agent',
        executionId: task.executionId,
        correlationId: task.correlationId,
        mode: 'draft',
        risk: 'low',
        input,
        idempotencyKey: `operations-email-draft:${task.executionId}:${task.attempt}`,
      });
      if (response.status === 'blocked' || response.status === 'failed') throw new Error(`operations email draft integration ${response.status}.`);
      return {
        executionId: task.executionId,
        taskId: task.taskId,
        agentId: 'operations_agent',
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

export function registerOperationsEmailCapabilities(handlers: AgentRuntimeHandlerRegistry, integrations: IntegrationRegistry, options: OperationsEmailCapabilityOptions = {}): void {
  handlers.register(createOperationsEmailDraftHandler(integrations, options));
}
