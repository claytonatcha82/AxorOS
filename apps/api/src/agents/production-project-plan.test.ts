import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProductionProjectPlanReady, validateProductionProjectPlan, type ProductionProjectPlan } from './production-project-plan.js';

function validPlan(): ProductionProjectPlan {
  return {
    architecture: 'React/Vite static website using approved AxorOS patterns.',
    pages: ['Home', 'About', 'Services', 'Contact'],
    components: ['Navigation', 'Hero', 'ServiceCards', 'ContactForm', 'Footer'],
    integrations: ['Contact form delivery'],
    dependencies: ['Approved client content', 'Approved imagery'],
    milestones: ['Architecture approved', 'Build complete', 'QA complete', 'Deployment approved'],
    qaStrategy: ['functional', 'visual', 'technical', 'content'],
    deploymentTarget: 'approved test environment before production approval',
    risks: ['Late client content'],
    complexity: 'medium',
    approvalRequirements: ['architecture approval', 'production deployment approval'],
  };
}

test('complete production project plan is accepted', () => {
  const validation = validateProductionProjectPlan(validPlan());
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.missingFields, []);
  assert.deepEqual(validation.errors, []);
  assert.doesNotThrow(() => assertProductionProjectPlanReady(validPlan()));
});

test('project plan is blocked when architecture and delivery structure are incomplete', () => {
  const plan = validPlan();
  plan.architecture = '';
  plan.pages = [];
  plan.milestones = [];

  const validation = validateProductionProjectPlan(plan);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.missingFields, ['architecture', 'pages', 'milestones']);
  assert.throws(() => assertProductionProjectPlanReady(plan), /Production project plan is not ready/);
});

test('project plan requires components for planned pages', () => {
  const plan = validPlan();
  plan.components = [];
  const validation = validateProductionProjectPlan(plan);
  assert.equal(validation.valid, false);
  assert.ok(validation.missingFields.includes('components'));
  assert.ok(validation.errors.includes('page plans require at least one planned component.'));
});

test('project plan rejects invalid complexity classifications at runtime', () => {
  const plan = { ...validPlan(), complexity: 'extreme' } as unknown as ProductionProjectPlan;
  const validation = validateProductionProjectPlan(plan);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('complexity must be low, medium, or high.'));
});
