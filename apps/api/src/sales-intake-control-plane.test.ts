import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import type { AgentRuntimeExecutionRecord } from './agents/agent-runtime-state.js';
import type { RuntimeExecutionOutcome } from './agents/agent-runtime-orchestrator.js';
import { createSalesIntakeControlPlaneRequestHandler } from './sales-intake-control-plane-request-handler.js';
import type { SalesOpportunityContext } from './services/sales-opportunity-assessment-service.js';

const controlPlaneToken = 'control-plane-test-token-1234567890abcdef';
const controlCenterUrl = 'http://localhost:5173';
const now = '2026-08-20T17:00:00.000Z';

type Calls = { activate: number; process: number; assess: number; review: number; gate: number; send: number };

function taskRecord(status: 'queued' | 'ready' | 'completed'): AgentRuntimeExecutionRecord {
  return {
    task: {
      taskId: 'sales-intake-task:workflow-1',
      executionId: 'sales-intake:workflow-1',
      originAgent: 'lead_agent',
      destinationAgent: 'sales_agent',
      objective: 'Intake a human-approved qualified opportunity for internal Sales review without contacting the prospect.',
      priority: 'normal',
      context: { leadId: 'lead-1', eligibilityRecordId: 'workflow-1' },
      knowledgeReferences: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
      inputs: { salesIntakeOnly: true, salesDispatchAuthorised: false, outreachAuthorised: false },
      expectedOutput: 'A governed internal Sales intake assessment with no prospect contact or outreach.',
      dependencies: [],
      risks: [],
      confidence: 1,
      approvalRequired: false,
      status,
      nextAction: status === 'queued'
        ? 'configure_governed_sales_intake_processing'
        : status === 'ready'
          ? 'execute_internal_sales_intake'
          : 'define_governed_sales_opportunity_assessment',
      attempt: 1,
      maxAttempts: 1,
      correlationId: 'corr-1',
      createdAt: now,
      updatedAt: now,
    },
    ...(status === 'completed' ? {
      result: {
        executionId: 'sales-intake:workflow-1',
        taskId: 'sales-intake-task:workflow-1',
        agentId: 'sales_agent' as const,
        status: 'completed' as const,
        output: { intakeAccepted: true, salesDispatchAuthorised: false, outreachAuthorised: false },
        evidenceReferences: [],
        knowledgeReferences: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
        confidence: 1,
      },
    } : {}),
    version: 2,
    persistedAt: now,
  };
}

function workflowRecord(id: string, eventType: string, actorType = 'founder', actorId: string | null = 'human_executive') {
  return { id, clientId: null, projectId: null, eventType, actorType, actorId, payload: {}, createdAt: now };
}

function assessmentOutcome(salesContext: SalesOpportunityContext) {
  const missingInformation = Object.keys(salesContext).length === 0 ? ['industry', 'country'] : [];
  return {
    assessment: {
      leadId: 'lead-1',
      salesIntakeExecutionId: 'sales-intake:workflow-1',
      company: 'Example Engineering',
      contactName: 'Jane Example',
      contactEmail: 'jane@example.com',
      source: 'google_places',
      opportunitySummary: 'Potential website redesign.',
      existingLeadScore: null,
      salesContext,
      assessmentStatus: missingInformation.length === 0 ? 'context_complete' as const : 'context_incomplete' as const,
      missingInformation,
      atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
      outreachAuthorised: false as const,
      pricingAuthorised: false as const,
      commercialCommitmentAuthorised: false as const,
      nextAction: missingInformation.length === 0 ? 'prepare_governed_sales_context' as const : 'retrieve_missing_sales_context' as const,
    },
    record: workflowRecord('workflow-assessment-1', 'sales_opportunity_assessment_recorded', 'agent', 'sales_agent'),
  };
}

