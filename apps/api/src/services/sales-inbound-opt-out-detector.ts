export interface SalesInboundOptOutDetection {
  optOutDetected: boolean;
  matchedPhrase?: string;
}

const EXPLICIT_OPT_OUT_PATTERNS: readonly RegExp[] = [
  /\bunsubscribe\b/i,
  /\bremove\s+me\b/i,
  /\btake\s+me\s+off\b/i,
  /\bstop\s+(?:emailing|contacting|messaging)\s+me\b/i,
  /\bdo\s+not\s+(?:email|contact|message)\s+me\b/i,
  /\bdon['’]?t\s+(?:email|contact|message)\s+me\b/i,
  /\bno\s+more\s+(?:emails?|messages?)\b/i,
];

function normalizeInboundText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function detectSalesInboundOptOut(text: string): SalesInboundOptOutDetection {
  const normalized = normalizeInboundText(text);
  if (!normalized) return { optOutDetected: false };

  for (const pattern of EXPLICIT_OPT_OUT_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[0]) {
      return {
        optOutDetected: true,
        matchedPhrase: match[0],
      };
    }
  }

  return { optOutDetected: false };
}
