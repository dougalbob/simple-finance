import { expect, type Locator, type Page, test } from '@playwright/test';
import { waitForTill } from './support';

/**
 * Fuel economy (v0.10.0 — plan decisions 139–141, SPEC §15.1/§16.6).
 *
 * One story, told the way the household would: a full tank with the
 * odometer, a quick part fill, then a full tank recorded in a hurry with no
 * mileage — which is added later from Purchases, at which point the mpg
 * appears on the row and on Insights.
 *
 * The spec adds its own vehicle so nothing else in the run moves its
 * numbers, and nothing it records disturbs the seeded vehicles' totals.
 * Worked answer: 450 miles on 14 + 36 = 50 litres (10.998 UK gallons) is
 * 40.9 mpg, and £70.00 over 450 miles is 15.6p a mile.
 */
const VEHICLE = 'Playwright Hatchback';

test.describe('fuel economy', () => {
  test('litres and odometer at the pump or later give mpg on the row and on Insights', async ({
    page,
  }) => {
    test.slow();
    await page.goto('/settings');
    const addVehicle = page.getByRole('form', { name: 'Add vehicle' });
    await addVehicle.getByLabel('Name').fill(VEHICLE);
    await addVehicle.getByRole('button', { name: 'Add vehicle' }).click();
    await expect(addVehicle.getByRole('status')).toContainText(/vehicle added/i, {
      timeout: 30_000,
    });

    // 1. Full tank with everything: the first reading is noted.
    await recordFuel(page, { amount: '60.00', litres: '42.00', odometer: '30000' }, (status) =>
      expect(status).toContainText(`${VEHICLE}: full tank at 30,000 miles noted`),
    );

    // 2. Part fill: just litres, the tick left off.
    await recordFuel(page, { amount: '20.00', litres: '14', fullTank: false }, (status) =>
      expect(status).toContainText(`Part fill for ${VEHICLE}`),
    );

    // 3. Full tank in a hurry: litres only, no mileage — nothing is demanded.
    await recordFuel(page, { amount: '50.00', litres: '36.00' }, (status) =>
      expect(status).toContainText(/no mpg for this stretch/),
    );

    // Insights lists the fill as missing its odometer reading.
    await page.goto('/insights');
    const card = page.getByRole('group', { name: `Fuel economy for ${VEHICLE}` });
    await expect(card).toContainText(/odometer/i);

    // Add the odometer later from Purchases.
    await page.goto('/purchases');
    const details = page
      .locator('[data-fuel-details]', { hasText: VEHICLE })
      .filter({ hasText: '36.00 L' });
    await expect(details).toHaveCount(1);
    await details.locator('summary', { hasText: /Fuel details — add odometer/ }).click();
    await details.getByLabel('Odometer (miles)').fill('30450');
    await expect(details.getByLabel('Litres')).toHaveValue('36.00');
    await expect(details.getByLabel('Filled to full')).toBeChecked();
    await details.getByRole('button', { name: 'Save fuel details' }).click();
    await expect(details.getByRole('status')).toContainText(
      `Fuel details saved. ${VEHICLE}: 40.9 mpg over 450 miles since the last full tank.`,
      { timeout: 30_000 },
    );
    await page.reload();
    await expect(
      page.locator('[data-fuel-details]', { hasText: VEHICLE }).filter({ hasText: '30,450 miles' }),
    ).toContainText('40.9 mpg over 450 miles');

    await page.goto('/insights');
    const after = page.getByRole('group', { name: `Fuel economy for ${VEHICLE}` });
    await expect(after).toContainText('40.9 mpg');
    await expect(after).toContainText('15.6p');
  });
});

async function recordFuel(
  page: Page,
  fill: { amount: string; litres: string; odometer?: string; fullTank?: boolean },
  check: (status: ReturnType<Page['getByRole']>) => Promise<void>,
): Promise<void> {
  await page.goto('/');
  await waitForTill(page);
  const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
  await entry.getByRole('tab', { name: 'Fuel' }).click();
  await entry.getByLabel('Fuel amount').fill(fill.amount);
  await entry.getByLabel('Litres (optional)').fill(fill.litres);
  if (fill.odometer !== undefined)
    await entry.getByLabel('Odometer (optional)').fill(fill.odometer);
  // Off by default since v0.11.0 (decision 147): a full tank is ticked on purpose.
  const tick = entry.getByLabel(/Filled to full/);
  await expect(tick).not.toBeChecked();
  if (fill.fullTank !== false) await tick.check();
  await pickChip(entry, 'Vehicle', VEHICLE);
  await pickChip(entry, 'Paid by', 'Alex');
  const pot = entry.getByLabel('Pot');
  if ((await pot.inputValue()) === '') await pot.selectOption({ label: 'Main account' });
  await entry.getByRole('button', { name: 'Save fuel' }).click();
  await check(entry.getByRole('status'));
}

