import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeFingerprint } from './knowledge-repository.js';

export interface AtlasSourceFile {
  absolutePath: string;
  relativePath: string;
  checksum: string;
  lastModified: string;
  sizeBytes: number;
}

export interface AtlasChangeSet {
  added: AtlasSourceFile[];
  changed: AtlasSourceFile[];
  unchanged: AtlasSourceFile[];
  missingFromSource: KnowledgeFingerprint[];
}

const ignoredDirectoryNames = new Set(['.git', '.obsidian', 'node_modules', '.trash', '.Trash']);

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/');
}

async function checksumFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function walkMarkdown(rootPath: string, currentPath: string, results: AtlasSourceFile[]): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name.startsWith('.') && ignoredDirectoryNames.has(entry.name)) continue;
    const absolutePath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) continue;
      await walkMarkdown(rootPath, absolutePath, results);
      continue;
    }

    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue;

    const fileStat = await stat(absolutePath);
    results.push({
      absolutePath,
      relativePath: normalizeRelativePath(path.relative(rootPath, absolutePath)),
      checksum: await checksumFile(absolutePath),
      lastModified: fileStat.mtime.toISOString(),
      sizeBytes: fileStat.size,
    });
  }
}

export async function discoverAtlasMarkdown(rootPath: string): Promise<AtlasSourceFile[]> {
  if (!rootPath.trim()) throw new Error('Atlas source root path is required.');
  const resolvedRoot = path.resolve(rootPath);
  const rootStat = await stat(resolvedRoot);
  if (!rootStat.isDirectory()) throw new Error('Atlas source root path must be a directory.');

  const results: AtlasSourceFile[] = [];
  await walkMarkdown(resolvedRoot, resolvedRoot, results);
  return results;
}

export function detectAtlasChanges(sourceFiles: AtlasSourceFile[], existing: KnowledgeFingerprint[]): AtlasChangeSet {
  const existingByPath = new Map(existing.map((item) => [item.path, item]));
  const sourcePaths = new Set(sourceFiles.map((item) => item.relativePath));

  const added: AtlasSourceFile[] = [];
  const changed: AtlasSourceFile[] = [];
  const unchanged: AtlasSourceFile[] = [];

  for (const file of sourceFiles) {
    const prior = existingByPath.get(file.relativePath);
    if (!prior) added.push(file);
    else if (prior.checksum !== file.checksum) changed.push(file);
    else unchanged.push(file);
  }

  const missingFromSource = existing.filter((item) => !sourcePaths.has(item.path));
  return { added, changed, unchanged, missingFromSource };
}
