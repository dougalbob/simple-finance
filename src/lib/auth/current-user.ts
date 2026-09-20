import { isAuthConfigComplete, type AppConfig } from '../config';
import { verifyAccessJwt } from './verify';

/**
 * Framework-free identity resolution — testable without Next.js.
 * Next-specific adapters live in ./next.ts.
 */
export interface User {
  email: string;
}

export interface HeaderSource {
  get(name: string): string | null;
}

/**
 * Resolve the current user, or null when the request is not authenticated.
 *
 * Order of trust:
 * 1. Development bypass — only when loadAppConfig computed it as active
 *    (explicit flag AND non-production AND identity configured). Production
 *    can never reach this branch.
 * 2. Verified Cloudflare Access JWT from the Cf-Access-Jwt-Assertion header.
 *    Any failure — missing token, bad signature, wrong issuer/audience,
 *    expired, identity not on the allowlist, or auth not configured at all —
 *    resolves to null. Fail closed, always.
 */
export async function getCurrentUser(
  headerSource: HeaderSource,
  config: AppConfig,
): Promise<User | null> {
  if (config.auth.devBypass && config.auth.devIdentityEmail !== null) {
    return { email: config.auth.devIdentityEmail };
  }
  if (!isAuthConfigComplete(config.auth)) {
    return null;
  }
  const token = headerSource.get('cf-access-jwt-assertion');
  if (token === null || token === '') {
    return null;
  }
  try {
    const identity = await verifyAccessJwt(token, config.auth);
    return { email: identity.email };
  } catch {
    return null;
  }
}
