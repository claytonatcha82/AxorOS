export interface KnowledgeAgentKpis {
  retrievalAccuracy: number;
  relevantDocumentPrecision: number;
  missingInformationDetectionRate: number;
  conflictDetectionRate: number;
  averageRetrievalLatencyMs: number;
  averageCostPerRetrieval: number;
  averageContextSizeCharacters: number;
  citationAccuracy: number;
  humanCorrectionRate: number;
  unsupportedAnswerRate: number;
  duplicateKnowledgeRetrievalRate: number;
  humanEscalationRate: number;
}

export interface KnowledgeAcceptanceTargets {
  correctContextRetrievalMinimum: number;
  unsupportedAnswersMaximum: number;
  duplicateKnowledgeRetrievalMaximum: number;
}

export const KNOWLEDGE_ACCEPTANCE_TARGETS: KnowledgeAcceptanceTargets = {
  correctContextRetrievalMinimum: 0.95,
  unsupportedAnswersMaximum: 0.01,
  duplicateKnowledgeRetrievalMaximum: 0.02,
};

export function validateKnowledgeKpis(kpis: KnowledgeAgentKpis): string[] {
  const errors: string[] = [];
  const rates: Array<[string, number]> = [
    ['retrievalAccuracy', kpis.retrievalAccuracy], ['relevantDocumentPrecision', kpis.relevantDocumentPrecision],
    ['missingInformationDetectionRate', kpis.missingInformationDetectionRate], ['conflictDetectionRate', kpis.conflictDetectionRate],
    ['citationAccuracy', kpis.citationAccuracy], ['humanCorrectionRate', kpis.humanCorrectionRate],
    ['unsupportedAnswerRate', kpis.unsupportedAnswerRate], ['duplicateKnowledgeRetrievalRate', kpis.duplicateKnowledgeRetrievalRate],
    ['humanEscalationRate', kpis.humanEscalationRate],
  ];
  for (const [name, value] of rates) if (value < 0 || value > 1) errors.push(`${name} must be between 0 and 1.`);
  if (kpis.averageRetrievalLatencyMs < 0) errors.push('averageRetrievalLatencyMs cannot be negative.');
  if (kpis.averageCostPerRetrieval < 0) errors.push('averageCostPerRetrieval cannot be negative.');
  if (kpis.averageContextSizeCharacters < 0) errors.push('averageContextSizeCharacters cannot be negative.');
  return errors;
}

export function knowledgeAcceptanceStatus(kpis: KnowledgeAgentKpis): { passing: boolean; failures: string[] } {
  const failures: string[] = [];
  if (kpis.retrievalAccuracy < KNOWLEDGE_ACCEPTANCE_TARGETS.correctContextRetrievalMinimum) failures.push('correct_context_retrieval');
  if (kpis.unsupportedAnswerRate >= KNOWLEDGE_ACCEPTANCE_TARGETS.unsupportedAnswersMaximum) failures.push('unsupported_answers');
  if (kpis.duplicateKnowledgeRetrievalRate >= KNOWLEDGE_ACCEPTANCE_TARGETS.duplicateKnowledgeRetrievalMaximum) failures.push('duplicate_knowledge_retrieval');
  return { passing: failures.length === 0, failures };
}
