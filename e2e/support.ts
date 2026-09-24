import { expect, type Page } from '@playwright/test';

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
