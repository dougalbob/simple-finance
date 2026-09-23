import { expect, test } from '@playwright/test';

/**
 * Balance checkpoints (SPEC §7.1): a checkpoint replaces the pot's reported
 * balance, and the page it was recorded on must show it in place — no
 * browser refresh. v0.2.0 revalidated only the home path after a
 * checkpoint, so /pots and /overview kept showing the old estimate until
 * you reloaded (v0.2.0 field report). The Salary account is never touched
 * by any other spec, so its seed balance is a stable baseline.
 */
test.describe('balance checkpoints', () => {
  test('checkpointing on /pots updates the estimate in place', async ({ page }) => {
    await page.goto('/pots');

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Salary account', exact: true }) });
    await expect(card.getByText('≈ £1,200.00')).toBeVisible();

    const checkpoint = page.locator('section[aria-labelledby="add-checkpoint-heading"]');
    await checkpoint.getByLabel('Pot').selectOption({ label: 'Salary account' });
    await checkpoint.getByLabel('Balance right now').fill('1234.56');
    await checkpoint.getByRole('button', { name: 'Save checkpoint' }).click();
    await expect(checkpoint.getByRole('status')).toContainText(/checkpoint saved: £1,234\.56/i);

    // No reload: the pot card reads the new balance straight away.
    await expect(card.getByText('≈ £1,234.56')).toBeVisible();
    await expect(card.getByText(/Last reported £1,234\.56/)).toBeVisible();
  });
});
