import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteNav } from '@/components/site-nav';
import { currentTheme } from '@/lib/theme/next';
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

/**
 * The browser chrome follows the theme (decision 160).
 *
 * This is the one colour the app still states as a literal, and it cannot be
 * anything else: the browser paints its own strip — and the PWA splash —
 * before a stylesheet exists, so a custom property would resolve to nothing.
 * The value comes from the generated catalogue, which takes it from the same
 * derivation as the theme's tokens: a light theme hands over the till colour
 * (as it always has), a dark theme hands over its page. Installed-app manifest
 * colours stay pinned to the default theme, because the manifest is read once
 * at install time and belongs to no session — `tests/colour-tokens.test.ts`
 * holds those three literals together.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = await currentTheme();
  return { themeColor: theme.chrome };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = await currentTheme();
  return (
    <html lang="en-GB" data-theme={theme.id}>
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
