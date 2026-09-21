import { expect, test } from '@playwright/test';
import { APP_RELEASE_STAGE, APP_VERSION } from '../src/lib/version';

/**
 * Mobile acceptance path (blueprint §12: "desktop and mobile primary paths are
 * checked"). This is the run earlier sessions could not claim — the sandbox had
 * no browser binaries.
 */
test.describe('mobile quick entry', () => {
  test('records a purchase at the till, then refuses an unbalanced split', async ({ page }) => {
    await page.goto('/');

    // The app identifies itself: the version badge is part of the release check.
    await expect(
      page.getByRole('main').getByText(`v${APP_VERSION} · ${APP_RELEASE_STAGE}`),
    ).toBeVisible();

    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await expect(entry).toBeVisible();

    await entry.locator('input[name="supplierName"]').fill('Playwright Paints');
    await entry.locator('input[name="amount"]').fill('12.34');
    await entry.getByLabel('Line 1 amount').fill('12.34');
    await entry.getByLabel(/^Category/).selectOption({ label: 'Groceries / Weekly Shop' });
    await expect(entry.getByText('Matches exactly')).toBeVisible();

    const saveButton = entry.getByRole('button', { name: 'Save purchase' });
    await saveButton.click();
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });

    // Splits must total exactly: an unbalanced entry cannot be submitted.
    await entry.getByLabel('Line 1 amount').fill('1.00');
    await expect(saveButton).toBeDisabled();
    await expect(entry.getByText(/Remaining|Over by/)).toBeVisible();

    // The record is really stored: it is there on a fresh request.
    await page.goto('/purchases');
    const results = page.locator('section[aria-labelledby="results-heading"]');
    await expect(results.locator('tbody tr', { hasText: 'Playwright Paints' })).toHaveCount(1);
  });

  test('records a balance checkpoint, labelled as a checkpoint', async ({ page }) => {
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await entry.getByRole('tab', { name: 'Balance' }).click();
    await entry.getByLabel('Balance now').fill('987.65');
    await entry.getByRole('button', { name: 'Save checkpoint' }).click();
    await expect(entry.getByRole('status')).toContainText(/checkpoint/i, { timeout: 30_000 });
    // Reported by a person, never presented as a bank balance.
    await expect(page.getByText(/not a bank balance/i).first()).toBeVisible();
  });

  test('every page stays reachable on a phone viewport', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Pages' });
    for (const label of [
      'Overview',
      'Purchases',
      'Recurring',
      'Accounts & Pots',
      'Insights',
      'Settings',
      'Suppliers',
      'Contracts & Renewals',
    ]) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });
});
