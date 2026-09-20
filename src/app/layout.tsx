import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME, APP_RELEASE_STAGE, APP_VERSION } from '@/lib/version';
import './globals.css';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description:
    'Private household spending tracker for two people watching money carefully. Self-hosted; protected by Cloudflare Access.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
        <footer className="mx-auto mt-12 max-w-3xl px-4 pb-8 text-center text-xs text-slate-400">
          {APP_NAME} v{APP_VERSION} ({APP_RELEASE_STAGE})
        </footer>
      </body>
    </html>
  );
}
