import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_CONTROL_PLANE_TOKEN_LENGTH = 32;

export interface ControlPlaneAuthResult {
  authenticated: boolean;
  reason?: 'not_configured' | 'missing_bearer_token' | 'invalid_bearer_token';
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function validateControlPlaneToken(token: string | undefined): string | undefined {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length < MIN_CONTROL_PLANE_TOKEN_LENGTH) {
    throw new Error(`AXOROS_CONTROL_PLANE_TOKEN must be at least ${MIN_CONTROL_PLANE_TOKEN_LENGTH} characters.`);
  }
  return trimmed;
}

export function authenticateControlPlaneRequest(
  authorizationHeader: string | undefined,
  configuredToken: string | undefined,
): ControlPlaneAuthResult {
  if (!configuredToken) return { authenticated: false, reason: 'not_configured' };

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader?.trim() ?? '');
  if (!match) return { authenticated: false, reason: 'missing_bearer_token' };

  const suppliedToken = match[1]?.trim() ?? '';
  if (!suppliedToken) return { authenticated: false, reason: 'missing_bearer_token' };

  const expectedDigest = digest(configuredToken);
  const suppliedDigest = digest(suppliedToken);
  if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
    return { authenticated: false, reason: 'invalid_bearer_token' };
  }

  return { authenticated: true };
}
