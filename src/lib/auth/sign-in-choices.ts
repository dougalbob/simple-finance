import type { AppConfig } from '../config';

/**
 * The emails a person can be linked to in Settings → "Signs in as"
 * (decision 146): the Cloudflare Access allowlist (`AUTH_ALLOWED_EMAILS`),
 * plus the development identity when the dev bypass is on, plus any address
 * already stored (so a link survives an allowlist edit and can be cleared).
 * Lower case, de-duplicated, in that order.
 */
export function signInEmailChoices(
  config: Pick<AppConfig, 'auth'>,
  people: ReadonlyArray<{ email: string | null }> = [],
): string[] {
  const all = [
    ...config.auth.allowedEmails,
    ...(config.auth.devBypass && config.auth.devIdentityEmail !== null
      ? [config.auth.devIdentityEmail]
      : []),
    ...people.map((person) => person.email).filter((email): email is string => email !== null),
  ].map((email) => email.trim().toLowerCase());
  return [...new Set(all)].filter((email) => email !== '');
}