async function withServer(run: (baseUrl: string, calls: Calls) => Promise<void>): Promise<void> {
  const calls: Calls = { activate: 0, process: 0, assess: 0, review: 0, gate: 0, send: 0 };
  const fallback: RequestListener = (_request, response) => { response.writeHead(418); response.end(); };
  const handler = createSalesIntakeControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken },
    salesIntakeCommand: {
      async activateIntake(executionId) {
        calls.activate += 1;
        assert.equal(executionId, 'sales-intake:workflow-1');
        return taskRecord('ready');
      },
      async processIntake(executionId): Promise<RuntimeExecutionOutcome> {
        calls.process += 1;
        assert.equal(executionId, 'sales-intake:workflow-1');
        return { record: taskRecord('completed'), replayed: false };
      },
      async assessOpportunity(executionId, salesContext = {}) {
        calls.assess += 1;
        assert.equal(executionId, 'sales-intake:workflow-1');
        return assessmentOutcome(salesContext);
      },
    },
    salesOutreachDraftReviewCommand: {
      async review(draftRecordId, decision) {
        calls.review += 1;
        assert.equal(draftRecordId, 'draft-1');
        return {
          review: {
            draftRecordId: 'draft-1',
            leadId: 'lead-1',
            decision,
            reviewer: 'human_executive' as const,
            reviewComplete: true as const,
            outreachAuthorised: false as const,
            sendAuthorised: false as const,
            pricingAuthorised: false as const,
            commercialCommitmentAuthorised: false as const,
            nextAction: decision === 'approved' ? 'prepare_supervised_send_gate' as const : 'revise_internal_outreach_draft' as const,
          },
          record: workflowRecord('review-1', 'sales_outreach_draft_review_recorded'),
        };
      },
    },
    salesSupervisedSendGateCommand: {
      async decide(draftReviewRecordId, decision) {
        calls.gate += 1;
        assert.equal(draftReviewRecordId, 'review-1');
        return {
          gate: {
            draftReviewRecordId: 'review-1',
            draftRecordId: 'draft-1',
            leadId: 'lead-1',
            decision,
            approver: 'human_executive' as const,
            supervised: true as const,
            outreachAuthorised: false as const,
            sendAuthorised: decision === 'approved',
            pricingAuthorised: false as const,
            commercialCommitmentAuthorised: false as const,
            nextAction: decision === 'approved' ? 'execute_supervised_email_send' as const : 'return_to_outreach_review' as const,
          },
          record: workflowRecord('gate-1', 'sales_supervised_send_gate_recorded'),
        };
      },
    },
    salesEmailCommand: {
      async execute(sendGateRecordId) {
        calls.send += 1;
        assert.equal(sendGateRecordId, 'gate-1');
        return {
          execution: {
            sendGateRecordId: 'gate-1',
            draftRecordId: 'draft-1',
            leadId: 'lead-1',
            recipientEmail: 'owner@example.com',
            subject: 'Website opportunity',
            providerMessageId: 'provider-message-1',
            supervised: true as const,
            humanSendApprovalVerified: true as const,
            sendExecuted: true as const,
            pricingAuthorised: false as const,
            commercialCommitmentAuthorised: false as const,
            nextAction: 'record_outreach_and_monitor_response' as const,
          },
          record: workflowRecord('sent-record-1', 'sales_supervised_email_sent', 'agent', 'sales_agent'),
        };
      },
    },
    fallback,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, calls); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function post(baseUrl: string, path: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('authenticated control plane activates queued Sales intake without authorising outreach', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await post(baseUrl, '/api/v1/control/sales-intake/activate', { executionId: 'sales-intake:workflow-1' });
    const body = await response.json() as { ok: boolean; data: { status: string; salesDispatchAuthorised: boolean; outreachAuthorised: boolean } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ready');
    assert.equal(body.data.salesDispatchAuthorised, false);
    assert.equal(body.data.outreachAuthorised, false);
    assert.equal(calls.activate, 1);
  });
});

test('authenticated control plane processes internal Sales intake without prospect contact authority', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await post(baseUrl, '/api/v1/control/sales-intake/process', { executionId: 'sales-intake:workflow-1' });
    const body = await response.json() as { ok: boolean; data: { status: string; outreachAuthorised: boolean } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'completed');
    assert.equal(body.data.outreachAuthorised, false);
    assert.equal(calls.process, 1);
  });
});

test('authenticated control plane persists evidence-backed Sales opportunity assessment', async () => {
  await withServer(async (baseUrl, calls) => {
    const salesContext: SalesOpportunityContext = {
      decisionMaker: 'Jane Example', industry: 'Engineering', country: 'South Africa',
      businessSummary: 'Engineering services company.', websiteAudit: 'Public website requires modernization.',
      painPoints: ['Outdated website'], recommendedServices: ['Website redesign'], priority: 'normal',
      confidence: 0.8, previousContact: 'No previous contact recorded.',
    };
    const response = await post(baseUrl, '/api/v1/control/sales-intake/assess', { executionId: 'sales-intake:workflow-1', salesContext });
    const body = await response.json() as { ok: boolean; data: { assessmentRecordId: string; assessmentStatus: string; outreachAuthorised: boolean; pricingAuthorised: boolean; commercialCommitmentAuthorised: boolean } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.assessmentRecordId, 'workflow-assessment-1');
    assert.equal(body.data.assessmentStatus, 'context_complete');
    assert.equal(body.data.outreachAuthorised, false);
    assert.equal(body.data.pricingAuthorised, false);
    assert.equal(body.data.commercialCommitmentAuthorised, false);
    assert.equal(calls.assess, 1);
  });
});

