/**
 * Generate the themes (decision 160).
 *
 *   npm run themes:build      # rewrite the generated files
 *   npm run themes:check      # fail if they are out of date
 *
 * Writes two files, and nothing else in the app knows a colour:
 *
 *   src/app/themes.generated.css   one `[data-theme='…']` block per theme
 *   src/lib/theme/catalogue.ts     the list the Settings gallery renders
 *
 * `classic-light` is copied **verbatim** from the base `@theme static` block
 * in `globals.css` rather than derived, so the default theme is the scheme
 * decision 159 tokenised, to the byte. Every other theme is derived by
 * `derive.ts` from its five stops.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import { readBaseTokens, baseTokenColours, REPO_ROOT } from './base-tokens';
import { deriveTheme, themeId, type DerivedTheme, type ThemeMode } from './derive';
import { SEED_PALETTES } from './palettes';

const CSS_OUT = path.join(REPO_ROOT, 'src', 'app', 'themes.generated.css');
const CATALOGUE_OUT = path.join(REPO_ROOT, 'src', 'lib', 'theme', 'catalogue.ts');

export const MODES: ThemeMode[] = ['light', 'dark'];

/** Every theme, in gallery order: Classic first, then the palettes as supplied. */
export function buildThemes(): DerivedTheme[] {
  const baseTokens = readBaseTokens();
  const order = baseTokens.map((token) => token.name);
  const base = baseTokenColours(baseTokens);
  const themes: DerivedTheme[] = [];
  for (const palette of SEED_PALETTES) {
    for (const mode of MODES) {
      if (palette.id === 'classic' && mode === 'light') {
        themes.push({
          id: themeId('classic', 'light'),
          paletteId: palette.id,
          label: palette.label,
          blurb: palette.blurb,
          mode,
          tokens: Object.fromEntries(baseTokens.map((token) => [token.name, token.value])),
          chrome: '#0f172a',
        });
        continue;
      }
      themes.push(deriveTheme(palette, mode, base, order));
    }
  }
  return themes;
}

const MODE_LABEL: Record<ThemeMode, string> = { light: 'light', dark: 'dark' };

function cssFor(themes: DerivedTheme[]): string {
  const blocks = themes.map((theme) => {
    const declarations = Object.entries(theme.tokens)
      .map(([name, value]) => `  --color-${name}: ${value};`)
      .join('\n');
    return `/* ${theme.label} — ${MODE_LABEL[theme.mode]} */
[data-theme='${theme.id}'] {
  color-scheme: ${theme.mode};
${declarations}
}`;
  });

  return `/*
 * GENERATED FILE — do not edit by hand.
 * Run \`npm run themes:build\` after changing scripts/themes/*.
 *
 * One block per theme (decision 160, SPEC §15.4). Each block re-declares the
 * same \`--color-*\` names the base \`@theme static\` block in globals.css
 * defines, so switching themes is a single attribute on <html> and no page,
 * component or chart knows that anything changed.
 *
 * Plain CSS rather than more \`@theme\` blocks on purpose: Tailwind puts
 * \`@theme\` into \`@layer theme\`, and an unlayered rule beats a layered one
 * whatever the order, so these win over the defaults without a specificity
 * war. They are attribute selectors rather than \`:root[data-theme]\` so the
 * Settings gallery can paint a live preview of any theme inside a card while
 * the page around it wears another.
 *
 * \`color-scheme\` is part of the theme: it is what makes the browser's own
 * furniture — scrollbars, a native select's popup, the date picker — follow
 * the page instead of glowing white in the middle of a dark one.
 */

${blocks.join('\n\n')}
`;
}

function catalogueFor(themes: DerivedTheme[]): string {
  const ids = themes.map((theme) => `  | '${theme.id}'`).join('\n');
  const entries = themes
    .map(
      (theme) => `  {
    id: '${theme.id}',
    paletteId: '${theme.paletteId}',
    label: ${JSON.stringify(theme.label)},
    blurb: ${JSON.stringify(theme.blurb)},
    mode: '${theme.mode}',
    chrome: '${theme.chrome}',
  },`,
    )
    .join('\n');

  return `/*
 * GENERATED FILE — do not edit by hand.
 * Run \`npm run themes:build\` after changing scripts/themes/*.
 *
 * The themes the Settings gallery offers (decision 160). Data only: an id, a
 * name, and the one colour that cannot be a CSS variable — \`chrome\`, the PWA
 * theme colour, which the browser reads before any stylesheet exists (SPEC
 * §14, §15.4). Every other colour in this app lives in CSS, and
 * \`tests/colour-tokens.test.ts\` keeps it that way.
 */

export type ThemeId =
${ids};

export type ThemeMode = 'light' | 'dark';

export interface ThemeEntry {
  /** Cookie value, \`data-theme\` attribute and CSS selector. */
  id: ThemeId;
  /** The palette both modes share. */
  paletteId: string;
  label: string;
  blurb: string;
  mode: ThemeMode;
  /** The browser chrome colour, read before any CSS exists. */
  chrome: string;
}

/** Gallery order: Classic first, then the palettes as the household listed them. */
export const THEMES: readonly ThemeEntry[] = [
${entries}
];

/** The scheme the app has always worn — what an installation with no cookie gets. */
export const DEFAULT_THEME_ID: ThemeId = 'classic-light';
`;
}

async function pretty(filePath: string, contents: string): Promise<string> {
  const config = await resolveConfig(filePath);
  return format(contents, { ...config, filepath: filePath });
}

export async function generate(): Promise<{ css: string; catalogue: string }> {
  const themes = buildThemes();
  return {
    css: await pretty(CSS_OUT, cssFor(themes)),
    catalogue: await pretty(CATALOGUE_OUT, catalogueFor(themes)),
  };
}

/** The CLI body; `scripts/themes/cli.mts` is the entry point that awaits it. */
export async function main(check: boolean): Promise<void> {
  const { css, catalogue } = await generate();
  const targets: Array<[string, string]> = [
    [CSS_OUT, css],
    [CATALOGUE_OUT, catalogue],
  ];
  let stale = false;
  for (const [file, contents] of targets) {
    const current = existsSync(file) ? readFileSync(file, 'utf8').toString() : '';
    if (current === contents) continue;
    if (check) {
      stale = true;
      console.error(`stale: ${path.relative(REPO_ROOT, file)}`);
      continue;
    }
    writeFileSync(file, contents);
    console.log(`wrote ${path.relative(REPO_ROOT, file)}`);
  }
  if (stale) {
    console.error('Run `npm run themes:build` and commit the result.');
    process.exitCode = 1;
  } else if (check) {
    console.log('themes are up to date');
  }
}
