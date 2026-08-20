import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import pg from 'pg';
import { createOperationalRepository } from '../apps/api/dist/data/operational-repository.js';
import { SalesEmailSendAttemptPostgresStore } from '../apps/api/dist/data/sales-email-send-attempt-postgres-store.js';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';
import { createSalesInternalOutreachDraftService } from '../apps/api/dist/services/sales-internal-outreach-draft-service.js';
import { createSalesOutreachDraftReviewService } from '../apps/api/dist/services/sales-outreach-draft-review-service.js';
import { createSalesSupervisedSendGateService } from '../apps/api/dist/services/sales-supervised-send-gate-service.js';
import { createSalesIntegrationEmailTransport } from '../apps/api/dist/services/sales-integration-email-transport.js';
import { createSalesSupervisedEmailExecutionService } from '../apps/api/dist/services/sales-supervised-email-execution-service.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL?.trim();
const clientId = process.env.AXOROS_GMAIL_CLIENT_ID?.trim();
const clientSecret = process.env.AXOROS_GMAIL_CLIENT_SECRET?.trim();
const refreshToken = process.env.AXOROS_GMAIL_REFRESH_TOKEN?.trim();
const identitiesJson = process.env.AXOROS_GMAIL_IDENTITY_ADDRESSES?.trim();
const supervisedFlag = process.env.AXOROS_GMAIL_SUPERVISED_SALES_SEND?.trim();

if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required via Infisical.');
if (!clientId || !clientSecret || !refreshToken || !identitiesJson) {
  throw new Error('Complete AXOROS_GMAIL_* configuration is required via Infisical.');
}
if (supervisedFlag !== 'enabled') {
  throw new Error('AXOROS_GMAIL_SUPERVISED_SALES_SEND must be explicitly enabled for this verifier.');
}

let identityAddresses;
try {
  identityAddresses = JSON.parse(identitiesJson);
} catch {
  throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.');
}
const salesAddress = typeof identityAddresses?.sales === 'string' ? identityAddresses.sales.trim() : '';
if (!salesAddress) throw new Error('A configured sales Gmail identity is required.');

function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[masked-invalid-address]';
  return `${local.slice(0, 1)}***@${domain}`;
}

const pool = new Pool({
  connectionString,
  max: 1,
  application_name: 'axoros-sales-gmail-supervised-self-send-verifier',
});
const readline = createInterface({ input, output });

