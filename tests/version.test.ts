import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { APP_NAME, APP_VERSION } from '../src/lib/version';

/** Blueprint §10: the version module and package metadata must agree. */
describe('version module', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(APP_VERSION, pkg.version);
    assert.equal(pkg.name, 'simple-finance');
  });
});
