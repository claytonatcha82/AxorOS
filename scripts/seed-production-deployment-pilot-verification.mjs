import { Pool } from 'pg';
import { ProductionDeploymentAuthorityPostgresStore } from '../apps/api/dist/data/production-deployment-authority-postgres-store.js';

const databaseUrl = process.env.AXOROS_DATABASE_URL;
if (!databaseUrl) throw new Error('AXOROS_DATABASE_URL is required.');

const authorityId = 'deployment-authority:pilot-production-verification';
const commercialRecordReference = 'pilot-production-verification';
const projectName = 'axoros-pilot-production-verification';
const approvedAt = '2026-08-26T08:00:00.000Z';

const pool = new Pool({ connectionString: databaseUrl });

try {
  const store = new ProductionDeploymentAuthorityPostgresStore(pool);
  const result = await store.save({
    authorityId,
    commercialRecordReference,
    projectName,
    codeQaPassed: true,
    functionalQaPassed: true,
    visualQaPassed: true,
    businessQaPassed: true,
    clientApproved: true,
    requiredFinalPaymentConditionMet: true,
    rollbackPrepared: true,
    seoChecked: true,
    securityChecked: true,
    deploymentApproved: true,
    evidenceReferences: [
      'verification:code-qa',
      'verification:functional-qa',
      'verification:visual-qa',
      'verification:business-qa',
      'verification:client-approval',
      'verification:final-payment-condition',
      'verification:rollback-ready',
      'verification:seo-check',
      'verification:security-check',
      'verification:deployment-approval',
    ],
    approvedBy: 'human_executive:pilot-verification',
    approvedAt,
  });

  console.log(`PASS  Strict production deployment authority ${result}.`);
  console.log(`authorityId=${authorityId}`);
  console.log(`commercialRecordReference=${commercialRecordReference}`);
  console.log(`projectName=${projectName}`);
} finally {
  await pool.end();
}
