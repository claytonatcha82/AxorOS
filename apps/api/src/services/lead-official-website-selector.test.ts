import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOfficialWebsite } from './lead-official-website-selector.js';

test('selects a strong first-party website and preserves the Google Places business name', () => {
  const result = selectOfficialWebsite({ businessName: 'Acme Engineering', results: [
    { title: 'Home - Acme Engineering', url: 'https://acmeengineering.co.za/services', content: 'Acme Engineering provides industrial engineering services.' },
    { title: 'Acme Engineering on Facebook', url: 'https://facebook.com/acmeengineering', content: 'Social profile.' },
  ] });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') {
    assert.equal(result.websiteUrl, 'https://acmeengineering.co.za/');
    assert.equal(result.companyName, 'Acme Engineering');
  }
});

test('does not derive the canonical name from a polluted first-party search title', () => {
  const result = selectOfficialWebsite({ businessName: 'Dennes Engineering', results: [
    { title: 'Dennes Engineering :: Contact Us - Cape Town', url: 'https://dennesengineering.co.za/contact', content: 'Dennes Engineering. Contact us for engineering services. enquiries@dennesengineering.co.za. +27 21 555 0100.' },
  ] });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') {
    assert.equal(result.websiteUrl, 'https://dennesengineering.co.za/');
    assert.equal(result.companyName, 'Dennes Engineering');
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
  if (result.status === 'selected') assert.equal(result.websiteUrl, 'https://acmeengineering.co.za/');
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

test('rejects an unknown directory domain even when the listing contains strong business contact evidence', () => {
  const result = selectOfficialWebsite({
    businessName: 'TFD Manufacturing',
    results: [{ title: 'TFD Manufacturing - Western Cape Online', url: 'https://www.western-cape.online/item/tfd-manufacturing/', content: 'TFD Manufacturing. Business directory listing. Somerset West. +27 21 852 8777. Contact details and company profile.' }],
  });
  assert.equal(result.status, 'not_found');
});

test('selects the first-party TFD Manufacturing website over an unknown directory result', () => {
  const result = selectOfficialWebsite({
    businessName: 'TFD Manufacturing',
    results: [
      { title: 'TFD Manufacturing - Western Cape Online', url: 'https://www.western-cape.online/item/tfd-manufacturing/', content: 'TFD Manufacturing. Business directory listing. Somerset West. +27 21 555 8777. Contact details and company profile.' },
      { title: 'Steel Fabrication and Laser Cutting Somerset West | TFD Manufacturing', url: 'https://www.tfdm.co.za/', content: 'TFD Manufacturing and TFDM Laser support metal projects through laser cutting, CNC bending and rolling, welding, fabrication and finishing. Contact the Team. Manufacturing +27 21 555 8777. 24 Delson Close, Somerset West Business Park, Somerset West, South Africa.' },
    ],
  });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') assert.equal(result.websiteUrl, 'https://www.tfdm.co.za/');
});

test('does not reject a first-party contact page merely because it contains directions or a map', () => {
  const result = selectOfficialWebsite({
    businessName: 'Acme Engineering',
    results: [{ title: 'Contact Acme Engineering | Get Directions', url: 'https://acme-engineering.co.za/contact', content: 'Acme Engineering. Contact us for engineering services. Get directions to our Durban office. View map. +27 31 555 0100. enquiries@acme-engineering.co.za.' }],
  });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') assert.equal(result.websiteUrl, 'https://acme-engineering.co.za/');
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
  if (result.status === 'selected') assert.equal(result.websiteUrl, 'https://acmeengineering.co.za/');
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

test('rejects constructioncompanies.co.za directory domain for Archstone Construction', () => {
  const result = selectOfficialWebsite({
    businessName: 'Archstone Construction (Pty) Ltd',
    results: [{ title: 'Archstone Construction (Pty) Ltd Information', url: 'https://constructioncompanies.co.za/', content: 'Archstone Construction (Pty) Ltd. Contact details. +27 11 555 0100. info@archstone.co.za. About the company.' }],
  });
  assert.equal(result.status, 'not_found');
});

test('rejects constructionsouthafrica.co.za directory domain for Amandla Construction', () => {
  const result = selectOfficialWebsite({
    businessName: 'Amandla Construction',
    results: [{ title: 'Amandla Construction', url: 'https://www.constructionsouthafrica.co.za/', content: 'Amandla Construction. Building and civil engineering services. Contact us for a quote.' }],
  });
  assert.equal(result.status, 'not_found');
});

test('rejects constructionsouthafrica.co.za directory domain for Naude Construction', () => {
  const result = selectOfficialWebsite({
    businessName: 'Naude Construction',
    results: [{ title: 'Naude Construction', url: 'https://www.constructionsouthafrica.co.za/', content: 'Naude Construction. General building contractor. Phone +27 21 555 0200.' }],
  });
  assert.equal(result.status, 'not_found');
});

test('selects blackmahoganycivils.co.za as first-party for Black Mahogany Civils', () => {
  const result = selectOfficialWebsite({
    businessName: 'Black Mahogany Civils',
    results: [{ title: 'Black Mahogany Civils | Home', url: 'https://blackmahoganycivils.co.za/', content: 'Black Mahogany Civils provides civil engineering and construction services in Gauteng. Contact us for projects.' }],
  });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') {
    assert.equal(result.websiteUrl, 'https://blackmahoganycivils.co.za/');
    assert.equal(result.companyName, 'Black Mahogany Civils');
  }
});

test('rejects generic Company Information listing titles as first-party evidence', () => {
  const result = selectOfficialWebsite({
    businessName: 'SteelWorks Manufacturing',
    results: [{ title: 'SteelWorks Manufacturing Company Information', url: 'https://steelworks.example.co.za/', content: 'SteelWorks Manufacturing. Industrial steel fabrication. Contact: +27 11 555 0300.' }],
  });
  assert.equal(result.status, 'not_found');
});

test('rejects generic Home - Company listing titles as first-party evidence', () => {
  const result = selectOfficialWebsite({
    businessName: 'Precision Engineering',
    results: [{ title: 'Home - Precision Engineering', url: 'https://precision.example.co.za/', content: 'Precision Engineering. CNC machining and fabrication.' }],
  });
  assert.equal(result.status, 'not_found');
});

test('rejects generic Contact Company listing titles as first-party evidence', () => {
  const result = selectOfficialWebsite({
    businessName: 'Delta Projects',
    results: [{ title: 'Contact Delta Projects', url: 'https://delta.example.co.za/', content: 'Delta Projects. Construction and project management.' }],
  });
  assert.equal(result.status, 'not_found');
});

test('rejects generic Company :: Contact Us listing titles as first-party evidence', () => {
  const result = selectOfficialWebsite({
    businessName: 'Omega Builders',
    results: [{ title: 'Omega Builders :: Contact Us', url: 'https://omega.example.co.za/', content: 'Omega Builders. Residential and commercial construction.' }],
  });
  assert.equal(result.status, 'not_found');
});

test('rejects directory domain even when title contains business name and contact info', () => {
  const result = selectOfficialWebsite({
    businessName: 'Metro Construction',
    results: [{ title: 'Metro Construction - Official Website', url: 'https://constructioncompanies.co.za/metro', content: 'Metro Construction official page. Contact: +27 11 555 0400. info@metro.co.za.' }],
  });
  assert.equal(result.status, 'not_found');
});
