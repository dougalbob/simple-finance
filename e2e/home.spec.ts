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

  test('the amount alone fills line 1, balances the split and enables Save', async ({ page }) => {
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const line1 = entry.getByLabel('Line 1 amount');

    // The till amount is typed once: Line 1 follows it, so the split is
    // complete and Save is live without touching the line.
    await entry.locator('input[name="amount"]').fill('85.00');
    await expect(line1).toHaveValue('85.00');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
    await expect(entry.getByRole('button', { name: 'Save purchase' })).toBeEnabled();

    // The only category control is still the split line's own, in the panel
    // above Save — no category field crept in next to the supplier and amount.
    await expect(entry.getByLabel(/^Category/)).toHaveCount(1);
    await expect(entry.getByRole('heading', { name: 'Split the payment' })).toBeVisible();
  });

  test('every keystroke updates line 1 — 8 then 5 is 85.00, not 8.00', async ({ page }) => {
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');

    // "8" is already a valid amount, so the first digit must not freeze it.
    await amount.pressSequentially('8');
    await expect(amount).toHaveValue('8');
    await expect(line1).toHaveValue('8.00');
    await amount.pressSequentially('5');
    await expect(amount).toHaveValue('85');
    await expect(line1).toHaveValue('85.00');

    // A correction downwards follows too.
    await amount.fill('84.50');
    await expect(line1).toHaveValue('84.50');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
  });

  test('a half-typed or deleted total never lies about line 1', async ({ page }) => {
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');
    const saveButton = entry.getByRole('button', { name: 'Save purchase' });

    await amount.fill('85');
    await expect(line1).toHaveValue('85.00');

    // "85." is not an amount yet: the last mirrored value stays put...
    await amount.fill('85.');
    await expect(line1).toHaveValue('85.00');
    // ...and the exact-total rule keeps Save off (balanced needs a parsed total).
    await expect(saveButton).toBeDisabled();
    await expect(entry.getByText('Enter amount')).toBeVisible();

    // Deleting the amount must not leave a stale mirrored line behind.
    await amount.fill('');
    await expect(line1).toHaveValue('');
    // Zero is not an amount either.
    await amount.fill('0');
    await expect(line1).toHaveValue('');
    await expect(saveButton).toBeDisabled();
  });

  test('editing line 1 takes it over and a later total change leaves it alone', async ({
    page,
  }) => {
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');
    const saveButton = entry.getByRole('button', { name: 'Save purchase' });

    await amount.fill('85');
    await expect(line1).toHaveValue('85.00');

    // Touching the line is a takeover: their value sticks from here on.
    await line1.fill('40.00');
    await expect(entry.getByText(/Remaining £45\.00/)).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await amount.fill('90');
    await expect(line1).toHaveValue('40.00');
    await expect(entry.getByText(/Remaining £50\.00/)).toBeVisible();
    await expect(saveButton).toBeDisabled();

    // The exact-total rule is unchanged: matching the total by hand saves.
    await line1.fill('90');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
    await expect(saveButton).toBeEnabled();
  });

  test('category, supplier, pot, paid by, date and note do not stop the following', async ({
    page,
  }) => {
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');

    // Naming a remembered supplier writes its most-used category through the
    // shared updateLine path, and the category dropdown uses that path too.
    await entry.locator('input[name="supplierName"]').fill('Corner Foods');
    await entry.getByLabel(/^Category/).selectOption({ label: 'Groceries / Top-up Shops' });
    await entry.getByLabel(/^For/).selectOption('person');
    await entry.getByLabel(/^Person/).selectOption({ label: 'Sam' });
    await entry.getByLabel('Pot').selectOption({ index: 2 });
    await entry.getByLabel('Paid by').selectOption({ index: 2 });
    await entry.getByLabel('Date').fill('2024-01-05');
    await entry.getByLabel('Note (optional)').fill('Follows the amount');

    await amount.fill('42.50');
    await expect(line1).toHaveValue('42.50');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
  });

  test('Add split leaves line 1 alone, and so does a later correction', async ({ page }) => {
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');
    const line2 = entry.getByLabel('Line 2 amount');
    const saveButton = entry.getByRole('button', { name: 'Save purchase' });
    const assignRemaining = entry.getByRole('button', { name: 'Assign remaining' });

    await amount.fill('85');
    await expect(line1).toHaveValue('85.00');

    // Splitting deliberately: the new line starts empty, Line 1 is neither
    // cleared nor shrunk, and there is nothing left to assign yet.
    await entry.getByRole('button', { name: '+ Add split' }).click();
    await expect(line1).toHaveValue('85.00');
    await expect(line2).toHaveValue('');
    await expect(assignRemaining).toHaveCount(0);

    // A correction to the total must not rewrite the line either.
    await amount.fill('60');
    await expect(line1).toHaveValue('85.00');
    await expect(line2).toHaveValue('');
    await expect(saveButton).toBeDisabled();

    // Hand-splitting still obeys the exact-total rule.
    await line2.fill('40');
    await expect(entry.getByText(/Over by £65\.00/)).toBeVisible();
    await expect(saveButton).toBeDisabled();
    await line1.fill('20');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // Removing the extra line does not resume the following: the typed value
    // stays exactly as typed.
    await entry.getByRole('button', { name: 'Remove line' }).last().click();
    await expect(line1).toHaveValue('20');
    await amount.fill('30');
    await expect(line1).toHaveValue('20');
    await expect(saveButton).toBeDisabled();
  });

  test('Add another starts the following over', async ({ page }) => {
    test.slow(); // its own purchase, against the dev server
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');

    // Saved straight from the mirrored amount — Line 1 was never touched.
    await entry.locator('input[name="supplierName"]').fill('Playwright Follower Shop');
    await amount.fill('12.00');
    await expect(line1).toHaveValue('12.00');
    await entry.getByRole('button', { name: 'Save purchase' }).click();
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });

    // After the save the line is taken over (the value sticks)...
    await line1.fill('1.00');
    await expect(line1).toHaveValue('1.00');

    // ...and "Add another" hands the following back to the amount.
    await entry.getByRole('button', { name: 'Add another' }).click();
    await expect(amount).toHaveValue('');
    await expect(line1).toHaveValue('');
    await amount.fill('7.50');
    await expect(line1).toHaveValue('7.50');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
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

  test('purchase filters start collapsed and stay inside the card', async ({ page }) => {
    await page.goto('/purchases');
    const filters = page.getByRole('form', { name: 'Purchase filters' });
    const show = filters.getByRole('button', { name: 'Show filters' });
    await expect(show).toBeVisible();
    await expect(filters.getByLabel('From date')).toBeHidden();

    await show.click();
    await expect(filters.getByRole('button', { name: 'Hide filters' })).toBeVisible();

    const from = filters.getByLabel('From date');
    const to = filters.getByLabel('To date');
    const pot = filters.getByLabel('Pot');
    await expect(from).toBeVisible();
    await expect(to).toBeVisible();
    await expect(pot).toBeVisible();

    const cardBox = await filters.boundingBox();
    const fromBox = await from.boundingBox();
    const toBox = await to.boundingBox();
    const potBox = await pot.boundingBox();
    expect(cardBox).toBeTruthy();
    expect(fromBox).toBeTruthy();
    expect(toBox).toBeTruthy();
    expect(potBox).toBeTruthy();
    if (cardBox === null || fromBox === null || toBox === null || potBox === null) return;

    // From/To sit on one row; the dropdowns stay inside the rounded card.
    expect(Math.abs(fromBox.y - toBox.y)).toBeLessThan(8);
    expect(toBox.x).toBeGreaterThan(fromBox.x);
    for (const box of [fromBox, toBox, potBox]) {
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    }

    await filters.getByLabel('Supplier').selectOption({ label: 'Corner Foods' });
    await filters.getByRole('button', { name: 'Apply filters' }).click();
    await expect(filters.getByRole('button', { name: 'Hide filters' })).toBeVisible();
    await expect(filters.getByLabel('Supplier')).toBeVisible();
  });

  test('the Move tab records a transfer without moving the household total', async ({ page }) => {
    await page.goto('/');
    const household = page.getByRole('heading', { name: /household:/i });
    const before = await household.textContent();

    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await entry.getByRole('tab', { name: 'Move' }).click();
    await entry.getByLabel('From pot').selectOption({ label: 'Main account' });
    await entry.getByLabel('To pot').selectOption({ label: "Alex's cash" });
    await entry.getByLabel('Amount').fill('5.00');
    await entry.getByRole('button', { name: 'Record transfer' }).click();
    await expect(entry.getByRole('status')).toContainText(/recorded/i, { timeout: 30_000 });

    // Between our own pots: the household total does not move.
    await expect(page.getByRole('heading', { name: /household:/i })).toHaveText(before ?? '');
  });
});
