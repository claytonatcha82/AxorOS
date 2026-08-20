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
      inputs: {
        salesIntakeOnly: true,
        salesDispatchAuthorised: false,
        outreachAuthorised: false,
      },
      expectedOutput: 'A governed internal Sales intake assessment with no prospect contact or outreach.',
      dependencies: [],
      risks: [],
      confidence: 1,
      approvalRequired: false,
      status,
      nextAction: status === 'queued' ? 'configure_governed_sales_intake_processing' : status === 'ready' ? 'execute_internal_sales_intake' : 'define_governed_sales_opportunity_assessment',
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
        output: {
          intakeAccepted: true,
          salesDispatchAuthorised: false,
          outreachAuthorised: false,
        },
        evidenceReferences: [],
        knowledgeReferences: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
        confidence: 1,
      },
    } : {}),
    version: 2,
    persistedAt: now,
  };
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
      nextAction: missingInformation.length === 0
        ? 'prepare_governed_sales_context' as const
        : 'retrieve_missing_sales_context' as const,
    },
    record: {
      id: 'workflow-assessment-1',
      clientId: null,
      projectId: null,
      eventType: 'sales_opportunity_assessment_recorded',
      actorType: 'agent',
      actorId: 'sales_agent',
      payload: {},
      createdAt: now,
    },
  };
}

async function withServer(
  run: (baseUrl: string, calls: { activate: number; process: number; assess: number; send: number }) => Promise<void>,
): Promise<void> {
  const calls = { activate: 0, process: 0, assess: 0, send: 0 };
  const fallback: RequestListener = (_request, response) => {
    response.writeHead(418);
    response.end();
  };
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
            supervised: true,
            humanSendApprovalVerified: true,
            sendExecuted: true,
            pricingAuthorised: false,
            commercialCommitmentAuthorised: false,
            nextAction: 'record_outreach_and_monitor_response',
          },
          record: {
            id: 'sent-record-1',
            clientId: null,
            projectId: null,
            eventType: 'sales_supervised_email_sent',
            actorType: 'agent',
            actorId: 'sales_agent',
            payload: {},
            createdAt: now,
          },
        };
      },
    },
    fallback,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('authenticated control plane activates queued Sales intake without authorising outreach', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-intake/activate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'sales-intake:workflow-1' }),
    });
    const body = await response.json() as { ok: boolean; data: { status: string; salesDispatchAuthorised: boolean; outreachAuthorised: boolean } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ready');
    assert.equal(body.data.salesDispatchAuthorised, false);
    assert.equal(body.data.outreachAuthorised, false);
    assert.equal(calls.activate, 1);
    assert.equal(calls.process, 0);
    assert.equal(calls.assess, 0);
    assert.equal(calls.send, 0);
  });
});

test('authenticated control plane processes internal Sales intake without prospect contact authority', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-intake/process`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'sales-intake:workflow-1' }),
    });
    const body = await response.json() as { ok: boolean; data: { status: string; resultStatus: string; salesDispatchAuthorised: boolean; outreachAuthorised: boolean } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'completed');
    assert.equal(body.data.resultStatus, 'completed');
    assert.equal(body.data.salesDispatchAuthorised, false);
    assert.equal(body.data.outreachAuthorised, false);
    assert.equal(calls.activate, 0);
    assert.equal(calls.process, 1);
    assert.equal(calls.assess, 0);
    assert.equal(calls.send, 0);
  });
});

test('authenticated control plane persists evidence-backed Sales opportunity assessment', async () => {
  await withServer(async (baseUrl, calls) => {
    const salesContext: SalesOpportunityContext = {
      decisionMaker: 'Jane Example',
      industry: 'Engineering',
      country: 'South Africa',
      businessSummary: 'Engineering services company.',
      websiteAudit: 'Public website requires modernization.',
      painPoints: ['Outdated website'],
      recommendedServices: ['Website redesign'],
      priority: 'normal',
      confidence: 0.8,
      previousContact: 'No previous contact recorded.',
    };
    const response = await fetch(`${baseUrl}/api/v1/control/sales-intake/assess`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'sales-intake:workflow-1', salesContext }),
    });
    const body = await response.json() as {
      ok: boolean;
      data: {
        assessmentRecordId: string;
        assessmentStatus: string;
        missingInformation: string[];
        outreachAuthorised: boolean;
        pricingAuthorised: boolean;
        commercialCommitmentAuthorised: boolean;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.assessmentRecordId, 'workflow-assessment-1');
    assert.equal(body.data.assessmentStatus, 'context_complete');
    assert.deepEqual(body.data.missingInformation, []);
    assert.equal(body.data.outreachAuthorised, false);
    assert.equal(body.data.pricingAuthorised, false);
    assert.equal(body.data.commercialCommitmentAuthorised, false);
    assert.equal(calls.activate, 0);
    assert.equal(calls.process, 0);
    assert.equal(calls.assess, 1);
    assert.equal(calls.send, 0);
  });
});

test('Sales opportunity assessment allows missing evidence to remain explicit', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-intake/assess`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'sales-intake:workflow-1', salesContext: {} }),
    });
    const body = await response.json() as { ok: boolean; data: { assessmentStatus: string; missingInformation: string[] } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.assessmentStatus, 'context_incomplete');
    assert.deepEqual(body.data.missingInformation, ['industry', 'country']);
    assert.equal(calls.assess, 1);
    assert.equal(calls.send, 0);
  });
});

