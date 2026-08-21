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
  test(`detects provider-backed deterministic delivery failure: ${text}`, () => {
    const result = detectSalesInboundDeliveryFailure(text, 'provider_or_system');
    assert.equal(result.deliveryFailureDetected, true);
    assert.ok(result.matchedSignal);
  });
}

test('normalizes whitespace before provider-backed delivery-failure detection', () => {
  const result = detectSalesInboundDeliveryFailure(
    'Delivery\n  has   failed to these recipients.',
    'provider_or_system',
  );
  assert.equal(result.deliveryFailureDetected, true);
});

test('bounce-like wording in ordinary message content is not authoritative delivery-failure evidence', () => {
  const result = detectSalesInboundDeliveryFailure(
    'Undeliverable: Delivery has failed to these recipients or groups.',
    'message_content',
  );
  assert.equal(result.deliveryFailureDetected, false);
});

test('omitted provenance fails closed as ordinary message content', () => {
  assert.equal(
    detectSalesInboundDeliveryFailure('550 User unknown').deliveryFailureDetected,
    false,
  );
});

test('does not classify ordinary rejection as a delivery failure', () => {
  assert.equal(
    detectSalesInboundDeliveryFailure(
      'Thanks, but we are not interested in the service.',
      'provider_or_system',
    ).deliveryFailureDetected,
    false,
  );
});

test('does not classify a prospect discussing their own unavailable mailbox as provider evidence', () => {
  assert.equal(
    detectSalesInboundDeliveryFailure(
      'Our shared mailbox is unavailable today, so please call me instead.',
      'message_content',
    ).deliveryFailureDetected,
    false,
  );
});

test('does not infer delivery failure from generic delivery language', () => {
  assert.equal(
    detectSalesInboundDeliveryFailure(
      'Can you deliver the proposal by Friday?',
      'provider_or_system',
    ).deliveryFailureDetected,
    false,
  );
});

test('empty provider evidence is not a delivery failure', () => {
  assert.equal(
    detectSalesInboundDeliveryFailure('   ', 'provider_or_system').deliveryFailureDetected,
    false,
  );
});
