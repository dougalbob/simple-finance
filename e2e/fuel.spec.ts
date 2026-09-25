import { expect, type Page, test } from '@playwright/test';
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

    // 2. Part fill: just litres, the tick taken off.
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
  const tick = entry.getByLabel(/Filled to full/);
  await expect(tick).toBeChecked();
  if (fill.fullTank === false) await tick.uncheck();
  await entry.getByLabel('Vehicle').selectOption({ label: VEHICLE });
  await entry.getByLabel('Paid by').selectOption({ label: 'Alex' });
  const pot = entry.getByLabel('Pot');
  if ((await pot.inputValue()) === '') await pot.selectOption({ label: 'Main account' });
  await entry.getByRole('button', { name: 'Save fuel' }).click();
  await check(entry.getByRole('status'));
}
