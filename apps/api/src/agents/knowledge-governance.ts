export type KnowledgeSourceAuthority =
  | 'atlas_governance'
  | 'atlas_standard'
  | 'atlas_sop'
  | 'current_project'
  | 'atlas_knowledge_base'
  | 'approved_external'
  | 'general_ai';

export type KnowledgeFreshness = 'current' | 'review_due' | 'deprecated' | 'archived';

export const KNOWLEDGE_SOURCE_PRIORITY: Record<KnowledgeSourceAuthority, number> = {
  atlas_governance: 1,
  atlas_standard: 2,
  atlas_sop: 3,
  current_project: 4,
  atlas_knowledge_base: 5,
  approved_external: 6,
  general_ai: 7,
};

export const KNOWLEDGE_FRESHNESS_PRIORITY: Record<KnowledgeFreshness, number> = {
  current: 1,
  review_due: 2,
  archived: 3,
  deprecated: 4,
};

export interface KnowledgeCandidate {
  documentId: string;
  title: string;
  authority: KnowledgeSourceAuthority;
  freshness: KnowledgeFreshness;
  relevance: number;
  version: string;
  topicKey: string;
  contentFingerprint: string;
}

export function rankKnowledgeCandidates(candidates: KnowledgeCandidate[]): KnowledgeCandidate[] {
  return [...candidates].sort((a, b) => {
    const authority = KNOWLEDGE_SOURCE_PRIORITY[a.authority] - KNOWLEDGE_SOURCE_PRIORITY[b.authority];
    if (authority !== 0) return authority;
    const freshness = KNOWLEDGE_FRESHNESS_PRIORITY[a.freshness] - KNOWLEDGE_FRESHNESS_PRIORITY[b.freshness];
    if (freshness !== 0) return freshness;
    return b.relevance - a.relevance;
  });
}

export function operationalKnowledgeAllowed(candidate: KnowledgeCandidate): boolean {
  return candidate.freshness !== 'deprecated';
}

export function suppressDuplicateKnowledge(candidates: KnowledgeCandidate[]): KnowledgeCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.topicKey}:${candidate.contentFingerprint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface KnowledgeConflict {
  conflictDetected: true;
  documentA: string;
  documentB: string;
  conflictingTopic: string;
  recommendedAction: 'knowledge_governance_review';
}

export function detectKnowledgeConflict(a: KnowledgeCandidate, b: KnowledgeCandidate): KnowledgeConflict | null {
  if (a.topicKey !== b.topicKey || a.contentFingerprint === b.contentFingerprint) return null;
  return {
    conflictDetected: true,
    documentA: a.documentId,
    documentB: b.documentId,
    conflictingTopic: a.topicKey,
    recommendedAction: 'knowledge_governance_review',
  };
}
