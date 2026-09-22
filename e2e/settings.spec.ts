import { expect, test, type Locator } from '@playwright/test';

/**
 * Settings → Category tree (SPEC §15.2). Regression for a field report on
 * v0.1.7: adding a parent or a child showed the success message but the new
 * entry was missing from the tree until a manual browser refresh.
 *
 * `saveCategoryAction` wrote correctly and returned `status: 'ok'`, but — unlike
 * every other Settings writer — it never revalidated. `CategoryTreeEditor`
 * renders the tree from server-rendered props, so the browser kept the previous
 * RSC payload. These tests therefore assert on the tree *without* ever calling
 * `page.reload()`, and rename/retire are covered because they had the same
 * stale-tree risk.
 *
 * Names are fictional. The rename/retire cases operate on categories this spec
 * creates, so the seeded `Groceries / Weekly Shop` the other specs pick is left
 * alone and a CI retry starts from a clean state.
 */
const PARENT = 'Playwright Garden';
const CHILD = 'Playwright Seedlings';
const RENAMED_CHILD = 'Playwright Seedlings Renamed';

/**
 * The parent card, not one of its own child rows: the tree is a nested list, so
 * a bare `hasText` filter matches the parent `li` *and* every `li` beneath it.
 * A card is the `li` that directly holds the parent name in its `p`.
 */
const parentCard = (section: Locator) => section.locator(`li:has(> p:text-is("${PARENT}"))`);

test.describe('category tree', () => {
  test('a new parent appears in the tree without a refresh', async ({ page }) => {
    await page.goto('/settings');
    const section = page.getByRole('region', { name: /Category tree/i });
    await expect(section.getByRole('heading', { name: 'Category tree', level: 2 })).toBeVisible();
    await expect(section.locator('li p', { hasText: PARENT })).toHaveCount(0);

    await section.getByLabel('Operation').selectOption('add-parent');
    await section.getByLabel('Name').fill(PARENT);
    await section.getByRole('button', { name: 'Apply' }).click();

    await expect(section.getByRole('status')).toContainText(/added/i, { timeout: 30_000 });
    // No page.reload(): the revalidated tree has to arrive on its own.
    await expect(section.locator('li p', { hasText: PARENT })).toHaveCount(1, { timeout: 30_000 });
    await expect(parentCard(section).getByText('No children yet')).toBeVisible();
  });

  test('a new child appears under its parent without a refresh', async ({ page }) => {
    await page.goto('/settings');
    const section = page.getByRole('region', { name: /Category tree/i });

    await section.getByLabel('Operation').selectOption('add-child');
    // The parent the previous test created is only selectable if the tree this
    // form renders came from the revalidated page, not a stale payload.
    await section.getByLabel('Under which parent').selectOption({ label: PARENT });
    await section.getByLabel('Name').fill(CHILD);
    await section.getByRole('button', { name: 'Apply' }).click();

    await expect(section.getByRole('status')).toContainText(/added/i, { timeout: 30_000 });
    const card = parentCard(section);
    await expect(card.getByText(CHILD)).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText('No children yet')).toHaveCount(0);
  });

  test('rename and retire update the tree without a refresh', async ({ page }) => {
    test.slow();
    await page.goto('/settings');
    const section = page.getByRole('region', { name: /Category tree/i });
    const card = parentCard(section);

    // Child options carry the bare name; parent options are suffixed "(parent)".
    await section.getByLabel('Operation').selectOption('rename');
    await section.getByLabel('Which category').selectOption({ label: CHILD });
    await section.getByLabel('Name').fill(RENAMED_CHILD);
    await section.getByRole('button', { name: 'Apply' }).click();

    await expect(section.getByRole('status')).toContainText(/renamed/i, { timeout: 30_000 });
    await expect(card.getByText(RENAMED_CHILD)).toBeVisible({ timeout: 30_000 });

    await section.getByLabel('Operation').selectOption('retire');
    await section.getByLabel('Which category').selectOption({ label: RENAMED_CHILD });
    await section.getByRole('button', { name: 'Apply' }).click();

    await expect(section.getByRole('status')).toContainText(/retired/i, { timeout: 30_000 });
    // Retired children stay visible but struck through, so history is preserved.
    await expect(card.getByText(RENAMED_CHILD)).toHaveClass(/line-through/, { timeout: 30_000 });
  });
});
