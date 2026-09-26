import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contrast, fit, type Oklch } from '../scripts/themes/colour';
import { parseCssColour, readBaseTokens } from '../scripts/themes/base-tokens';
import { CONTRAST_RULES, SEPARATION_RULES } from '../scripts/themes/derive';
import { generate } from '../scripts/themes/build';
import {
  DEFAULT_THEME_ID,
  isThemeId,
  resolveTheme,
  themeById,
  themeFamilies,
  THEMES,
} from '../src/lib/theme/theme';

/**
 * The themes (decision 160, SPEC §15.4).
 *
 * These tests read the **shipped stylesheet**, not the generator's output in
 * memory: the artefact the browser downloads is the thing that has to be
 * legible, and a check that only ever inspects the calculation would pass
 * happily while a stale file went out.
 *
 * What is guaranteed here, for all 28 of them:
 *
 *  1. Every theme is *complete* — it re-declares every token the base block
 *     defines, so no theme can half-apply and leave one colour behind.
 *  2. Every pairing the app actually renders clears its floor, and the floors
 *     are the Classic scheme's own measured ratios (decision 160): no theme
 *     may be less legible than the one the household already reads.
 *  3. No theme collapses a distinction Classic makes inside a family — two
 *     greys, two reds or two chart series that differ today still differ.
 *  4. The generated files are up to date with `scripts/themes/`.
 *  5. The default theme is byte-identical to the base block, so an
 *     installation that never opens Settings sees exactly what it saw before.
 */

const ROOT = path.join(import.meta.dirname, '..');
const themesCss = readFileSync(path.join(ROOT, 'src', 'app', 'themes.generated.css'), 'utf8');
const baseTokens = readBaseTokens();

interface ParsedTheme {
  id: string;
  colourScheme: string;
  values: Map<string, string>;
}

/** Read the generated stylesheet back the way a browser would group it. */
function parseThemes(css: string): ParsedTheme[] {
  const parsed: ParsedTheme[] = [];
  for (const block of css.matchAll(/\[data-theme='([a-z-]+)'\]\s*\{([^}]*)\}/g)) {
    const id = block[1];
    const body = block[2];
    if (id === undefined || body === undefined) continue;
    const values = new Map<string, string>();
    for (const decl of body.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      const name = decl[1];
      const value = decl[2];
      if (name === undefined || value === undefined) continue;
      values.set(name, value.trim());
    }
    parsed.push({
      id,
      colourScheme: /color-scheme:\s*([a-z]+);/.exec(body)?.[1] ?? '',
      values,
    });
  }
  return parsed;
}

const parsedThemes = parseThemes(themesCss);

/** A token's colour, or null for the two `color-mix()` relationships. */
function colourOf(theme: ParsedTheme, name: string): Oklch | null {
  const value = theme.values.get(name);
  if (value === undefined) return null;
  try {
    return parseCssColour(value);
  } catch {
    return null;
  }
}

function ratio(theme: ParsedTheme, fg: string, bg: string): number | null {
  const a = colourOf(theme, fg);
  const b = colourOf(theme, bg);
  if (a === null || b === null) return null;
  return contrast(fit(a), fit(b));
}

test('the stylesheet carries every theme the catalogue offers, and no others', () => {
  assert.deepEqual(
    parsedThemes.map((theme) => theme.id),
    THEMES.map((theme) => theme.id),
  );
  assert.equal(THEMES.length, 28, 'fourteen palettes, light and dark');
  assert.ok(
    THEMES.some((theme) => theme.id === DEFAULT_THEME_ID),
    'the default must be one of them',
  );
});

test('every theme is complete — the same token names as the base block', () => {
  const expected = baseTokens.map((token) => token.name);
  for (const theme of parsedThemes) {
    assert.deepEqual(
      [...theme.values.keys()].sort(),
      [...expected].sort(),
      `${theme.id} does not declare the same tokens as the base @theme block`,
    );
  }
});

test('the default theme is the base block, value for value', () => {
  const base = new Map(baseTokens.map((token) => [token.name, token.value]));
  const classic = parsedThemes.find((theme) => theme.id === DEFAULT_THEME_ID);
  assert.ok(classic, 'the default theme must be in the stylesheet');
  for (const [name, value] of base) {
    assert.equal(
      classic.values.get(name),
      value,
      `classic-light must not re-tint ${name}: an installation that never picks a theme sees the base block`,
    );
  }
});

