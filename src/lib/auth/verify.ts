import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthConfig } from '../config';

/**
 * Independent server-side verification of Cloudflare Access JWTs
 * (AGENT_APP_BLUEPRINT.md §4). We never trust an email header alone; the
 * Cf-Access-Jwt-Assertion token is verified against the issuer's JWKS with
 * expected issuer, audience, expiry and algorithm checked.
 *
 * This module is deliberately framework-free so tests can exercise it with a
 * local JWKS server (wrong issuer / wrong audience / expired / wrong key /
 * not-on-allowlist all covered).
 */

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

export class AuthVerificationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'AuthVerificationError';
  }
}

export interface VerifiedIdentity {
  email: string;
  sub: string;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(certsUrl: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(certsUrl);
  if (jwks === undefined) {
    jwks = createRemoteJWKSet(new URL(certsUrl));
    jwksCache.set(certsUrl, jwks);
  }
  return jwks;
}

/**
 * Verify a Cloudflare Access assertion and enforce the allowlist.
 * Throws AuthConfigError when authentication is not fully configured
 * (fail closed) and AuthVerificationError for any rejected token.
 */
export async function verifyAccessJwt(token: string, auth: AuthConfig): Promise<VerifiedIdentity> {
  if (
    auth.issuer === null ||
    auth.audience === null ||
    auth.certsUrl === null ||
    auth.allowedEmails.length === 0
  ) {
    throw new AuthConfigError('Authentication is not configured (issuer/audience/allowlist)');
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(auth.certsUrl), {
      issuer: auth.issuer,
      audience: auth.audience,
      algorithms: ['RS256'],
    });

    const emailClaim = payload['cf-access-authenticated-user-email'] ?? payload['email'];
    const email = typeof emailClaim === 'string' ? emailClaim.trim().toLowerCase() : null;
    if (email === null || email === '') {
      throw new Error('token carries no identity email claim');
    }
    if (!auth.allowedEmails.includes(email)) {
      throw new Error(`identity ${email} is not on the allowlist`);
    }
    const sub = typeof payload.sub === 'string' && payload.sub !== '' ? payload.sub : email;
    return { email, sub };
  } catch (err) {
    throw new AuthVerificationError('Access token rejected', err);
  }
}
