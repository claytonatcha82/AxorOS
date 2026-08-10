export interface ProductionProjectPlan {
  architecture: string;
  pages: string[];
  components: string[];
  integrations: string[];
  dependencies: string[];
  milestones: string[];
  qaStrategy: string[];
  deploymentTarget: string;
  risks: string[];
  complexity: 'low' | 'medium' | 'high';
  approvalRequirements: string[];
}

export interface ProductionProjectPlanValidation {
  valid: boolean;
  missingFields: Array<keyof ProductionProjectPlan>;
  errors: string[];
}

const REQUIRED_TEXT_FIELDS: Array<keyof ProductionProjectPlan> = ['architecture', 'deploymentTarget'];
const REQUIRED_LIST_FIELDS: Array<keyof ProductionProjectPlan> = [
  'pages',
  'components',
  'milestones',
  'qaStrategy',
  'approvalRequirements',
];

export function validateProductionProjectPlan(plan: ProductionProjectPlan): ProductionProjectPlanValidation {
  const missingFields: Array<keyof ProductionProjectPlan> = [];
  const errors: string[] = [];

  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = plan[field];
    if (typeof value !== 'string' || value.trim().length === 0) missingFields.push(field);
  }

  for (const field of REQUIRED_LIST_FIELDS) {
    const value = plan[field];
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
      missingFields.push(field);
    }
  }

  if (!['low', 'medium', 'high'].includes(plan.complexity)) errors.push('complexity must be low, medium, or high.');
  if (plan.pages.length > 0 && plan.components.length === 0) errors.push('page plans require at least one planned component.');
  if (plan.milestones.length > 0 && plan.qaStrategy.length === 0) errors.push('milestones require a QA strategy.');

  return { valid: missingFields.length === 0 && errors.length === 0, missingFields, errors };
}

export function assertProductionProjectPlanReady(plan: ProductionProjectPlan): void {
  const validation = validateProductionProjectPlan(plan);
  if (!validation.valid) {
    const details = [...validation.missingFields.map((field) => `missing:${field}`), ...validation.errors].join(', ');
    throw new Error(`Production project plan is not ready: ${details}`);
  }
}
