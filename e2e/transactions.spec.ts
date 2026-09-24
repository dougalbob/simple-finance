import { expect, test } from '@playwright/test';
import { waitForTill } from './support';

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
    await waitForTill(page);
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

  test('income renders as BAC and deep-links to the Income page', async ({ page }) => {
    // The seeded one-off income: the bicycle sold for cash (plan decision 110).
    // Income was reserved (`BAC`) but never rendered before v0.4.0.
    await page.goto('/transactions');
    const filters = page.getByRole('form', { name: 'Activity filters' });
    await filters.getByLabel('Target').selectOption({ label: "Alex's cash" });
    await filters.getByRole('button', { name: 'Show activity' }).click();

    const table = page.locator('section[aria-labelledby="activity-heading"] table');
    const income = table.locator('tr', { hasText: 'Sale of bicycle' }).first();
    // No \b after the code, for the same reason as the SO row above.
    await expect(income.getByRole('cell', { name: /^BAC/ })).toBeVisible();
    await expect(income).toContainText('+£45.00');
    await expect(income).toContainText('Collected in cash');
    // Income carries no category — it is not spending (SPEC §6).
    await expect(income.getByRole('cell').nth(3)).toHaveText('—');

    // The canonical form for income is the Income page, and the link lands on
    // the record itself.
    await income.getByRole('link', { name: /Open this income record/ }).click();
    await expect(page).toHaveURL(/\/income\?receipt=\d+#receipt-\d+/);
    await expect(
      page.locator('section[aria-labelledby="income-history-heading"] li', {
        hasText: 'Sale of bicycle',
      }),
    ).toContainText('+£45.00');
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

  test('expected support appears from its due date and gives way to the recorded borrowing', async ({
    page,
  }) => {
    // The household's shape (v0.7.0): an arrangement that has not started, so
    // the expectation must project and list before any money moves. The
    // server's own today is read from the End date input's `max` — the window
    // ends there — so this spec never fights the clock.
    await page.goto('/transactions');
    const serverToday = (await page.getByLabel('End date').getAttribute('max')) ?? '';
    if (serverToday === '') throw new Error('End date input has no max attribute');
    const dayOfMonth = Number(serverToday.slice(8, 10));

    // A brand-new IOU with no movements at all, then the expectation on it.
    await page.goto('/pots');
    const debts = page.locator('section[aria-labelledby="debts-heading"]');
    const trackForm = debts
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Track this debt' }) });
    const counterparty = `E2E Expectant ${Date.now()}`;
    await trackForm.getByLabel('Who is it owed to or by?').fill(counterparty);
    await trackForm.getByRole('button', { name: 'Track this debt' }).click();
    await expect(trackForm.getByRole('status')).toContainText(/now tracking/i);

    const row = debts.locator('li').filter({ hasText: counterparty }).first();
    await expect(row.getByText('no movements yet')).toBeVisible();
    await row.getByText('Edit', { exact: true }).click();
    const editForm = row.locator('form');
    await editForm.getByLabel('Expected support payment').fill('250.00');
    await editForm.getByLabel('Day of the month').fill(String(dayOfMonth));
    await editForm.getByRole('button', { name: 'Save debt' }).click();
    await expect(editForm.getByRole('status')).toContainText(/updated/i);
    // The panel says what the expectation is and that it moves no money. The
    // edit form's own hint carries the same phrase, so match the panel's
    // distinctive sentence rather than the phrase alone.
    await expect(row.getByText(/Expecting £250\.00 on day \d+ of each month/)).toBeVisible();
    await expect(
      row.getByText(/Expected, never received: it shows in the projections/),
    ).toBeVisible();

    // From its due date the expectation is on All Transactions: flagged,
    // linked to the loan panel, and outside the movements totals.
    const from = minusDays(serverToday, 3);
    const activityUrl = `/transactions?from=${from}&to=${serverToday}`;
    await page.goto(activityUrl);
    const table = page.locator('section[aria-labelledby="activity-heading"] table');
    const expectedRow = table.locator('tr').filter({ hasText: counterparty });
    await expect(expectedRow.getByRole('cell', { name: /^EXP</ })).toBeVisible();
    await expect(expectedRow).toContainText('+£250.00');
    await expect(expectedRow).toContainText('expected — not recorded yet');
    // The footer counts the expectations it is deliberately not counting. The
    // number is only asserted as "at least one" in words: the seeded Mum
    // expectation can share this short window when the run lands near the
    // 12th, so pinning it to 1 would be a date-dependent flake.
    await expect(
      page.locator('tfoot').getByText(/Expected support \(\d+\s*expectations?,\s*not counted\)/),
    ).toBeVisible();
    await expect(page.locator('tfoot').getByText('not a movement')).toBeVisible();
    // The row links to the loan panel that owns it.
    await expect(expectedRow.getByRole('link', { name: /Open the loan panel/ })).toHaveAttribute(
      'href',
      /\/pots#debt-\d+$/,
    );

    // The money lands and is recorded that day: the expectation gives way to
    // the real borrowing, on the same window.
    await page.goto('/pots');
    const borrow = page.locator('section[aria-labelledby="borrow-heading"]');
    await borrow.getByLabel('Debt').selectOption({ label: `${counterparty} (we owe)` });
    await borrow.getByLabel('Pot').selectOption({ label: 'Main account' });
    await borrow.getByLabel('Amount').fill('250.00');
    await borrow.getByRole('button', { name: 'Record it' }).click();
    await expect(borrow.getByRole('status')).toContainText(/borrowed £250\.00/i);

    await page.goto(activityUrl);
    await expect(
      page.locator('section[aria-labelledby="activity-heading"]').getByText(counterparty),
    ).toBeVisible();
    // This debt's expectation is gone — the seeded one (if it happens to fall
    // in the window) is not this test's business.
    const borrowRow = table.locator('tr').filter({ hasText: counterparty });
    await expect(borrowRow.getByRole('cell', { name: /^EXP</ })).toHaveCount(0);
    await expect(borrowRow.getByRole('cell', { name: /^LN</ })).toBeVisible();
    await expect(borrowRow).toContainText('+£250.00');
    // The loan panel now carries the real balance.
    await page.goto('/pots');
    await expect(
      page.locator('section[aria-labelledby="debts-heading"]').getByText('we owe £250.00'),
    ).toBeVisible();
  });
});

/**
 * A local date `days` before an ISO date — computed in UTC from the server's
 * own date string, so the window never depends on the browser's clock.
 */
function minusDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - days));
  return shifted.toISOString().slice(0, 10);
}