test('authenticated control plane executes supervised Sales email only from a persisted send gate identifier', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-email/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sendGateRecordId: 'gate-1' }),
    });
    const body = await response.json() as {
      ok: boolean;
      data: {
        sendGateRecordId: string;
        draftRecordId: string;
        leadId: string;
        sentRecordId: string;
        providerMessageId: string;
        supervised: boolean;
        humanSendApprovalVerified: boolean;
        sendExecuted: boolean;
        pricingAuthorised: boolean;
        commercialCommitmentAuthorised: boolean;
        nextAction: string;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.sendGateRecordId, 'gate-1');
    assert.equal(body.data.draftRecordId, 'draft-1');
    assert.equal(body.data.leadId, 'lead-1');
    assert.equal(body.data.sentRecordId, 'sent-record-1');
    assert.equal(body.data.providerMessageId, 'provider-message-1');
    assert.equal(body.data.supervised, true);
    assert.equal(body.data.humanSendApprovalVerified, true);
    assert.equal(body.data.sendExecuted, true);
    assert.equal(body.data.pricingAuthorised, false);
    assert.equal(body.data.commercialCommitmentAuthorised, false);
    assert.equal(body.data.nextAction, 'record_outreach_and_monitor_response');
    assert.equal(calls.send, 1);
    assert.equal(calls.activate, 0);
    assert.equal(calls.process, 0);
    assert.equal(calls.assess, 0);
  });
});

test('supervised Sales email control rejects caller-supplied message content or authority', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-email/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        sendGateRecordId: 'gate-1',
        recipientEmail: 'attacker@example.com',
        subject: 'Forged subject',
        sendAuthorised: true,
      }),
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_sales_email_send_command');
    assert.equal(calls.send, 0);
    assert.equal(calls.activate, 0);
    assert.equal(calls.process, 0);
    assert.equal(calls.assess, 0);
  });
});

test('Sales intake controls reject caller-supplied authority fields', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-intake/process`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ executionId: 'sales-intake:workflow-1', outreachAuthorised: true }),
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_sales_intake_command');
    assert.equal(calls.activate, 0);
    assert.equal(calls.process, 0);
    assert.equal(calls.assess, 0);
    assert.equal(calls.send, 0);
  });
});

test('Sales opportunity assessment rejects caller-supplied authority or unsupported context fields', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/sales-intake/assess`, {
      method: 'POST',
      headers: { authorization: `Bearer ${controlPlaneToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        executionId: 'sales-intake:workflow-1',
        salesContext: { industry: 'Engineering', outreachAuthorised: true },
      }),
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_sales_opportunity_assessment');
    assert.equal(calls.activate, 0);
    assert.equal(calls.process, 0);
    assert.equal(calls.assess, 0);
    assert.equal(calls.send, 0);
  });
});
