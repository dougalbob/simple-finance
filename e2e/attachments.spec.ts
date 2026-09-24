import { expect, test } from '@playwright/test';

/**
 * Receipt removal (SPEC §23.4). The PNG is generated fictional bytes — never a
 * real receipt. This spec creates its own purchase so it does not depend on
 * seed rows surviving a later restore in the backup project.
 */
const RECEIPT_NAME = 'fictional-receipt.png';
/** 1×1 PNG. Generated fixture, not a household document. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('removing a receipt', () => {
  test('removes it from Purchases, Overview and Suppliers, and keeps the audit', async ({
    page,
  }) => {
    test.slow();
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await entry.locator('input[name="supplierName"]').fill('Playwright Receipt Shop');
    await entry.locator('input[name="amount"]').fill('4.50');
    await entry.getByLabel('Line 1 amount').fill('4.50');
    await entry.getByLabel(/^Category/).selectOption({ label: 'Groceries / Weekly Shop' });
    await entry.getByRole('button', { name: 'Save purchase' }).first().click();
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });

    await page.goto('/purchases');
    const row = page.locator('tbody tr', { hasText: 'Playwright Receipt Shop' });
    await expect(row).toHaveCount(1);
    await row.locator('input[type="file"]').setInputFiles({
      name: RECEIPT_NAME,
      mimeType: 'image/png',
      buffer: PNG_BYTES,
    });
    await row.getByRole('button', { name: 'Attach receipt' }).click();
    const viewLink = row.getByRole('link', { name: new RegExp(RECEIPT_NAME) });
    await expect(viewLink).toBeVisible({ timeout: 30_000 });
    const href = await viewLink.getAttribute('href');
    expect(href).toMatch(/^\/api\/attachments\/[0-9a-f-]+\.png$/);

    await page.goto('/overview');
    const overviewRow = page.locator('li', { hasText: 'Playwright Receipt Shop' });
    await expect(
      overviewRow.getByRole('button', { name: `Remove receipt ${RECEIPT_NAME}` }),
    ).toBeVisible();

    await page.goto('/suppliers');
    const supplierCard = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: 'Playwright Receipt Shop', exact: true }),
    });
    await expect(
      supplierCard.getByRole('button', { name: `Remove receipt ${RECEIPT_NAME}` }).first(),
    ).toBeVisible();

    await page.goto('/purchases');
    const again = page.locator('tbody tr', { hasText: 'Playwright Receipt Shop' });
    await again.getByRole('button', { name: `Remove receipt ${RECEIPT_NAME}` }).click();
    await again.getByRole('button', { name: `Confirm remove receipt ${RECEIPT_NAME}` }).click();
    await expect(again.getByRole('link', { name: new RegExp(RECEIPT_NAME) })).toHaveCount(0, {
      timeout: 30_000,
    });

    await again.getByText('History', { exact: true }).click();
    const removal = again.locator('li', { hasText: `Removed ${RECEIPT_NAME}` });
    await expect(removal).toBeVisible();
    await expect(removal).toContainText('alex@example.com');
    await expect(removal).toContainText(/\d{1,2}:\d{2}/);

    const gone = await page.request.get(new URL(href!, page.url()).toString());
    expect(gone.status()).toBe(404);

    await page.goto('/overview');
    await expect(
      page
        .locator('li', { hasText: 'Playwright Receipt Shop' })
        .getByRole('link', { name: new RegExp(RECEIPT_NAME) }),
    ).toHaveCount(0);
  });
});
