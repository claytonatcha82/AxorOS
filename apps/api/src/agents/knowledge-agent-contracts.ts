export interface KnowledgeAgentRequest {
  requestId: string;
  requestingAgent: string;
  task: string;
  requiredContext: string[];
  projectId?: string;
  maximumClassification: 'public' | 'internal' | 'confidential';
}

export interface KnowledgeAgentDocumentResult {
  documentId: string;
  title: string;
  version: string;
  relevance: number;
  classification: 'public' | 'internal' | 'confidential';
  citation: string;
}

export interface KnowledgeAgentResult {
  requestId: string;
  confidence: number;
  documents: KnowledgeAgentDocumentResult[];
  keyInformation: string[];
  conflictsFound: string[];
  missingInformation: string[];
  recommendedFollowup: string[];
  citations: string[];
}

export type KnowledgeConfidenceAction = 'continue' | 'continue_with_uncertainty' | 'request_additional_information' | 'escalate';

export function validateKnowledgeAgentRequest(request: KnowledgeAgentRequest): string[] {
  const errors: string[] = [];
  if (!request.requestId.trim()) errors.push('requestId is required.');
  if (!request.requestingAgent.trim()) errors.push('requestingAgent is required.');
  if (!request.task.trim()) errors.push('task is required.');
  if (request.requiredContext.length === 0) errors.push('requiredContext must contain at least one knowledge domain.');
  if (request.requiredContext.some((item) => !item.trim())) errors.push('requiredContext entries cannot be blank.');
  return errors;
}

export function confidenceAction(confidence: number): KnowledgeConfidenceAction {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('confidence must be between 0 and 1.');
  if (confidence >= 0.9) return 'continue';
  if (confidence >= 0.7) return 'continue_with_uncertainty';
  if (confidence >= 0.5) return 'request_additional_information';
  return 'escalate';
}

export function validateKnowledgeAgentResult(result: KnowledgeAgentResult): string[] {
  const errors: string[] = [];
  if (!result.requestId.trim()) errors.push('requestId is required.');
  if (result.confidence < 0 || result.confidence > 1) errors.push('confidence must be between 0 and 1.');
  if (result.documents.some((document) => document.relevance < 0 || document.relevance > 1)) errors.push('document relevance must be between 0 and 1.');
  if (result.documents.some((document) => !document.citation.trim())) errors.push('every returned document requires a citation.');
  return errors;
}
