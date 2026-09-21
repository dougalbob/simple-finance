import { expect, test } from '@playwright/test';

/**
 * Desktop paths (SPEC §15.2): the dense overview, the purchases table with
 * inline edit, the recurring month calendar staying consistent with its
 * instance list after a real edit, and the suppliers/contracts pages.
 */

test.describe('desktop review', () => {
  test('overview carries money, projection, due dates and the review list', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    // Money figures are labelled as estimates, never as a bank balance.
    await expect(page.getByText(/never a bank balance/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /due this week/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /key dates/i })).toBeVisible();
    // Key dates include the seeded renewal inside its 21-day window.
    await expect(page.getByText(/Vehicle A insurance renews in/i)).toBeVisible();
    // ...and the seeded contract end inside its warning window.
    await expect(page.getByText(/time to shop around/i).first()).toBeVisible();
  });

  test('purchases can be filtered and edited inline', async ({ page }) => {
    await page.goto('/purchases');
    await expect(page.getByRole('heading', { name: 'Purchases', level: 1 })).toBeVisible();
    await expect(page.getByText('Corner Foods').first()).toBeVisible();

    // Filter down to one supplier and confirm the table follows.
    await page.getByLabel('Supplier', { exact: false }).first().selectOption({
      label: 'Corner Foods',
    });
    await page.getByRole('button', { name: /apply/i }).click();
    await expect(page.getByText('Corner Foods').first()).toBeVisible();
    await expect(page.getByText('The Corner Cafe')).toHaveCount(0);

    // Inline edit: open the row editor, change the note, save, see it.
    await page.getByText('Edit', { exact: true }).first().click();
    const note = page.getByLabel(/note/i).first();
    await note.fill('Edited in a browser test');
    await page.getByRole('button', { name: /save/i }).first().click();
    await expect(page.getByText('Edited in a browser test')).toBeVisible({ timeout: 30_000 });
  });

  test('the month calendar follows a real due-day edit', async ({ page }) => {
    await page.goto('/recurring');
    await expect(page.getByRole('heading', { name: /Recurring Payments/i })).toBeVisible();

    // The read-only boundary is stated in plain language (SPEC §11.2).
    await expect(page.getByText(/bank instruction/i).first()).toBeVisible();

    // Open the "Phone plan" schedule editor and move it to the 21st.
    const scheduleItem = page.locator('li', { hasText: 'Phone plan' }).first();
    await scheduleItem.getByText('Edit schedule').click();
    await scheduleItem.getByLabel('Day of month').fill('21');
    await scheduleItem.getByRole('button', { name: 'Save from next instance' }).click();

    // The schedule reports its new next-due date, and the save message repeats
    // that converted history is untouched (SPEC §11.1).
    const dueLine = scheduleItem.getByText(/Next due: \d{4}-\d{2}-\d{2}/);
    await expect(dueLine).toBeVisible({ timeout: 30_000 });
    const dueDate = /(\d{4}-\d{2}-\d{2})/.exec(await dueLine.innerText())?.[1] ?? '';
    expect(dueDate.slice(8)).toBe('21');

    // Now prove the calendar agrees: the cell for that exact date, in the month
    // that contains it, carries the instance. The grid and the lists render from
    // one instance list, so they cannot disagree; this observes it.
    await page.goto(`/recurring?month=${dueDate.slice(0, 7)}`);
    const calendar = page.locator('section[aria-labelledby="calendar-heading"]');
    const cell = calendar.locator(`[data-date="${dueDate}"]`);
    await expect(cell).toHaveCount(1);
    // Whatever else that day holds, the schedule's own instance is in the cell
    // and links back to the schedule it came from.
    await cell.locator('summary').click();
    await expect(cell.getByText('Phone plan')).toBeVisible();
    await expect(cell.locator('a[href^="#schedule-edit-"]')).toHaveCount(1);

    // Month navigation keeps working, and the heading follows the URL.
    const heading = await calendar.getByRole('heading', { level: 2 }).innerText();
    await page.getByRole('link', { name: /next/i }).first().click();
    await expect(calendar.getByRole('heading', { level: 2 })).not.toHaveText(heading);
  });

  test('suppliers carry contact cards, references and the interaction log', async ({ page }) => {
    await page.goto('/suppliers');
    await expect(page.getByRole('heading', { name: 'Suppliers', level: 1 })).toBeVisible();
    await expect(page.getByText('Corner Foods')).toBeVisible();
    await expect(page.getByRole('link', { name: '01632 960111' })).toBeVisible();

    // Add a reference pair and see it listed.
    await page.getByPlaceholder('Label (e.g. Policy number)').first().fill('Account number');
    await page.getByPlaceholder('Value').first().fill('ACCT-42');
    await page.getByRole('button', { name: 'Add reference' }).first().click();
    await expect(page.getByText('ACCT-42')).toBeVisible({ timeout: 30_000 });

    // Log an interaction with an outcome and see it in the log.
    await page.getByPlaceholder('What happened?').first().fill('Rang about the renewal');
    await page.getByPlaceholder('Outcome (optional)').first().fill('Quote to follow');
    await page.getByRole('button', { name: 'Log interaction' }).first().click();
    await expect(page.getByText('Quote to follow')).toBeVisible({ timeout: 30_000 });
  });

  test('contracts and renewals list both kinds of date and stay editable', async ({ page }) => {
    await page.goto('/contracts');
    await expect(page.getByRole('heading', { name: /Contracts/i, level: 1 })).toBeVisible();
    await expect(page.getByText('Vehicle A insurance')).toBeVisible();
    await expect(page.getByText(/BroadbandCo fibre/).first()).toBeVisible();
    // The seeded contract end is inside its window (or honestly rolled).
    await expect(
      page.getByText(/ends in \d+ days|ends today|rolled \/ awaiting review/).first(),
    ).toBeVisible();
    // Promised follow-up from the seed appears here (SPEC §21.2).
    await expect(page.getByText(/Follow-ups you promised/i)).toBeVisible();

    // The renewal is editable in place.
    await page.getByText('Edit renewal').first().click();
    await expect(page.getByLabel('Warn days before').first()).toBeVisible();
  });

  test('insights show the four panels with honest labels', async ({ page }) => {
    await page.goto('/insights');
    await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
    // The current calendar month is flagged as in progress rather than quoted
    // as a finished figure.
    await expect(page.getByText(/in progress/i).first()).toBeVisible();
    // The projection honesty loop compares configured figures with recent
    // complete periods (SPEC §16 panel 4).
    await expect(page.getByRole('heading', { name: /configured figures honest/i })).toBeVisible();
    await expect(page.getByText(/Groceries|Fuel/i).first()).toBeVisible();
  });
});
