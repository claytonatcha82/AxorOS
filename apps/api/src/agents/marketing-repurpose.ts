export type RepurposeChannel = 'blog' | 'linkedin' | 'newsletter' | 'portfolio_page';

export interface ApprovedMarketingSource {
  sourceId: string;
  approved: boolean;
  knowledgeReferences: string[];
  factualClaimsVerified: boolean;
}

export interface RepurposeRequest {
  source: ApprovedMarketingSource;
  channels: RepurposeChannel[];
}

export function validateRepurposeRequest(request: RepurposeRequest): string[] {
  const errors: string[] = [];
  if (!request.source.sourceId.trim()) errors.push('sourceId is required.');
  if (!request.source.approved) errors.push('source must be approved.');
  if (!request.source.factualClaimsVerified) errors.push('source factual claims must be verified.');
  if (request.source.knowledgeReferences.length === 0) errors.push('knowledgeReferences are required.');
  if (request.channels.length === 0) errors.push('at least one channel is required.');
  if (new Set(request.channels).size !== request.channels.length) errors.push('channels must not contain duplicates.');
  return errors;
}

export function createRepurposeJobs(request: RepurposeRequest): Array<{ sourceId: string; channel: RepurposeChannel }> {
  const errors = validateRepurposeRequest(request);
  if (errors.length) throw new Error(errors.join(' '));
  return request.channels.map((channel) => ({ sourceId: request.source.sourceId, channel }));
}