async function pickChip(entry: Locator, group: string, label: string): Promise<void> {
  const radios = entry.getByRole('radiogroup', { name: group });
  await radios.locator('label', { hasText: label }).click();
  await expect(radios.getByRole('radio', { name: label })).toBeChecked();
}

async function openFuelTab(page: Page): Promise<Locator> {
  await page.goto('/');
  await waitForTill(page);
  const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
  await entry.getByRole('tab', { name: 'Fuel' }).click();
  return entry;
}

async function linkSignIn(page: Page, person: string, email: string): Promise<void> {
  await page.goto('/settings');
  const select = page.getByLabel(`${person} signs in as`);
  const form = page.locator('form', { has: select });
  await select.selectOption(email);
  await form.getByRole('button', { name: 'Save sign-in' }).click();
  await expect(form.getByRole('status')).toContainText(`${person} signs in as ${email}`, {
    timeout: 30_000,
  });
}

test.describe('the Fuel tab at the pump (v0.11.0)', () => {
  test('offers only fuel suppliers, and a new name can still be typed', async ({ page }) => {
    const entry = await openFuelTab(page);
    const supplier = entry.getByLabel('Supplier (optional)');
    await supplier.click();
    const list = entry.getByRole('listbox', { name: 'Supplier suggestions' });
    // Corner Foods has a seeded purchase with fuel for Vehicle A; The Corner
    // Cafe only ever sold a coffee (decision 145).
    await expect(list.getByRole('option', { name: /Corner Foods/ })).toBeVisible();
    await expect(list.getByRole('option', { name: /Corner Cafe/ })).toHaveCount(0);
    await supplier.fill('corner');
    await expect(list.getByRole('option')).toHaveCount(1);
    await supplier.fill('Playwright Forecourt');
    await expect(list).toHaveCount(0);
    await expect(supplier).toHaveValue('Playwright Forecourt');
  });

  test('opens on the signed-in person and their own car; a tap overrides it', async ({ page }) => {
    test.slow();
    // The seed links the dev sign-in to Alex, owner of Vehicle A.
    let entry = await openFuelTab(page);
    const vehicles = entry.getByRole('radiogroup', { name: 'Vehicle' });
    const payers = entry.getByRole('radiogroup', { name: 'Paid by' });
    await expect(vehicles.getByRole('radio', { name: 'Vehicle A' })).toBeChecked();
    await expect(payers.getByRole('radio', { name: 'Alex' })).toBeChecked();

    // Until a vehicle is tapped it follows the payer's car...
    await pickChip(entry, 'Paid by', 'Sam');
    await expect(vehicles.getByRole('radio', { name: 'Vehicle B' })).toBeChecked();
    // ...and once it has been tapped, a payer change leaves it alone.
    await pickChip(entry, 'Vehicle', 'Vehicle A');
    await pickChip(entry, 'Paid by', 'Alex');
    await pickChip(entry, 'Paid by', 'Sam');
    await expect(vehicles.getByRole('radio', { name: 'Vehicle A' })).toBeChecked();

    // Link the same sign-in to Sam instead: the till follows (decision 146).
    const email = 'alex@example.com';
    await linkSignIn(page, 'Sam', email);
    try {
      entry = await openFuelTab(page);
      await expect(
        entry
          .getByRole('radiogroup', { name: 'Vehicle' })
          .getByRole('radio', { name: 'Vehicle B' }),
      ).toBeChecked();
      await expect(
        entry.getByRole('radiogroup', { name: 'Paid by' }).getByRole('radio', { name: 'Sam' }),
      ).toBeChecked();
    } finally {
      await linkSignIn(page, 'Alex', email);
    }
  });
});
