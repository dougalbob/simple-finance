import { expect, test } from '@playwright/test';
import { londonToday } from './support';

/**
 * Income (SPEC §6, §11.3 — plan decisions 109–113): one-off money recorded
 * by hand with a source, scheduled salary edited in place, and the payday
 * rule that moves a weekend due date to the Friday before.
 *
 * Desktop-shaped on purpose: income is not a till-side task for this
 * household, so these specs drive the Income page rather than Quick Entry.
 *
 * Runs after `transactions` and before `backup`, so the records it creates
 * cannot disturb the specs that count rows, and the backup project's restore
 * cannot rewind them mid-spec.
 */
test.describe('income', () => {
  test('records one-off income with a source and shows it in the list', async ({ page }) => {
    await page.goto('/income');
    await expect(page.getByRole('heading', { name: 'Money coming in', level: 1 })).toBeVisible();

    const form = page.locator('section[aria-labelledby="one-off-income-heading"]');
    await form.getByLabel('Amount received').fill('32.50');
    await form.getByLabel('Into which pot?').selectOption({ label: "Alex's cash" });
    await form.getByLabel('What was it / who from? (optional)').fill('Sale of old bike');
    await form.getByLabel('Note (optional)').fill('Buyer transferred it');
    await form.getByRole('button', { name: 'Record income' }).click();
    await expect(form.getByRole('status')).toContainText(
      /£32\.50 of income from Sale of old bike/i,
    );

    const list = page.locator('section[aria-labelledby="income-history-heading"]');
    const row = list.locator('li', { hasText: 'Sale of old bike' }).first();
    await expect(row).toContainText('+£32.50');
    await expect(row).toContainText("Alex's cash");
    await expect(row).toContainText('Buyer transferred it');

    // The seeded salary is in the same list, marked as scheduled income.
    // Matched on the badge, not the name: every row's pot picker also
    // contains the word "Salary" ("Salary account").
    const salary = list.locator('li').filter({ hasText: 'from schedule' }).first();
    await expect(salary).toContainText('Salary');
  });

  test('an income record can be corrected and voided, keeping the history', async ({ page }) => {
    test.slow();
    await page.goto('/income');
    const list = page.locator('section[aria-labelledby="income-history-heading"]');
    const row = list.locator('li', { hasText: 'Sale of old bike' }).first();

    // Correct the amount: the money that actually arrived was 30.00.
    await row.locator('summary', { hasText: 'Correct or void' }).click();
    await row.getByLabel('Amount', { exact: true }).fill('30.00');
    await row.getByRole('button', { name: 'Save changes' }).click();
    await expect(row).toContainText('+£30.00', { timeout: 30_000 });

    // Void it: the row stays, struck through, with the reason. Reload first —
    // the save above re-rendered the list, and a <details> that is still open
    // would only be closed by another click.
    await page.reload();
    const saved = list.locator('li', { hasText: 'Sale of old bike' }).first();
    await expect(saved).toContainText('+£30.00');
    await saved.locator('summary', { hasText: 'Correct or void' }).click();
    await expect(saved.getByLabel(/Why are you voiding this/)).toBeVisible();
    await saved.getByLabel(/Why are you voiding this/).fill('The buyer changed their mind');
    await saved.getByRole('button', { name: 'Void income' }).click();
    await expect(saved).toContainText('Voided — The buyer changed their mind', { timeout: 30_000 });

    // ...and it leaves All Transactions, which excludes voided records.
    await page.goto('/transactions');
    const table = page.locator('section[aria-labelledby="activity-heading"] table');
    await expect(table).toBeVisible();
    const filters = page.getByRole('form', { name: 'Activity filters' });
    await filters.getByLabel('Target').selectOption({ label: "Alex's cash" });
    await filters.getByRole('button', { name: 'Show activity' }).click();
    // The pot still has its seeded income; the voided one is gone. Matched on
    // the corrected amount, so a row left behind by an earlier failed attempt
    // cannot make this fail — and the seeded row proves the filter applied.
    await expect(table.getByText('Sale of bicycle')).toHaveCount(1);
    await expect(
      table.locator('tr').filter({ hasText: 'Sale of old bike' }).filter({ hasText: '+£30.00' }),
    ).toHaveCount(0);
  });

  test('a payday that lands on a weekend is expected on the Friday before', async ({ page }) => {
    test.slow();
    // The seeded salary is due on the 27th. Move it to a day of the month
    // that falls on a weekend in the next month or two — computed here, so
    // the spec is not tied to a calendar date.
    const probe = weekendPaydayProbe();
    await page.goto('/income');
    const schedules = page.locator('section[aria-labelledby="scheduled-income-heading"]');
    const salary = schedules.locator('li', { hasText: 'Salary' }).first();
    await salary.locator('summary', { hasText: 'Edit or cancel' }).click();
    await salary.getByLabel('Day of the month').fill(String(probe.dayOfMonth));
    await salary.getByRole('button', { name: 'Save from next instance' }).click();

    // The page says so, and the date it expects is a Friday, not the weekend.
    await expect(salary).toContainText('falls on a weekend', { timeout: 30_000 });
    const text = await salary.innerText();
    const next = /next expected (\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? '';
    expect(next).not.toBe('');
    expect(new Date(`${next}T12:00:00Z`).getUTCDay()).toBe(5); // Friday
  });

  test('a payslip can be attached to an income record and opened', async ({ page }) => {
    test.slow();
    await page.goto('/income');
    const form = page.locator('section[aria-labelledby="one-off-income-heading"]');
    await form.getByLabel('Amount received').fill('1234.56');
    await form.getByLabel('Into which pot?').selectOption({ label: 'Salary account' });
    await form.getByLabel('What was it / who from? (optional)').fill('Playwright Payroll Ltd');
    await form.getByRole('button', { name: 'Record income' }).click();
    await expect(form.getByRole('status')).toContainText(/Playwright Payroll Ltd/i);

    const list = page.locator('section[aria-labelledby="income-history-heading"]');
    const row = list.locator('li', { hasText: 'Playwright Payroll Ltd' }).first();
    // Decision 138: the pipeline sniffs the bytes, so this must be a real
    // (tiny, fictional) PDF — never a household payslip.
    await row.getByLabel('Payslip or document file').setInputFiles({
      name: 'fictional-payslip.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
    });
    await row.getByRole('button', { name: 'Attach payslip' }).click();
    const link = row.getByRole('link', { name: /fictional-payslip\.pdf/ });
    await expect(link).toBeVisible({ timeout: 30_000 });
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/api\/attachments\/[0-9a-f-]+\.pdf$/);
    const served = await page.request.get(href!);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('application/pdf');

    // Still there after a fresh load; the upload control stays for a second page.
    await page.reload();
    const again = list.locator('li', { hasText: 'Playwright Payroll Ltd' }).first();
    await expect(again.getByRole('link', { name: /fictional-payslip\.pdf/ })).toBeVisible();
    await expect(again.getByRole('button', { name: 'Attach payslip' })).toBeVisible();
  });

  test('a scheduled income can be added and appears with its next payday', async ({ page }) => {
    test.slow();
    await page.goto('/income');
    const schedules = page.locator('section[aria-labelledby="scheduled-income-heading"]');
    await schedules.locator('summary', { hasText: 'Add scheduled income' }).click();
    const form = schedules
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Add scheduled income' }) });
    await form.locator('input[name="name"]').fill('Car allowance');
    await form.locator('input[name="amount"]').fill('125.00');
    await form.getByLabel('Paid into').selectOption({ label: 'Salary account' });
    await form.getByLabel('Day of the month').fill('15');
    await form.getByRole('button', { name: 'Add scheduled income' }).click();
    await expect(form.getByRole('status')).toContainText(/added/i, { timeout: 30_000 });

    const allowance = schedules.locator('li', { hasText: 'Car allowance' }).first();
    await expect(allowance).toContainText('£125.00 a month');
    await expect(allowance).toContainText('due on the 15th');
    await expect(allowance).toContainText('Salary account');
  });
});

/**
 * A day of the month (1–28, so it exists in every month) that falls on a
 * Saturday or Sunday within the next two months, and whose Friday is still in
 * the future — so the schedule's next instance really is the shifted one.
 */
function weekendPaydayProbe(): { dayOfMonth: number } {
  // The household's today (Europe/London), as the server computes schedules.
  const [year, month, day] = londonToday().split('-').map(Number);
  const base = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  for (let offset = 1; offset <= 70; offset += 1) {
    const stamp = base + offset * 86_400_000;
    const candidate = new Date(stamp);
    const weekday = candidate.getUTCDay();
    if (weekday !== 6 && weekday !== 0) continue;
    const dayOfMonth = candidate.getUTCDate();
    if (dayOfMonth > 28) continue;
    const backDays = weekday === 6 ? 1 : 2;
    // Strictly after today: a Friday that *is* today may already have been
    // received (the seeded salary on the 27th is, when the 27th is a Sunday),
    // and then the next instance is a month later — not a weekend.
    if (stamp - backDays * 86_400_000 <= base) continue;
    return { dayOfMonth };
  }
  throw new Error('no weekend payday found in the next 70 days');
}
