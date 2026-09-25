import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteNav } from '@/components/site-nav';
import { APP_NAME, APP_RELEASE_STAGE, APP_VERSION } from '@/lib/version';
import './globals.css';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description:
    'Private household spending tracker for two people watching money carefully. Self-hosted; protected by Cloudflare Access.',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: APP_NAME },
  icons: { apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  /*
   * The one colour literal this file keeps, and it cannot be a token: the
   * browser reads the theme colour (and `public/manifest.webmanifest`, which
   * carries the same value twice) before any stylesheet is parsed, so a CSS
   * custom property would resolve to nothing. It is the `--color-till` colour
   * from `src/app/globals.css` — decision 159 records the limitation, and
   * `tests/colour-tokens.test.ts` fails if the three literals drift from the
   * token or from each other. A theme (Phase 2) will need a second literal
   * here via the `media` form of `themeColor`, or must accept the light-theme
   * chrome colour; that choice is Phase 2's to make.
   */
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <SiteNav />
        {children}
        <footer className="mx-auto mt-12 max-w-3xl px-4 pb-8 text-center text-xs text-ink-faint">
          {APP_NAME} v{APP_VERSION} ({APP_RELEASE_STAGE}) · estimates and projections, never a bank
          balance
        </footer>
      </body>
    </html>
  );
}
