import type { LeadRecord } from '../data/operational-repository.js';
import { createSalesOpportunityAssessmentService } from './sales-opportunity-assessment-service.js';
import type { AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';

const atlasSourcePaths = [
  'Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md',
  'Volume 1 - Agency/06 Sales System/Sales Agent.md',
];

const intakeExecution: AgentRuntimeExecutionRecord = {
  task: {
    taskId: 'sales-intake-task:demo-1',
    executionId: 'sales-intake:demo-1',
    originAgent: 'lead_agent',
    destinationAgent: 'sales_agent',
    objective: 'Intake a human-approved qualified opportunity for internal Sales review without contacting the prospect.',
    priority: 'normal',
    context: { leadId: 'lead-demo-1', eligibilityRecordId: 'eligibility-demo-1' },
    knowledgeReferences: atlasSourcePaths,
    inputs: { salesIntakeOnly: true, salesDispatchAuthorised: false, outreachAuthorised: false },
    expectedOutput: 'A governed internal Sales intake assessment with no prospect contact or outreach.',
    dependencies: [], risks: [], confidence: 1, approvalRequired: false,
    status: 'completed', nextAction: 'define_governed_sales_opportunity_assessment',
    attempt: 1, maxAttempts: 1, correlationId: 'sales-demo-1',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  result: {
    executionId: 'sales-intake:demo-1', taskId: 'sales-intake-task:demo-1', agentId: 'sales_agent', status: 'completed',
    output: { intakeAccepted: true, salesDispatchAuthorised: false, outreachAuthorised: false },
    evidenceReferences: [], knowledgeReferences: atlasSourcePaths, confidence: 1,
  },
  version: 2, persistedAt: new Date().toISOString(),
};

const lead: LeadRecord = {
  id: 'lead-demo-1', clientId: null, companyName: 'Coastal Engineering Solutions',
  contactName: 'Thandi Ndlovu', contactEmail: 'thandi@example.com', source: 'lead_agent_research',
  opportunitySummary: 'Established engineering business with an outdated website and unclear service presentation.',
  leadScore: 44, status: 'qualified', evidence: [],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

const assessment = createSalesOpportunityAssessmentService().assess({
  intakeExecution,
  lead,
  salesContext: {
    decisionMaker: 'Thandi Ndlovu', industry: 'Engineering', country: 'South Africa',
    businessSummary: 'Engineering services business serving commercial and industrial clients.',
    websiteAudit: 'Existing website is dated, difficult to navigate, and does not clearly present core services.',
    painPoints: ['Outdated website presentation', 'Core services are difficult to identify quickly'],
    recommendedServices: ['Website redesign', 'Service-page restructuring'],
    priority: 'good', confidence: 0.88, previousContact: 'No previous contact recorded.',
  },
});

const draftSubject = `Website opportunity for ${lead.companyName}`;
const draftBody = `Hi ${lead.contactName},\n\nI came across ${lead.companyName} while researching engineering businesses in South Africa. Based on the publicly available information reviewed, there may be an opportunity to improve how your services are presented online and make the website easier for prospective clients to navigate.\n\nWe would be happy to discuss whether a website redesign and clearer service structure would be useful for your business.\n\nKind regards,\nAxorOS Sales`;

console.log('\n====================================================');
console.log('AXOROS SALES AGENT — CONTROLLED PILOT DEMO');
console.log('====================================================');
console.log('\n[1] HUMAN-APPROVED LEAD RECEIVED');
console.log(`Company: ${lead.companyName}`);
console.log(`Contact: ${lead.contactName}`);
console.log(`Email: ${lead.contactEmail}`);
console.log(`Existing Lead score: ${lead.leadScore} (carried through; Sales did not rescore)`);
console.log('\n[2] INTERNAL SALES INTAKE');
console.log(`Status: ${intakeExecution.task.status}`);
console.log(`Sales dispatch authorised: ${String(intakeExecution.task.inputs.salesDispatchAuthorised).toUpperCase()}`);
console.log(`Outreach authorised: ${String(intakeExecution.task.inputs.outreachAuthorised).toUpperCase()}`);
console.log('\n[3] EVIDENCE-BACKED OPPORTUNITY ASSESSMENT');
console.log(`Industry: ${assessment.salesContext.industry}`);
console.log(`Country: ${assessment.salesContext.country}`);
console.log(`Website audit: ${assessment.salesContext.websiteAudit}`);
console.log(`Pain points: ${assessment.salesContext.painPoints?.join('; ')}`);
console.log(`Recommended services: ${assessment.salesContext.recommendedServices?.join('; ')}`);
console.log(`Assessment: ${assessment.assessmentStatus.toUpperCase()}`);
console.log(`Missing information: ${assessment.missingInformation.length === 0 ? 'NONE' : assessment.missingInformation.join(', ')}`);
console.log('\n[4] OUTREACH PREPARATION GATE');
console.log(`Preparation eligible: ${assessment.assessmentStatus === 'context_complete' ? 'YES' : 'NO'}`);
console.log('Outreach authorised: NO');
console.log('Send authorised: NO');
console.log('Pricing authorised: NO');
console.log('\n[5] INTERNAL OUTREACH DRAFT — NOT SENT');
console.log(`To: ${lead.contactEmail}`);
console.log(`Subject: ${draftSubject}`);
console.log('----------------------------------------------------');
console.log(draftBody);
console.log('----------------------------------------------------');
console.log('\n[6] GOVERNANCE');
console.log('Human review required: YES');
console.log('Email sent: NO');
console.log('Commercial commitment made: NO');
console.log('\nNEXT ACTION: request_human_outreach_draft_review');
console.log('====================================================\n');
