import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOfficialWebsite } from './lead-official-website-selector.js';

test('rejects unrelated Semper Gumby site for South African Semper Prima Builders', () => {
  const result = selectOfficialWebsite({
    businessName: 'SEMPER PRIMA BUILDERS',
    formattedAddress: '9 Binne St, George Industria, George, Western Cape, South Africa',
    results: [{
      title: 'Custom Decks & Docks in SW Michigan | Semper Gumby',
      url: 'https://www.sempergumbyconstruction.com/',
      content: 'Semper Gumby Construction is based in Benton Harbor, Michigan and serves Southwest Michigan. Custom decks, docks and outdoor construction.',
    }],
  });
  assert.equal(result.status, 'not_found');
});

test('rejects Property24 as the official site for Universal Property Improvement and Construction', () => {
  const result = selectOfficialWebsite({
    businessName: 'Universal Property Improvement and Construction',
    formattedAddress: 'Milnerton, Cape Town, Western Cape, South Africa',
    results: [{
      title: 'Universal Property Improvement and Construction | Property24',
      url: 'https://www.property24.com/',
      content: 'Universal Property Improvement and Construction. Property listings and property information.',
    }],
  });
  assert.equal(result.status, 'not_found');
});

test('still selects a genuine multi-word first-party hostname', () => {
  const result = selectOfficialWebsite({
    businessName: 'Black Mahogany Civils',
    formattedAddress: 'Gauteng, South Africa',
    results: [{
      title: 'Black Mahogany Civils | Home',
      url: 'https://blackmahoganycivils.co.za/',
      content: 'Black Mahogany Civils provides civil engineering and construction services in Gauteng, South Africa.',
    }],
  });
  assert.equal(result.status, 'selected');
  if (result.status === 'selected') assert.equal(result.websiteUrl, 'https://blackmahoganycivils.co.za/');
});
