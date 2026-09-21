import { expect, test } from '@playwright/test';

/**
 * The real client download path (blueprint §6 — the v0.2.21 lesson): the
 * browser must save the archive under the name the server chose, forwarded
 * through `anchor.download`, and the household must be able to put that archive
 * back through the Settings UI. A successful HTTP response is not proof of
 * either; this runs the actual button, the actual blob and the actual rename.
 */
test.describe('backup and restore in a browser', () => {
  test('downloads the encrypted archive under the contract filename', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Backup & restore/i })).toBeVisible();

    await page.getByLabel(/Backup passphrase/).fill('a-long-enough-passphrase');
    await page.getByLabel('Repeat passphrase').fill('a-long-enough-passphrase');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download encrypted backup/i }).click();
    const download = await downloadPromise;

    // The filename contract, carried by the client path rather than inherited
    // from the response headers (blob URLs do not inherit them).
    expect(download.suggestedFilename()).toMatch(
      /^simple-finance-backup-v0\.1\.0-\d{4}-\d{2}-\d{2}-\d{6}\.simple-finance-backup$/,
    );

    // The UI confirms what was saved and repeats that the passphrase is not kept.
    await expect(page.getByRole('status')).toContainText(/Saved simple-finance-backup-v0\.1\.0/);

    // The bytes are a real, non-trivial archive (and never plaintext SQLite).
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBeGreaterThan(2000);
    // The backup frame magic proves the archive is encrypted, not a plain
    // SQLite file that merely looks like one.
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('SFBA');
    expect(bytes.subarray(0, 6).toString('latin1')).not.toBe('SQLite');

    // A short passphrase is refused before any request is made.
    await page.getByLabel(/Backup passphrase/).fill('short');
    await page.getByLabel('Repeat passphrase').fill('short');
    await page.getByRole('button', { name: /Download encrypted backup/i }).click();
    await expect(page.getByRole('status')).toContainText(/at least 12 characters/i);
  });

  test('restores that archive over the live installation from the UI', async ({ page }) => {
    await page.goto('/settings');
    await page.getByLabel(/Backup passphrase/).fill('a-long-enough-passphrase');
    await page.getByLabel('Repeat passphrase').fill('a-long-enough-passphrase');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download encrypted backup/i }).click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();

    // Change the data, then put the archive back.
    await page.goto('/');
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await entry.getByLabel('Supplier (optional)').fill('After The Backup');
    await entry.getByLabel('Amount').fill('5.00');
    await entry.getByLabel('Line 1 amount').fill('5.00');
    await entry.getByLabel('Category').selectOption({ label: 'Groceries / Weekly Shop' });
    await entry.getByRole('button', { name: 'Save purchase' }).click();
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });
    await page.goto('/purchases');
    await expect(page.getByText('After The Backup')).toBeVisible();

    await page.goto('/settings');
    await page.getByLabel('Archive file').setInputFiles(savedPath!);
    await page.getByLabel(/Passphrase that archive was made with/).fill('a-long-enough-passphrase');
    await page.getByLabel(/Type RESTORE to confirm/).fill('RESTORE');
    await page.getByRole('button', { name: /Replace this installation/ }).click();
    await expect(page.getByRole('status')).toContainText(/Restored \d+ purchases?/i, {
      timeout: 60_000,
    });

    // The app refreshed and is reading the restored data.
    await page.goto('/purchases');
    await expect(page.getByText('After The Backup')).toHaveCount(0);
    await expect(page.getByText('Corner Foods').first()).toBeVisible();
  });
});
