/**
 * Same-origin guard for route handlers (blueprint §4.7: "Protect mutations
 * against cross-origin abuse; use the framework's protections correctly and
 * assess route handlers separately").
 *
 * Server actions get framework CSRF protection; route handlers do not, so the
 * two mutating handlers that matter most — backup download and live restore —
 * check the request's own origin headers before doing any work.
 *
 * Rules:
 * - `Sec-Fetch-Site: cross-site` is refused outright;
 * - an `Origin` that does not match the request host (or the forwarded host
 *   Cloudflare's tunnel passes through) is refused;
 * - a request with no `Origin` and no `Sec-Fetch-Site` (a script, curl, or a
 *   same-origin form post from a browser that omits `Origin`) is allowed —
 *   it still has to pass the Cloudflare Access verification above it.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site.toLowerCase() === 'cross-site') return false;

  const origin = request.headers.get('origin');
  // No Origin header at all: not a browser-initiated cross-site request.
  if (origin === null) return true;
  // "Origin: null" is a sandboxed/opaque document — never trusted for a write.
  if (origin === 'null') return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost !== null && forwardedHost.length > 0) {
    if (originHost === forwardedHost) return true;
  }

  try {
    return new URL(request.url).host === originHost;
  } catch {
    return false;
  }
}
