export interface SupportHandover {
  projectId: string;
  clientId: string;
  productionUrl: string;
  technologyStack: string[];
  repository: string;
  hosting: string;
  domain: string;
  deploymentPlatform: string;
  integrations: string[];
  monitoringRequirements: string[];
  backupProcess: string;
  maintenancePlan: string;
  supportEntitlement: string;
  credentialsReference: string;
  knownLimitations: string[];
  clientContacts: string[];
  documentation: string[];
  renewalDates: string[];
  openItems: string[];
  websiteLive: boolean;
  postLaunchValidationPassed: boolean;
  technicalDocumentationComplete: boolean;
  credentialsReferencedSecurely: boolean;
  maintenanceRequirementsDefined: boolean;
  clientHandoverComplete: boolean;
}

export function supportActivationGate(handover: SupportHandover): { allowed: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!handover.websiteLive) missing.push('websiteLive');
  if (!handover.postLaunchValidationPassed) missing.push('postLaunchValidationPassed');
  if (!handover.technicalDocumentationComplete) missing.push('technicalDocumentationComplete');
  if (!handover.credentialsReferencedSecurely) missing.push('credentialsReferencedSecurely');
  if (!handover.maintenanceRequirementsDefined) missing.push('maintenanceRequirementsDefined');
  if (!handover.clientHandoverComplete) missing.push('clientHandoverComplete');
  if (!handover.projectId.trim()) missing.push('projectId');
  if (!handover.clientId.trim()) missing.push('clientId');
  if (!handover.credentialsReference.trim()) missing.push('credentialsReference');
  return { allowed: missing.length === 0, missing };
}
