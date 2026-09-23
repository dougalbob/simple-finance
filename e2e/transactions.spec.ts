import { expect, test } from '@playwright/test';

/**
 * All Transactions (SPEC §15.3, plan decisions 101–108): a read-only,
 * one-pot activity view. The page renders no forms, so these specs check the
 * projection itself — codes, the pot-relative sign, the checkpoint divider,
 * the honest "movements shown" total — and that every row's deep link lands
 * on the record in the page that can still edit or void it.
 *
 * Runs after `checkpoint` and before `backup`, so the backup project's
 * restore cannot rewind records this spec asserts on.
 */

test.describe('all transactions', () => {
  test('projects one pot: purchases, converted schedules and a checkpoint divider', async ({
    page,
  }) => {
    await page.goto('/transactions');
    await expect(page.getByRole('heading', { name: 'Activity in one pot' })).toBeVisible();
    // The default target is the household's main pot.
    await expect(page.getByText('Everything that touched')).toContainText('Main account');

    const table = page.locator('section[aria-labelledby="activity-heading"] table');

    // The seeded split purchase: one row, first allocation line + "+1 more",
    // red (money out), with the original note and the exact-total intact.
    const corner = table
      .locator('tr', { has: page.getByRole('link', { name: /Corner Foods/ }) })
      .first();
    // Anchored: the source cell's name ("Corner Foods — Open this purchase")
    // contains "pur" too, so an unanchored match is not unique.
    await expect(corner.getByRole('cell', { name: /^PUR\b/ })).toBeVisible();
    await expect(corner).toContainText('Groceries / Weekly Shop (household)');
    await expect(corner).toContainText('+1 more');
    await expect(corner).toContainText('−£63.47');
    // The note field is carried across verbatim — but not pinned to the seed's
    // text, because the `desktop` project edits this very purchase's note
    // before this one runs. What matters is that it is not the empty placeholder.
    await expect(corner.getByRole('cell').last()).not.toHaveText('—');

    // A converted standing order keeps its code and links back to the
    // schedule. `.first()`: the `desktop` project moves this schedule's due day
    // to the 21st, which back-fills a second converted row inside the window.
    const phone = table
      .locator('tr', { has: page.getByRole('link', { name: /Phone plan/ }) })
      .first();
    // No \b after the code: JSX leaves no whitespace between the badge and the
    // schedule link, so the cell's accessible name is "SOOpen the schedule".
    await expect(phone.getByRole('cell', { name: /^SO/ })).toBeVisible();
    await expect(phone.getByRole('link', { name: 'Open the schedule' })).toHaveAttribute(
      'href',
      /^\/recurring#schedule-\d+$/,
    );

    // The checkpoint is a divider carrying a reported figure, never a movement.
    const divider = table.locator('tr', { hasText: 'Checkpoint · reported' });
    await expect(divider.first()).toContainText('not a movement');
    // Scoped to the footer: the caveat paragraph below the table also says
    // "Movements shown", so an unscoped text match would not be unique.
    await expect(page.locator('tfoot').getByText('Movements shown')).toBeVisible();
    // The page says what the total is not.
    await expect(page.getByText(/It is not the change in this pot’s estimate/)).toBeVisible();
  });

  test('one transfer is red on the pot it left and green on the pot it reached', async ({
    page,
  }) => {
    // Transfers are recorded where they always were: the Move tab. This page
    // only reads.
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await entry.getByRole('tab', { name: 'Move' }).click();
    await entry.getByLabel('From pot').selectOption({ label: 'Main account' });
    await entry.getByLabel('To pot').selectOption({ label: "Alex's cash" });
    await entry.getByLabel('Amount').fill('7.77');
    await entry.getByRole('button', { name: 'Record transfer' }).click();
    await expect(entry.getByRole('status')).toContainText(/recorded/i, { timeout: 30_000 });

    // Red on Main, from the selected pot's point of view.
    await page.goto('/transactions');
    const outRow = page
      .locator('section[aria-labelledby="activity-heading"] table tr')
      .filter({ hasText: '£7.77' });
    await expect(outRow.getByRole('cell', { name: /^TX>/ })).toBeVisible();
    await expect(outRow).toContainText("Alex's cash");
    await expect(outRow).toContainText('−£7.77');

    // Green on Alex's cash — the same record, the other side.
    const filters = page.getByRole('form', { name: 'Activity filters' });
    await filters.getByLabel('Target').selectOption({ label: "Alex's cash" });
    await filters.getByRole('button', { name: 'Show activity' }).click();
    const inRow = page
      .locator('section[aria-labelledby="activity-heading"] table tr')
      .filter({ hasText: '£7.77' });
    await expect(inRow.getByRole('cell', { name: /^TX</ })).toBeVisible();
    await expect(inRow).toContainText('Main account');
    await expect(inRow).toContainText('+£7.77');

    // The deep link lands on the record itself, not just its section.
    await inRow.getByRole('link', { name: /Open this transfer/ }).click();
    await expect(page).toHaveURL(/\/overview\?transfer=\d+#transfer-\d+/);
    await expect(page.locator('section[aria-labelledby="transfers-heading"]')).toContainText(
      /Main account\s*→\s*Alex's cash/,
    );
  });

  test('a purchase row deep-links to its filtered row on Purchases', async ({ page }) => {
    await page.goto('/transactions');
    const table = page.locator('section[aria-labelledby="activity-heading"] table');
    await table
      .getByRole('link', { name: /Corner Foods/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/purchases\?potId=\d+&from=\d{4}-\d{2}-\d{2}&to=/);
    await expect(page.locator('section[aria-labelledby="results-heading"]')).toContainText(
      'Corner Foods',
    );
  });
});