test('every theme declares its colour-scheme so browser furniture follows', () => {
  for (const theme of parsedThemes) {
    const entry = THEMES.find((candidate) => candidate.id === theme.id);
    assert.ok(entry);
    assert.equal(theme.colourScheme, entry.mode, `${theme.id} must declare color-scheme`);
  }
});

test('every theme clears every legibility floor the app renders', () => {
  const failures: string[] = [];
  for (const theme of parsedThemes) {
    for (const rule of [...CONTRAST_RULES, ...SEPARATION_RULES]) {
      const measured = ratio(theme, rule.fg, rule.bg);
      assert.ok(measured !== null, `${theme.id}: ${rule.fg}/${rule.bg} is not a colour`);
      if (measured + 0.005 < rule.min) {
        failures.push(
          `${theme.id}: ${rule.fg} on ${rule.bg} is ${measured.toFixed(2)}:1, needs ${rule.min} (${rule.why})`,
        );
      }
    }
  }
  assert.deepEqual(failures, [], `legibility floors missed:\n${failures.join('\n')}`);
});

/**
 * Distinctions that must survive a re-tint (decision 159: "today's
 * distinctions stay distinct"), grouped the way the eye reads them. Across
 * groups a theme may legitimately converge — on a dark page the ink on a card
 * and the ink on the till are both near-white — but *within* a group, two
 * colours Classic tells apart have to stay two colours.
 */
const GROUPS: Record<string, readonly string[]> = {
  surfaces: [
    'canvas',
    'surface',
    'surface-muted',
    'surface-sunk',
    'border-hairline',
    'border',
    'border-strong',
    'border-emphasis',
    'marker-muted',
  ],
  inks: ['ink', 'ink-emphasis', 'ink-body', 'ink-soft', 'ink-muted', 'ink-faint', 'ink-ghost'],
  till: ['till', 'till-ink', 'fill-ink', 'till-inset', 'till-hover', 'till-muted'],
  accent: [
    'accent-50',
    'accent-100',
    'accent-200',
    'accent-300',
    'accent-400',
    'accent-500',
    'accent-600',
    'accent',
    'accent-800',
    'accent-900',
  ],
  positive: [
    'positive-50',
    'positive-100',
    'positive-200',
    'positive-500',
    'positive',
    'positive-800',
    'positive-900',
  ],
  warning: [
    'warning-50',
    'warning-100',
    'warning-200',
    'warning-300',
    'warning-600',
    'warning-700',
    'warning',
    'warning-900',
    'warning-950',
  ],
  danger: ['danger-50', 'danger-200', 'danger-300', 'danger', 'danger-800'],
  negative: ['negative-50', 'negative-200', 'negative', 'negative-900'],
  'chart series': ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'],
};

/** `#fff` and `#ffffff` are the same white; compare them as one. */
function expandHex(value: string | undefined): string {
  if (value === undefined) return '';
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value.trim());
  if (short === null) return value.trim().toLowerCase();
  return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
}

/** Perceptual distance in OKLab — small enough to be "the same colour". */
function apart(a: Oklch, b: Oklch): number {
  const ax = a.c * Math.cos((a.h * Math.PI) / 180);
  const ay = a.c * Math.sin((a.h * Math.PI) / 180);
  const bx = b.c * Math.cos((b.h * Math.PI) / 180);
  const by = b.c * Math.sin((b.h * Math.PI) / 180);
  return Math.hypot(a.l - b.l, ax - bx, ay - by);
}

test('no theme collapses two colours Classic tells apart', () => {
  const classic = parsedThemes.find((theme) => theme.id === DEFAULT_THEME_ID);
  assert.ok(classic);
  const collapses: string[] = [];
  for (const [group, names] of Object.entries(GROUPS)) {
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const a = names[i] ?? '';
        const b = names[j] ?? '';
        const classicA = colourOf(classic, a);
        const classicB = colourOf(classic, b);
        if (classicA === null || classicB === null) continue;
        if (apart(classicA, classicB) < 0.02) continue; // Classic barely separates them either
        for (const theme of parsedThemes) {
          const themeA = colourOf(theme, a);
          const themeB = colourOf(theme, b);
          if (themeA === null || themeB === null) continue;
          const distance = apart(themeA, themeB);
          if (distance < 0.008) {
            collapses.push(`${theme.id}: ${group} — ${a} and ${b} are the same colour`);
          }
        }
      }
    }
  }
  assert.deepEqual(collapses, [], `collapsed distinctions:\n${collapses.join('\n')}`);
});

