import type { ExternalIntegration, IntegrationMode } from './integration-contract.js';

export type EmailIntegrationOperation = 'create_draft' | 'send_email';

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailMessageInput {
  fromIdentity: string;
  to: readonly EmailRecipient[];
  cc?: readonly EmailRecipient[];
  bcc?: readonly EmailRecipient[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  replyTo?: string;
  threadReference?: string;
}

export interface EmailDraftOutput {
  messageId?: string;
  draftId?: string;
  threadReference?: string;
  fromIdentity: string;
  recipients: readonly string[];
  subject: string;
  preview: string;
}

export type EmailIntegration = ExternalIntegration<EmailMessageInput, EmailDraftOutput>;

export const EMAIL_DRAFT_ONLY_MODES: readonly IntegrationMode[] = ['draft'];

export function validateEmailMessage(input: EmailMessageInput): string[] {
  const errors: string[] = [];
  if (!input.fromIdentity.trim()) errors.push('fromIdentity is required.');
  if (input.to.length === 0) errors.push('at least one recipient is required.');
  if (input.to.some((recipient) => !recipient.email.trim())) errors.push('recipient email is required.');
  if (!input.subject.trim()) errors.push('subject is required.');
  if (!input.textBody.trim()) errors.push('textBody is required.');
  return errors;
}
