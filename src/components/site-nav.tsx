'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_NAME, APP_RELEASE_STAGE, APP_VERSION } from '@/lib/version';

const NAV_ITEMS = [
  { href: '/overview', label: 'Overview' },
  { href: '/purchases', label: 'Purchases' },
  { href: '/transactions', label: 'All Transactions' },
  { href: '/recurring', label: 'Recurring' },
  { href: '/pots', label: 'Accounts & Pots' },
  { href: '/insights', label: 'Insights' },
  { href: '/settings', label: 'Settings' },
  { href: '/suppliers', label: 'Suppliers' },
  { href: '/contracts', label: 'Contracts & Renewals' },
];

/**
 * The app chrome (SPEC §15.2, blueprint §1 version display): the menu pages
 * plus an unobtrusive version badge on desktop AND mobile (the mobile home
 * stays the quick-entry surface; nothing is hidden on any screen size,
 * decision 20).
 */
export function SiteNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <Link href="/" className="text-sm font-semibold tracking-tight text-slate-900">
          {APP_NAME}
          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
            v{APP_VERSION} · {APP_RELEASE_STAGE}
          </span>
        </Link>
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`rounded-md px-2.5 py-1.5 font-medium ${
                isActive(item.href)
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
