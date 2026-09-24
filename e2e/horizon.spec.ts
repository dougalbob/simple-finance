import { expect, test } from '@playwright/test';

/**
 * Horizon (SPEC §7.6, v0.5.0): how far the money would go if the household
 * only paid what is already expected. The same pure engine as the payday
 * panel, with the chosen date as the window's end.
 *
 * Drives the /horizon page: pick a date, toggle day-to-day, scope by pot,
 * and read back the headline, the lowest point + the seeded debt's expected
 * support (flagged `expected`, never income — the £1,000 loan from Mum is
 * borrowed money, which is owed, never income).
 *
 * Runs after `income` and before `backup`: it only reads the seeded support
 * loan, mutates nothing another spec counts, and finishes before the backup
 * project's restore rewinds the install.
 */

/* Scoped locators: the page is a single form + cards + <details> blocks. */
const potFieldset = (page: import('@playwright/test').Page) =>
  page.locator('fieldset', { hasText: 'Which pots count' });
const commitmentsBlock = (page: import('@playwright/test').Page) =>
  page.locator('details', { hasText: 'Commitments in the window' }).first();
const moneyInBlock = (page: import('@playwright/test').Page) =>
  page.locator('details', { hasText: 'Expected money in' }).first();

test.describe('horizon', () => {
  test('renders the seeded scope: headline, lowest point and every pot by default', async ({
    page,
  }) => {
    await page.goto('/horizon');
    await expect(
      page.getByRole('heading', { name: 'How far the money would go', level: 1 }),
    ).toBeVisible();

    // Headline pair — a projection, never a promise.
    await expect(page.getByText('Free to spend up to', { exact: true })).toBeVisible();
    await expect(page.getByText(/Where we.ll land on \d{4}-\d{2}-\d{2}/)).toBeVisible();

    // The lowest point across the window is always shown.
    await expect(page.getByText('Lowest point', { exact: true })).toBeVisible();

    // Every pot is ticked by default.
    await expect(potFieldset(page).getByRole('checkbox', { name: 'Main account' })).toBeChecked();
    await expect(potFieldset(page).getByRole('checkbox', { name: 'Salary account' })).toBeChecked();
    await expect(potFieldset(page).getByRole('checkbox', { name: "Alex's cash" })).toBeChecked();

    // The seeded expected support is listed, flagged as expected.
    const moneyIn = moneyInBlock(page);
    await expect(moneyIn.getByText('support from Mum', { exact: true })).toBeVisible();
    await expect(moneyIn.getByText('expected — never received').first()).toBeVisible();
  });

  test('choosing a date updates the headline and the scope card', async ({ page }) => {
    await page.goto('/horizon');
    const date = futureDate(90);
    await page.getByLabel('Look ahead to').fill(date);
    await page.getByRole('button', { name: 'Look ahead' }).click();
    await expect(page).toHaveURL(/[?&]through=/);
    await expect(page.getByText(`Where we.ll land on ${date}`)).toBeVisible();
    // The scope card's "· every pot" suffix is stable across midnight; the
    // exact day count can differ by one against the London clock, so it is
    // deliberately not asserted.
    await expect(page.getByText(/days ahead · every pot/)).toBeVisible();
  });

  test('toggling day-to-day off relabels the headline and the context line', async ({ page }) => {
    await page.goto('/horizon');
    await page.getByLabel('Day-to-day').selectOption('0');
    await page.getByRole('button', { name: 'Look ahead' }).click();
    await expect(page).toHaveURL(/[?&]daytoday=0/);
    await expect(page.getByText('Free to spend on bills up to', { exact: true })).toBeVisible();
    await expect(page.getByText(/without day-to-day spending/)).toBeVisible();
  });

  test('unticking a pot removes its money from the projection', async ({ page }) => {
    await page.goto('/horizon');
    await potFieldset(page).getByRole('checkbox', { name: "Alex's cash" }).uncheck();
    await page.getByRole('button', { name: 'Look ahead' }).click();
    // The support loan lives in Alex's cash: deselected → its expectation is
    // gone from the window (they owe the money, never earned it).
    const moneyIn = moneyInBlock(page);
    await expect(moneyIn.getByText('support from Mum', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/3 of 4 pots/)).toBeVisible();
  });

  test('keeping six weeks or less leaves the detail blocks open', async ({ page }) => {
    await page.goto('/horizon');
    await page.getByLabel('Look ahead to').fill(futureDate(42));
    await page.getByRole('button', { name: 'Look ahead' }).click();
    await expect(commitmentsBlock(page)).toHaveAttribute('open', '');
    await expect(moneyInBlock(page)).toHaveAttribute('open', '');
  });
});

/**
 * An ISO local date `days` ahead, computed in the page's own time zone so
 * the spec is never tied to a calendar date.
 */
function futureDate(days: number): string {
  const base = new Date();
  const shifted = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(
    shifted.getDate(),
  ).padStart(2, '0')}`;
}
