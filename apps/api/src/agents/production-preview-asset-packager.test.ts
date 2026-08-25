import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageProductionPreviewAssets } from './production-preview-asset-packager.js';

test('packages a deterministic dist tree into Cloudflare preview assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axoros-preview-assets-'));
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><html><body>AxorOS</body></html>');
    await writeFile(join(root, 'assets', 'app.js'), 'console.log("AxorOS");');

    const packaged = await packageProductionPreviewAssets(root);

    assert.equal(packaged.assets.length, 2);
    assert.deepEqual(packaged.assets.map((asset) => asset.path), ['/assets/app.js', '/index.html']);
    assert.deepEqual(packaged.assets.map((asset) => asset.contentType), [
      'text/javascript; charset=utf-8',
      'text/html; charset=utf-8',
    ]);
    assert.ok(packaged.assets.every((asset) => /^[a-f0-9]{32}$/.test(asset.contentHash)));
    assert.equal(Buffer.from(packaged.assets[1]!.contentBase64, 'base64').toString('utf8'), '<!doctype html><html><body>AxorOS</body></html>');
    assert.ok(packaged.totalBytes > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a missing build output directory', async () => {
  await assert.rejects(
    () => packageProductionPreviewAssets(join(tmpdir(), 'axoros-preview-does-not-exist')),
    /was not found or is not a directory/,
  );
});

test('rejects an empty build output directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axoros-preview-empty-'));
  try {
    await assert.rejects(() => packageProductionPreviewAssets(root), /contains no deployable files/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects files larger than the Cloudflare Direct Upload per-file limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axoros-preview-large-'));
  try {
    const large = Buffer.alloc((25 * 1024 * 1024) + 1);
    await writeFile(join(root, 'large.bin'), large);
    await assert.rejects(() => packageProductionPreviewAssets(root), /25 MiB file limit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
