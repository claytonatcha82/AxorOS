export interface SalesInboundDeliveryFailureDetection {
  deliveryFailureDetected: boolean;
  matchedSignal?: string;
}

export type SalesInboundDeliveryFailureProvenance = 'provider_or_system' | 'message_content';

const DELIVERY_FAILURE_PATTERNS: readonly RegExp[] = [
  /\bundeliverable\b/i,
  /\bdelivery\s+(?:has\s+)?failed\b/i,
  /\bdelivery\s+failure\b/i,
  /\bmessage\s+not\s+delivered\b/i,
  /\baddress\s+not\s+found\b/i,
  /\brecipient\s+(?:address\s+)?rejected\b/i,
  /\bmailbox\s+(?:does\s+not\s+exist|not\s+found|unavailable)\b/i,
  /\buser\s+unknown\b/i,
  /\bno\s+such\s+(?:user|recipient|mailbox)\b/i,
];

function normalizeInboundText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function detectSalesInboundDeliveryFailure(
  text: string,
  provenance: SalesInboundDeliveryFailureProvenance = 'message_content',
): SalesInboundDeliveryFailureDetection {
  // Atlas requires delivery_failure to be grounded in provider/system evidence.
  // Bounce-like wording in ordinary message content is not authoritative evidence.
  if (provenance !== 'provider_or_system') {
    return { deliveryFailureDetected: false };
  }

  const normalized = normalizeInboundText(text);
  if (!normalized) return { deliveryFailureDetected: false };

  for (const pattern of DELIVERY_FAILURE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[0]) {
      return {
        deliveryFailureDetected: true,
        matchedSignal: match[0],
      };
    }
  }

  return { deliveryFailureDetected: false };
}
