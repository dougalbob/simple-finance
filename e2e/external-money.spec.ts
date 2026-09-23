import { expect, test } from '@playwright/test';

/**
 * Household-boundary money (SPEC §10.2): informal debts, borrowing and
 * repayments, and swaps with someone outside the household. Borrowing is
 * shown as owed beside "available now" — never as income.
 *
 * Swap semantics (SPEC §7.1, amended for v0.2.1): swap legs are date-only
 * records, and a same-day checkpoint is timed. The sign-aware rule keeps
 * the estimate safe per pot: the leg OUT of a pot counts the same day
 * (understating is self-correcting), the leg IN is absorbed until a later
 * checkpoint. So a same-day swap reads one leg LOW against the household
 * total — by design, not a bug.
 */

function parsePounds(text: string): number {
  const match = text.match(/£([\d,]+\.\d{2})/);
  const value = match?.[1];
  if (value === undefined) throw new Error(`no £ amount in ${JSON.stringify(text)}`);
  return Number(value.replace(/,/g, ''));
}

test.describe('external money', () => {
  test('borrowing raises the owed balance beside available now', async ({ page }) => {
    await page.goto('/pots');
    const debts = page.locator('section[aria-labelledby="debts-heading"]');
    await debts.getByLabel('Who is it owed to or by?').fill('E2E Lender');
    await debts.getByRole('button', { name: 'Track this debt' }).click();
    await expect(debts.getByRole('status')).toContainText(/now tracking/i);

    const borrow = page.locator('section[aria-labelledby="borrow-heading"]');
    await borrow.getByLabel('Debt').selectOption({ label: 'E2E Lender (we owe)' });
    await borrow.getByLabel('Pot').selectOption({ label: 'Main account' });
    await borrow.getByLabel('Amount').fill('50.00');
    await borrow.getByRole('button', { name: 'Record it' }).click();
    await expect(borrow.getByRole('status')).toContainText(/borrowed £50\.00/i);

    await expect(debts.getByText('we owe £50.00')).toBeVisible();
    await page.goto('/');
    await expect(page.getByText(/owe others/i)).toBeVisible();
    await expect(page.getByText('£50.00').first()).toBeVisible();
  });

  test('repayments reduce the balance; a same-day swap reads one leg low', async ({ page }) => {
    await page.goto('/pots');
    const borrow = page.locator('section[aria-labelledby="borrow-heading"]');
    await borrow.getByLabel('Debt').selectOption({ label: 'E2E Lender (we owe)' });
    await borrow.getByLabel('What happened?').selectOption({ label: 'Repaid — money out' });
    await borrow.getByLabel('Pot').selectOption({ label: 'Main account' });
    await borrow.getByLabel('Amount').fill('20.00');
    await borrow.getByRole('button', { name: 'Record it' }).click();
    await expect(borrow.getByRole('status')).toContainText(/repaid £20\.00/i);

    const debts = page.locator('section[aria-labelledby="debts-heading"]');
    await expect(debts.getByText('we owe £30.00')).toBeVisible();

    await page.goto('/');
    const before = await page.getByRole('heading', { name: /household:/i }).textContent();
    if (before === null) throw new Error('household heading missing');
    const beforePence = Math.round(parsePounds(before) * 100);

    await page.goto('/pots');
    const swap = page.locator('section[aria-labelledby="swap-heading"]');
    // The section also holds the "Recent swaps" list once any swap exists,
    // and each pair's edit form has its own "Amount" label — scope to the
    // SwapForm itself (the form with the "Record swap" button).
    const swapForm = swap
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Record swap' }) });
    await swapForm.getByLabel('Who did you swap with?').fill('E2E Son');
    await swapForm.getByLabel('Money arrived in').selectOption({ label: "Alex's cash" });
    await swapForm.getByLabel('Money left from').selectOption({ label: 'Main account' });
    await swapForm.getByLabel('Amount').fill('10.00');
    await swapForm.getByRole('button', { name: 'Record swap' }).click();
    await expect(swapForm.getByRole('status')).toContainText(/swapped £10\.00/i);

    // SPEC §7.1: the out-leg (a debit against Main's same-day checkpoint)
    // counts immediately; the in-leg into Alex's cash is absorbed until a
    // later checkpoint. The household total reads exactly one leg low.
    await page.goto('/');
    const after = await page.getByRole('heading', { name: /household:/i }).textContent();
    if (after === null) throw new Error('household heading missing');
    expect(Math.round(parsePounds(after) * 100)).toBe(beforePence - 1000);
  });

  test('recent swaps are findable, editable and voidable as a pair', async ({ page }) => {
    await page.goto('/pots');
    const swap = page.locator('section[aria-labelledby="swap-heading"]');
    // The "Recent swaps" list (with its per-leg edit forms, each labelled
    // "Amount") is in the same section — scope to the SwapForm itself.
    const swapForm = swap
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Record swap' }) });
    // Unique per attempt: a failed attempt leaves its pair in the shared
    // e2e database, and a retry must not match the old pair's name.
    const counterparty = `E2E Trader ${Date.now()}`;
    await swapForm.getByLabel('Who did you swap with?').fill(counterparty);
    await swapForm.getByLabel('Money arrived in').selectOption({ label: "Alex's cash" });
    await swapForm.getByLabel('Money left from').selectOption({ label: 'Main account' });
    await swapForm.getByLabel('Amount').fill('30.00');
    await swapForm.getByRole('button', { name: 'Record swap' }).click();
    await expect(swapForm.getByRole('status')).toContainText(/swapped £30\.00/i);

    // Findable where the household looks: the paired "Recent swaps" list in
    // the same section, grouped with its net-zero total — and linked from
    // the pot card.
    const pair = swap.locator('ul li').filter({ hasText: counterparty });
    await expect(pair.getByText('net £0.00')).toBeVisible();
    await expect(pair.getByText(/In \+£30\.00 → Alex's cash/)).toBeVisible();
    await expect(pair.getByText(/Out −£30\.00 ← Main account/)).toBeVisible();
    const mainCard = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Main account', exact: true }) });
    await expect(mainCard.getByText(/Recent swaps involving Main account/)).toBeVisible();

    // Edit the in-leg's note through the paired list. The in-leg details is
    // nested inside the pair's "Correct or void one leg" details — open the
    // outer one first. Each is targeted via its summary's nearest <details>
    // ancestor (the outer details also contains the inner texts, transitively).
    const correct = pair
      .getByText('Correct or void one leg')
      .locator('xpath=ancestor-or-self::details[1]');
    await correct.locator(':scope > summary').click();
    const inLeg = pair.getByText('In-leg — to').locator('xpath=ancestor-or-self::details[1]');
    await inLeg.locator(':scope > summary').click();
    await inLeg.getByLabel('Note (blank keeps the current note)').fill('edited at the table');
    await inLeg.getByRole('button', { name: 'Save changes' }).click();
    await expect(inLeg.getByRole('status')).toContainText(/saved: £30\.00/);
    await expect(pair.getByText('— edited at the table')).toBeVisible();

    // Void both legs in one step, with one shared reason. The pair's
    // durable confirmation is the "voided" badge and the shared reason
    // (the confirm form unmounts when the pair leaves the live state).
    await pair.getByRole('button', { name: 'Void both legs' }).click();
    await pair.getByLabel('Why are you voiding both legs?').fill('the swap never happened');
    await pair.getByRole('button', { name: 'Yes, void both legs' }).click();
    await expect(pair.getByText('voided', { exact: true })).toBeVisible();
    await expect(pair.getByText('Voided — the swap never happened')).toBeVisible();
    // Both legs are struck through.
    await expect(pair.getByText(/In \+£30\.00 → Alex's cash/)).toHaveClass(/line-through/);
    await expect(pair.getByText(/Out −£30\.00 ← Main account/)).toHaveClass(/line-through/);

    // The pot-card link lands on the swaps section.
    await mainCard.getByRole('link', { name: /Recent swaps involving Main account/ }).click();
    await expect(swap).toBeInViewport();
  });
});
