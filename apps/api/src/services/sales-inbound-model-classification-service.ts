import type { ExternalIntegration } from '../integrations/integration-contract.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';
import {
  createSalesInboundReplyClassificationRecord,
  SALES_INBOUND_REPLY_CATEGORIES,
  type SalesInboundReplyClassificationRecord,
} from './sales-inbound-reply-classification-contract.js';

const MODEL_ALLOWED_CATEGORIES = [
  'positive_interest',
  'information_request',
  'pricing_or_commercial_question',
  'meeting_request',
  'objection',
  'not_interested',
  'ambiguous',
  'sensitive_or_high_risk',
] as const;

type ModelAllowedCategory = typeof MODEL_ALLOWED_CATEGORIES[number];

export interface SalesInboundPersistedEvidenceForClassification {
  inboundEvidenceId: string;
  outboundRecordId: string;
  leadId: string;
  providerMessageId: string;
  senderAddress: string;
  subject?: string;
  bodyOrSnippet: string;
}

interface ModelClassificationPayload {
  primaryCategory: ModelAllowedCategory;
  evidenceReasons: Array<{ reason: string }>;
  commercialTopicDetected: boolean;
  sensitiveTopicDetected: boolean;
  uncertaintyDetected: boolean;
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function parsePayload(text: string): ModelClassificationPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Sales inbound model classification must return valid JSON.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Sales inbound model classification must return a JSON object.');
  }
  const value = raw as Record<string, unknown>;
  if (!MODEL_ALLOWED_CATEGORIES.includes(value.primaryCategory as ModelAllowedCategory)) {
    throw new Error('Sales inbound model classification returned an unsupported category.');
  }
  if (!Array.isArray(value.evidenceReasons) || value.evidenceReasons.length === 0) {
    throw new Error('Sales inbound model classification requires evidence reasons.');
  }
  const evidenceReasons = value.evidenceReasons.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Sales inbound model classification evidence reason is invalid.');
    }
    return { reason: requireText(String((entry as Record<string, unknown>).reason ?? ''), 'evidence reason') };
  });
  for (const field of ['commercialTopicDetected', 'sensitiveTopicDetected', 'uncertaintyDetected'] as const) {
    if (typeof value[field] !== 'boolean') throw new Error(`${field} must be boolean.`);
  }
  return {
    primaryCategory: value.primaryCategory as ModelAllowedCategory,
    evidenceReasons,
    commercialTopicDetected: value.commercialTopicDetected as boolean,
    sensitiveTopicDetected: value.sensitiveTopicDetected as boolean,
    uncertaintyDetected: value.uncertaintyDetected as boolean,
  };
}

function nextActionFor(category: ModelAllowedCategory): SalesInboundReplyClassificationRecord['nextAction'] {
  switch (category) {
    case 'positive_interest': return 'prepare_sales_response';
    case 'information_request': return 'retrieve_authoritative_information';
    case 'pricing_or_commercial_question': return 'retrieve_approved_pricing_authority';
    case 'meeting_request': return 'prepare_scheduling_action';
    case 'objection': return 'prepare_bounded_objection_response';
    case 'not_interested': return 'stop_active_sales_progression';
    case 'ambiguous': return 'human_review_required';
    case 'sensitive_or_high_risk': return 'route_to_human_executive_or_appropriate_owner';
  }
}

