import { createHash } from 'node:crypto';
import type { AtlasMarkdownDocument } from './markdown-parser.js';

export type AtlasChunkKind = 'prose' | 'checklist' | 'table' | 'code' | 'callout';

export interface AtlasChunk {
  index: number;
  kind: AtlasChunkKind;
  content: string;
  headingPath: string[];
  groupId: string;
  checksum: string;
  previousIndex: number | null;
  nextIndex: number | null;
  tokenEstimate: number;
}

interface Block {
  kind: AtlasChunkKind;
  content: string;
  headingPath: string[];
  groupId: string;
}

function checksum(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function headingPathForLine(document: AtlasMarkdownDocument, lineNumber: number): string[] {
  let current: string[] = [];
  for (const heading of document.headings) {
    if (heading.line > lineNumber) break;
    current = heading.path;
  }
  return current;
}

function isTableStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  const next = lines[index + 1] ?? '';
  return /^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
}

function blockGroup(sourcePath: string, kind: AtlasChunkKind, headingPath: string[], ordinal: number): string {
  return checksum(`${sourcePath}|${kind}|${headingPath.join('>')}|${ordinal}`).slice(0, 24);
}

function parseBlocks(document: AtlasMarkdownDocument): Block[] {
  const lines = document.body.split('\n');
  const blocks: Block[] = [];
  let index = 0;
  let ordinal = 0;

  const pushBlock = (kind: AtlasChunkKind, contentLines: string[], startLine: number) => {
    const content = contentLines.join('\n').trim();
    if (!content) return;
    const headingPath = headingPathForLine(document, startLine);
    blocks.push({
      kind,
      content,
      headingPath,
      groupId: blockGroup(document.sourcePath, kind, headingPath, ordinal++),
    });
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;

    if (/^#{1,6}\s+/.test(line)) {
      index += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const codeLines = [line];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? '';
        codeLines.push(current);
        index += 1;
        if (/^\s*```\s*$/.test(current)) break;
      }
      pushBlock('code', codeLines, lineNumber);
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index] ?? '')) {
        tableLines.push(lines[index] ?? '');
        index += 1;
      }
      pushBlock('table', tableLines, lineNumber);
      continue;
    }

    if (/^>\s*\[![A-Za-z0-9_-]+\]/.test(line)) {
      const calloutLines = [line];
      index += 1;
      while (index < lines.length && /^>/.test(lines[index] ?? '')) {
        calloutLines.push(lines[index] ?? '');
        index += 1;
      }
      pushBlock('callout', calloutLines, lineNumber);
      continue;
    }

    if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
      const checklistLines = [line];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (!/^\s*[-*+]\s+\[[ xX]\]\s+/.test(current)) break;
        checklistLines.push(current);
        index += 1;
      }
      pushBlock('checklist', checklistLines, lineNumber);
      continue;
    }

    const proseLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (/^#{1,6}\s+/.test(current) || /^\s*```/.test(current) || isTableStart(lines, index) || /^>\s*\[![A-Za-z0-9_-]+\]/.test(current) || /^\s*[-*+]\s+\[[ xX]\]\s+/.test(current)) break;
      proseLines.push(current);
      index += 1;
    }
    pushBlock('prose', proseLines, lineNumber);
  }

  return blocks;
}

function splitLongProse(block: Block, targetChars: number): Block[] {
  if (block.kind !== 'prose' || block.content.length <= targetChars) return [block];

  const paragraphs = block.content.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const result: Block[] = [];
  let current: string[] = [];
  let ordinal = 0;

  const flush = () => {
    if (!current.length) return;
    result.push({ ...block, content: current.join('\n\n'), groupId: `${block.groupId}-${ordinal++}` });
    current = [];
  };

  for (const paragraph of paragraphs) {
    const projected = [...current, paragraph].join('\n\n');
    if (current.length && projected.length > targetChars) flush();
    current.push(paragraph);
  }
  flush();

  return result.length ? result : [block];
}

export function chunkAtlasDocument(document: AtlasMarkdownDocument, targetChars = 3200): AtlasChunk[] {
  if (!Number.isInteger(targetChars) || targetChars < 800) throw new Error('targetChars must be an integer of at least 800.');

  const blocks = parseBlocks(document).flatMap((block) => splitLongProse(block, targetChars));

  return blocks.map((block, index) => ({
    index,
    kind: block.kind,
    content: block.content,
    headingPath: block.headingPath,
    groupId: block.groupId,
    checksum: checksum(`${document.checksum}|${block.kind}|${block.headingPath.join('>')}|${block.content}`),
    previousIndex: index > 0 ? index - 1 : null,
    nextIndex: index < blocks.length - 1 ? index + 1 : null,
    tokenEstimate: estimateTokens(block.content),
  }));
}
