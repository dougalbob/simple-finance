import { expect, type Page } from '@playwright/test';
import { toLocalDateString } from '../src/lib/time';

/**
 * Wait until the Quick Entry till is listening (SPEC §15.1).
 *
 * The till is a client island. Before React hydrates it, a tap switches
 * nothing and a keystroke into a controlled input is wiped by the hydration
 * render — and the form is `inert` until it can hear, so it cannot pretend
 * otherwise. Clicking and typing faster than the page can hydrate is not a
 * household behaviour worth asserting, but it is exactly what a test does:
 * locator *actions* do not auto-wait for hydration the way assertions do, so
 * every spec that drives the till waits for the form's own ready signal first.
 *
 * `data-till-ready` is the till's, not the page's: the rest of the page may
 * still be catching up.
 */
export async function waitForTill(page: Page): Promise<void> {
  await expect(page.locator('[data-till-ready="true"]')).toBeAttached();
}

/**
 * Today's date as the app sees it — the household's calendar in
 * Europe/London, not the test runner's. CI runs in UTC, so for an hour every
 * summer night (23:00–00:00 UTC is already tomorrow in London) a spec that
 * took its "today" from UTC disagreed with the server by a day. Every date a
 * spec computes starts here (decision 134).
 */
export function londonToday(now: Date = new Date()): string {
  return toLocalDateString(now);
}

/** An ISO local date `days` after (or, negative, before) another, calendar-exact. */
export function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}