export function createSalesInboundModelClassificationService(
  model: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput>,
) {
  if (model.integrationId !== 'model.gemini') {
    throw new Error('Sales inbound model classification requires the governed model.gemini integration.');
  }

  return {
    async classify(evidence: SalesInboundPersistedEvidenceForClassification): Promise<SalesInboundReplyClassificationRecord> {
      const inboundEvidenceId = requireText(evidence.inboundEvidenceId, 'inboundEvidenceId');
      const outboundRecordId = requireText(evidence.outboundRecordId, 'outboundRecordId');
      const leadId = requireText(evidence.leadId, 'leadId');
      const providerMessageId = requireText(evidence.providerMessageId, 'providerMessageId');
      const senderAddress = requireText(evidence.senderAddress, 'senderAddress');
      const bodyOrSnippet = requireText(evidence.bodyOrSnippet, 'bodyOrSnippet');
      const executionId = `sales-inbound-classification:${providerMessageId}`;

      const response = await model.execute({
        integrationId: 'model.gemini',
        requestedBy: 'sales_agent',
        executionId,
        correlationId: inboundEvidenceId,
        operation: 'generate_text',
        mode: 'draft',
        risk: 'medium',
        input: {
          systemInstruction: [
            'You are a bounded Sales inbound intent classifier for AxorOS.',
            'Classify only from the supplied persisted message evidence.',
            `Allowed categories: ${MODEL_ALLOWED_CATEGORIES.join(', ')}.`,
            'Do not classify opt_out, automated_response, or delivery_failure; those are deterministic safety categories handled before this model.',
            'Do not invent sender statements, facts, pricing, discounts, capabilities, commitments, payment status, contracts, or authority.',
            'If intent is materially unclear, use ambiguous and set uncertaintyDetected true.',
            'Legal, regulatory, security, privacy, threatening, complaint, or other consequential sensitive content must use sensitive_or_high_risk.',
            'A client payment claim, invoice-status issue, billing-status issue, reconciliation issue, or request for payment verification is Finance-owned financial administration: classify it sensitive_or_high_risk and set commercialTopicDetected true. Sales must not confirm payment.',
            'Pricing questions belong to pricing_or_commercial_question. Exceptional discounts, bespoke terms, unusual payment arrangements, negotiation requests, and other exceptional commercial decisions are Human Executive matters; do not use commercialTopicDetected merely because a matter is commercial.',
            'Within sensitive_or_high_risk, commercialTopicDetected true is reserved for Finance-owned financial administration that should route from Sales to Finance. Otherwise set it false so high-risk matters route to the Human Executive.',
            'Return JSON only with: primaryCategory, evidenceReasons (array of {reason}), commercialTopicDetected, sensitiveTopicDetected, uncertaintyDetected.',
          ].join(' '),
          context: JSON.stringify({
            senderAddress,
            subject: evidence.subject?.trim() || undefined,
            bodyOrSnippet,
          }),
          prompt: 'Classify this persisted inbound Sales reply using only the supplied evidence.',
          maxOutputTokens: 500,
        },
      });

      if (response.status !== 'drafted' || !response.output?.text?.trim()) {
        throw new Error(`Sales inbound model classification failed with status ${response.status}.`);
      }

      const payload = parsePayload(response.output.text);
      const highRisk = payload.primaryCategory === 'sensitive_or_high_risk';
      const ambiguous = payload.primaryCategory === 'ambiguous';

      return createSalesInboundReplyClassificationRecord({
        inboundEvidenceId,
        outboundRecordId,
        leadId,
        providerMessageId,
        primaryCategory: payload.primaryCategory,
        evidenceReasons: payload.evidenceReasons,
        deterministicSignals: {
          optOutDetected: false,
          automatedResponseDetected: false,
          deliveryFailureDetected: false,
        },
        commercialTopicDetected: payload.commercialTopicDetected,
        sensitiveTopicDetected: payload.sensitiveTopicDetected || highRisk,
        uncertaintyDetected: payload.uncertaintyDetected || ambiguous,
        classificationSource: 'model_assisted',
        modelReference: response.output.model,
        nextAction: nextActionFor(payload.primaryCategory),
        humanReviewRequired: true,
        classifiedAt: new Date().toISOString(),
      });
    },
  };
}

export const SALES_INBOUND_MODEL_ALLOWED_CATEGORIES: readonly string[] = MODEL_ALLOWED_CATEGORIES;
export const SALES_INBOUND_ALL_CATEGORIES: readonly string[] = SALES_INBOUND_REPLY_CATEGORIES;
