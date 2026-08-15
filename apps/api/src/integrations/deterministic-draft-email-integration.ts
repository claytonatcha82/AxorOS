import type { IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import type { EmailDraftOutput, EmailIntegration, EmailMessageInput } from './email-integration.js';
import { validateEmailMessage } from './email-integration.js';

export class DeterministicDraftEmailIntegration implements EmailIntegration {
  readonly integrationId = 'email.draft';
  readonly kind = 'email' as const;
  readonly provider = 'deterministic-draft-email';
  readonly supportedModes = ['draft'] as const;
  readonly supportedOperations = ['create_draft'] as const;

  async execute(
    request: IntegrationRequest<EmailMessageInput>,
  ): Promise<IntegrationResponse<EmailDraftOutput>> {
    if (request.mode !== 'draft') {
      return this.blocked(request, 'Draft email integration only supports draft mode.');
    }
    if (request.operation !== 'create_draft') {
      return this.blocked(request, 'Draft email integration cannot send email.');
    }

    const errors = validateEmailMessage(request.input);
    if (errors.length > 0) return this.blocked(request, errors.join(' '));

    const recipients = request.input.to.map((recipient) => recipient.email.trim());
    return {
      integrationId: this.integrationId,
      operation: request.operation,
      provider: this.provider,
      mode: request.mode,
      status: 'drafted',
      output: {
        draftId: `draft:${request.executionId}`,
        fromIdentity: request.input.fromIdentity,
        recipients,
        subject: request.input.subject,
        preview: request.input.textBody.slice(0, 160),
      },
      evidenceReferences: [`email-draft:${request.executionId}`],
      retryable: false,
    };
  }

  private blocked(
    request: IntegrationRequest<EmailMessageInput>,
    reason: string,
  ): IntegrationResponse<EmailDraftOutput> {
    return {
      integrationId: this.integrationId,
      operation: request.operation,
      provider: this.provider,
      mode: request.mode,
      status: 'blocked',
      output: {
        fromIdentity: request.input.fromIdentity,
        recipients: request.input.to.map((recipient) => recipient.email),
        subject: request.input.subject,
        preview: reason,
      },
      evidenceReferences: [],
      retryable: false,
    };
  }
}
