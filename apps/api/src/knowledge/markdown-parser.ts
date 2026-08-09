import { createHash } from 'node:crypto';

export type FrontmatterValue = string | number | boolean | string[] | null;

export interface AtlasHeading {
  level: number;
  text: string;
  line: number;
  path: string[];
}

export interface AtlasWikiLink {
  target: string;
  alias?: string;
  line: number;
}

export interface AtlasCallout {
  type: string;
  title?: string;
  line: number;
}

export interface AtlasCodeFence {
  language?: string;
  startLine: number;
  endLine: number;
}

export interface AtlasMarkdownDocument {
  sourcePath: string;
  raw: string;
  checksum: string;
  frontmatterRaw?: string;
  metadata: Record<string, FrontmatterValue>;
  body: string;
  headings: AtlasHeading[];
  wikiLinks: AtlasWikiLink[];
  callouts: AtlasCallout[];
  codeFences: AtlasCodeFence[];
  hasTables: boolean;
  hasChecklists: boolean;
}

function parseScalar(value: string): FrontmatterValue {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => stripQuotes(item.trim()));
  }

  return stripQuotes(trimmed);
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseControlledFrontmatter(raw: string): Record<string, FrontmatterValue> {
  const result: Record<string, FrontmatterValue> = {};
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let activeListKey: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && activeListKey) {
      const current = result[activeListKey];
      if (!Array.isArray(current)) throw new Error(`Invalid YAML list for key ${activeListKey}.`);
      current.push(stripQuotes(listMatch[1]!.trim()));
      continue;
    }

    if (/^\s/.test(line)) {
      throw new Error(`Unsupported nested YAML at frontmatter line ${index + 1}.`);
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!keyMatch) throw new Error(`Unsupported YAML syntax at frontmatter line ${index + 1}.`);

    const key = keyMatch[1]!;
    const rawValue = keyMatch[2] ?? '';
    if (rawValue.trim() === '') {
      result[key] = [];
      activeListKey = key;
    } else {
      result[key] = parseScalar(rawValue);
      activeListKey = undefined;
    }
  }

  return result;
}

function extractFrontmatter(markdown: string): { frontmatterRaw?: string; body: string } {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { body: normalized };

  const closingIndex = normalized.indexOf('\n---\n', 4);
  if (closingIndex === -1) throw new Error('Markdown frontmatter is not closed.');

  return {
    frontmatterRaw: normalized.slice(4, closingIndex),
    body: normalized.slice(closingIndex + 5),
  };
}

function parseStructure(body: string) {
  const headings: AtlasHeading[] = [];
  const wikiLinks: AtlasWikiLink[] = [];
  const callouts: AtlasCallout[] = [];
  const codeFences: AtlasCodeFence[] = [];
  const headingStack: string[] = [];
  const lines = body.split('\n');

  let inFence = false;
  let fenceStart = 0;
  let fenceLanguage: string | undefined;
  let hasTables = false;
  let hasChecklists = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;
    const fenceMatch = line.match(/^\s*```\s*([^\s`]*)/);

    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceStart = lineNumber;
        fenceLanguage = fenceMatch[1] || undefined;
      } else {
        codeFences.push({
          startLine: fenceStart,
          endLine: lineNumber,
          ...(fenceLanguage ? { language: fenceLanguage } : {}),
        });
        inFence = false;
        fenceLanguage = undefined;
      }
      continue;
    }

    if (inFence) continue;

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!.trim();
      headingStack.length = level - 1;
      headingStack[level - 1] = text;
      headings.push({ level, text, line: lineNumber, path: headingStack.filter(Boolean) });
    }

    for (const match of line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)) {
      const target = match[1]?.trim();
      if (!target) continue;
      const alias = match[2]?.trim();
      wikiLinks.push({ target, line: lineNumber, ...(alias ? { alias } : {}) });
    }

    const calloutMatch = line.match(/^>\s*\[!([A-Za-z0-9_-]+)\][+-]?\s*(.*)$/);
    if (calloutMatch) {
      const title = calloutMatch[2]?.trim();
      callouts.push({ type: calloutMatch[1]!.toLowerCase(), line: lineNumber, ...(title ? { title } : {}) });
    }

    if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) hasChecklists = true;

    if (/^\s*\|.*\|\s*$/.test(line) && index + 1 < lines.length) {
      const next = lines[index + 1] ?? '';
      if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next)) hasTables = true;
    }
  }

  if (inFence) throw new Error(`Unclosed code fence starting at body line ${fenceStart}.`);

  return { headings, wikiLinks, callouts, codeFences, hasTables, hasChecklists };
}

export function parseAtlasMarkdown(sourcePath: string, markdown: string): AtlasMarkdownDocument {
  if (!sourcePath.trim()) throw new Error('sourcePath is required.');
  const raw = markdown.replace(/\r\n/g, '\n');
  const extracted = extractFrontmatter(raw);
  const metadata = extracted.frontmatterRaw ? parseControlledFrontmatter(extracted.frontmatterRaw) : {};
  const structure = parseStructure(extracted.body);

  return {
    sourcePath,
    raw,
    checksum: createHash('sha256').update(raw, 'utf8').digest('hex'),
    ...(extracted.frontmatterRaw !== undefined ? { frontmatterRaw: extracted.frontmatterRaw } : {}),
    metadata,
    body: extracted.body,
    ...structure,
  };
}
