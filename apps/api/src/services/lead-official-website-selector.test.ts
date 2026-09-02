import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOfficialWebsite } from './lead-official-website-selector.js';

test('selects a strong first-party website candidate and derives the durable name from public-web evidence', () => {
  const result = selectOfficialWebsite({ businessName: 'Acme Engineering', results: [
    { title: 'Acme Engineering | Industrial Solutions', url: 'https://acmeengineering.co.za/services', content: 'Industrial engineering services.' },
    { title: 'Acme Engineering on Facebook', url: 'https://facebook.com/acmeengineering', content: 'Social profile.' },
  ] });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') {
    assert.equal(result.websiteUrl, 'https://acmeengineering.co.za/');
    assert.equal(result.companyName, 'Acme Engineering');
  }
});

test('fails closed when competing domains have equal identity evidence', () => {
  const result = selectOfficialWebsite({ businessName: 'Acme Engineering', results: [
    { title: 'Acme Engineering', url: 'https://acmeengineering.co.za/', content: 'Candidate.' },
    { title: 'Acme Engineering', url: 'https://acme-engineering.com/', content: 'Candidate.' },
  ] });
  assert.equal(result.status, 'ambiguous');
});

test('rejects social and directory results as official websites', () => {
  const result = selectOfficialWebsite({ businessName: 'Acme Engineering', results: [
    { title: 'Acme Engineering', url: 'https://www.facebook.com/acmeengineering', content: 'Social.' },
    { title: 'Acme Engineering', url: 'https://www.linkedin.com/company/acme-engineering', content: 'Profile.' },
  ] });
  assert.equal(result.status, 'not_found');
});

test('rejects observed map and directory hosts from the pilot without suppressing first-party candidates', () => {
  const thirdPartyResults = [
    { title: 'Rhino Valves (Pty) Ltd', url: 'https://rsa.worldorgs.com/catalog/benoni/valve-supplier/rhino-valves', content: 'Business listing.' },
    { title: 'South Zambezi Engineering Services (Pty) Ltd', url: 'https://www.waze.com/live-map/directions', content: 'Driving directions.' },
    { title: 'Fountain Civil Engineering (Pty) Ltd', url: 'https://www.goafricaonline.com/company/fountain-civil-engineering', content: 'Business directory listing.' },
    { title: 'Hersol Manufacturing Laboratories', url: 'https://sanha.org.za/member/hersol', content: 'Industry directory listing.' },
    { title: 'Company profile', url: 'https://cylex.net.za/company/acme-engineering', content: 'Business directory listing.' },
    { title: 'Acme Engineering', url: 'https://www.africabizinfo.com/acme-engineering', content: 'Business directory listing.' },
    { title: 'Acme Engineering', url: 'https://www.steel-technology.com/acme-engineering', content: 'Industry portal listing.' },
  ];
  const result = selectOfficialWebsite({
    businessName: 'Acme Engineering',
    results: [
      ...thirdPartyResults,
      { title: 'Acme Engineering | Industrial Solutions', url: 'https://acmeengineering.co.za/services', content: 'Official company website.' },
    ],
  });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') {
    assert.equal(result.websiteUrl, 'https://acmeengineering.co.za/');
  }
});

test('returns not_found when only observed third-party hosts remain', () => {
  const result = selectOfficialWebsite({ businessName: 'Rhino Valves', results: [
    { title: 'Rhino Valves', url: 'https://rsa.worldorgs.com/catalog/benoni/rhino-valves', content: 'Directory listing.' },
    { title: 'Rhino Valves', url: 'https://www.waze.com/live-map/directions', content: 'Map listing.' },
    { title: 'Rhino Valves', url: 'https://www.cylex.net.za/company/rhino-valves', content: 'Directory listing.' },
  ] });
  assert.equal(result.status, 'not_found');
});

test('rejects domain-mismatch search results that merely repeat the business name', () => {
  const falsePositiveCases = [
    { businessName: 'ALENG Engineering Services (Pty) Ltd', title: 'ALENG Engineering Services', url: 'https://magicpin.com/ALENG-engineering', content: 'ALENG Engineering Services. Business listing.' },
    { businessName: 'Hersol Manufacturing Laboratories', title: 'Hersol Manufacturing Laboratories', url: 'https://pharmaboardroom.com/hersol', content: 'Hersol Manufacturing Laboratories. Industry profile.' },
    { businessName: 'PARNIS MANUFACTURING - Steel Technology', title: 'PARNIS MANUFACTURING - Steel Technology', url: 'https://www.steel-technology.com/parnis', content: 'PARNIS MANUFACTURING. Industry portal listing.' },
    { businessName: 'NATCO LOGISTICS', title: 'NATCO LOGISTICS', url: 'https://freightglobal.com/natco-logistics', content: 'NATCO LOGISTICS. Freight marketplace listing.' },
  ];

  for (const input of falsePositiveCases) {
    const result = selectOfficialWebsite({ businessName: input.businessName, results: [input] });
    assert.equal(result.status, 'not_found', `unexpected official site selected for ${input.businessName}`);
  }
});

test('uses matching Google Places location evidence only as a tie-breaker between equally strong identities', () => {
  const result = selectOfficialWebsite({
    businessName: 'Acme Engineering',
    formattedAddress: '12 Example Road, Durban, KwaZulu-Natal, South Africa',
    results: [
      { title: 'Acme Engineering', url: 'https://acmeengineering.co.za/', content: 'Engineering services based in Durban, KwaZulu-Natal.' },
      { title: 'Acme Engineering', url: 'https://acme-engineering.com/', content: 'Engineering services based in Cape Town, Western Cape.' },
    ],
  });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') {
    assert.equal(result.websiteUrl, 'https://acmeengineering.co.za/');
  }
});

test('still fails closed when equal-identity candidates have equal location evidence', () => {
  const result = selectOfficialWebsite({
    businessName: 'Acme Engineering',
    formattedAddress: 'Durban, KwaZulu-Natal, South Africa',
    results: [
      { title: 'Acme Engineering', url: 'https://acmeengineering.co.za/', content: 'Engineering services in Durban.' },
      { title: 'Acme Engineering', url: 'https://acme-engineering.com/', content: 'Engineering services in Durban.' },
    ],
  });
  assert.equal(result.status, 'ambiguous');
});
