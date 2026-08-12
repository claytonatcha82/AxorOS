export interface MarketingPortfolioProject {
  projectId: string;
  industry: string;
  problem: string;
  solution: string;
  results: string[];
  technologies: string[];
  clientTestimonial?: string;
  beforeAfterEvidence: string[];
  mediaReferences: string[];
  approvalStatus: 'draft' | 'client_approved' | 'internal_approved' | 'publishable';
}

export function portfolioProjectMayPublish(project: MarketingPortfolioProject): boolean {
  if (project.approvalStatus !== 'publishable') return false;
  if (!project.projectId.trim() || !project.industry.trim() || !project.problem.trim() || !project.solution.trim()) return false;
  if (project.results.length > 0 && project.beforeAfterEvidence.length === 0 && project.mediaReferences.length === 0) return false;
  return true;
}

export interface SeoHealthSnapshot {
  organicTrafficTrend: 'up' | 'flat' | 'down';
  indexingIssues: number;
  brokenInternalLinks: number;
  technicalIssues: number;
  contentOutdated: number;
  keywordVisibilityTrend: 'up' | 'flat' | 'down';
}

export function seoPriority(snapshot: SeoHealthSnapshot): 'low' | 'medium' | 'high' | 'critical' {
  if (snapshot.indexingIssues > 0 && snapshot.organicTrafficTrend === 'down') return 'critical';
  if (snapshot.technicalIssues > 0 || snapshot.brokenInternalLinks > 3 || snapshot.keywordVisibilityTrend === 'down') return 'high';
  if (snapshot.contentOutdated > 0 || snapshot.organicTrafficTrend === 'flat') return 'medium';
  return 'low';
}

export function outdatedContentAction(reflectsCurrentServices: boolean): 'keep' | 'update_or_retire' {
  return reflectsCurrentServices ? 'keep' : 'update_or_retire';
}
