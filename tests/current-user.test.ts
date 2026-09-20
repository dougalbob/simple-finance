import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { getCurrentUser } from '../src/lib/auth/current-user';
import { loadAppConfig } from '../src/lib/config';
import { headerSource, startMockAccessAuthority, type MockAccessAuthority } from './helpers';

describe('getCurrentUser (fail-closed resolution)', () => {
  let authority: MockAccessAuthority;

  before(async () => {
    authority = await startMockAccessAuthority();
  });

  after(async () => {
    await authority.close();
  });

  it('uses the dev identity only when the bypass is active', async () => {
    const config = loadAppConfig({
      NODE_ENV: 'development',
      AUTH_DEV_BYPASS: 'true',
      AUTH_DEV_IDENTITY_EMAIL: 'Dev@Example.com',
    });
    const user = await getCurrentUser(headerSource({}), config);
    assert.deepEqual(user, { email: 'dev@example.com' });
  });

  it('returns null with no token when auth is incomplete (fail closed)', async () => {
    const config = loadAppConfig({ NODE_ENV: 'production' });
    assert.equal(await getCurrentUser(headerSource({}), config), null);
  });

  it('returns null in production even when bypass flags are set in the environment', async () => {
    const config = loadAppConfig({
      NODE_ENV: 'production',
      AUTH_DEV_BYPASS: 'true',
      AUTH_DEV_IDENTITY_EMAIL: 'dev@example.com',
      AUTH_ISSUER: authority.issuer,
      AUTH_AUDIENCE: authority.audience,
      AUTH_CERTS_URL: authority.certsUrl,
      AUTH_ALLOWED_EMAILS: 'alex@example.com',
    });
    assert.equal(await getCurrentUser(headerSource({}), config), null);
  });

  it('returns null when a token is present but invalid', async () => {
    const config = loadAppConfig({
      NODE_ENV: 'production',
      AUTH_ISSUER: authority.issuer,
      AUTH_AUDIENCE: authority.audience,
      AUTH_CERTS_URL: authority.certsUrl,
      AUTH_ALLOWED_EMAILS: 'alex@example.com',
    });
    assert.equal(
      await getCurrentUser(headerSource({ 'cf-access-jwt-assertion': 'garbage' }), config),
      null,
    );
    const expired = await authority.mintToken({ expiresInSeconds: -60 });
    assert.equal(
      await getCurrentUser(headerSource({ 'cf-access-jwt-assertion': expired }), config),
      null,
    );
  });

  it('resolves a verified token to the allowlisted user', async () => {
    const config = loadAppConfig({
      NODE_ENV: 'production',
      AUTH_ISSUER: authority.issuer,
      AUTH_AUDIENCE: authority.audience,
      AUTH_CERTS_URL: authority.certsUrl,
      AUTH_ALLOWED_EMAILS: 'alex@example.com,sam@example.com',
    });
    const token = await authority.mintToken({ email: 'sam@example.com' });
    const user = await getCurrentUser(headerSource({ 'cf-access-jwt-assertion': token }), config);
    assert.deepEqual(user, { email: 'sam@example.com' });
  });

  it('returns null for a verified token whose identity is not allowlisted', async () => {
    const config = loadAppConfig({
      NODE_ENV: 'production',
      AUTH_ISSUER: authority.issuer,
      AUTH_AUDIENCE: authority.audience,
      AUTH_CERTS_URL: authority.certsUrl,
      AUTH_ALLOWED_EMAILS: 'alex@example.com',
    });
    const token = await authority.mintToken({ email: 'stranger@example.com' });
    assert.equal(
      await getCurrentUser(headerSource({ 'cf-access-jwt-assertion': token }), config),
      null,
    );
  });
});
