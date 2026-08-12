export interface KnowledgeRetrievalAcceptanceCase {
  id: string;
  question: string;
  expectedCapability: string;
  checks: readonly ['correct_document', 'correct_section', 'correct_interpretation', 'correct_citations', 'no_hallucination'];
}

const STANDARD_CHECKS = ['correct_document', 'correct_section', 'correct_interpretation', 'correct_citations', 'no_hallucination'] as const;

export const KNOWLEDGE_AGENT_ACCEPTANCE_CASES: readonly KnowledgeRetrievalAcceptanceCase[] = [
  { id: 'technology_stack', question: 'What is the approved technology stack?', expectedCapability: 'retrieve approved technology standards', checks: STANDARD_CHECKS },
  { id: 'international_clients', question: 'How should international clients be handled?', expectedCapability: 'retrieve international client operating guidance', checks: STANDARD_CHECKS },
  { id: 'pre_deployment', question: 'What happens before a website is deployed?', expectedCapability: 'retrieve production and QA deployment gates', checks: STANDARD_CHECKS },
  { id: 'finance_access', question: 'What may the Finance Agent access?', expectedCapability: 'retrieve agent permissions and restrictions', checks: STANDARD_CHECKS },
  { id: 'client_onboarding', question: 'Which SOP governs client onboarding?', expectedCapability: 'retrieve authoritative onboarding SOP', checks: STANDARD_CHECKS },
  { id: 'pricing_conflicts', question: 'Find conflicting or duplicated guidance regarding pricing.', expectedCapability: 'detect conflicts and duplicate knowledge', checks: STANDARD_CHECKS },
];

export interface KnowledgeAcceptanceCaseResult {
  caseId: string;
  correctDocument: boolean;
  correctSection: boolean;
  correctInterpretation: boolean;
  correctCitations: boolean;
  noHallucination: boolean;
}

export function evaluateKnowledgeAcceptanceCase(result: KnowledgeAcceptanceCaseResult): boolean {
  return result.correctDocument && result.correctSection && result.correctInterpretation && result.correctCitations && result.noHallucination;
}

export function evaluateKnowledgeAcceptanceSuite(results: KnowledgeAcceptanceCaseResult[]): { passing: boolean; failedCases: string[] } {
  const expected = new Set(KNOWLEDGE_AGENT_ACCEPTANCE_CASES.map((item) => item.id));
  const received = new Set(results.map((item) => item.caseId));
  const failedCases = KNOWLEDGE_AGENT_ACCEPTANCE_CASES
    .filter((item) => !received.has(item.id) || !evaluateKnowledgeAcceptanceCase(results.find((result) => result.caseId === item.id)!))
    .map((item) => item.id);
  for (const result of results) if (!expected.has(result.caseId)) failedCases.push(`unknown:${result.caseId}`);
  return { passing: failedCases.length === 0, failedCases };
}
