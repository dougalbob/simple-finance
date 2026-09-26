import { expect, test, type BrowserContext } from '@playwright/test';
import { waitForThemeGallery } from './support';
import { DEFAULT_THEME_ID, THEME_COOKIE, THEMES, themeById } from '../src/lib/theme/theme';

/**
 * Appearance — themes for this device (decision 160, SPEC §15.4).
 *
 * The claim under test is decision 159's: a theme is one block of token
 * declarations, and the pages know nothing about it. So this spec never looks
 * for a colour *name* in the markup. It asserts the three things the household
 * can actually see:
 *
 *  1. choosing a theme repaints the page it is chosen on, without a reload;
 *  2. the choice is already in the server's first response — no flash of the
 *     old theme, because there is no client-side apply step to wait for;
 *  3. it is *this device only*: the cookie is the whole of the memory, so a
 *     browser without it gets the default, and so does one carrying nonsense.
 *
 * Each Playwright test gets a fresh context (and so a fresh cookie jar), which
 * is exactly the "other device" this feature is about — tests 2 and 3 set the
 * cookie themselves rather than leaning on test 1.
 */
const CHOSEN = 'fernwood-dark';
const chosen = themeById(CHOSEN);

/** A device that already made a choice — the cookie is the whole of the memory. */
async function deviceRemembers(
  context: BrowserContext,
  url: string | undefined,
  value: string,
): Promise<void> {
  await context.addCookies([
    { name: THEME_COOKIE, value, url: url ?? 'http://127.0.0.1:3100', httpOnly: true },
  ]);
}

test.describe('appearance', () => {
  test('a theme is chosen on Settings and repaints the page at once', async ({ page }) => {
    await page.goto('/settings');
    const section = page.getByRole('region', { name: /Appearance/i });
    await expect(section.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible();
    await waitForThemeGallery(page);

    // Every palette ships in both modes, and they are all offered.
    await expect(section.getByRole('radio')).toHaveCount(THEMES.length);
    await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME_ID);

    // A real element of the page — not a preview — is the repaint witness.
    const heading = section.getByRole('heading', { name: 'Appearance', level: 2 });
    const before = await heading.evaluate((node) => getComputedStyle(node).color);

    await section.locator(`input[value="${CHOSEN}"]`).check();

    await expect(page.locator('html')).toHaveAttribute('data-theme', CHOSEN, { timeout: 30_000 });
    await expect(section.getByRole('status')).toContainText(/fernwood/i, { timeout: 30_000 });
    // Colour is never the only signal (§16.7): the chosen card says so in words.
    await expect(
      section.locator('label', { has: page.locator(`input[value="${CHOSEN}"]`) }),
    ).toContainText('In use');
    await expect
      .poll(async () => heading.evaluate((node) => getComputedStyle(node).color))
      .not.toBe(before);

    // And it was saved, not just painted.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', CHOSEN);
  });

  test('the choice is already in the server’s first response, on every page', async ({
    page,
    baseURL,
  }) => {
    await deviceRemembers(page.context(), baseURL, CHOSEN);

    // Straight from the network: no JavaScript has run on this HTML, so if the
    // attribute is right here there is nothing left to flash.
    const html = await (await page.request.get('/settings')).text();
    expect(html).toContain(`data-theme="${CHOSEN}"`);

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', CHOSEN);
    // The browser chrome cannot be a CSS variable, so it is generated with the
    // stylesheet and served per theme.
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      chosen.chrome,
    );

    await page.goto('/charts');
    await expect(page.locator('html')).toHaveAttribute('data-theme', CHOSEN);
  });

  test('another device — or a stale cookie — gets Classic', async ({ page, baseURL }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME_ID);

    await deviceRemembers(page.context(), baseURL, 'a-theme-that-was-removed');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME_ID);
    await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible();
  });
});
