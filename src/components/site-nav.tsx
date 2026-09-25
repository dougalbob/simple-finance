'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_NAME, APP_RELEASE_STAGE, APP_VERSION } from '@/lib/version';

const NAV_ITEMS = [
  { href: '/overview', label: 'Overview' },
  { href: '/purchases', label: 'Purchases' },
  { href: '/transactions', label: 'All Transactions' },
  { href: '/recurring', label: 'Recurring' },
  { href: '/horizon', label: 'Horizon' },
  { href: '/income', label: 'Income' },
  { href: '/pots', label: 'Accounts & Pots' },
  { href: '/insights', label: 'Insights' },
  { href: '/charts', label: 'Charts' },
  { href: '/settings', label: 'Settings' },
  { href: '/suppliers', label: 'Suppliers' },
  { href: '/contracts', label: 'Contracts & Renewals' },
];

const NAV_GROUPS = [
  {
    title: 'Daily & Transactions',
    items: [
      { href: '/', label: 'Quick Entry (Till)' },
      { href: '/overview', label: 'Overview' },
      { href: '/purchases', label: 'Purchases' },
      { href: '/transactions', label: 'All Transactions' },
    ],
  },
  {
    title: 'Planning & Accounts',
    items: [
      { href: '/recurring', label: 'Recurring' },
      { href: '/horizon', label: 'Horizon' },
      { href: '/income', label: 'Income' },
      { href: '/pots', label: 'Accounts & Pots' },
    ],
  },
  {
    title: 'Reference & System',
    items: [
      { href: '/suppliers', label: 'Suppliers' },
      { href: '/contracts', label: 'Contracts & Renewals' },
      { href: '/insights', label: 'Insights' },
      { href: '/charts', label: 'Charts' },
      { href: '/settings', label: 'Settings' },
    ],
  },
];

function Bars3Icon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="2"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
      />
    </svg>
  );
}

function XMarkIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="2"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

/**
 * Site navigation:
 * - Desktop (lg:): Full horizontal navigation bar with all items visible.
 * - Mobile (< lg): Compact single-row header (saving ~20% of screen height)
 *   with an independent slide-out drawer accessible via hamburger button
 *   and edge-swipe gesture (from extreme left edge < 30px to avoid till conflict).
 */
export function SiteNav() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  // Close drawer on route changes
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close drawer on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close drawer if window is resized to desktop width
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle edge-swipe to open drawer, and swipe left on drawer to close.
  // Note: startX <= 30px ensures we never conflict with the Quick Entry till swipe gestures.
  useEffect(() => {
    let startX = 0;
    let startY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || e.touches.length !== 1) return;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch || e.changedTouches.length !== 1) return;
      const endX = touch.clientX;
      const endY = touch.clientY;
      const deltaX = endX - startX;
      const deltaY = endY - startY;

      // Only respond if the swipe is predominantly horizontal
      if (Math.abs(deltaX) < 40 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.5) {
        return;
      }

      // If closed: swipe right starting from left edge (< 30px) opens drawer
      if (!isOpen && startX <= 30 && deltaX > 45) {
        setIsOpen(true);
      }

      // If open: swipe left anywhere closes drawer
      if (isOpen && deltaX < -45) {
        setIsOpen(false);
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOpen]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        {/* Desktop Navbar (lg and up) */}
        <div className="mx-auto hidden max-w-7xl items-center justify-between gap-x-4 px-4 py-2 lg:flex">
          <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight text-slate-900">
            {APP_NAME}
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
              v{APP_VERSION} · {APP_RELEASE_STAGE}
            </span>
          </Link>
          <nav
            aria-label="Desktop navigation"
            className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm"
          >
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
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

        {/* Mobile Header Bar (< lg) */}
        <div className="flex h-14 items-center justify-between px-4 lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={isOpen}
              aria-controls="mobile-nav-drawer"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              <Bars3Icon className="h-6 w-6" />
            </button>
            <Link href="/" className="text-sm font-semibold tracking-tight text-slate-900">
              {APP_NAME}
              <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-500">
                v{APP_VERSION}
              </span>
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Backdrop */}
      {isOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs transition-opacity duration-300 lg:hidden"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Mobile Drawer Panel */}
      <div
        id="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out lg:hidden ${
          isOpen
            ? 'translate-x-0 pointer-events-auto'
            : '-translate-x-full pointer-events-none invisible'
        }`}
      >
        {/* Drawer Header */}
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
          <Link
            href="/"
            onClick={() => setIsOpen(false)}
            className="text-sm font-semibold tracking-tight text-slate-900"
          >
            {APP_NAME}
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
              v{APP_VERSION} · {APP_RELEASE_STAGE}
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close navigation menu"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <nav aria-label="Pages" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {group.title}
              </p>
              <ul className="mt-1.5 space-y-1">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      className={`flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive(item.href)
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Drawer Footer hint */}
        <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
          Swipe left to close · tap outside to dismiss
        </div>
      </div>
    </>
  );
}
