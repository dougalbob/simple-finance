import { expect, test } from '@playwright/test';

/**
 * Household-boundary money (SPEC §10.2): informal debts, borrowing and
 * repayments, and swaps with someone outside the household. Borrowing is
 * shown as owed beside "available now" — never as income — and swaps leave
 * the household total alone.
 */
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

  test('repayments reduce the balance; swaps leave the household total alone', async ({ page }) => {
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
    const household = page.getByRole('heading', { name: /household:/i });
    const before = await household.textContent();

    await page.goto('/pots');
    const swap = page.locator('section[aria-labelledby="swap-heading"]');
    await swap.getByLabel('Who did you swap with?').fill('E2E Son');
    await swap.getByLabel('Money arrived in').selectOption({ label: "Alex's cash" });
    await swap.getByLabel('Money left from').selectOption({ label: 'Main account' });
    await swap.getByLabel('Amount').fill('10.00');
    await swap.getByRole('button', { name: 'Record swap' }).click();
    await expect(swap.getByRole('status')).toContainText(/swapped £10\.00/i);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /household:/i })).toHaveText(before ?? '');
  });
});
