import { generateKeyPairSync } from 'node:crypto';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportJWK, SignJWT } from 'jose';

/** Isolated scratch directory per test (blueprint §9: never touch real appdata). */
export async function makeTempDir(prefix = 'simple-finance-test-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export interface MintTokenOptions {
  email?: string;
  issuer?: string;
  audience?: string;
  /** Seconds from now until expiry (negative = already expired). */
  expiresInSeconds?: number;
  /** Which claim carries the email (Cloudflare uses the long one). */
  emailClaim?: 'cf-access-authenticated-user-email' | 'email';
  signWithWrongKey?: boolean;
}

export interface MockAccessAuthority {
  issuer: string;
  audience: string;
  certsUrl: string;
  mintToken(options?: MintTokenOptions): Promise<string>;
  close(): Promise<void>;
}

/**
 * A local stand-in for the Cloudflare Access cert endpoint so auth tests
 * exercise the real jose verification path (JWKS fetch, signature, issuer,
 * audience, expiry) without network access to Cloudflare.
 */
export async function startMockAccessAuthority(): Promise<MockAccessAuthority> {
  const issuer = 'https://mock-team.cloudflareaccess.com';
  const audience = 'mock-audience-tag';

  const goodKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const goodJwk = { ...(await exportJWK(goodKey.publicKey)), kid: 'test-key-1' };
  const jwks = JSON.stringify({ keys: [goodJwk] });

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(jwks);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('mock JWKS server failed to listen');
  }
  const certsUrl = `http://127.0.0.1:${address.port}/cdn-cgi/access/certs`;

  async function mintToken(options: MintTokenOptions = {}): Promise<string> {
    const email = options.email ?? 'alex@example.com';
    const claim = options.emailClaim ?? 'cf-access-authenticated-user-email';
    const nowSec = Math.floor(Date.now() / 1000);
    const signingKey = options.signWithWrongKey ? otherKey.privateKey : goodKey.privateKey;
    const payload: Record<string, string> =
      claim === 'email' ? { email } : { 'cf-access-authenticated-user-email': email };
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? audience)
      .setIssuedAt(nowSec)
      .setSubject(email)
      .setExpirationTime(nowSec + (options.expiresInSeconds ?? 600))
      .sign(signingKey);
  }

  async function close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  return { issuer, audience, certsUrl, mintToken, close };
}

/** Minimal header source for framework-free auth tests. */
export function headerSource(headers: Record<string, string>): {
  get(name: string): string | null;
} {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}
