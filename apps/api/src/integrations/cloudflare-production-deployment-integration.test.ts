import { describe, expect, it, vi } from 'vitest';
import { createCloudflareProductionDeploymentIntegration } from './cloudflare-production-deployment-integration.js';

const asset = {
  path: '/index.html',
  contentHash: '0123456789abcdef0123456789abcdef',
  contentType: 'text/html; charset=utf-8',
  contentBase64: Buffer.from('<html></html>').toString('base64'),
};

function request() {
  return {
    integrationId: 'deployment.cloudflare.production',
    operation: 'deploy_production',
    requestedBy: 'human_executive' as const,
    executionId: 'exec-1',
    correlationId: 'corr-1',
    mode: 'live' as const,
    risk: 'critical' as const,
    idempotencyKey: 'deploy-production-1',
    input: {
      projectName: 'client-site',
      productionBranch: 'main',
      assets: [asset],
      buildOutputDirectory: 'dist',
    },
  };
}

describe('Cloudflare production deployment integration', () => {
  it('uploads missing assets and creates a production deployment on the production branch', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { jwt: 'upload-jwt' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [asset.contentHash] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: { id: 'deployment-1', environment: 'production', url: 'https://client-site.pages.dev', latest_stage: { status: 'success' } },
      }), { status: 200 }));

    const integration = createCloudflareProductionDeploymentIntegration({
      accountId: 'account-1',
      apiToken: 'secret-token',
      fetchImpl,
      baseUrl: 'https://cloudflare.test',
    });

    const result = await integration.execute(request());
    expect(result.status).toBe('succeeded');
    expect(result.output.environment).toBe('production');
    expect(result.output.deploymentId).toBe('deployment-1');
    expect(result.evidenceReferences).toEqual(['cloudflare:pages:production:deployment-1']);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const deploymentCall = fetchImpl.mock.calls[3];
    expect(String(deploymentCall?.[0])).toContain('/pages/projects/client-site/deployments');
    const form = deploymentCall?.[1]?.body as FormData;
    expect(form.get('branch')).toBe('main');
  });

  it('blocks callers other than Production or the Human Executive before network execution', async () => {
    const fetchImpl = vi.fn();
    const integration = createCloudflareProductionDeploymentIntegration({ accountId: 'account-1', apiToken: 'secret-token', fetchImpl });
    const result = await integration.execute({ ...request(), requestedBy: 'operations_agent' });
    expect(result.status).toBe('blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when Cloudflare returns a non-production environment', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { jwt: 'upload-jwt' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { id: 'deployment-2', environment: 'preview' } }), { status: 200 }));
    const integration = createCloudflareProductionDeploymentIntegration({ accountId: 'account-1', apiToken: 'secret-token', fetchImpl });
    const result = await integration.execute(request());
    expect(result.status).toBe('failed');
    expect(result.output.environment).toBe('production');
    expect(result.output.providerErrorMessage).toContain('did not classify');
  });

  it('redacts the API token from provider errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      success: false,
      errors: [{ code: 9100, message: 'bad secret-token credential' }],
    }), { status: 403 }));
    const integration = createCloudflareProductionDeploymentIntegration({ accountId: 'account-1', apiToken: 'secret-token', fetchImpl });
    const result = await integration.execute(request());
    expect(result.status).toBe('failed');
    expect(result.output.providerErrorMessage).toContain('[REDACTED]');
    expect(result.output.providerErrorMessage).not.toContain('secret-token');
  });
});
