import { expect, test } from '@playwright/test';

/**
 * Desktop review paths (blueprint §12): the dense overview, the purchases table
 * with its inline editor, the month calendar staying consistent with the
 * schedule list after a real due-day edit, suppliers and contracts.
 */

test.describe('desktop review', () => {
  test('overview carries money, projection, due dates and key dates', async ({ page }) => {
    await page.goto('/overview');
    await expect(
      page.getByRole('heading', { name: 'Everything in one place', level: 1 }),
    ).toBeVisible();
    // Estimates and projections, never a bank balance.
    await expect(page.getByText(/never a bank balance/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Due this week/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Key dates/i })).toBeVisible();
    // The seeded renewal is inside its warning window (SPEC §22).
    await expect(page.getByText(/Vehicle A insurance renews in \d+ days/i)).toBeVisible();
    // ...and the seeded contract end is inside its own window.
    await expect(page.getByText(/time to shop around/i).first()).toBeVisible();
  });

  test('purchases can be filtered and edited inline', async ({ page }) => {
    await page.goto('/purchases');
    await expect(
      page.getByRole('heading', { name: 'Every recorded purchase', level: 1 }),
    ).toBeVisible();

    const results = page.locator('section[aria-labelledby="results-heading"]');
    await expect(results.getByText('Corner Foods').first()).toBeVisible();

    // Filter down to one supplier and confirm the table follows.
    await page.getByLabel('Supplier').selectOption({ label: 'Corner Foods' });
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(results.getByText('Corner Foods').first()).toBeVisible();
    await expect(results.getByText('The Corner Cafe')).toHaveCount(0);

    // Inline edit: open the row editor, change the note, save, see it.
    await results.locator('summary', { hasText: 'Edit' }).first().click();
    await page.getByLabel('Note (blank keeps the current note)').fill('Edited in a browser test');
    await page.getByRole('button', { name: 'Save purchase' }).click();
    await expect(results.getByText('Edited in a browser test').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('the month calendar follows a real due-day edit', async ({ page }) => {
    await page.goto('/recurring');
    await expect(
      page.getByRole('heading', { name: /Schedules, renewals & the month at a glance/i, level: 1 }),
    ).toBeVisible();

    // The read-only boundary is stated in plain language (SPEC §11.2).
    await expect(page.getByText(/bank instruction/i).first()).toBeVisible();

    // Open the "Phone plan" schedule editor and move it to the 21st.
    const schedules = page.locator('section[aria-labelledby="schedules-heading"]');
    const scheduleItem = schedules.locator('li', { hasText: 'Phone plan' }).first();
    await scheduleItem.getByText('Edit schedule').click();
    await scheduleItem.getByLabel('Day of month').fill('21');
    await scheduleItem.getByRole('button', { name: 'Save from next instance' }).click();

    // The schedule reports its new next-due date...
    const dueLine = scheduleItem.getByText(/Next due: \d{4}-\d{2}-\d{2}/);
    await expect(dueLine).toBeVisible({ timeout: 30_000 });
    const dueDate = /(\d{4}-\d{2}-\d{2})/.exec(await dueLine.innerText())?.[1] ?? '';
    expect(dueDate.slice(8)).toBe('21');

    // ...and the calendar agrees: the cell for that exact date carries the
    // schedule's own instance, linked back to the schedule it came from. The
    // grid and the lists render from one instance list, so they cannot drift;
    // this observes it in a browser.
    await page.goto(`/recurring?month=${dueDate.slice(0, 7)}`);
    const calendar = page.locator('section[aria-labelledby="calendar-heading"]');
    const cell = calendar.locator(`[data-date="${dueDate}"]`);
    await expect(cell).toHaveCount(1);
    await cell.locator('summary').click();
    await expect(cell.locator('a[href^="#schedule-edit-"]', { hasText: 'Phone plan' })).toHaveCount(
      1,
    );

    // Month navigation keeps working.
    const heading = await calendar.getByRole('heading', { level: 2 }).innerText();
    await page.getByRole('link', { name: /Next/ }).first().click();
    await expect(calendar.getByRole('heading', { level: 2 })).not.toHaveText(heading);
  });

  test('suppliers carry contact cards, references and the interaction log', async ({ page }) => {
    await page.goto('/suppliers');
    await expect(page.getByRole('heading', { name: 'Suppliers', level: 1 })).toBeVisible();

    const card = page
      .locator('article', { has: page.getByRole('heading', { name: 'Corner Foods', exact: true }) })
      .first();
    await expect(card.getByRole('link', { name: '01632 960111' })).toBeVisible();

    // Add a reference pair and see it listed on the same card.
    await card.getByPlaceholder('Label (e.g. Policy number)').fill('Account number');
    await card.getByPlaceholder('Value').fill('ACCT-42');
    await card.getByRole('button', { name: 'Add reference' }).click();
    await expect(card.getByText('ACCT-42').first()).toBeVisible({ timeout: 30_000 });

    // Log an interaction and see it in the same card's log.
    await card.getByPlaceholder('What happened?').fill('Rang about the renewal');
    await card.getByPlaceholder('Outcome (optional)').fill('Quote to follow');
    await card.getByRole('button', { name: 'Log interaction' }).click();
    await expect(card.getByText('Quote to follow').first()).toBeVisible({ timeout: 30_000 });
  });

  test('contracts list both kinds of date and stay editable', async ({ page }) => {
    await page.goto('/contracts');
    await expect(
      page.getByRole('heading', { name: 'Contracts & Renewals', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /Fixed-term contract ends/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Follow-ups you promised/i })).toBeVisible();

    // The seeded contract end is inside its window (or honestly rolled).
    const contractRow = page.locator('li', { hasText: 'BroadbandCo fibre' }).first();
    await expect(contractRow.getByText(/in \d+ days|ends today|ended|rolled/i)).toBeVisible();
    await expect(page.getByText('Vehicle A insurance').first()).toBeVisible();

    // The renewal is editable in place.
    await page.getByText('Edit renewal').first().click();
    await expect(page.getByLabel('Warn days before').first()).toBeVisible();
  });

  test('insights show the four panels with honest labels', async ({ page }) => {
    await page.goto('/insights');
    await expect(
      page.getByRole('heading', { name: 'Where the money actually went', level: 1 }),
    ).toBeVisible();
    // The current calendar month is flagged as in progress, never quoted as a
    // finished figure.
    await expect(page.getByText(/in progress/i).first()).toBeVisible();
    // The honesty loop compares configured figures with recent complete periods.
    await expect(page.getByRole('heading', { name: /configured figures honest/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Vehicle running costs/i })).toBeVisible();
  });
});
