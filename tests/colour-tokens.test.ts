import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The colour grep-gate (decision 159; extended for the themes, decision 160).
 *
 * The whole colour scheme lives in CSS: one `@theme` block in
 * `src/app/globals.css` for the default, and one generated block per theme in
 * `src/app/themes.generated.css`. Every page and the chart kit reach for it by
 * token name. These tests keep it that way:
 *
 *  1. No raw Tailwind palette utility class (a slate-500 or red-700 utility)
 *     anywhere under `src` — pages may not re-introduce app-wide colour.
 *  2. No colour literal (hex / rgb / hsl) in the TypeScript under `src`
 *     outside the two documented exceptions, both of them the same exception:
 *     the browser reads a theme colour before any stylesheet exists, so the
 *     PWA chrome cannot be a custom property. Those literals are the generated
 *     catalogue's `chrome` values (`src/lib/theme/catalogue.ts`).
 *  3. Every `var(--color-…)` the code references is actually defined in
 *     globals.css, so a typo'd token cannot ship silently.
 *  4. The semantic token names a theme redefines all exist.
 *  5. The manifest's two literals agree with each other, with the default
 *     theme's `chrome`, and with the `--color-till` token (±1/255 per channel,
 *     the Tailwind oklch→sRGB rounding).
 *
 * The gate only scans `src/`. The chart kit's palette is the token block; its
 * `CHART_COLOURS` map holds `var(--color-chart-…)` strings, which the chart
 * components apply through inline `style` so the custom property resolves in a
 * declaration (presentation-attribute support is not universal).
 *
 * `tests/themes.test.ts` is the other half: it checks the generated themes
 * themselves — complete blocks, legible pairings, no collapsed distinctions.
 */

const SRC = path.join(import.meta.dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(entry)) out.push(p);
  }
  return out;
}

const files = walk(SRC).sort();
const read = (p: string): string => readFileSync(p, 'utf8');

const tsFiles = files.filter((f) => /\.(ts|tsx)$/.test(f));
const globalsCss = read(path.join(SRC, 'app', 'globals.css'));

/** Any raw Tailwind palette utility class, with or without a variant prefix. */
const PALETTE_CLASS = new RegExp(
  '(?<![\\w-])(?:(?:[a-z0-9-]+:)+)?(?:[a-z][a-z-]*(?:-x|-y)?-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\\d{2,3})?|(?:bg|text|border|ring|divide|fill|stroke|from|via|to|shadow|outline)-(?:white|black))(?![\\w-])',
  'g',
);

