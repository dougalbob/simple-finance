import { expect, test } from '@playwright/test';
import { addDaysIso, londonToday } from './support';

/**
 * Horizon (SPEC §7.6, v0.5.0): how far the money would go if the household
 * only paid what is already expected. The same pure engine as the payday
 * panel, with the chosen date as the window's end.
 *
 * Drives the /horizon page: the payday-aligned default date, a date change
 * that applies itself (decision 150), the button for day-to-day and pots,
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
    // Five weeks, named explicitly: the default window now ends the day
    // before the next payday (decision 150), which can be a day or two long
    // — too short to be sure of containing the 12th (Mum's support) and the
    // projected shops and fills this spec reads.
    await page.goto(`/horizon?through=${futureDate(35)}`);
    await expect(
      page.getByRole('heading', { name: 'How far the money would go', level: 1 }),
    ).toBeVisible();

    // Headline pair — a projection, never a promise.
    await expect(page.getByText('Free to spend up to', { exact: true })).toBeVisible();
    await expect(page.getByText(/Where we[’']d land on \d{4}-\d{2}-\d{2}/)).toBeVisible();

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

    // Day-to-day rides as dated events (v0.6.0 anchor-reset): the seeded
    // weekly shop and fill anchor the next ones, and the page lists them —
    // never as an invisible up-front lump.
    await expect(
      page.getByText(/Projected day-to-day spending \(\d+\)/, { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Weekly shop (projected)').first()).toBeVisible();
    await expect(page.getByText(/Fuel — Vehicle [AB] \(projected\)/).first()).toBeVisible();
  });

  test('opens on the day before the next scheduled payday (decision 150)', async ({ page }) => {
    // The Income page's "Next payday" is scheduled income only (receipt
    // schedules, weekend-shifted) — the same definition Horizon uses, and the
    // seeded support from Mum never counts. Reading it there duplicates no
    // date logic in the spec.
    await page.goto('/income');
    const summary = page.locator('section[aria-label="Income summary"]');
    const payday = /(\d{4}-\d{2}-\d{2}) · into/.exec(await summary.innerText())?.[1] ?? '';
    expect(payday).not.toBe('');

    const tomorrow = futureDate(1);
    const dayBefore = addDaysIso(payday, -1);
    const expected = dayBefore < tomorrow ? tomorrow : dayBefore;

    await page.goto('/horizon');
    await expect(page.getByLabel('Look ahead to')).toHaveValue(expected);
    await expect(page.getByText(new RegExp(`Where we[’']d land on ${expected}`))).toBeVisible();

    // The smart default composes with the other params: no `through`, still
    // the day before payday.
    await page.goto('/horizon?daytoday=0');
    await expect(page.getByLabel('Look ahead to')).toHaveValue(expected);

    // An explicit, in-range date is kept exactly as named.
    const named = futureDate(90);
    await page.goto(`/horizon?through=${named}`);
    await expect(page.getByLabel('Look ahead to')).toHaveValue(named);
  });

  test('the date field sits below the pots and the day-to-day choice', async ({ page }) => {
    await page.goto('/horizon');
    const order = await page.evaluate(() => {
      const date = document.getElementById('horizon-through');
      const daytoday = document.getElementById('horizon-daytoday');
      const pots = document.querySelector('fieldset');
      if (date === null || daytoday === null || pots === null) return null;
      const follows = (a: Node, b: Node) =>
        Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        potsThenDayToDay: follows(pots, daytoday),
        dayToDayThenDate: follows(daytoday, date),
      };
    });
    expect(order).toEqual({ potsThenDayToDay: true, dayToDayThenDate: true });
  });

  test('changing the date applies the look-ahead without the button', async ({ page }) => {
    await page.goto('/horizon');
    await waitForHorizonForm(page);
    const date = futureDate(90);
    await page.getByLabel('Look ahead to').fill(date);
    await expect(page).toHaveURL(new RegExp(`[?&]through=${date}`));
    await expect(page.getByText(new RegExp(`Where we[’']d land on ${date}`))).toBeVisible();
    // The scope card's "· every pot" suffix is stable across midnight; the
    // exact day count can differ by one against the London clock, so it is
    // deliberately not asserted.
    await expect(page.getByText(/days ahead · every pot/)).toBeVisible();
  });

  test('a date change carries the pots and day-to-day chosen above it', async ({ page }) => {
    await page.goto('/horizon');
    await waitForHorizonForm(page);
    // Neither of these navigates on its own …
    await potFieldset(page).getByRole('checkbox', { name: "Alex's cash" }).uncheck();
    await page.getByLabel('Day-to-day').selectOption('0');
    await expect(page).not.toHaveURL(/[?&]daytoday=/);
    // … the date change applies all three in one go.
    const date = futureDate(60);
    await page.getByLabel('Look ahead to').fill(date);
    await expect(page).toHaveURL(new RegExp(`[?&]through=${date}`));
    await expect(page).toHaveURL(/[?&]daytoday=0/);
    await expect(page.getByText('Free to spend on bills up to', { exact: true })).toBeVisible();
    await expect(page.getByText(/3 of 4 pots/)).toBeVisible();
    await expect(
      potFieldset(page).getByRole('checkbox', { name: "Alex's cash" }),
    ).not.toBeChecked();
  });

  test('clearing the date does not navigate mid-edit', async ({ page }) => {
    const date = futureDate(30);
    await page.goto(`/horizon?through=${date}`);
    await waitForHorizonForm(page);
    await page.getByLabel('Look ahead to').fill('');
    // Give a (wrong) submission time to happen, then prove it did not.
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(new RegExp(`[?&]through=${date}$`));
    await expect(page.getByText(new RegExp(`Where we[’']d land on ${date}`))).toBeVisible();
  });

  test('the button still applies a day-to-day change', async ({ page }) => {
    await page.goto('/horizon');
    await page.getByLabel('Day-to-day').selectOption('0');
    await page.getByRole('button', { name: 'Look ahead' }).click();
    await expect(page).toHaveURL(/[?&]daytoday=0/);
    await expect(page.getByText('Free to spend on bills up to', { exact: true })).toBeVisible();
    await expect(page.getByText(/without day-to-day spending/)).toBeVisible();
  });

  test('the button still applies a pot change: unticking removes its money', async ({ page }) => {
    await page.goto('/horizon');
    await potFieldset(page).getByRole('checkbox', { name: "Alex's cash" }).uncheck();
    await page.getByRole('button', { name: 'Look ahead' }).click();
    await expect(page).toHaveURL(/[?&]pots=/);
    // The support loan lives in Alex's cash: deselected → its expectation is
    // gone from the window (they owe the money, never earned it).
    const moneyIn = moneyInBlock(page);
    await expect(moneyIn.getByText('support from Mum', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/3 of 4 pots/)).toBeVisible();
  });

  test('keeping six weeks or less leaves the detail blocks open', async ({ page }) => {
    await page.goto('/horizon');
    await waitForHorizonForm(page);
    const date = futureDate(42);
    await page.getByLabel('Look ahead to').fill(date);
    await expect(page).toHaveURL(new RegExp(`[?&]through=${date}`));
    await expect(commitmentsBlock(page)).toHaveAttribute('open', '');
    await expect(moneyInBlock(page)).toHaveAttribute('open', '');
  });
});

/**
 * Wait until the look-ahead form has hydrated: before then a date change
 * cannot auto-apply (the button would still work), so specs that rely on the
 * date change wait for the form's own ready signal, as till specs do.
 */
async function waitForHorizonForm(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('form[data-horizon-ready="true"]')).toBeAttached();
}

/**
 * An ISO local date `days` ahead of the household's today (Europe/London,
 * the server's calendar — not the runner's, which is UTC in CI).
 */
function futureDate(days: number): string {
  return addDaysIso(londonToday(), days);
}
