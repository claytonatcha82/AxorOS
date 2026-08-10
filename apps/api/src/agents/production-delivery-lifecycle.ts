export interface ProductionDeploymentRecord {
  deploymentId: string;
  previousVersion: string;
  newVersion: string;
  backupStatus: 'ready' | 'not_ready';
  rollbackMethod: string;
  validationStatus: 'pending' | 'passed' | 'failed';
  deployedAt: string;
}

export interface PostLaunchValidationInput {
  siteAvailable: boolean;
  domainValid: boolean;
  sslValid: boolean;
  navigationValid: boolean;
  formsValid: boolean;
  analyticsValid: boolean;
  seoEssentialsValid: boolean;
  mobileRenderingValid: boolean;
  criticalIntegrationsValid: boolean;
  noProductionOnlyErrors: boolean;
}

export interface PostLaunchValidationResult {
  passed: boolean;
  failedChecks: Array<keyof PostLaunchValidationInput>;
}

export interface SupportHandover {
  projectId: string;
  productionUrl: string;
  hosting: string;
  domain: string;
  deploymentPlatform: string;
  repository: string;
  technologyStack: string[];
  integrations: string[];
  maintenanceRequirements: string[];
  monitoringRequirements: string[];
  backupProcess: string;
  knownLimitations: string[];
  credentialsReference: string;
  clientTrainingRequired: boolean;
  documentation: string[];
  outstandingItems: string[];
}

const POST_LAUNCH_CHECKS: Array<keyof PostLaunchValidationInput> = [
  'siteAvailable',
  'domainValid',
  'sslValid',
  'navigationValid',
  'formsValid',
  'analyticsValid',
  'seoEssentialsValid',
  'mobileRenderingValid',
  'criticalIntegrationsValid',
  'noProductionOnlyErrors',
];

export function validatePostLaunch(input: PostLaunchValidationInput): PostLaunchValidationResult {
  const failedChecks = POST_LAUNCH_CHECKS.filter((check) => !input[check]);
  return { passed: failedChecks.length === 0, failedChecks };
}

export function assertDeploymentRecordSafe(record: ProductionDeploymentRecord): void {
  if (!record.deploymentId.trim()) throw new Error('deploymentId is required.');
  if (!record.previousVersion.trim() || !record.newVersion.trim()) throw new Error('previousVersion and newVersion are required.');
  if (record.backupStatus !== 'ready') throw new Error('backup must be ready before deployment can be considered safe.');
  if (!record.rollbackMethod.trim()) throw new Error('rollbackMethod is required.');
  if (!record.deployedAt.trim()) throw new Error('deployedAt is required.');
}

export function validateSupportHandover(handover: SupportHandover): string[] {
  const errors: string[] = [];
  const requiredText: Array<keyof SupportHandover> = [
    'projectId', 'productionUrl', 'hosting', 'domain', 'deploymentPlatform', 'repository', 'backupProcess', 'credentialsReference',
  ];

  for (const field of requiredText) {
    const value = handover[field];
    if (typeof value !== 'string' || value.trim().length === 0) errors.push(`${String(field)} is required.`);
  }

  if (handover.technologyStack.length === 0) errors.push('technologyStack is required.');
  if (handover.documentation.length === 0) errors.push('documentation is required.');
  if (/password|secret|token|api[_-]?key\s*[:=]/i.test(handover.credentialsReference)) {
    errors.push('credentialsReference must point to an approved secure store and must not contain raw credentials.');
  }

  return errors;
}

export function assertSupportHandoverReady(handover: SupportHandover): void {
  const errors = validateSupportHandover(handover);
  if (errors.length > 0) throw new Error(`Support handover is not ready: ${errors.join(' ')}`);
}
