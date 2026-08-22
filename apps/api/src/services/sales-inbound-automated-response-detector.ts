export interface SalesInboundAutomatedResponseDetection {
  automatedResponseDetected: boolean;
  matchedSignal?: string;
}

const AUTOMATED_RESPONSE_PATTERNS: readonly RegExp[] = [
  /\bout\s+of\s+(?:the\s+)?office\b/i,
  /\bautomatic\s+reply\b/i,
  /\bauto(?:matic)?[-\s]?reply\b/i,
  /\baway\s+from\s+(?:the\s+)?office\b/i,
  /\bcurrently\s+away\b/i,
  /\bon\s+(?:annual\s+)?leave\b/i,
  /\bvacation\s+(?:reply|response)\b/i,
];

function normalizeInboundText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function detectSalesInboundAutomatedResponse(
  text: string,
): SalesInboundAutomatedResponseDetection {
  const normalized = normalizeInboundText(text);
  if (!normalized) return { automatedResponseDetected: false };

  for (const pattern of AUTOMATED_RESPONSE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[0]) {
      return {
        automatedResponseDetected: true,
        matchedSignal: match[0],
      };
    }
  }

  return { automatedResponseDetected: false };
}
