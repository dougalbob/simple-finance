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

    // Desktop keeps the filter form open; the phone-only toggle stays hidden.
    await expect(page.getByRole('button', { name: 'Show filters' })).toBeHidden();
    await expect(page.getByLabel('Supplier')).toBeVisible();

    // Filter down to one supplier and confirm the table follows.
    await page.getByLabel('Supplier').selectOption({ label: 'Corner Foods' });
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(results.getByText('Corner Foods').first()).toBeVisible();
    await expect(results.getByText('The Corner Cafe')).toHaveCount(0);

    // Inline edit: open the row editor, change the note, save, see it.
    const row = results.locator('tbody tr', { hasText: 'Corner Foods' }).first();
    await row.locator('summary', { hasText: 'Edit' }).click();
    await row.getByRole('button', { name: 'Edit' }).click();
    await row.getByLabel('Note (blank keeps the current note)').fill('Edited in a browser test');
    await row.getByRole('button', { name: 'Save purchase' }).click();
    await expect(results.getByText('Edited in a browser test').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('a purchase can be voided, and the void control stays legible', async ({ page }) => {
    // Regression for two field reports on v0.1.1. The void form posts
    // `expectedVersion` while both void actions read `version`, so every void
    // failed with "Invalid input: expected number, received null"; and the
    // submit button layered `text-red-700` over `submitClass`'s `text-white`,
    // which Tailwind resolves to white-on-white because `.text-white` is emitted
    // later in the stylesheet. Nothing covered either path.
    //
    // Three sequential mutations against a dev server, so allow more than the
    // default budget. Its own purchase, so the seeded rows the other specs
    // assert on are untouched and a CI retry starts from a clean state.
    test.slow();
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await entry.locator('input[name="supplierName"]').fill('Playwright Duplicate');
    await entry.locator('input[name="amount"]').fill('4.50');
    await entry.getByLabel('Line 1 amount').fill('4.50');
    await entry.getByLabel(/^Category/).selectOption({ label: 'Groceries / Weekly Shop' });
    await entry.getByRole('button', { name: 'Save purchase' }).click();
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });

    await page.goto('/purchases');
    const results = page.locator('section[aria-labelledby="results-heading"]');
    const rows = results.locator('tbody tr', { hasText: 'Playwright Duplicate' });
    await expect(rows).toHaveCount(1);
    await rows.first().locator('summary', { hasText: 'Edit' }).click();
    await rows.first().getByRole('button', { name: 'Void', exact: true }).click();

    // Legibility, as the product owner specified it: a coloured label at rest,
    // and a white label only on a saturated (non-white) background when hovered.
    const submit = rows.first().getByRole('button', { name: 'Void purchase' });
    await expect(submit).not.toHaveCSS('color', 'rgb(255, 255, 255)');
    await submit.hover();
    await expect(submit).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(submit).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await rows
      .first()
      .getByLabel(/Why are you voiding this/)
      .fill('Entered twice at the till');
    await submit.click();

    // The void lands and the table revalidates. A voided entry leaves the
    // default history view: listPurchases excludes voided records unless the
    // Voided tag is active (SPEC §15.2), so the row disappearing *is* the
    // success signal - a rejected void would leave it there with an error.
    await expect(rows).toHaveCount(0, { timeout: 30_000 });

    // Voids never delete (decision 6): the record is still in the history under
    // the Voided tag, with its reason and the editor replaced by "history kept".
    await page.getByLabel('Voided', { exact: true }).check();
    await page.getByRole('button', { name: 'Apply filters' }).click();
    const voidedRow = results.locator('tbody tr', { hasText: 'Playwright Duplicate' }).first();
    await expect(voidedRow).toContainText(/Voided .* Entered twice at the till/, {
      timeout: 30_000,
    });
    await expect(voidedRow).toContainText('history kept');
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
    const originalDueLine = scheduleItem.getByText(/Next due: \d{4}-\d{2}-\d{2}/);
    const originalDueText = await originalDueLine.innerText();
    await scheduleItem.getByText('Edit schedule').click();
    await scheduleItem.getByLabel('Day of month').fill('21');
    await scheduleItem.getByRole('button', { name: 'Save from next instance' }).click();

    // The edit itself sticks...
    await expect(scheduleItem.getByLabel('Day of month')).toHaveValue('21');

    // ...and the schedule reports a next-due date that the calendar agrees with.
    const dueLine = scheduleItem.getByText(/Next due: \d{4}-\d{2}-\d{2}/);
    await expect(dueLine).not.toHaveText(originalDueText, { timeout: 30_000 });
    const dueDate = /(\d{4}-\d{2}-\d{2})/.exec(await dueLine.innerText())?.[1] ?? '';

    // ...and the calendar agrees: the cell for that exact date carries the
    // schedule's own instance, linked back to the schedule it came from. The
    // grid and the lists render from one instance list, so they cannot drift;
    // this observes it in a browser.
    await page.goto(`/recurring?month=${dueDate.slice(0, 7)}`);
    const calendar = page.locator('section[aria-labelledby="calendar-heading"]');
    const cell = calendar.locator(`[data-date="${dueDate}"]`);
    await expect(cell).toHaveCount(1);
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
    const contracts = page.locator('section[aria-labelledby="contract-ends-heading"]');
    const contractRow = contracts.locator('div', { hasText: 'BroadbandCo fibre' }).first();
    await expect(contractRow.getByText(/in \d+ days|ends today|rolled/i)).toBeVisible();
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

  test('a supplier created from Recurring is shared with Suppliers and Renewals', async ({
    page,
  }) => {
    // Configuration + identity only: no receipts, purchases or real financial
    // data. Fictional supplier name throughout.
    test.slow();
    const supplierName = 'Willow Energy Co';
    const scheduleName = 'Electricity bill';

    await page.goto('/recurring');
    const schedules = page.locator('section[aria-labelledby="schedules-heading"]');
    await schedules.getByText('Add a schedule').click();
    // Scope to the add form only — edit forms also label a "Schedule name" field.
    const form = schedules
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Add schedule' }) });
    await form.locator('input[name="name"]').fill(scheduleName);
    await form.locator('input[name="amount"]').fill('55.00');
    await form.locator('select[name="kind"]').selectOption('dd');
    await form.locator('select[name="categoryId"]').selectOption({ label: 'Utilities / Energy' });
    // The add form's supplier select has no name until a choice is made; pick by label text.
    await form
      .locator('label', { hasText: /^Supplier$/ })
      .locator('select')
      .selectOption({
        label: 'Add a new supplier…',
      });
    await form.locator('input[name="supplierName"]').fill(supplierName);
    await form.getByRole('button', { name: 'Add schedule' }).click();
    await expect(form.getByRole('status')).toContainText(/added/i, { timeout: 30_000 });

    // The new schedule lists the canonical supplier name.
    const scheduleItem = schedules.locator('li', { hasText: scheduleName }).first();
    await expect(scheduleItem.getByText(supplierName)).toBeVisible({ timeout: 30_000 });

    // It appears on the Suppliers page and contact details can be edited.
    await page.goto('/suppliers');
    const card = page
      .locator('article', { has: page.getByRole('heading', { name: supplierName, exact: true }) })
      .first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByText('Edit contact card').click();
    await card.getByLabel('Phone').fill('01632 960333');
    await card.getByRole('button', { name: 'Save contact card' }).click();
    await expect(card.getByRole('link', { name: '01632 960333' })).toBeVisible({
      timeout: 30_000,
    });

    // The same supplier is selectable on a renewal.
    await page.goto('/recurring');
    const renewals = page.locator('section[aria-labelledby="renewals-heading"]');
    await renewals.getByText('Add a renewal').click();
    const renewalForm = renewals
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Add renewal' }) });
    await renewalForm.locator('input[name="label"]').fill('Electricity contract renewal');
    const nextYear = new Date();
    nextYear.setUTCDate(nextYear.getUTCDate() + 40);
    const nextDate = nextYear.toISOString().slice(0, 10);
    await renewalForm.locator('input[name="nextRenewalDate"]').fill(nextDate);
    await renewalForm.locator('select[name="supplierId"]').selectOption({ label: supplierName });
    await renewalForm.getByRole('button', { name: 'Add renewal' }).click();
    await expect(renewalForm.getByRole('status')).toContainText(/added/i, { timeout: 30_000 });

    const renewalItem = renewals.locator('li', { hasText: 'Electricity contract renewal' }).first();
    await expect(renewalItem.getByText(supplierName)).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .locator('section[aria-labelledby="schedules-heading"]')
        .locator('li', { hasText: scheduleName })
        .getByText(supplierName),
    ).toBeVisible();
  });

  test('a vehicle added in Settings reaches every vehicle picker', async ({ page }) => {
    // This changes only household configuration. It deliberately does not add
    // a receipt or any financial data.
    test.slow();
    const newVehicle = 'Vehicle C';
    await page.goto('/settings');
    const addVehicle = page.getByRole('form', { name: 'Add vehicle' });
    await addVehicle.getByLabel('Name').fill(newVehicle);
    await addVehicle.getByLabel('Owner (optional)').selectOption({ label: 'Sam' });
    await addVehicle.getByRole('button', { name: 'Add vehicle' }).click();
    await expect(addVehicle.getByRole('status')).toContainText(/vehicle added/i, {
      timeout: 30_000,
    });

    await page.goto('/');
    const quickEntry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await quickEntry.getByRole('tab', { name: 'Fuel' }).click();
    await expect(
      quickEntry.getByLabel('Vehicle').locator('option', { hasText: newVehicle }),
    ).toHaveCount(1);

    await page.goto('/purchases');
    await page.getByLabel('Target type').selectOption('vehicle');
    await expect(page.getByLabel('Target').locator('option', { hasText: newVehicle })).toHaveCount(
      1,
    );

    await page.goto('/recurring');
    await expect(page.locator('select[name="target"] option', { hasText: newVehicle })).toHaveCount(
      2,
    );

    await page.goto('/insights');
    await expect(page.getByText(newVehicle, { exact: true }).first()).toBeVisible();
  });
});
