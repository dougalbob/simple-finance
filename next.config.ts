import type { NextConfig } from 'next';

/**
 * Simple Finance sits behind Cloudflare Access; keep responses quiet and lean.
 *
 * Security headers (blueprint §4.8: "keep sensitive responses private and
 * uncached; use appropriate security headers"). They are applied to production
 * builds only: a development server is also what the operator's own preview
 * harness embeds, and refusing to be framed there would break a local preview
 * for no security gain — in production the app is behind Cloudflare Access,
 * where clickjacking protection is the point.
 *
 * `Cache-Control` for money and document responses is set per route
 * (`no-store` / `private, no-store`), not here.
 */
const isProductionBuild = process.env.NODE_ENV === 'production';

const securityHeaders = [
  // Nothing here needs to be framed by another site.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  // The app is HTTPS-only in production; remember that for a year.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  /**
   * Receipt uploads travel through a server action (`uploadAttachmentAction`),
   * and Next's default 1 MB action body limit rejected real camera photos with
   * an opaque 500 before the attachment pipeline's own 10 MB rule
   * (MAX_ATTACHMENT_BYTES, plan OQ12) could answer politely. 12 MB = the app's
   * 10 MB attachment limit plus multipart framing and the rest of the form,
   * so the pipeline's clear "too big" message is the one the household sees.
   */
  experimental: {
    serverActions: {
      bodySizeLimit: '12mb',
    },
  },
  /**
   * Development-only: the browser acceptance run and the operator's hosted
   * preview load the dev server through a proxy host, not localhost. This list
   * is ignored by `next build`/`next start`; production behind Cloudflare
   * Access serves its own hostname and needs no entry here.
   */
  allowedDevOrigins: ['localhost', '127.0.0.1', '*.e2b.app'],
  async headers() {
    if (!isProductionBuild) return [];
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
