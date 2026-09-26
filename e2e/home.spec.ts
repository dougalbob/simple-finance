import { expect, test, type Locator, type Page } from '@playwright/test';
import { waitForTill } from './support';
import { APP_RELEASE_STAGE, APP_VERSION } from '../src/lib/version';

/**
 * Mobile acceptance path (blueprint §12: "desktop and mobile primary paths are
 * checked"). This is the run earlier sessions could not claim — the sandbox had
 * no browser binaries.
 */

function parsePounds(text: string): number {
  const match = text.match(/£([\d,]+\.\d{2})/);
  const value = match?.[1];
  if (value === undefined) throw new Error(`no £ amount in ${JSON.stringify(text)}`);
  return Number(value.replace(/,/g, ''));
}

/** The till's two panels (decision 143): switch with the dots, wait for the slide. */
async function showPanel(entry: Locator, index: 0 | 1): Promise<void> {
  await entry
    .getByRole('button', { name: index === 0 ? 'Show the entry panel' : 'Show the details panel' })
    .click();
  await expect(entry.locator('[data-panel-track]')).toHaveAttribute(
    'data-active-panel',
    String(index),
  );
}

/** Tap a pill in a ChipGroup (Paid by, Vehicle) and check it took. */
async function pickChip(entry: Locator, group: string, label: string): Promise<void> {
  const radios = entry.getByRole('radiogroup', { name: group });
  await radios.locator('label', { hasText: label }).click();
  await expect(radios.getByRole('radio', { name: label })).toBeChecked();
}

/**
 * Nothing the household did not tap is focused (decision 151).
 *
 * Focus at the till moves only as the answer to something they did — tapping a
 * field, Enter in Supplier, Next, "+ Note", "Add another" — never as a
 * side-effect of the till becoming ready or of a type tab appearing. A tab
 * button they just tapped keeps its own focus; a text field the page focused by
 * itself is the bug this guards.
 */
async function expectNoFieldFocused(page: Page): Promise<void> {
  const active = await page.evaluate(() => {
    const element = document.activeElement;
    if (element === null) return null;
    const tag = element.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') return null;
    return {
      tag,
      name: element.getAttribute('name'),
      inTill: element.closest('[data-till-ready]') !== null,
    };
  });
  const fields = ['input', 'select', 'textarea'];
  expect(
    active === null || !fields.includes(active.tag),
    `a field was focused without the household tapping it: ${JSON.stringify(active)}`,
  ).toBe(true);
}

