import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSalesInboundOptOut } from './sales-inbound-opt-out-detector.js';

const explicitOptOuts = [
  'Unsubscribe',
  'Please remove me from your mailing list.',
  'Take me off this list please.',
  'Stop emailing me.',
  'Please stop contacting me.',
  'Do not contact me again.',
  "Don't email me anymore.",
  'No more emails please.',
];

for (const text of explicitOptOuts) {
  test(`detects explicit Sales opt-out: ${text}`, () => {
    const result = detectSalesInboundOptOut(text);
    assert.equal(result.optOutDetected, true);
    assert.ok(result.matchedPhrase);
  });
}

test('normalises whitespace before evaluating an explicit opt-out', () => {
  const result = detectSalesInboundOptOut('Please   do not\ncontact   me again.');
  assert.equal(result.optOutDetected, true);
});

test('does not treat ordinary rejection as an opt-out', () => {
  const result = detectSalesInboundOptOut('Thanks, but we are not interested at this time.');
  assert.deepEqual(result, { optOutDetected: false });
});

test('does not treat an objection as an opt-out', () => {
  const result = detectSalesInboundOptOut('This sounds useful, but it may be outside our budget.');
  assert.deepEqual(result, { optOutDetected: false });
});

test('does not infer opt-out from ambiguous text', () => {
  const result = detectSalesInboundOptOut('Okay, thanks.');
  assert.deepEqual(result, { optOutDetected: false });
});

test('empty text is not classified as an opt-out', () => {
  assert.deepEqual(detectSalesInboundOptOut('   '), { optOutDetected: false });
});
