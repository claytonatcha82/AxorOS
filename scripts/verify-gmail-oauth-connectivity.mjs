const required = [
  'AXOROS_GMAIL_CLIENT_ID',
  'AXOROS_GMAIL_CLIENT_SECRET',
  'AXOROS_GMAIL_REFRESH_TOKEN',
  'AXOROS_GMAIL_IDENTITY_ADDRESSES',
];

const requireReadScope = process.argv.includes('--require-read');
const gmailThreadReadScopes = new Set([
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.metadata',
]);

for (const key of required) {
  if (!process.env[key]?.trim()) {
    console.error(`FAIL  ${key} is required for Gmail OAuth connectivity verification`);
    process.exit(1);
  }
}

let identities;
try {
  identities = JSON.parse(process.env.AXOROS_GMAIL_IDENTITY_ADDRESSES);
} catch {
  console.error('FAIL  AXOROS_GMAIL_IDENTITY_ADDRESSES is not valid JSON');
  process.exit(1);
}

if (!identities || typeof identities !== 'object' || Array.isArray(identities)) {
  console.error('FAIL  AXOROS_GMAIL_IDENTITY_ADDRESSES must be a JSON object');
  process.exit(1);
}

const salesIdentity = typeof identities.sales === 'string' ? identities.sales.trim() : '';
if (!salesIdentity) {
  console.error('FAIL  A non-empty sales identity is required in AXOROS_GMAIL_IDENTITY_ADDRESSES');
  process.exit(1);
}

async function main() {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.AXOROS_GMAIL_CLIENT_ID.trim(),
      client_secret: process.env.AXOROS_GMAIL_CLIENT_SECRET.trim(),
      refresh_token: process.env.AXOROS_GMAIL_REFRESH_TOKEN.trim(),
      grant_type: 'refresh_token',
    }),
  });

  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok || typeof tokenPayload.access_token !== 'string' || !tokenPayload.access_token.trim()) {
    const detail = tokenPayload.error_description ?? tokenPayload.error ?? `HTTP ${tokenResponse.status}`;
    throw new Error(`Gmail OAuth token refresh failed: ${detail}`);
  }

  console.log('PASS  Gmail OAuth refresh token produced a fresh access token');

  if (requireReadScope) {
    const tokenInfoResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(tokenPayload.access_token)}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
    );
    const tokenInfo = await tokenInfoResponse.json();
    if (!tokenInfoResponse.ok) {
      const detail = tokenInfo?.error_description ?? tokenInfo?.error ?? `HTTP ${tokenInfoResponse.status}`;
      throw new Error(`Gmail access-token scope inspection failed: ${detail}`);
    }

    const grantedScopes = typeof tokenInfo.scope === 'string'
      ? tokenInfo.scope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
      : [];
    if (!grantedScopes.some((scope) => gmailThreadReadScopes.has(scope))) {
      throw new Error(
        'Gmail OAuth token does not grant thread-read access. Re-authorize with gmail.readonly (preferred) or another Gmail thread-read scope.',
      );
    }

    console.log('PASS  Gmail OAuth token grants thread-read access');
  }

  const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      Accept: 'application/json',
    },
  });

  const profile = await profileResponse.json();
  if (!profileResponse.ok || typeof profile.emailAddress !== 'string' || !profile.emailAddress.trim()) {
    const detail = profile?.error?.message ?? `HTTP ${profileResponse.status}`;
    throw new Error(`Gmail profile verification failed: ${detail}`);
  }

  console.log('PASS  Gmail API profile is reachable with the refreshed token');
  console.log('PASS  Configured Sales email identity is present');

  const supervisedFlag = process.env.AXOROS_GMAIL_SUPERVISED_SALES_SEND?.trim();
  if (supervisedFlag === 'enabled') {
    console.log('PASS  Supervised Sales Gmail sending is explicitly enabled');
  } else {
    console.log('INFO  Supervised Sales Gmail sending remains disabled');
  }

  console.log('\nGmail OAuth connectivity verification passed.');
  console.log('No draft was created. No email was sent.');
}

main().catch((error) => {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
