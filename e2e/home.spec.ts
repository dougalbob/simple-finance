import { expect, test } from '@playwright/test';

/**
 * Mobile acceptance path (SPEC §15.1, plan decision 54): a real browser, a real
 * phone viewport, a real till moment. This is the run Sessions 3 and 5 could
 * not claim — no browser existed in that sandbox.
 */
test.describe('mobile quick entry', () => {
  test('records a purchase at the till in one pass, and refuses an unbalanced split', async ({
    page,
  }) => {
    await page.goto('/');

    // The app identifies itself — the version badge is the release check
    // blueprint §10 asks for.
    await expect(page.getByText('v0.1.0 · pre-release')).toBeVisible();

    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await expect(entry).toBeVisible();

    await entry.getByLabel('Supplier (optional)').fill('Playwright Paints');
    await entry.getByLabel('Amount').fill('12.34');
    await entry.getByLabel('Line 1 amount').fill('12.34');
    await entry.getByLabel('Category').selectOption({ label: 'Groceries / Weekly Shop' });
    await expect(entry.getByText('Matches exactly')).toBeVisible();

    await entry.getByRole('button', { name: 'Save purchase' }).click();

    // The save is confirmed in place, and the record is visible on the page.
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });
    await expect(page.getByText('Playwright Paints')).toBeVisible();

    // Splits must total exactly: an unbalanced entry cannot be submitted.
    const saveButton = entry.getByRole('button', { name: 'Save purchase' });
    await entry.getByLabel('Line 1 amount').fill('1.00');
    await expect(saveButton).toBeDisabled();
    await expect(entry.getByText(/Remaining|Over by/)).toBeVisible();
  });

  test('records a balance checkpoint, labelled as a checkpoint', async ({ page }) => {
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await entry.getByRole('tab', { name: 'Balance' }).click();
    await entry.getByLabel('Balance now').fill('987.65');
    await entry.getByRole('button', { name: 'Save checkpoint' }).click();
    await expect(entry.getByRole('status')).toContainText(/checkpoint/i, { timeout: 30_000 });
    // The wording never claims a bank balance: reported figures only.
    await expect(page.getByText(/not a bank balance/i).first()).toBeVisible();
  });

  test('keeps every menu page reachable on a phone viewport', async ({ page }) => {
    await page.goto('/');
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
      await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
  });
});
