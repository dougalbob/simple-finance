import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * PWA manifest and icon validation.
 *
 * The manifest must parse, declare the required fields, and every icon it
 * lists must exist on disk at the declared pixel size.  This catches a broken
 * Dockerfile COPY or a missing asset before CI's docker job builds the image.
 */
const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = join(ROOT, 'public', 'manifest.webmanifest');

describe('PWA manifest', () => {
  it('exists and parses as valid JSON', () => {
    assert.ok(existsSync(MANIFEST_PATH), 'public/manifest.webmanifest must exist');
    const raw = readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    assert.ok(manifest, 'manifest must parse');
  });

  it('declares start_url, display and name', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.name, 'Simple Finance');
  });

  it('lists icons that exist on disk at the declared pixel sizes', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    assert.ok(Array.isArray(manifest.icons), 'manifest must have an icons array');
    assert.ok(manifest.icons.length >= 2, 'must list at least two icons');

    for (const icon of manifest.icons) {
      const iconPath = join(ROOT, 'public', icon.src.replace(/^\//, ''));
      assert.ok(existsSync(iconPath), `icon file must exist: ${iconPath}`);

      // Read the PNG header to get actual dimensions.
      const buf = readFileSync(iconPath);
      // PNG signature (8 bytes) + IHDR length (4 bytes) + IHDR type (4 bytes) = offset 16 for width.
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      const [declW, declH] = icon.sizes.split('x').map(Number);
      assert.equal(width, declaredSize(declW), `${icon.src}: width must be ${declW}`);
      assert.equal(height, declaredSize(declH), `${icon.src}: height must be ${declH}`);
      assert.equal(width, height, `${icon.src}: must be square`);
    }
  });

  it('uses the required colour values', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    assert.equal(manifest.background_color, '#0f172a');
    assert.equal(manifest.theme_color, '#0f172a');
  });

  it('declares scope', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    assert.equal(manifest.scope, '/');
  });
});

function declaredSize(n: number): number {
  return n;
}
