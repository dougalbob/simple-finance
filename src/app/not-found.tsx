import Link from 'next/link';

/**
 * Next's built-in 404 paints its own near-black text, which all but disappears
 * on a dark theme. This one is made of the same tokens as every other page, so
 * it wears whatever theme the device has chosen.
 */
export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">404</p>
      <h1 className="mt-2 text-xl font-semibold">That page is not here</h1>
      <p className="mt-3 text-sm text-ink-soft">
        The link may be out of date, or the record behind it may have been deleted. Nothing has been
        changed.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-till px-4 py-2 text-sm font-semibold text-till-ink"
      >
        Back to the overview
      </Link>
    </main>
  );
}
