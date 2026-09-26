import { expect, test } from '@playwright/test';
import { waitForTill } from './support';

/**
 * Household-boundary money (SPEC §10.2): informal debts, borrowing and
 * repayments, and swaps with someone outside the household. Borrowing is
 * shown as owed beside "available now" — never as income.
 *
 * Swap semantics (SPEC §7.1): swap legs are date-only records. A swap
 * recorded after both pots' checkpoints moves both estimates, so the
 * household total does not change. A credit recorded before a same-day
 * checkpoint is already inside that count; the debit leg still counts, so
 * that order can read one leg low until the next checkpoint.
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
    // Scope to the "Track someone new" form: the seeded "Mum" debt's own edit
    // form (inside its collapsed <details>) carries the same label.
    const trackForm = debts
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Track this debt' }) });
    await trackForm.getByLabel('Who is it owed to or by?').fill('E2E Lender');
    await trackForm.getByRole('button', { name: 'Track this debt' }).click();
    await expect(trackForm.getByRole('status')).toContainText(/now tracking/i);

    const borrow = page.locator('section[aria-labelledby="borrow-heading"]');
    await borrow.getByLabel('Debt').selectOption({ label: 'E2E Lender (we owe)' });
    await borrow.getByLabel('Pot').selectOption({ label: 'Main account' });
    await borrow.getByLabel('Amount').fill('50.00');
    await borrow.getByRole('button', { name: 'Record it' }).click();
    await expect(borrow.getByRole('status')).toContainText(/borrowed £50\.00/i);

    // The new debt's own row reads £50.00 (the seeded "Mum" row keeps its
    // £1,000.00 beside it — both are owed, never income).
    await expect(debts.getByText('we owe £50.00')).toBeVisible();
    await page.goto('/');
    await waitForTill(page);
    // The household now owes Mum's £1,000 plus the £50 just borrowed.
    const owedLine = page.locator('p', { hasText: /Owe others/ }).first();
    await expect(owedLine).toContainText('£1,050.00');
    await expect(owedLine).toContainText('borrowed, not income');
  });

  test('repayments reduce the balance; a swap recorded after the checkpoint is net zero', async ({
    page,
  }) => {
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
    await waitForTill(page);
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

    // SPEC §7.1: both pots were checkpointed before this swap was recorded,
    // so the out-leg and the in-leg both count. The household total does not
    // move. (The one-leg-low case is a swap recorded *before* the same-day
    // checkpoint, covered by the domain tests.)
    await page.goto('/');
    await waitForTill(page);
    const after = await page.getByRole('heading', { name: /household:/i }).textContent();
    if (after === null) throw new Error('household heading missing');
    expect(Math.round(parsePounds(after) * 100)).toBe(beforePence);
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
