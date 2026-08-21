import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSalesInboundDeliveryFailure } from './sales-inbound-delivery-failure-detector.js';

const deliveryFailures = [
  'Undeliverable: Your message could not be delivered.',
  'Delivery has failed to these recipients or groups.',
  'Delivery failure: recipient unavailable.',
  'Message not delivered. There was a problem delivering your message.',
  'Address not found. Your message was not delivered.',
  'Recipient address rejected: User unknown.',
  'The mailbox does not exist.',
  '550 User unknown',
  '550 No such user here.',
];

for (const text of deliveryFailures) {
  test(`detects deterministic delivery failure: ${text}`, () => {
    const result = detectSalesInboundDeliveryFailure(text);
    assert.equal(result.deliveryFailureDetected, true);
    assert.ok(result.matchedSignal);
  });
}

test('normalizes whitespace before delivery-failure detection', () => {
  const result = detectSalesInboundDeliveryFailure('Delivery\n  has   failed to these recipients.');
  assert.equal(result.deliveryFailureDetected, true);
});

test('does not classify ordinary rejection as a delivery failure', () => {
  assert.equal(
    detectSalesInboundDeliveryFailure('Thanks, but we are not interested in the service.')
      .deliveryFailureDetected,
    false,
  );
});

test('does not classify a prospect discussing their own unavailable mailbox as provider evidence', () => {
  assert.equal(
    detectSalesInboundDeliveryFailure('Our shared mailbox is unavailable today, so please call me instead.')
      .deliveryFailureDetected,
    false,
  );
});

test('does not infer delivery failure from generic delivery language', () => {
  assert.equal(
    detectSalesInboundDeliveryFailure('Can you deliver the proposal by Friday?')
      .deliveryFailureDetected,
    false,
  );
});

test('empty text is not a delivery failure', () => {
  assert.equal(detectSalesInboundDeliveryFailure('   ').deliveryFailureDetected, false);
});
