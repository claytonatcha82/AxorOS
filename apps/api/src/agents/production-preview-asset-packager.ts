import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import type { DeploymentAsset } from '../integrations/deployment-provider-contract.js';

const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

export interface ProductionPreviewAssetPackage {
  buildOutputDirectory: string;
  assets: DeploymentAsset[];
  totalBytes: number;
}

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function deploymentPath(root: string, absolutePath: string): string {
  const relativePath = relative(root, absolutePath).split(sep).join('/');
  if (!relativePath || relativePath.startsWith('../') || relativePath.includes('/../')) {
    throw new Error('Preview asset path escaped the build output directory.');
  }
  return `/${relativePath}`;
}

async function collectFiles(root: string, directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Preview asset packaging does not permit symbolic links: ${deploymentPath(root, absolutePath)}.`);
    }
    if (entry.isDirectory()) {
      await collectFiles(root, absolutePath, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Preview asset packaging encountered an unsupported filesystem entry: ${deploymentPath(root, absolutePath)}.`);
    }
    files.push(absolutePath);
    if (files.length > MAX_FILES) {
      throw new Error(`Preview asset packaging exceeds Cloudflare's ${MAX_FILES}-file Direct Upload limit.`);
    }
  }
}

export async function packageProductionPreviewAssets(buildOutputDirectory: string): Promise<ProductionPreviewAssetPackage> {
  const root = resolve(buildOutputDirectory.trim());
  if (!buildOutputDirectory.trim()) throw new Error('Preview build output directory is required.');

  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error(`Preview build output directory was not found or is not a directory: ${root}.`);
  }

  const files: string[] = [];
  await collectFiles(root, root, files);
  if (files.length === 0) throw new Error('Preview build output directory contains no deployable files.');

  const assets: DeploymentAsset[] = [];
  let totalBytes = 0;

  for (const absolutePath of files) {
    const fileStat = await lstat(absolutePath);
    const path = deploymentPath(root, absolutePath);
    if (fileStat.size > MAX_FILE_BYTES) {
      throw new Error(`Preview asset exceeds Cloudflare's 25 MiB file limit: ${path}.`);
    }

    const content = await readFile(absolutePath);
    totalBytes += content.byteLength;
    assets.push({
      path,
      contentHash: createHash('md5').update(content).digest('hex'),
      contentType: contentTypeFor(path),
      contentBase64: content.toString('base64'),
    });
  }

  assets.sort((a, b) => a.path.localeCompare(b.path));
  return { buildOutputDirectory: root, assets, totalBytes };
}