test('every chrome colour is its own theme’s token, not a stray literal', () => {
  for (const entry of THEMES) {
    const theme = parsedThemes.find((candidate) => candidate.id === entry.id);
    assert.ok(theme, `${entry.id} must be in the stylesheet`);
    // A light theme hands the browser the till; a dark theme hands it the page.
    const source = entry.mode === 'light' ? 'till' : 'canvas';
    const token = colourOf(theme, source);
    const chrome = parseCssColour(entry.chrome);
    assert.ok(token);
    assert.ok(
      apart(token, chrome) < 0.005,
      `${entry.id}: chrome ${entry.chrome} does not match --color-${source}`,
    );
  }
});

test('the generated files are up to date with scripts/themes', async () => {
  const { css, catalogue } = await generate();
  assert.equal(
    readFileSync(path.join(ROOT, 'src', 'app', 'themes.generated.css'), 'utf8'),
    css,
    'run `npm run themes:build`',
  );
  assert.equal(
    readFileSync(path.join(ROOT, 'src', 'lib', 'theme', 'catalogue.ts'), 'utf8'),
    catalogue,
    'run `npm run themes:build`',
  );
});

test('a light theme keeps pure white on its saturated fills', () => {
  // The void button's legibility e2e asserts rgb(255, 255, 255) on hover, and
  // a light theme has no reason to write anything else on a dark fill.
  for (const theme of parsedThemes) {
    const entry = THEMES.find((candidate) => candidate.id === theme.id);
    if (entry?.mode !== 'light') continue;
    assert.equal(expandHex(theme.values.get('till-ink')), '#ffffff', `${theme.id} till-ink`);
    assert.equal(expandHex(theme.values.get('fill-ink')), '#ffffff', `${theme.id} fill-ink`);
  }
});

test('a dark theme writes on its saturated fills in near-black', () => {
  for (const theme of parsedThemes) {
    const entry = THEMES.find((candidate) => candidate.id === theme.id);
    if (entry?.mode !== 'dark') continue;
    const fillInk = colourOf(theme, 'fill-ink');
    const tillInk = colourOf(theme, 'till-ink');
    assert.ok(fillInk && tillInk);
    assert.ok(fillInk.l < 0.3, `${theme.id}: fill-ink must be dark, got L${fillInk.l}`);
    assert.ok(tillInk.l > 0.9, `${theme.id}: till-ink must stay light, got L${tillInk.l}`);
  }
});

test('the cookie resolves to a theme, whatever it says', () => {
  assert.equal(resolveTheme(undefined).id, DEFAULT_THEME_ID);
  assert.equal(resolveTheme(null).id, DEFAULT_THEME_ID);
  assert.equal(resolveTheme('').id, DEFAULT_THEME_ID);
  assert.equal(resolveTheme('not-a-theme').id, DEFAULT_THEME_ID);
  assert.equal(resolveTheme('  harbour-dark  ').id, 'harbour-dark');
  assert.equal(resolveTheme('harbour-dark').mode, 'dark');
  assert.ok(isThemeId('classic-light'));
  assert.ok(!isThemeId('classic'));
  assert.ok(!isThemeId(42));
  assert.equal(themeById('beacon-dark').label, 'Beacon');
});

test('the gallery pairs every palette with both of its modes', () => {
  const families = themeFamilies();
  assert.equal(families.length, 14);
  assert.equal(families[0]?.paletteId, 'classic', 'Classic leads the gallery');
  for (const family of families) {
    assert.equal(family.light.mode, 'light', `${family.paletteId} needs a light theme`);
    assert.equal(family.dark.mode, 'dark', `${family.paletteId} needs a dark theme`);
    assert.equal(family.light.paletteId, family.paletteId);
    assert.equal(family.dark.paletteId, family.paletteId);
  }
});
