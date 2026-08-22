import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSalesInboundAutomatedResponse } from './sales-inbound-automated-response-detector.js';

const automatedResponses = [
  'Out of office until Monday.',
  'I am out of the office and will respond when I return.',
  'Automatic reply: Thank you for your email.',
  'Auto-reply: I am currently unavailable.',
  'I am away from the office this week.',
  'I am currently away and will respond later.',
  'I am on annual leave until 2 September.',
  'Vacation reply: I will have limited access to email.',
];

for (const text of automatedResponses) {
  test(`detects deterministic automated response: ${text}`, () => {
    const result = detectSalesInboundAutomatedResponse(text);
    assert.equal(result.automatedResponseDetected, true);
    assert.ok(result.matchedSignal);
  });
}

test('normalizes whitespace before automated-response detection', () => {
  const result = detectSalesInboundAutomatedResponse('I am\n  out   of the office until Monday.');
  assert.equal(result.automatedResponseDetected, true);
});

test('does not classify ordinary positive interest as an automated response', () => {
  assert.equal(
    detectSalesInboundAutomatedResponse('Thanks, I am interested. Please send more information.')
      .automatedResponseDetected,
    false,
  );
});

test('does not classify ordinary rejection as an automated response', () => {
  assert.equal(
    detectSalesInboundAutomatedResponse('Thanks for reaching out, but we are not interested.')
      .automatedResponseDetected,
    false,
  );
});

test('does not infer automation from generic unavailability', () => {
  assert.equal(
    detectSalesInboundAutomatedResponse('I am unavailable for a meeting today, but tomorrow works.')
      .automatedResponseDetected,
    false,
  );
});

test('empty text is not an automated response', () => {
  assert.equal(detectSalesInboundAutomatedResponse('   ').automatedResponseDetected, false);
});