/** A colour literal: #abc / #aabbcc / #aabbccdd / rgb( / rgba( / hsl( / hsla( / oklch( . */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|\boklch\(/g;

/**
 * The only place a colour literal may remain in TS: the generated theme
 * catalogue's `chrome` values — the browser chrome / PWA colour, which is
 * read before any stylesheet exists and so cannot be a custom property
 * (SPEC §14, §15.4). `themes.test.ts` checks each one against its theme's own
 * token, so a literal here can never drift from the CSS.
 */
const HEX_ALLOWLIST_TS = new Set([path.join('src', 'lib', 'theme', 'catalogue.ts')]);

test('no raw palette utility classes remain in src', () => {
  const offenders: string[] = [];
  for (const f of tsFiles) {
    const src = read(f);
    PALETTE_CLASS.lastIndex = 0;
    const hits = src.match(PALETTE_CLASS);
    if (hits)
      for (const h of hits)
        offenders.push(`${path.relative(path.join(import.meta.dirname, '..'), f)}: ${h}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `palette classes must be token names (decision 159):\n${offenders.join('\n')}`,
  );
});

test('no colour literals in src TS outside the PWA theme colour', () => {
  const offenders: string[] = [];
  for (const f of tsFiles) {
    const rel = path.relative(path.join(import.meta.dirname, '..'), f);
    if (HEX_ALLOWLIST_TS.has(rel)) continue;
    const src = read(f);
    COLOUR_LITERAL.lastIndex = 0;
    const hits = src.match(COLOUR_LITERAL);
    if (hits) for (const h of hits) offenders.push(`${rel}: ${h}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `colours belong in the @theme block, not in components:\n${offenders.join('\n')}`,
  );
});

test('the @theme block defines the token names a theme redefines', () => {
  const defined = new Set([...globalsCss.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const expected = [
    // neutral spine a dark theme must flip
    'canvas',
    'surface',
    'surface-muted',
    'surface-sunk',
    'marker-muted',
    'border',
    'border-strong',
    'border-hairline',
    'border-emphasis',
    'ink',
    'ink-emphasis',
    'ink-body',
    'ink-soft',
    'ink-muted',
    'ink-faint',
    'ink-ghost',
    'till',
    'till-ink',
    'fill-ink',
    'till-inset',
    'till-hover',
    'till-muted',
    // chromatic families (primary shade carries the un-numbered name)
    'accent',
    'accent-50',
    'accent-100',
    'accent-500',
    'accent-900',
    'positive',
    'positive-50',
    'positive-500',
    'warning',
    'warning-50',
    'warning-300',
    'danger',
    'danger-50',
    'danger-300',
    'danger-800',
    'negative',
    'negative-50',
    'negative-200',
    'note',
    'note-200',
    // charts
    'chart-1',
    'chart-2',
    'chart-3',
    'chart-4',
    'chart-5',
    'chart-bar',
    'chart-bar-muted',
    'chart-danger',
    'chart-danger-tint',
    'chart-grid',
    'chart-axis',
    'chart-text',
    'chart-halo',
    'chart-line-fill',
  ];
  const missing = expected.filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `missing tokens in globals.css @theme:\n${missing.join('\n')}`);
});

test('every var(--color-…) referenced in src is defined in the @theme block', () => {
  const defined = new Set([...globalsCss.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const referenced = new Set<string>();
  for (const f of tsFiles) {
    const src = read(f);
    for (const m of src.matchAll(/var\(--color-([a-z0-9-]+)\)/g)) if (m[1]) referenced.add(m[1]);
  }
  const dangling = [...referenced].filter((name) => !defined.has(name));
  assert.deepEqual(dangling, [], `referenced but undefined tokens:\n${dangling.join('\n')}`);
});

test('PWA theme colour literals agree with each other and with --color-till', () => {
  const catalogue = read(path.join(SRC, 'lib', 'theme', 'catalogue.ts'));
  const manifest = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '..', 'public', 'manifest.webmanifest'), 'utf8'),
  ) as {
    theme_color: string;
    background_color: string;
  };
  // The manifest is read once, at install time, and belongs to no session, so
  // it stays pinned to the default theme's chrome — which is the till colour.
  const defaultId = /DEFAULT_THEME_ID: ThemeId = '([a-z-]+)'/.exec(catalogue)?.[1];
  assert.equal(defaultId, 'classic-light', 'the default theme should be the scheme we shipped');
  const defaultEntry = new RegExp(`id: '${defaultId}',[\\s\\S]*?chrome: '(#[0-9a-fA-F]{6})'`).exec(
    catalogue,
  );
  const themeColor = defaultEntry?.[1];
  assert.ok(themeColor, 'the catalogue must give the default theme a chrome hex');
  assert.equal(
    manifest.theme_color.toLowerCase(),
    themeColor.toLowerCase(),
    "manifest theme_color must match the default theme's chrome",
  );
  assert.equal(
    manifest.background_color.toLowerCase(),
    themeColor.toLowerCase(),
    "manifest background_color must match the default theme's chrome",
  );

  // The token is oklch in globals.css; the PWA literal is its sRGB form, which
  // Tailwind rounds to within 1/255 per channel. Compare on that basis.
  const till = /--color-till:\s*oklch\(([0-9.]+)%\s+([0-9.]+)\s+([0-9.]+)\)/.exec(globalsCss);
  if (!till) throw new Error('--color-till must be an oklch literal');
  const L = Number(till[1]) / 100;
  const C = Number(till[2]);
  const H = Number(till[3]);
  const rgb = oklchToSrgb(L, C, H);
  const hex = rgbToHex(rgb);
  const [ar, ag, ab] = hexToInt(hex);
  const [br, bg, bb] = hexToInt(themeColor);
  [Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb)].forEach((diff, channel) => {
    assert.ok(
      diff <= 1,
      `--color-till (${hex}) and the chrome colour (${themeColor}) differ by more than 1/255 in channel ${channel}`,
    );
  });
});

// --- tiny colour helpers ---------------------------------------------------

function hexToInt(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const to = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function oklchToSrgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const toSrgb = (x: number) =>
    Math.round(
      Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)) * 255,
    );
  return [toSrgb(lin[0] ?? 0), toSrgb(lin[1] ?? 0), toSrgb(lin[2] ?? 0)];
}
