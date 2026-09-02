import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOfficialWebsite } from './lead-official-website-selector.js';

test('selects a strong first-party website candidate and derives the durable name from public-web evidence', () => {
  const result = selectOfficialWebsite({ businessName: 'Acme Engineering', results: [
    { title: 'Acme Engineering | Industrial Solutions', url: 'https://acmeengineering.co.za/services', content: 'Acme Engineering provides industrial engineering services.' },
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
    { title: 'Acme Engineering', url: 'https://acmeengineering.co.za/', content: 'Acme Engineering candidate.' },
    { title: 'Acme Engineering', url: 'https://acme-engineering.com/', content: 'Acme Engineering candidate.' },
  ] });
  assert.equal(result.status, 'ambiguous');
});

test('rejects social and directory results as official websites', () => {
  const result = selectOfficialWebsite({ businessName: 'Acme Engineering', results: [
    { title: 'Acme Engineering', url: 'https://www.facebook.com/acmeengineering', content: 'Social.' },
    { title: 'Acme Engineering', url: 'https://www.linkedin.com/company/acme-engineering', content: 'Profile.' },
    { title: 'Acme Engineering', url: 'https://www.waze.com/live-map/directions/acme-engineering', content: 'Map listing.' },
    { title: 'Acme Engineering', url: 'https://rsa.worldorgs.com/catalog/example/acme-engineering', content: 'Business directory listing.' },
    { title: 'Acme Engineering', url: 'https://www.goafricaonline.com/example/acme-engineering', content: 'Directory listing.' },
  ] });
  assert.equal(result.status, 'not_found');
});

test('does not mistake a third-party organization page for the business website', () => {
  const result = selectOfficialWebsite({ businessName: 'Hersol Manufacturing Laboratories', results: [
    { title: 'Hersol Manufacturing Laboratories - SANHA', url: 'https://sanha.org.za/certified-establishments/categories/pharmaceutical/', content: 'Hersol Manufacturing Laboratories is listed among certified establishments.' },
  ] });
  assert.equal(result.status, 'not_found');
});

test('uses matching Google Places location evidence only as a tie-breaker between equally strong identities', () => {
  const result = selectOfficialWebsite({
    businessName: 'Acme Engineering',
    formattedAddress: '12 Example Road, Durban, KwaZulu-Natal, South Africa',
    results: [
      { title: 'Acme Engineering', url: 'https://acmeengineering.co.za/', content: 'Acme Engineering provides engineering services based in Durban, KwaZulu-Natal.' },
      { title: 'Acme Engineering', url: 'https://acme-engineering.com/', content: 'Acme Engineering provides engineering services based in Cape Town, Western Cape.' },
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
      { title: 'Acme Engineering', url: 'https://acmeengineering.co.za/', content: 'Acme Engineering provides engineering services in Durban.' },
      { title: 'Acme Engineering', url: 'https://acme-engineering.com/', content: 'Acme Engineering provides engineering services in Durban.' },
    ],
  });
  assert.equal(result.status, 'ambiguous');
});