/** A real finger on the glass: Chromium touch events through CDP. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / steps,
          y: from.y + ((to.y - from.y) * step) / steps,
        },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('mobile quick entry', () => {
  test('records a purchase at the till, then refuses an unbalanced split', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);

    // The app identifies itself: the version badge is part of the release check.
    await expect(
      page.getByRole('main').getByText(`v${APP_VERSION} · ${APP_RELEASE_STAGE}`),
    ).toBeVisible();

    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await expect(entry).toBeVisible();

    await entry.locator('input[name="supplierName"]').fill('Playwright Paints');
    await entry.locator('input[name="amount"]').fill('12.34');
    // No Save on the first card (decision 144): Next slides to the category.
    await entry.getByRole('button', { name: 'Next: category →' }).click();
    await expect(entry.locator('[data-panel-track]')).toHaveAttribute('data-active-panel', '1');
    await expect(entry.getByLabel(/^Category/)).toBeFocused();
    await entry.getByLabel('Line 1 amount').fill('12.34');
    await entry.getByLabel(/^Category/).selectOption({ label: 'Groceries / Weekly Shop' });
    await expect(entry.getByText('Matches exactly')).toBeVisible();

    const saveButton = entry.getByRole('button', { name: 'Save purchase' });
    await saveButton.click();
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });

    // Splits must total exactly: an unbalanced entry cannot be submitted.
    await entry.getByLabel('Line 1 amount').fill('1.00');
    await expect(saveButton).toBeDisabled();
    await expect(entry.getByText(/Remaining|Over by/)).toBeVisible();

    // The record is really stored: it is there on a fresh request.
    await page.goto('/purchases');
    const results = page.locator('section[aria-labelledby="results-heading"]');
    await expect(results.locator('tbody tr', { hasText: 'Playwright Paints' })).toHaveCount(1);
  });

  test('records a balance checkpoint, labelled as a checkpoint', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await entry.getByRole('tab', { name: 'Balance' }).click();
    await entry.getByLabel('Balance now').fill('987.65');
    await entry.getByRole('button', { name: 'Save checkpoint' }).click();
    await expect(entry.getByRole('status')).toContainText(/checkpoint/i, { timeout: 30_000 });
    // Reported by a person, never presented as a bank balance.
    await expect(page.getByText(/not a bank balance/i).first()).toBeVisible();
  });

  test('the amount alone fills line 1, balances the split and enables Save', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const line1 = entry.getByLabel('Line 1 amount');

    // The till amount is typed once: Line 1 follows it, so the split is
    // complete and Save is live without touching the line.
    await entry.locator('input[name="amount"]').fill('85.00');
    await expect(line1).toHaveValue('85.00');
    await showPanel(entry, 1);
    await expect(entry.getByText('Matches exactly')).toBeVisible();
    await expect(entry.getByRole('button', { name: 'Save purchase' })).toBeEnabled();

    // The only category control is still the split line's own, in the
    // details panel above Save — no category field crept in next to the
    // supplier and amount.
    await expect(entry.getByLabel(/^Category/)).toHaveCount(1);
    await expect(entry.getByRole('heading', { name: 'Category & allocation' })).toBeVisible();
    // With one line the label is just "Amount": the amount typed at the till
    // is already mirrored, so "Line 1" would be noise (SPEC §15.1).
    await expect(entry.getByText('Line 1 amount')).toHaveCount(0);
    await expect(entry.getByText('Amount', { exact: true }).first()).toBeVisible();
  });

  test('every keystroke updates line 1 — 8 then 5 is 85.00, not 8.00', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');

    // "8" is already a valid amount, so the first digit must not freeze it.
    await amount.pressSequentially('8');
    await expect(amount).toHaveValue('8');
    await expect(line1).toHaveValue('8.00');
    await amount.pressSequentially('5');
    await expect(amount).toHaveValue('85');
    await expect(line1).toHaveValue('85.00');

    // A correction downwards follows too.
    await amount.fill('84.50');
    await expect(line1).toHaveValue('84.50');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
  });

  test('a half-typed or deleted total never lies about line 1', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');
    const saveButton = entry.getByRole('button', { name: 'Save purchase' });

    await amount.fill('85');
    await expect(line1).toHaveValue('85.00');

    // "85." is not an amount yet: the last mirrored value stays put...
    await amount.fill('85.');
    await expect(line1).toHaveValue('85.00');
    // ...and the exact-total rule keeps Save off (balanced needs a parsed total).
    await expect(saveButton).toBeDisabled();
    await expect(entry.getByText('Enter amount')).toBeVisible();

    // Deleting the amount must not leave a stale mirrored line behind.
    await amount.fill('');
    await expect(line1).toHaveValue('');
    // Zero is not an amount either.
    await amount.fill('0');
    await expect(line1).toHaveValue('');
    await expect(saveButton).toBeDisabled();
  });

  test('editing line 1 takes it over and a later total change leaves it alone', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');
    const saveButton = entry.getByRole('button', { name: 'Save purchase' });

    await amount.fill('85');
    await expect(line1).toHaveValue('85.00');

    // Touching the line is a takeover: their value sticks from here on.
    await showPanel(entry, 1);
    await line1.fill('40.00');
    await expect(entry.getByText(/Remaining £45\.00/)).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await showPanel(entry, 0);
    await amount.fill('90');
    await expect(line1).toHaveValue('40.00');
    await expect(entry.getByText(/Remaining £50\.00/)).toBeVisible();
    await expect(saveButton).toBeDisabled();

    // The exact-total rule is unchanged: matching the total by hand saves.
    await showPanel(entry, 1);
    await line1.fill('90');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
    await expect(saveButton).toBeEnabled();
  });

  test('category, supplier, pot, paid by, date and note do not stop the following', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');

    // Naming a remembered supplier writes its most-used category through the
    // shared updateLine path, and the category dropdown uses that path too.
    await entry.locator('input[name="supplierName"]').fill('Corner Foods');
    await entry.getByLabel('Pot').selectOption({ index: 2 });
    await entry.getByRole('button', { name: '+ Note' }).click();
    await entry.getByLabel('Note (optional)').fill('Follows the amount');
    await showPanel(entry, 1);
    await entry.getByLabel(/^Category/).selectOption({ label: 'Groceries / Top-up Shops' });
    await entry
      .getByRole('group', { name: 'For line 1' })
      .getByRole('button', { name: 'Person' })
      .click();
    await entry
      .getByRole('group', { name: 'Person for line 1' })
      .getByRole('button', { name: 'Sam' })
      .click();
    // Paid by and Date now sit on the second card, below the lines (decision 145).
    await pickChip(entry, 'Paid by', 'Sam');
    await entry.getByLabel('Date').fill('2024-01-05');

    await showPanel(entry, 0);
    await amount.fill('42.50');
    await expect(line1).toHaveValue('42.50');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
  });

  test('Add split leaves line 1 alone, and so does a later correction', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');
    const line2 = entry.getByLabel('Line 2 amount');
    const saveButton = entry.getByRole('button', { name: 'Save purchase' });
    const assignRemaining = entry.getByRole('button', { name: 'Assign remaining' });

    await amount.fill('85');
    await expect(line1).toHaveValue('85.00');

    // Splitting deliberately: the new line starts empty, Line 1 is neither
    // cleared nor shrunk, and there is nothing left to assign yet.
    await showPanel(entry, 1);
    await entry.getByRole('button', { name: '+ Add split' }).click();
    await expect(line1).toHaveValue('85.00');
    await expect(line2).toHaveValue('');
    await expect(assignRemaining).toHaveCount(0);

    // A correction to the total must not rewrite the line either.
    await showPanel(entry, 0);
    await amount.fill('60');
    await expect(line1).toHaveValue('85.00');
    await expect(line2).toHaveValue('');
    await expect(saveButton).toBeDisabled();

    // Hand-splitting still obeys the exact-total rule.
    await showPanel(entry, 1);
    await line2.fill('40');
    await expect(entry.getByText(/Over by £65\.00/)).toBeVisible();
    await expect(saveButton).toBeDisabled();
    await line1.fill('20');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // Removing the extra line does not resume the following: the typed value
    // stays exactly as typed.
    await entry.getByRole('button', { name: 'Remove line' }).last().click();
    await expect(line1).toHaveValue('20');
    await showPanel(entry, 0);
    await amount.fill('30');
    await expect(line1).toHaveValue('20');
    await expect(saveButton).toBeDisabled();
  });

  test('Add another starts the following over', async ({ page }) => {
    test.slow(); // its own purchase, against the dev server
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const amount = entry.locator('input[name="amount"]');
    const line1 = entry.getByLabel('Line 1 amount');

    // Saved straight from the mirrored amount — Line 1 was never touched.
    await entry.locator('input[name="supplierName"]').fill('Playwright Follower Shop');
    await amount.fill('12.00');
    await expect(line1).toHaveValue('12.00');
    await entry.getByRole('button', { name: 'Next: category →' }).click();
    await entry.getByRole('button', { name: 'Save purchase' }).click();
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });

    // After the save the line is taken over (the value sticks)...
    await line1.fill('1.00');
    await expect(line1).toHaveValue('1.00');

    // ...and "Add another" hands the following back to the amount, and goes
    // back to the first card on the supplier (decision 137).
    await entry.getByRole('button', { name: 'Add another' }).click();
    await expect(entry.locator('[data-panel-track]')).toHaveAttribute('data-active-panel', '0');
    await expect(entry.locator('input[name="supplierName"]')).toBeFocused();
    await expect(amount).toHaveValue('');
    await expect(line1).toHaveValue('');
    await amount.fill('7.50');
    await expect(line1).toHaveValue('7.50');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
  });

  test('the till panel leads with the pot, the reported balance and what is left', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });

    // Pot first (SPEC §15.1): the balance is context for the entry, not
    // something to go hunting for. The seed sets Main account as the default.
    const pot = entry.getByLabel('Pot');
    await expect(pot.locator('option:checked')).toHaveText('Main account');

    // The bank's last reported figure — labelled as a checkpoint, with a
    // pound amount, its age and the time it was reported, and never presented
    // as a live balance. (The figure itself moves during this spec file: an
    // earlier test records a checkpoint against the same default pot.)
    const reported = entry.getByText(/Last reported/);
    await expect(reported).toBeVisible();
    await expect(reported).toContainText(/Last reported £[\d,]+\.\d{2}/);
    await expect(reported).toContainText(/ago|just now/);

    // ...and the figure that stops the mortgage being a surprise three days
    // before payday: what is left when everything expected to leave has left,
    // counting no income at all (SPEC §7.7).
    await expect(entry.getByText('Free to spend before income')).toBeVisible();
    await expect(entry.getByText(/Nothing coming in is counted/)).toBeVisible();
    await expect(entry.getByText(/never a bank balance/).first()).toBeVisible();

    // A cash pot shows no balance at all: the household counts the notes.
    await pot.selectOption({ label: "Alex's cash" });
    await expect(entry.getByText(/no balance is shown for cash/i)).toBeVisible();
    await expect(entry.getByText(/Last reported/)).toHaveCount(0);
    await expect(entry.getByText('Free to spend before income')).toBeVisible();
  });

  test('suggests suppliers inline, filters as you type and moves on to the amount', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const supplier = entry.locator('input[name="supplierName"]');
    const amount = entry.locator('input[name="amount"]');

    // No browser popup any more: the list is part of the page.
    await expect(entry.locator('datalist')).toHaveCount(0);

    // Landing on the field offers the household's recent suppliers.
    await supplier.click();
    const list = entry.getByRole('listbox', { name: 'Supplier suggestions' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('option', { name: /Corner Foods/ })).toBeVisible();

    // Typing narrows it to matches.
    await supplier.fill('corner');
    await expect(list.getByRole('option')).toHaveCount(2);
    await supplier.fill('insurer');
    await expect(list.getByRole('option')).toHaveCount(1);

    // Tapping a row fills the name, closes the list and moves on to Amount.
    await list.getByRole('option', { name: /InsurerCo/ }).click();
    await expect(supplier).toHaveValue('InsurerCo');
    await expect(amount).toBeFocused();
    await expect(list).toHaveCount(0);

    // A brand-new name is still just typed in — nothing blocks the entry.
    await supplier.fill('Playwright New Shop');
    await expect(list).toHaveCount(0);
  });

  test('the home page opens at the till with nothing focused', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });

    // Decision 151 still holds for focus: the page moves, but nothing takes
    // focus, so the keyboard stays down. (The old autofocus scrolled *with*
    // the keyboard up and buried the tab strip — measured before that fix at
    // scrollY 1342 with the tabs at y=-35.)
    await expectNoFieldFocused(page);

    // Decision 158: on a phone the home page opens AT the till. The card's
    // top parks just under the 56px sticky header (the section carries
    // scroll-mt-16 = 64px), so the type tabs are on screen on arrival and a
    // purchase starts in one tap.
    const top = await entry.evaluate((element) => element.getBoundingClientRect().top);
    expect(
      top,
      `the till's top sits at ${top}px on open — expected just below the sticky header`,
    ).toBeGreaterThanOrEqual(56);
    expect(
      top,
      `the till's top sits at ${top}px on open — expected 64px (scroll-mt-16)`,
    ).toBeLessThanOrEqual(96);
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(
      scrolled,
      `expected the page to have scrolled itself to the till, scrollY was ${scrolled}`,
    ).toBeGreaterThan(0);

    // Everything the card shows in its first paint is there without a tap:
    // the type tabs, the pot, and what is left before income lands.
    await expect(entry.getByRole('tab', { name: 'Purchase' })).toBeVisible();
    await expect(entry.getByLabel('Pot').locator('option:checked')).toHaveText('Main account');
    await expect(entry.getByText('Free to spend before income')).toBeVisible();

    // The tab strip sits inside the viewport — a different mode is one tap
    // away, which is the whole point of opening here.
    const tabs = entry.getByRole('tablist', { name: 'Quick entry type' });
    const box = await tabs.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box === null || viewport === null) return;
    expect(box.y, `tab strip top at y=${box.y}`).toBeGreaterThanOrEqual(0);
    expect(
      box.y + box.height,
      `tab strip bottom at y=${box.y + box.height} on a ${viewport.height}px screen`,
    ).toBeLessThanOrEqual(viewport.height);

    // That arrival was a scroll, not the browser's answer to a focus call.
    await expectNoFieldFocused(page);
  });

  test("the drawer's Quick Entry (Till) link lands on the till", async ({ page }) => {
    await page.goto('/purchases');
    const menuBtn = page.getByRole('button', { name: 'Open navigation menu' });
    await menuBtn.click();
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await nav.getByRole('link', { name: 'Quick Entry (Till)' }).click();

    // The link carries the anchor, so the hop ends at the till even though
    // the drawer closes over the navigation (decision 158).
    await waitForTill(page);
    await expect(page).toHaveURL(/\/#quick-entry$/);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const top = await entry.evaluate((element) => element.getBoundingClientRect().top);
    expect(
      top,
      `the till's top sits at ${top}px after the drawer tap — expected just below the sticky header`,
    ).toBeGreaterThanOrEqual(56);
    expect(top, `the till's top sits at ${top}px after the drawer tap`).toBeLessThanOrEqual(96);
    await expectNoFieldFocused(page);
  });

  test('choosing a type does not grab a field: Fuel, Balance and Move wait to be tapped', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });

    // The same rule as the opening page (decision 151), one level down:
    // choosing a *type* is not choosing a field. The Fuel amount and the
    // Balance figure used to autofocus as the tab appeared, with the same
    // keyboard-and-scroll cost on a phone.
    await entry.getByRole('tab', { name: 'Fuel' }).click();
    await expect(entry.getByLabel('Fuel amount')).toBeVisible();
    await expectNoFieldFocused(page);

    await entry.getByRole('tab', { name: 'Balance' }).click();
    await expect(entry.getByLabel('Balance now')).toBeVisible();
    await expectNoFieldFocused(page);

    await entry.getByRole('tab', { name: 'Move' }).click();
    await expect(entry.getByLabel('From pot')).toBeVisible();
    await expectNoFieldFocused(page);

    // Tapping the field itself still works, and still focuses it — the
    // household's tap, not the page's idea.
    await entry.getByRole('tab', { name: 'Balance' }).click();
    const balance = entry.getByLabel('Balance now');
    await balance.click();
    await expect(balance).toBeFocused();
  });

  test('one tap on Next moves on, even with the supplier suggestions open', async ({ page }) => {
    test.slow(); // its own purchase, against the dev server
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const supplier = entry.locator('input[name="supplierName"]');

    await entry.locator('input[name="amount"]').fill('4.20');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
    // A new name that still matches remembered suppliers: the list stays open
    // under the field, pushing Next down the page.
    await supplier.tap();
    await supplier.fill('Corner');
    const list = entry.getByRole('listbox', { name: 'Supplier suggestions' });
    await expect(list).toBeVisible();

    // One tap on Next. Closing the list must not move the button out from
    // under the finger before the tap lands (decision 135, now for Next).
    await entry.getByRole('button', { name: 'Next: category →' }).tap();
    await expect(entry.locator('[data-panel-track]')).toHaveAttribute('data-active-panel', '1');
    await expect(list).toHaveCount(0);
    await entry.getByRole('button', { name: 'Save purchase' }).tap();
    await expect(entry.getByRole('status')).toContainText(/saved/i, { timeout: 30_000 });
  });

  test('every control on every till tab is at least 44px tall', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });

    const tooSmall = async (label: string): Promise<string[]> =>
      entry.evaluate((root, where) => {
        const found: string[] = [];
        const controls = root.querySelectorAll<HTMLElement>(
          'button, a[href], input:not([type="hidden"]), select, textarea, summary',
        );
        for (const control of controls) {
          const box = control.getBoundingClientRect();
          // Only what a thumb can actually reach right now: on screen, on the
          // visible swipe panel, not hidden by a closed <details>.
          if (box.width === 0 || box.height === 0) continue;
          if (box.right <= 0 || box.left >= window.innerWidth) continue;
          const style = window.getComputedStyle(control);
          if (style.visibility === 'hidden') continue;
          // A checkbox or radio is measured by its label, which is the target.
          const target =
            control instanceof HTMLInputElement &&
            (control.type === 'checkbox' || control.type === 'radio') &&
            control.closest('label') !== null
              ? (control.closest('label') as HTMLElement).getBoundingClientRect()
              : box;
          if (target.height < 44 || target.width < 44) {
            const name =
              control.getAttribute('aria-label') ??
              (control.textContent ?? '').trim().slice(0, 40) ??
              control.getAttribute('name');
            found.push(
              `${where}: <${control.tagName.toLowerCase()}> "${name || control.getAttribute('name')}" ${Math.round(target.width)}x${Math.round(target.height)}`,
            );
          }
        }
        return found;
      }, label);

    const problems: string[] = [];
    problems.push(...(await tooSmall('Purchase panel 1')));
    await showPanel(entry, 1);
    await page.waitForTimeout(400); // let the 200ms slide finish before measuring
    problems.push(...(await tooSmall('Purchase panel 2')));
    await showPanel(entry, 0);
    await page.waitForTimeout(400);
    for (const tab of ['Fuel', 'Balance', 'Move']) {
      await entry.getByRole('tab', { name: tab }).click();
      problems.push(...(await tooSmall(tab)));
    }
    for (const moveTab of ['Borrow & repay', 'Swap', 'Other']) {
      await entry.getByRole('tab', { name: moveTab }).click();
      problems.push(...(await tooSmall(`Move / ${moveTab}`)));
    }
    expect(problems).toEqual([]);
  });

  test('Save is only on the second card; Next, the dots and a real swipe switch cards', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const track = entry.locator('[data-panel-track]');

    // Decision 144: one Save, on the Category & allocation card.
    await expect(entry.getByRole('button', { name: 'Save purchase' })).toHaveCount(1);
    await expect(entry.getByRole('button', { name: 'Next: category →' })).toBeVisible();
    await expect(entry.getByText(/Swipe/)).toBeVisible();

    // The dots move between the panels and flip the hint.
    await showPanel(entry, 1);
    await expect(entry.getByText('Swipe ← back to the entry')).toBeVisible();
    await showPanel(entry, 0);
    await expect(entry.getByText(/Swipe → category/)).toBeVisible();

    // Start the drags on the balance card, away from inputs and buttons —
    // measured afresh each time, because a vertical drag scrolls the page.
    const balanceCard = async () => {
      const card = entry.getByText('Free to spend before income');
      // Mid-screen, clear of the sticky page navigation.
      await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const box = await card.boundingBox();
      if (box === null) throw new Error('no balance card');
      return { x: box.x + box.width / 2, y: box.y + 4 };
    };

    // A diagonal thumb (20px sideways, 200px down) is a scroll, not a swipe.
    let start = await balanceCard();
    await drag(page, start, { x: start.x - 20, y: start.y + 200 });
    await page.waitForTimeout(300);
    await expect(track).toHaveAttribute('data-active-panel', '0');

    // A real horizontal swipe switches — and back again.
    start = await balanceCard();
    await drag(page, start, { x: start.x - 150, y: start.y + 10 });
    await expect(track).toHaveAttribute('data-active-panel', '1');
    const heading = entry.getByRole('heading', { name: 'Category & allocation' });
    await heading.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const back = await heading.boundingBox();
    if (back === null) throw new Error('no details heading');
    const from = { x: back.x + 20, y: back.y + back.height / 2 };
    await drag(page, from, { x: from.x + 150, y: from.y - 5 });
    await expect(track).toHaveAttribute('data-active-panel', '0');

    // The hidden card cannot be reached by accident.
    await expect(entry.locator('[data-panel="1"]')).toHaveAttribute('inert', '');
  });

  test('Enter on the first card never saves: supplier → amount → Next', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    const supplier = entry.locator('input[name="supplierName"]');
    const amount = entry.locator('input[name="amount"]');

    await supplier.fill('Playwright Enter Shop');
    await supplier.press('Enter');
    await expect(amount).toBeFocused();
    await amount.fill('6.66');
    await expect(entry.getByText('Matches exactly')).toBeVisible();
    // The phone keyboard's Go key: implicit submission would press Save on the
    // hidden card. It must move on instead.
    await amount.press('Enter');
    await expect(entry.locator('[data-panel-track]')).toHaveAttribute('data-active-panel', '1');
    await expect(entry.getByLabel(/^Category/)).toBeFocused();
    await page.waitForTimeout(1000);
    await expect(entry.getByRole('status')).toHaveCount(0);
  });

  test('the page never pans sideways — 320px, and 360px with 130% text', async ({ page }) => {
    test.slow();
    const noOverflow = async (where: string) => {
      const sizes = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(sizes.scroll, `${where}: page ${sizes.scroll}px on a ${sizes.client}px screen`).toBe(
        sizes.client,
      );
    };
    for (const setup of [
      { width: 320, fontSize: null, label: '320px' },
      { width: 360, fontSize: '130%', label: '360px @130%' },
    ]) {
      await page.setViewportSize({ width: setup.width, height: 780 });
      await page.goto('/');
      await waitForTill(page);
      if (setup.fontSize !== null) {
        await page.addStyleTag({ content: `html{font-size:${setup.fontSize}}` });
      }
      const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
      await noOverflow(`${setup.label} purchase panel 1`);
      await showPanel(entry, 1);
      await noOverflow(`${setup.label} purchase panel 2`);
      await showPanel(entry, 0);
      for (const tab of ['Fuel', 'Balance', 'Move']) {
        await entry.getByRole('tab', { name: tab }).click();
        await noOverflow(`${setup.label} ${tab}`);
      }
      for (const moveTab of ['Borrow & repay', 'Swap', 'Other']) {
        await entry.getByRole('tab', { name: moveTab }).click();
        await noOverflow(`${setup.label} Move / ${moveTab}`);
      }
    }
  });

  test('every page stays reachable on a phone viewport', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    const menuBtn = page.getByRole('button', { name: 'Open navigation menu' });
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
    }
    const nav = page.getByRole('navigation', { name: 'Pages' });
    const daily = ['Quick Entry (Till)', 'Purchases', 'Horizon', 'Charts', 'Overview', 'Recurring'];
    const more = [
      'All Transactions',
      'Income',
      'Accounts & Pots',
      'Insights',
      'Settings',
      'Suppliers',
      'Contracts & Renewals',
    ];
    for (const label of [...daily, ...more]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    const labels = await nav.getByRole('link').allTextContents();
    expect(labels.slice(0, daily.length)).toEqual(daily);
  });

  test('the phone home is the till, not a dump of laptop pages', async ({ page }) => {
    await page.goto('/');
    await waitForTill(page);
    await expect(page.getByRole('heading', { name: /Household:/i })).toBeVisible();
    await expect(page.getByText('Payday projection').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Due this week' })).toBeVisible();
    const more = page.getByRole('navigation', { name: 'Other pages' });
    await expect(more.getByRole('link', { name: /Charts/ })).toBeVisible();
    await expect(more.getByRole('link', { name: /Purchases/ })).toBeVisible();
    await expect(more.getByRole('link', { name: /Horizon/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a pot' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Record a balance checkpoint/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recent checkpoints' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recent entries' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Key dates' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Schedules, renewals/ })).toHaveCount(0);
  });

  test('purchase filters start collapsed and stay inside the card', async ({ page }) => {
    await page.goto('/purchases');
    const filters = page.getByRole('form', { name: 'Purchase filters' });
    const show = filters.getByRole('button', { name: 'Show filters' });
    await expect(show).toBeVisible();
    await expect(filters.getByLabel('From date')).toBeHidden();

    await show.click();
    await expect(filters.getByRole('button', { name: 'Hide filters' })).toBeVisible();

    const from = filters.getByLabel('From date');
    const to = filters.getByLabel('To date');
    const pot = filters.getByLabel('Pot');
    await expect(from).toBeVisible();
    await expect(to).toBeVisible();
    await expect(pot).toBeVisible();

    const cardBox = await filters.boundingBox();
    const fromBox = await from.boundingBox();
    const toBox = await to.boundingBox();
    const potBox = await pot.boundingBox();
    expect(cardBox).toBeTruthy();
    expect(fromBox).toBeTruthy();
    expect(toBox).toBeTruthy();
    expect(potBox).toBeTruthy();
    if (cardBox === null || fromBox === null || toBox === null || potBox === null) return;

    // From/To sit on one row; the dropdowns stay inside the rounded card.
    expect(Math.abs(fromBox.y - toBox.y)).toBeLessThan(8);
    expect(toBox.x).toBeGreaterThan(fromBox.x);
    for (const box of [fromBox, toBox, potBox]) {
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    }

    await filters.getByLabel('Supplier').selectOption({ label: 'Corner Foods' });
    await filters.getByRole('button', { name: 'Apply filters' }).click();
    await expect(filters.getByRole('button', { name: 'Hide filters' })).toBeVisible();
    await expect(filters.getByLabel('Supplier')).toBeVisible();
  });

  test('the Move tab records a transfer; a transfer after the checkpoint is household-net-zero', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTill(page);
    const before = await page.getByRole('heading', { name: /household:/i }).textContent();
    if (before === null) throw new Error('household heading missing');
    const beforePence = Math.round(parsePounds(before) * 100);

    const entry = page.getByRole('region', { name: /Record it while it is fresh/i });
    await entry.getByRole('tab', { name: 'Move' }).click();
    await entry.getByLabel('From pot').selectOption({ label: 'Main account' });
    await entry.getByLabel('To pot').selectOption({ label: "Alex's cash" });
    await entry.getByLabel('Amount').fill('5.00');
    await entry.getByRole('button', { name: 'Record transfer' }).click();
    await expect(entry.getByRole('status')).toContainText(/recorded/i, { timeout: 30_000 });

    // SPEC §7.1: the seed checkpoints were written down before this transfer,
    // so both legs count. The household total does not move. (A credit
    // recorded *before* a same-day checkpoint is the one that stays absorbed.)
    const after = await page.getByRole('heading', { name: /household:/i }).textContent();
    if (after === null) throw new Error('household heading missing');
    expect(Math.round(parsePounds(after) * 100)).toBe(beforePence);
  });
});