test('Sales opportunity assessment allows missing evidence to remain explicit', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, '/api/v1/control/sales-intake/assess', { executionId: 'sales-intake:workflow-1', salesContext: {} });
    const body = await response.json() as { ok: boolean; data: { assessmentStatus: string; missingInformation: string[] } };
    assert.equal(response.status, 200);
    assert.equal(body.data.assessmentStatus, 'context_incomplete');
    assert.deepEqual(body.data.missingInformation, ['industry', 'country']);
  });
});

test('Human Executive draft review records approval without granting send authority', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await post(baseUrl, '/api/v1/control/sales-email/review-draft', { draftRecordId: 'draft-1', decision: 'approved' });
    const body = await response.json() as { ok: boolean; data: { reviewRecordId: string; reviewer: string; sendAuthorised: boolean; pricingAuthorised: boolean; commercialCommitmentAuthorised: boolean; nextAction: string } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.reviewRecordId, 'review-1');
    assert.equal(body.data.reviewer, 'human_executive');
    assert.equal(body.data.sendAuthorised, false);
    assert.equal(body.data.pricingAuthorised, false);
    assert.equal(body.data.commercialCommitmentAuthorised, false);
    assert.equal(body.data.nextAction, 'prepare_supervised_send_gate');
    assert.equal(calls.review, 1);
    assert.equal(calls.gate, 0);
    assert.equal(calls.send, 0);
  });
});

test('separate Human Executive supervised send gate can authorise only the send', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await post(baseUrl, '/api/v1/control/sales-email/send-gate', { draftReviewRecordId: 'review-1', decision: 'approved' });
    const body = await response.json() as { ok: boolean; data: { sendGateRecordId: string; approver: string; supervised: boolean; sendAuthorised: boolean; pricingAuthorised: boolean; commercialCommitmentAuthorised: boolean; nextAction: string } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.sendGateRecordId, 'gate-1');
    assert.equal(body.data.approver, 'human_executive');
    assert.equal(body.data.supervised, true);
    assert.equal(body.data.sendAuthorised, true);
    assert.equal(body.data.pricingAuthorised, false);
    assert.equal(body.data.commercialCommitmentAuthorised, false);
    assert.equal(body.data.nextAction, 'execute_supervised_email_send');
    assert.equal(calls.gate, 1);
    assert.equal(calls.send, 0);
  });
});

test('authenticated control plane executes supervised Sales email only from persisted send gate identifier', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await post(baseUrl, '/api/v1/control/sales-email/send', { sendGateRecordId: 'gate-1' });
    const body = await response.json() as { ok: boolean; data: { sendGateRecordId: string; providerMessageId: string; humanSendApprovalVerified: boolean; sendExecuted: boolean; pricingAuthorised: boolean; commercialCommitmentAuthorised: boolean } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.sendGateRecordId, 'gate-1');
    assert.equal(body.data.providerMessageId, 'provider-message-1');
    assert.equal(body.data.humanSendApprovalVerified, true);
    assert.equal(body.data.sendExecuted, true);
    assert.equal(body.data.pricingAuthorised, false);
    assert.equal(body.data.commercialCommitmentAuthorised, false);
    assert.equal(calls.send, 1);
  });
});

test('Sales email approval controls reject caller-supplied authority', async () => {
  await withServer(async (baseUrl, calls) => {
    const reviewResponse = await post(baseUrl, '/api/v1/control/sales-email/review-draft', { draftRecordId: 'draft-1', decision: 'approved', sendAuthorised: true });
    const gateResponse = await post(baseUrl, '/api/v1/control/sales-email/send-gate', { draftReviewRecordId: 'review-1', decision: 'approved', pricingAuthorised: true });
    assert.equal(reviewResponse.status, 400);
    assert.equal(gateResponse.status, 400);
    assert.equal(calls.review, 0);
    assert.equal(calls.gate, 0);
    assert.equal(calls.send, 0);
  });
});

test('supervised Sales email control rejects caller-supplied message content or authority', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await post(baseUrl, '/api/v1/control/sales-email/send', { sendGateRecordId: 'gate-1', recipientEmail: 'attacker@example.com', subject: 'Forged subject', sendAuthorised: true });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_sales_email_send_command');
    assert.equal(calls.send, 0);
  });
});

test('Sales intake controls reject caller-supplied authority fields', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await post(baseUrl, '/api/v1/control/sales-intake/process', { executionId: 'sales-intake:workflow-1', outreachAuthorised: true });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_sales_intake_command');
    assert.equal(calls.process, 0);
  });
});

test('Sales opportunity assessment rejects caller-supplied authority or unsupported context fields', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await post(baseUrl, '/api/v1/control/sales-intake/assess', { executionId: 'sales-intake:workflow-1', salesContext: { industry: 'Engineering', outreachAuthorised: true } });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_sales_opportunity_assessment');
    assert.equal(calls.assess, 0);
  });
});
