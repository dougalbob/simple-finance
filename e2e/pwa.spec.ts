import { test, expect } from '@playwright/test';

/**
 * PWA asset accessibility.
 *
 * These four paths must respond 200 with the correct content types when
 * requested without any Cloudflare Access cookie.  A failure here means
 * the Dockerfile COPY is missing or the Cloudflare bypass is misconfigured.
 *
 * NOTE: This spec runs inside the e2e webserver which has the dev-identity
 * bypass enabled.  The bypass does NOT affect static file serving — the
 * manifest and icons are served from public/ with no auth gate.  The HTTP
 * assertions prove that Next.js serves them without credentials.
 */

const pwaAssets = [
  { path: '/manifest.webmanifest', contentType: 'application/manifest+json' },
  { path: '/icon-192.png', contentType: 'image/png' },
  { path: '/icon-512.png', contentType: 'image/png' },
  { path: '/apple-touch-icon.png', contentType: 'image/png' },
];

for (const asset of pwaAssets) {
  test(`${asset.path} returns 200 with ${asset.contentType}`, async ({ request }) => {
    const response = await request.get(asset.path);
    expect(response.status()).toBe(200);
    const ct = response.headers()['content-type'];
    expect(ct).toContain(asset.contentType);
  });
}
