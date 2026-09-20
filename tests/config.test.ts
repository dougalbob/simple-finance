import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAuthConfigComplete, loadAppConfig } from '../src/lib/config';

describe('loadAppConfig', () => {
  it('defaults the data root to ./data in development and /data in production', () => {
    const dev = loadAppConfig({ NODE_ENV: 'development' });
    assert.equal(dev.dataDir, './data');
    assert.equal(dev.databasePath, 'data/simple-finance.sqlite'); // path.join normalises ./data

    const prod = loadAppConfig({ NODE_ENV: 'production' });
    assert.equal(prod.dataDir, '/data');
    assert.equal(prod.databasePath, '/data/simple-finance.sqlite');
  });

  it('honours explicit DATA_DIR and DATABASE_PATH overrides', () => {
    const config = loadAppConfig({
      DATA_DIR: '/srv/finance',
      DATABASE_PATH: '/elsewhere/x.sqlite',
    });
    assert.equal(config.dataDir, '/srv/finance');
    assert.equal(config.databasePath, '/elsewhere/x.sqlite');
  });

  it('derives the JWKS URL from the issuer unless overridden', () => {
    const derived = loadAppConfig({ AUTH_ISSUER: 'https://team.cloudflareaccess.com' });
    assert.equal(derived.auth.certsUrl, 'https://team.cloudflareaccess.com/cdn-cgi/access/certs');

    const explicit = loadAppConfig({
      AUTH_ISSUER: 'https://team.cloudflareaccess.com',
      AUTH_CERTS_URL: 'https://mirror.example.com/certs',
    });
    assert.equal(explicit.auth.certsUrl, 'https://mirror.example.com/certs');
  });

  it('parses the allowlist case-insensitively, ignoring blanks', () => {
    const config = loadAppConfig({ AUTH_ALLOWED_EMAILS: ' Alex@Example.com , ,sam@example.com ' });
    assert.deepEqual(config.auth.allowedEmails, ['alex@example.com', 'sam@example.com']);
  });

  it('never activates the dev bypass in production, whatever the flags say', () => {
    const config = loadAppConfig({
      NODE_ENV: 'production',
      AUTH_DEV_BYPASS: 'true',
      AUTH_DEV_IDENTITY_EMAIL: 'dev@example.com',
    });
    assert.equal(config.auth.devBypass, false);
  });

  it('activates the dev bypass only with flag AND identity AND non-production', () => {
    assert.equal(
      loadAppConfig({
        NODE_ENV: 'development',
        AUTH_DEV_BYPASS: 'true',
        AUTH_DEV_IDENTITY_EMAIL: 'dev@example.com',
      }).auth.devBypass,
      true,
    );
    assert.equal(
      loadAppConfig({ NODE_ENV: 'development', AUTH_DEV_BYPASS: 'true' }).auth.devBypass,
      false,
    );
    assert.equal(
      loadAppConfig({
        NODE_ENV: 'development',
        AUTH_DEV_IDENTITY_EMAIL: 'dev@example.com',
      }).auth.devBypass,
      false,
    );
  });

  it('marks auth incomplete until issuer, audience and allowlist are all present', () => {
    assert.equal(isAuthConfigComplete(loadAppConfig({}).auth), false);
    assert.equal(
      isAuthConfigComplete(
        loadAppConfig({ AUTH_ISSUER: 'https://x', AUTH_ALLOWED_EMAILS: 'a@example.com' }).auth,
      ),
      false,
    );
    assert.equal(
      isAuthConfigComplete(
        loadAppConfig({
          AUTH_ISSUER: 'https://x',
          AUTH_AUDIENCE: 'aud',
          AUTH_ALLOWED_EMAILS: 'a@example.com',
        }).auth,
      ),
      true,
    );
  });
});
