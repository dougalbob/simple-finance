import { expect, test } from '@playwright/test';
import { addDaysIso, londonToday, waitForFilters, waitForTill } from './support';

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
    // submit button layered a danger-coloured label over `submitClass`'s
    // till-ink one, which Tailwind resolves to ink-on-ink because
    // `.text-till-ink` is emitted later in the stylesheet than `.text-danger`
    // (the classes were palette names until the token pass, decision 159).
    // Nothing covered either path.
    //
    // Three sequential mutations against a dev server, so allow more than the
    // default budget. Its own purchase, so the seeded rows the other specs
    // assert on are untouched and a CI retry starts from a clean state.
    test.slow();
    await page.goto('/');
    await waitForTill(page);
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
    await scheduleItem.getByRole('button', { name: 'Save changes' }).click();

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

  test('a backdated schedule start turns a missed direct debit into a DD record', async ({
    page,
  }) => {
    test.slow();
    // The case decision 162 was made for: a household starts recording a few
    // days late, and the direct debits inside that gap belong to no instance.
    // The fix is the schedule's own start date — move it earlier and the app
    // materialises the missed due date, which converts into a real DD record
    // instead of being typed in as a Purchase.
    const scheduleName = 'Playwright backfilled DD';
    const supplierName = 'Playwright Backfill Co';
    const today = londonToday();
    const missedDate = addDaysIso(today, -10); // already gone by, inside the default window
    const dueDayOfMonth = Number(missedDate.slice(8));

    await page.goto('/recurring');
    const schedules = page.locator('section[aria-labelledby="schedules-heading"]');
    await schedules.getByText('Add a schedule').click();
    const addForm = schedules
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Add schedule' }) });
    await addForm.locator('input[name="name"]').fill(scheduleName);
    await addForm.locator('input[name="amount"]').fill('44.40');
    await addForm.locator('input[name="dueDayOfMonth"]').fill(String(dueDayOfMonth));
    // Named pot, not the select's default: the row is looked up on Main account.
    await addForm.locator('select[name="potId"]').selectOption({ label: 'Main account' });
    await addForm
      .locator('select[name="categoryId"]')
      .selectOption({ label: 'Utilities / Energy' });
    await addForm
      .locator('select[name="supplierId"]')
      .selectOption({ label: 'Add a new supplier…' });
    await addForm.locator('input[name="supplierName"]').fill(supplierName);
    // 'Active from' is left at today — which is exactly the mistake this edit
    // exists to correct: the schedule starts after the money already left.
    await addForm.getByRole('button', { name: 'Add schedule' }).click();
    await expect(addForm.getByRole('status')).toContainText(/added/i, { timeout: 30_000 });

    const scheduleItem = schedules.locator('li', { hasText: scheduleName }).first();
    await expect(scheduleItem).toContainText(supplierName, { timeout: 30_000 });
    // The card shows the start date it holds, and the next expectation is still
    // a month away: nothing in the app covers the date that has passed.
    await expect(scheduleItem).toContainText(`active from ${today}`);
    const nextDue = /Next due: (\d{4}-\d{2}-\d{2})/.exec(await scheduleItem.innerText())?.[1] ?? '';
    expect(nextDue).not.toBe('');
    expect(nextDue > today).toBe(true);

    // Edit it: the start date is now a field on the card, and moving it earlier
    // is a normal edit — not a support ticket or a re-created schedule.
    await scheduleItem.locator('summary', { hasText: 'Edit schedule' }).click();
    await expect(scheduleItem.getByLabel(/Active from/)).toHaveValue(today);
    await scheduleItem.getByLabel(/Active from/).fill(addDaysIso(today, -12));
    await scheduleItem.getByRole('button', { name: 'Save changes' }).click();
    await expect(scheduleItem.getByRole('status')).toContainText(
      /one payment the app had not been told about is now expected/,
      { timeout: 30_000 },
    );
    await expect(scheduleItem.getByLabel(/Active from/)).toHaveValue(addDaysIso(today, -12), {
      timeout: 30_000,
    });

    // The month that held the missed collection now carries the instance, and
    // the card's own line reflects the start it was given.
    await page.goto(`/recurring?month=${missedDate.slice(0, 7)}`);
    const calendar = page.locator('section[aria-labelledby="calendar-heading"]');
    const cell = calendar.locator(`[data-date="${missedDate}"]`);
    await expect(cell).toHaveCount(1);
    await expect(cell.locator('a[href^="#schedule-edit-"]', { hasText: scheduleName })).toHaveCount(
      1,
    );

    // The money pass runs on All Transactions (§11.2), and the row it makes is
    // a direct debit — code DD, linked back to its schedule — not a PUR.
    await page.goto(`/transactions?from=${addDaysIso(today, -12)}&to=${today}`);
    const table = page.locator('section[aria-labelledby="activity-heading"] table');
    const row = table.locator('tr', { hasText: '−£44.40' }).filter({ hasText: missedDate }).first();
    await expect(row.getByRole('cell', { name: /^DD/ })).toBeVisible({ timeout: 30_000 });
    await expect(row.getByRole('link', { name: 'Open the schedule' })).toHaveAttribute(
      'href',
      /^\/recurring#schedule-\d+$/,
    );

    // And the start date on the card stayed where the household put it.
    await page.goto('/recurring');
    await expect(
      page.locator('section[aria-labelledby="schedules-heading"] li', { hasText: scheduleName }),
    ).toContainText(`active from ${addDaysIso(today, -12)}`, { timeout: 30_000 });
  });

  test('suppliers carry contact cards, references and the interaction log', async ({ page }) => {
    await page.goto('/suppliers');
    await expect(page.getByRole('heading', { name: 'Suppliers', level: 1 })).toBeVisible();

    const card = page
      .locator('article', { has: page.getByRole('heading', { name: 'Corner Foods', exact: true }) })
      .first();
    await card.getByRole('button', { name: /Corner Foods/i }).click();
    await expect(card.getByRole('link', { name: '01632 960111' })).toBeVisible();

    // "Recent purchases" says who each payment was for, not just date · amount
    // (decision 161). One supplier can hold a contract per person, so a row
    // that reads only an amount is the one place the household could not tell
    // three contracts apart. The seeded shop is split across two targets, so
    // it names the first line and counts the rest, exactly as All
    // Transactions does.
    const shop = card.locator('li', { hasText: '£63.47' }).first();
    await expect(shop).toContainText('Weekly Shop (household)');
    await expect(shop).toContainText('+1 more');

    // Same category, different target: the target is what tells them apart,
    // and it is words — never colour alone (SPEC §16.7).
    const cafe = page
      .locator('article', {
        has: page.getByRole('heading', { name: 'The Corner Cafe', exact: true }),
      })
      .first();
    await cafe.getByRole('button', { name: /The Corner Cafe/i }).click();
    const cafeRow = cafe.locator('li', { hasText: '£3.49' }).first();
    await expect(cafeRow).toContainText('Weekly Shop (Sam)');
    await expect(cafeRow).not.toContainText('more');

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

    // "BroadbandCo card →" names the supplier it came from (decision 149): the
    // Suppliers page opens filtered to that supplier with the card already
    // open, not as a collapsed list of everyone.
    await contracts.getByRole('link', { name: 'BroadbandCo card →' }).click();
    await expect(page).toHaveURL(/\/suppliers\?supplierId=\d+/);
    await expect(page.getByLabel('Filter suppliers')).toHaveValue('BroadbandCo');
    await expect(
      page
        .locator('article', {
          has: page.getByRole('heading', { name: 'BroadbandCo', exact: true }),
        })
        .getByRole('button', { name: 'BroadbandCo' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await page.goBack();

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
    await form.locator('select[name="supplierId"]').selectOption({ label: 'Add a new supplier…' });
    await form.locator('input[name="supplierName"]').fill(supplierName);
    await form.getByRole('button', { name: 'Add schedule' }).click();
    await expect(form.getByRole('status')).toContainText(/added/i, { timeout: 30_000 });

    // The new schedule lists the canonical supplier name in its summary line
    // (the edit-form <option> list also contains it, so avoid getByText alone).
    const scheduleItem = schedules.locator('li', { hasText: scheduleName }).first();
    await expect(scheduleItem).toContainText(supplierName, { timeout: 30_000 });
    const supplierLink = scheduleItem.locator('a', { hasText: 'Supplier card' });
    await expect(supplierLink).toBeVisible();

    // The link lands on that supplier — filtered to it, card already open, in
    // view — instead of the collapsed full list (decision 149).
    await supplierLink.click();
    await expect(page).toHaveURL(/\/suppliers\?supplierId=\d+/);
    await expect(page.getByLabel('Filter suppliers')).toHaveValue(supplierName);
    await expect(page.locator('article')).toHaveCount(1);
    const card = page
      .locator('article', { has: page.getByRole('heading', { name: supplierName, exact: true }) })
      .first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole('button', { name: supplierName })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    // Contact details can be edited straight away.
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
    const nextDate = addDaysIso(londonToday(), 40);
    await renewalForm.locator('input[name="nextRenewalDate"]').fill(nextDate);
    await renewalForm.locator('select[name="supplierId"]').selectOption({ label: supplierName });
    await renewalForm.getByRole('button', { name: 'Add renewal' }).click();
    await expect(renewalForm.getByRole('status')).toContainText(/added/i, { timeout: 30_000 });

    const renewalItem = renewals.locator('li', { hasText: 'Electricity contract renewal' }).first();
    await expect(renewalItem).toContainText(supplierName, { timeout: 30_000 });
    await expect(
      page
        .locator('section[aria-labelledby="schedules-heading"]')
        .locator('li', { hasText: scheduleName }),
    ).toContainText(supplierName);
  });

  test('a vehicle added in Settings reaches every vehicle picker', async ({ page }) => {
    // This changes only household configuration. It deliberately does not add
    // a receipt or any financial data.
    test.slow();
    // Unique per retry: the database survives a retry, so a hard-coded name
    // turns every retry into "There is already a vehicle called …".
    const newVehicle =
      test.info().retry === 0 ? 'Vehicle C' : `Vehicle C (retry ${test.info().retry})`;
    await page.goto('/settings');
    const addVehicle = page.getByRole('form', { name: 'Add vehicle' });
    await addVehicle.getByLabel('Name').fill(newVehicle);
    await addVehicle.getByLabel('Owner (optional)').selectOption({ label: 'Sam' });
    await addVehicle.getByRole('button', { name: 'Add vehicle' }).click();
    await expect(addVehicle.getByRole('status')).toContainText(/vehicle added/i, {
      timeout: 30_000,
    });

    await page.goto('/');
    await waitForTill(page);
    const quickEntry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await quickEntry.getByRole('tab', { name: 'Fuel' }).click();
    // The vehicle is a row of chips now (decision 146), one per vehicle.
    await expect(
      quickEntry.getByRole('radiogroup', { name: 'Vehicle' }).getByRole('radio', {
        name: newVehicle,
      }),
    ).toHaveCount(1);

    await page.goto('/purchases');
    await waitForFilters(page);
    await page.getByLabel('Target type', { exact: true }).selectOption('vehicle');
    await expect(
      page.getByLabel('Target', { exact: true }).locator('option', { hasText: newVehicle }),
    ).toHaveCount(1);

    await page.goto('/recurring');
    await expect(page.locator('select[name="target"] option', { hasText: newVehicle })).toHaveCount(
      2,
    );

    await page.goto('/insights');
    await expect(page.getByText(newVehicle, { exact: true }).first()).toBeVisible();
  });
});

test('monthly no-payment months use a compact native disclosure and survive save/reload', async ({
  page,
}) => {
  test.slow();
  await page.goto('/recurring');
  const schedules = page.locator('section[aria-labelledby="schedules-heading"]');
  await schedules.getByText('Add a schedule').click();
  const form = schedules
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Add schedule' }) });
  const summary = form.locator('summary', { hasText: 'Select any months with no payment:' });
  await expect(summary).toHaveText('Select any months with no payment: none');
  await expect(summary).toHaveCSS('display', 'list-item');
  await expect(summary.locator('..')).not.toHaveAttribute('open');
  await expect(form.getByLabel('February', { exact: true })).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(form.getByRole('checkbox')).toHaveCount(12);
  await form.getByLabel('February', { exact: true }).check();
  await form.getByLabel('March', { exact: true }).focus();
  await page.keyboard.press('Space');
  await summary.click();
  await expect(summary).toHaveText('Select any months with no payment: February, March');
  await expect(form.getByLabel('March', { exact: true })).toBeHidden();
  await form.locator('select[name="frequency"]').selectOption('annual');
  await expect(summary).toHaveCount(0);
  await form.locator('select[name="frequency"]').selectOption('monthly');
  await summary.click();
  await form.getByLabel('February', { exact: true }).check();
  await form.getByLabel('March', { exact: true }).check();
  await form.locator('input[name="name"]').fill('Playwright ten-month payment');
  await form.locator('input[name="amount"]').fill('150.00');
  await form.locator('select[name="kind"]').selectOption('so');
  await form.locator('select[name="categoryId"]').selectOption({ label: 'Utilities / Energy' });
  await form.getByRole('button', { name: 'Add schedule' }).click();
  await expect(form.getByRole('status')).toContainText(/added/i);
  await page.reload();
  const card = schedules.locator('li', { hasText: 'Playwright ten-month payment' }).first();
  await card.locator('summary', { hasText: 'Edit schedule' }).click();
  const editSummary = card.locator('summary', { hasText: 'Select any months with no payment:' });
  await expect(editSummary).toHaveText('Select any months with no payment: February, March');
  await expect(editSummary.locator('..')).not.toHaveAttribute('open');
  await expect(card.getByLabel('February', { exact: true })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await editSummary.click();
  await expect(card.getByRole('checkbox')).toHaveCount(12);
  await expect(card.getByLabel('February', { exact: true })).toBeChecked();
  await expect(card.getByLabel('December', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await card.getByLabel('February', { exact: true }).uncheck();
  await card.getByLabel('March', { exact: true }).uncheck();
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByRole('status')).toContainText(/saved|updated/i);
  await page.reload();
  await card.locator('summary', { hasText: 'Edit schedule' }).click();
  await expect(editSummary).toHaveText('Select any months with no payment: none');
  await expect(editSummary.locator('..')).not.toHaveAttribute('open');
});
