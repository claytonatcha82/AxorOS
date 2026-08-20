import type { EmailDraftOutput, EmailMessageInput } from '../integrations/email-integration.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { SalesEmailMessage, SalesEmailSendContext, SalesEmailTransport } from './sales-supervised-email-execution-service.js';

function requiredString(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

export function createSalesIntegrationEmailTransport(
  integrations: Pick<IntegrationRegistry, 'execute'>,
): SalesEmailTransport {
  return {
    async send(message: SalesEmailMessage, context: SalesEmailSendContext) {
      const response = await integrations.execute<EmailMessageInput, EmailDraftOutput>({
        integrationId: 'email.gmail',
        operation: 'send_email',
        requestedBy: 'sales_agent',
        executionId: requiredString(context.executionId, 'executionId'),
        correlationId: requiredString(context.correlationId, 'correlationId'),
        mode: 'live',
        risk: 'medium',
        idempotencyKey: requiredString(context.idempotencyKey, 'idempotencyKey'),
        input: {
          fromIdentity: 'sales',
          to: [{ email: requiredString(message.to, 'message.to') }],
          subject: requiredString(message.subject, 'message.subject'),
          textBody: requiredString(message.body, 'message.body'),
        },
      });

      if (response.status !== 'succeeded') {
        throw new Error(`supervised Sales email integration ${response.status}.`);
      }

      const providerMessageId = requiredString(response.output.messageId, 'providerMessageId');
      const providerThreadReference = requiredString(response.output.threadReference, 'providerThreadReference');
      return { providerMessageId, providerThreadReference };
    },
  };
}
