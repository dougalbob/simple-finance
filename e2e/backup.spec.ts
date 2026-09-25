import { expect, test } from '@playwright/test';
import { waitForTill } from './support';
import { APP_VERSION } from '../src/lib/version';

// The filename contract follows the released version; deriving it here keeps
// a version bump from silently invalidating this suite (it broke at v0.1.1).
const VERSION_PATTERN = APP_VERSION.replaceAll('.', '\\.');

/**
 * The real client download path (the blueprint's v0.2.21 lesson): the browser
 * must save the archive under the name the server chose, forwarded through
 * `anchor.download`, and the household must be able to put that archive back
 * through the Settings UI. A successful HTTP response proves neither, so this
 * runs the actual button, the actual bytes and the actual restore.
 */
const downloadSection = (page: import('@playwright/test').Page) =>
  page.locator('section', { has: page.getByRole('heading', { name: 'Download a backup' }) });

const restoreSection = (page: import('@playwright/test').Page) =>
  page.locator('section', { has: page.getByRole('heading', { name: 'Restore a backup' }) });

test.describe('backup and restore in a browser', () => {
  test('downloads the encrypted archive under the contract filename', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Backup & restore' })).toBeVisible();

    await page.getByLabel(/Backup passphrase/).fill('a-long-enough-passphrase');
    await page.getByLabel('Repeat passphrase').fill('a-long-enough-passphrase');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download encrypted backup' }).click();
    const download = await downloadPromise;

    // The filename contract, carried by the client path rather than inherited
    // from response headers (blob URLs do not inherit them).
    expect(download.suggestedFilename()).toMatch(
      new RegExp(
        `^simple-finance-backup-v${VERSION_PATTERN}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.simple-finance-backup$`,
      ),
    );

    // The UI says what was saved and repeats that the passphrase is not kept.
    await expect(downloadSection(page).getByRole('status')).toContainText(
      new RegExp(`Saved simple-finance-backup-v${VERSION_PATTERN}`),
    );

    // The bytes are a real, encrypted archive — not a plaintext SQLite file.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBeGreaterThan(2000);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('SFBA');

    // A short passphrase is refused before anything is encrypted.
    await page.getByLabel(/Backup passphrase/).fill('short');
    await page.getByLabel('Repeat passphrase').fill('short');
    await page.getByRole('button', { name: 'Download encrypted backup' }).click();
    await expect(downloadSection(page).getByRole('status')).toContainText(
      /at least 12 characters/i,
    );
  });

  test('restores that archive over the live installation from the UI', async ({ page }) => {
    await page.goto('/settings');
    await page.getByLabel(/Backup passphrase/).fill('a-long-enough-passphrase');
    await page.getByLabel('Repeat passphrase').fill('a-long-enough-passphrase');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download encrypted backup' }).click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();

    // Change the data after the archive was taken...
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    // The pot is named here rather than inherited: the settings project has
    // already cleared the default pot, and a purchase cannot be recorded
    // without one (v0.9.0 made "no default" a real state, SPEC §15.2).
    await entry.getByLabel('Pot').selectOption({ label: 'Main account' });
    await entry.locator('input[name="supplierName"]').fill('After The Backup');
    await entry.locator('input[name="amount"]').fill('5.00');
    await entry.getByLabel('Line 1 amount').fill('5.00');
    await entry.getByLabel(/^Category/).selectOption({ label: 'Groceries / Weekly Shop' });
    await entry.getByRole('button', { name: 'Save purchase' }).click();
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });
    await page.goto('/purchases');
    const results = page.locator('section[aria-labelledby="results-heading"]');
    await expect(results.getByText('After The Backup').first()).toBeVisible();

    // ...then put the archive back over the running installation.
    await page.goto('/settings');
    await page.getByLabel('Archive file').setInputFiles(savedPath!);
    await page.getByLabel('Passphrase that archive was made with').fill('a-long-enough-passphrase');
    await page.getByLabel('Type RESTORE to confirm').fill('RESTORE');
    await page.getByRole('button', { name: 'Replace this installation from the archive' }).click();
    await expect(restoreSection(page).getByRole('status')).toContainText(
      /Restored \d+ purchases?/i,
      { timeout: 60_000 },
    );

    // The app is reading the restored data.
    await page.goto('/purchases');
    await expect(results.locator('tbody tr', { hasText: 'After The Backup' })).toHaveCount(0);
    await expect(results.getByText('Corner Foods').first()).toBeVisible();
  });
});
