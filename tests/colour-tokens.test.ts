import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The colour grep-gate (decision 159, Phase 1).
 *
 * The whole colour scheme lives in one `@theme` block in
 * `src/app/globals.css`; every page and the chart kit reach for it by token
 * name. These tests keep it that way:
 *
 *  1. No raw Tailwind palette utility class (a slate-500 or red-700 utility)
 *     anywhere under `src` — pages may not re-introduce app-wide colour.
 *  2. No colour literal (hex / rgb / hsl) in the TypeScript under `src`
 *     outside the one documented exception: the PWA/theme `themeColor` in
 *     `layout.tsx`, which the browser reads before any stylesheet exists.
 *  3. Every `var(--color-…)` the code references is actually defined in
 *     globals.css, so a typo'd token cannot ship silently.
 *  4. The semantic token names a theme (Phase 2) will redefine all exist, so
 *     a theme is a one-block change.
 *  5. The three PWA literals agree with each other and with the `--color-till`
 *     token (±1/255 per channel, the Tailwind oklch→sRGB rounding).
 *
 * The gate only scans `src/`. The chart kit's palette is the token block; its
 * `CHART_COLOURS` map holds `var(--color-chart-…)` strings, which the chart
 * components apply through inline `style` so the custom property resolves in a
 * declaration (presentation-attribute support is not universal).
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

// The single place a colour literal may remain in TS: the PWA theme colour.
const HEX_ALLOWLIST_TS = new Set([path.join('src', 'app', 'layout.tsx')]);

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
  const layout = read(path.join(SRC, 'app', 'layout.tsx'));
  const manifest = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '..', 'public', 'manifest.webmanifest'), 'utf8'),
  ) as {
    theme_color: string;
    background_color: string;
  };
  const themeColor = /themeColor: '(#[0-9a-fA-F]{6})'/.exec(layout)?.[1];
  assert.ok(themeColor, 'layout.tsx must declare a themeColor hex');
  assert.equal(
    manifest.theme_color.toLowerCase(),
    themeColor.toLowerCase(),
    'manifest theme_color must match layout themeColor',
  );
  assert.equal(
    manifest.background_color.toLowerCase(),
    themeColor.toLowerCase(),
    'manifest background_color must match layout themeColor',
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
      `--color-till (${hex}) and themeColor (${themeColor}) differ by more than 1/255 in channel ${channel}`,
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