try {
  const repository = createOperationalRepository(pool);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const lead = await repository.createLead({
    companyName: 'AxorOS Controlled Self-Send Verification',
    contactName: 'AxorOS Human Executive',
    contactEmail: salesAddress,
    source: 'axoros_controlled_self_send_verification',
    opportunitySummary: 'Synthetic self-addressed verification only. No prospect or client data.',
    evidence: [{ testOnly: true, recipientPolicy: 'configured_sales_identity_only' }],
  });

  const eligibility = {
    eligible: true,
    assessmentRecordId: `self-send-assessment:${suffix}`,
    leadId: lead.id,
    salesIntakeExecutionId: `self-send-sales-intake:${suffix}`,
    atlasSourcePaths: ['atlas://controlled/sales-gmail-self-send-verification'],
    preparationOnly: true,
    outreachAuthorised: false,
    sendAuthorised: false,
    pricingAuthorised: false,
    commercialCommitmentAuthorised: false,
    nextAction: 'prepare_internal_outreach_draft',
  };

  const draftService = createSalesInternalOutreachDraftService(repository);
  const draftOutcome = await draftService.create({
    eligibility,
    subject: '[AxorOS TEST] Governed supervised Sales self-send verification',
    body: [
      'This is a controlled AxorOS supervised Sales email verification.',
      'It was sent only to the configured AxorOS Sales mailbox after two separate Human Executive approvals.',
      'No prospect or client data was used.',
      'No pricing or commercial commitment is authorised by this message.',
    ].join('\n\n'),
  });

  if (draftOutcome.draft.recipientEmail.trim().toLowerCase() !== salesAddress.toLowerCase()) {
    throw new Error('SELF-SEND SAFETY BLOCK: persisted draft recipient does not equal the configured Sales identity.');
  }

  console.log('\nAxorOS CONTROLLED LIVE SALES EMAIL VERIFICATION');
  console.log('------------------------------------------------');
  console.log(`Recipient: ${maskEmail(draftOutcome.draft.recipientEmail)}`);
  console.log(`Subject: ${draftOutcome.draft.subject}`);
  console.log(`Draft record: ${draftOutcome.record.id}`);
  console.log('Prospect/client recipient: NO');
  console.log('Pricing authority: NO');
  console.log('Commercial commitment authority: NO');

  const draftApproval = (await readline.question('\nHuman Executive draft review — type APPROVE_DRAFT to approve this exact persisted draft: ')).trim();
  if (draftApproval !== 'APPROVE_DRAFT') {
    throw new Error('Draft review was not explicitly approved. No email was sent.');
  }

  const reviewService = createSalesOutreachDraftReviewService(repository);
  const reviewOutcome = await reviewService.review(draftOutcome.record.id, 'approved');
  if (reviewOutcome.review.sendAuthorised !== false) {
    throw new Error('SAFETY BLOCK: draft review unexpectedly granted send authority.');
  }

  console.log('\nPASS  Human Executive draft review persisted.');
  console.log('PASS  Draft review still has sendAuthorised=false.');

  const sendApproval = (await readline.question('Human Executive send gate — type APPROVE_SEND to authorise ONE self-addressed live send: ')).trim();
  if (sendApproval !== 'APPROVE_SEND') {
    throw new Error('Supervised send was not explicitly approved. No email was sent.');
  }

  const sendGateService = createSalesSupervisedSendGateService(repository);
  const gateOutcome = await sendGateService.decide(reviewOutcome.record.id, 'approved');
  if (gateOutcome.gate.sendAuthorised !== true || gateOutcome.gate.supervised !== true) {
    throw new Error('SAFETY BLOCK: persisted send gate is not an explicitly supervised approved gate.');
  }

  const persistedDraft = await repository.getWorkflowEventById(gateOutcome.gate.draftRecordId);
  const persistedPayload = persistedDraft?.payload;
  const persistedRecipient = persistedPayload && typeof persistedPayload === 'object' && !Array.isArray(persistedPayload)
    ? persistedPayload.recipientEmail
    : undefined;
  if (typeof persistedRecipient !== 'string' || persistedRecipient.trim().toLowerCase() !== salesAddress.toLowerCase()) {
    throw new Error('SELF-SEND SAFETY BLOCK: persisted send-gate draft recipient is not the configured Sales identity.');
  }

  const { registry } = createConfiguredIntegrationRegistry({
    environment: 'development',
    host: '127.0.0.1',
    port: 3001,
    controlCenterUrl: 'http://localhost:5173',
    databaseUrl: connectionString,
    gmailClientId: clientId,
    gmailClientSecret: clientSecret,
    gmailRefreshToken: refreshToken,
    gmailIdentityAddresses: identityAddresses,
    gmailSupervisedSalesSendEnabled: true,
  });
  const transport = createSalesIntegrationEmailTransport(registry);
  const sendAttempts = new SalesEmailSendAttemptPostgresStore(pool);
  const executionService = createSalesSupervisedEmailExecutionService(repository, transport, sendAttempts);

  const sent = await executionService.execute(gateOutcome.record.id);

  console.log('\nPASS  Governed supervised Sales self-send completed.');
  console.log(`Recipient: ${maskEmail(sent.execution.recipientEmail)}`);
  console.log(`Send gate record: ${sent.execution.sendGateRecordId}`);
  console.log(`Sent audit record: ${sent.record.id}`);
  console.log(`Provider message ID recorded: ${Boolean(sent.execution.providerMessageId) ? 'YES' : 'NO'}`);
  console.log(`Human send approval verified: ${sent.execution.humanSendApprovalVerified ? 'YES' : 'NO'}`);
  console.log(`Supervised: ${sent.execution.supervised ? 'YES' : 'NO'}`);
  console.log(`Pricing authorised: ${sent.execution.pricingAuthorised ? 'YES' : 'NO'}`);
  console.log(`Commercial commitment authorised: ${sent.execution.commercialCommitmentAuthorised ? 'YES' : 'NO'}`);
  console.log('\nThis verifier sent exactly one message to the configured Sales mailbox.');
  console.log('No prospect or client recipient was permitted.');
} finally {
  readline.close();
  await pool.end().catch(() => undefined);
}
