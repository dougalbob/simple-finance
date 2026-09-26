/**
 * Turn a five-stop seed palette into a complete set of `--color-*` tokens
 * (decision 160). Build-time only.
 *
 * The rule the whole file follows: **a theme changes the colours, never the
 * relationships.** Every lightness step here is the step the Classic scheme
 * already used — read out of the base `@theme` block and re-applied in the
 * theme's own hues — so a caption is as quiet as it has always been, a table
 * rule as faint, a warning chip as loud. What the palette supplies is where
 * that ladder starts and finishes, and which hue it leans on.
 *
 * Two things are deliberately *not* free:
 *
 * 1. **Semantic hues are fixed.** Red is danger in every theme, green is
 *    money in, amber is "worth a look" (SPEC §16.7 — colour is never the only
 *    signal, but when it does speak it must say the same thing everywhere).
 *    A theme re-lights those families for its mode; it never re-hues them.
 * 2. **Contrast is arithmetic, not luck.** After derivation every pairing the
 *    app actually renders is checked against `CONTRAST_RULES` and the
 *    foreground is nudged until it passes. The floors are the Classic
 *    scheme's own measured ratios, so no theme can be less legible than the
 *    one the household already reads.
 */

import { clamp, contrast, ensureContrast, fit, fromHex, mix, toHex, type Oklch } from './colour';
import type { SeedPalette } from './palettes';

export type ThemeMode = 'light' | 'dark';

export interface DerivedTheme {
  /** `<palette>-<mode>`, e.g. `harbour-dark`. The cookie and `data-theme` value. */
  id: string;
  paletteId: string;
  label: string;
  blurb: string;
  mode: ThemeMode;
  /** Token name (without `--color-`) → CSS value. */
  tokens: Record<string, string>;
  /** The PWA/browser chrome colour for this theme (read before any CSS). */
  chrome: string;
}

/* -------------------------------------------------------------------------
 * The ladder, measured off the Classic scheme
 * ---------------------------------------------------------------------- */

/**
 * Where each ink sits between the darkest ink (0) and white (1) in Classic:
 * slate-800 is 9% of the way up from slate-900, slate-500 is 44%, and so on.
 * Reused verbatim by every light theme.
 */
const INK_STEPS: Record<string, number> = {
  'ink-emphasis': 0.0896,
  'ink-body': 0.2071,
  'ink-soft': 0.3005,
  'ink-muted': 0.4369,
  'ink-faint': 0.6263,
};

/** How far below the card surface each light-theme line and fill sits. */
const SURFACE_DROPS: Record<string, number> = {
  'surface-muted': 0.032,
  'surface-sunk': 0.071,
  'border-hairline': 0.032,
  border: 0.071,
  'border-strong': 0.131,
  'ink-ghost': 0.131,
};

/** Lightness targets for a dark theme, as offsets from the page colour. */
const DARK_LIFTS: Record<string, number> = {
  surface: 0.045,
  'surface-muted': 0.08,
  'surface-sunk': 0.12,
  'border-hairline': 0.07,
  border: 0.12,
  'border-strong': 0.19,
  'border-emphasis': 0.38,
};

/** How far below the brightest ink each dimmer ink sits in a dark theme. */
const DARK_INK_DROPS: Record<string, number> = {
  'ink-emphasis': 0.04,
  'ink-body': 0.09,
  'ink-soft': 0.14,
  'ink-muted': 0.21,
  'ink-faint': 0.29,
  'ink-ghost': 0.34,
};

/**
 * The chromatic families, by **role rather than by number**.
 *
 * A dark theme cannot simply invert the ramp: `accent-300` is the eyebrow
 * text *on the till* (already a dark panel today), while `accent-100` is a
 * chip background on a white card. Flipping by lightness would turn the
 * eyebrow into a shadow. So each numbered shade declares what it is for, and
 * the dark builder gives each role a lightness that works on a dark page.
 */
type ShadeRole = 'tint' | 'tint-strong' | 'line' | 'marker' | 'fill' | 'text' | 'text-strong';

const DARK_ROLE_LIGHTNESS: Record<ShadeRole, number> = {
  tint: 0.255, // a panel wash: bg-*-50
  'tint-strong': 0.3, // a chip: bg-*-100
  line: 0.42, // border-*-200 / ring-*-200
  marker: 0.66, // a dot or a bar the eye must find
  fill: 0.62, // a solid fill that carries dark ink
  text: 0.78, // body-weight coloured text on a dark card
  'text-strong': 0.86, // the loudest coloured text, on its own tint
};

const DARK_ROLE_CHROMA: Record<ShadeRole, number> = {
  tint: 0.05,
  'tint-strong': 0.065,
  line: 0.085,
  marker: 0.16,
  fill: 0.15,
  text: 0.14,
  'text-strong': 0.1,
};

/** Every numbered shade in the base block, with the job it does in the app. */
const SHADE_ROLES: Record<string, ShadeRole> = {
  'accent-50': 'tint',
  'accent-100': 'tint-strong',
  'accent-200': 'line',
  'accent-300': 'text', // text-accent-300 and the active dot, both on the till
  'accent-400': 'marker', // ring-accent-400
  'accent-500': 'marker', // focus rings and active borders
  'accent-600': 'fill', // the overview progress bar
  accent: 'text', // text-accent — links, "you are here"
  'accent-800': 'text-strong',
  'accent-900': 'text-strong', // on an accent-50/100 chip
  'positive-50': 'tint',
  'positive-100': 'tint-strong',
  'positive-200': 'line',
  'positive-500': 'marker',
  positive: 'text',
  'positive-800': 'text-strong',
  'positive-900': 'text-strong',
  'warning-50': 'tint',
  'warning-100': 'tint-strong',
  'warning-200': 'line',
  'warning-300': 'line',
  'warning-600': 'marker',
  'warning-700': 'text',
  warning: 'text',
  'warning-900': 'text-strong',
  'warning-950': 'text-strong',
  'danger-50': 'tint',
  'danger-200': 'line',
  'danger-300': 'line',
  danger: 'fill', // text-danger *and* the hovered void button's fill
  'danger-800': 'fill', // the restore button's fill
  'negative-50': 'tint',
  'negative-200': 'line',
  negative: 'text',
  'negative-900': 'text-strong',
  'note-200': 'line',
  note: 'fill', // the "log interaction" button
};

/**
 * Pairings the app actually renders, and the ratio each must clear.
 *
 * Floors are Classic's own measured ratios rounded down, never an aspiration:
 * `ink-faint` on white is 2.63:1 today, so 2.6 is the bar — a generated theme
 * may not be worse than what the household reads now, and the ones that can
 * be better (most text) are held to WCAG AA's 4.5.
 */
export interface ContrastRule {
  fg: string;
  bg: string;
  min: number;
  why: string;
}

export const CONTRAST_RULES: ContrastRule[] = [
  { fg: 'ink', bg: 'surface', min: 7, why: 'headings and key figures on a card' },
  { fg: 'ink', bg: 'canvas', min: 7, why: 'headings on the page itself' },
  { fg: 'ink-emphasis', bg: 'surface', min: 7, why: 'emphasised labels and values' },
  { fg: 'ink-body', bg: 'surface', min: 6, why: 'labels and copy that must read clearly' },
  { fg: 'ink-soft', bg: 'surface', min: 4.8, why: 'body copy' },
  { fg: 'ink-soft', bg: 'canvas', min: 4.8, why: 'body copy straight on the page' },
  { fg: 'ink-muted', bg: 'surface', min: 4.5, why: 'captions, hints, table headers' },
  { fg: 'ink-muted', bg: 'canvas', min: 4.4, why: 'captions on the page' },
  { fg: 'ink-muted', bg: 'surface-muted', min: 4.2, why: 'a table header on its grey strip' },
  { fg: 'ink-faint', bg: 'surface', min: 2.6, why: 'placeholders and footnotes (Classic: 2.63)' },
  { fg: 'ink-faint', bg: 'canvas', min: 2.5, why: 'footnotes on the page (Classic: 2.51)' },
  { fg: 'ink-ghost', bg: 'till', min: 4.5, why: 'the helper copy inside the till' },
  { fg: 'ink-ghost', bg: 'till-inset', min: 4.5, why: 'an inactive till tab' },
  { fg: 'till-ink', bg: 'till', min: 7, why: 'everything written on the till' },
  { fg: 'till-ink', bg: 'till-inset', min: 6, why: 'the till tab strip' },
  { fg: 'till-ink', bg: 'till-hover', min: 4.5, why: 'a hovered primary button' },
  { fg: 'accent', bg: 'surface', min: 4.5, why: 'links on a card' },
  { fg: 'accent', bg: 'canvas', min: 4.5, why: 'links on the page' },
  { fg: 'accent', bg: 'surface-muted', min: 4.5, why: 'links inside a grey strip' },
  { fg: 'accent', bg: 'accent-50', min: 4.5, why: 'a link inside its own tinted panel' },
  { fg: 'accent-900', bg: 'accent-50', min: 4.5, why: 'the loudest text on an accent panel' },
  { fg: 'accent-900', bg: 'accent-100', min: 4.5, why: 'a selected chip in the till' },
  { fg: 'accent-800', bg: 'surface', min: 4.5, why: 'emphasised accent text' },
  { fg: 'accent-300', bg: 'till', min: 4.5, why: 'the till eyebrow label' },
  { fg: 'accent-500', bg: 'surface', min: 2.4, why: 'a focus ring must be visible' },
  { fg: 'positive', bg: 'surface', min: 4.5, why: 'money in' },
  { fg: 'positive', bg: 'canvas', min: 4.5, why: 'money in, on the page' },
  { fg: 'positive-800', bg: 'positive-50', min: 4.5, why: 'a healthy-pot panel' },
  { fg: 'positive-800', bg: 'positive-100', min: 4.5, why: 'the balanced chip in the till' },
  { fg: 'positive-900', bg: 'positive-50', min: 4.5, why: 'the loudest positive text' },
  { fg: 'positive-500', bg: 'surface', min: 2.4, why: 'the receipt dot in the calendar' },
  { fg: 'warning', bg: 'surface', min: 4.5, why: 'tier-1 warning text' },
  { fg: 'warning', bg: 'warning-50', min: 4.5, why: 'a warning badge' },
  { fg: 'warning', bg: 'warning-100', min: 4.5, why: 'the unbalanced chip in the till' },
  { fg: 'warning-700', bg: 'surface', min: 4.5, why: 'warning text on a card' },
  { fg: 'warning-600', bg: 'surface', min: 3.1, why: 'a warning marker (Classic: 3.19)' },
  { fg: 'warning-900', bg: 'warning-50', min: 4.5, why: 'the loudest warning text' },
  { fg: 'warning-900', bg: 'warning-100', min: 4.5, why: 'a warning strip' },
  { fg: 'warning-950', bg: 'warning-100', min: 4.5, why: 'the darkest warning text' },
  { fg: 'danger', bg: 'surface', min: 4.5, why: 'overdrawn, destructive, tier-2' },
  { fg: 'danger', bg: 'canvas', min: 4.5, why: 'danger text on the page' },
  { fg: 'danger', bg: 'danger-50', min: 4.5, why: 'a danger row' },
  { fg: 'danger-800', bg: 'danger-50', min: 4.5, why: 'the danger panel heading' },
  { fg: 'fill-ink', bg: 'danger', min: 4.5, why: 'the hovered void button' },
  { fg: 'fill-ink', bg: 'danger-800', min: 4.5, why: 'the restore button' },
  { fg: 'fill-ink', bg: 'note', min: 4.5, why: 'the log-interaction button' },
  { fg: 'negative', bg: 'surface', min: 4.5, why: 'a below-zero figure' },
  { fg: 'negative', bg: 'canvas', min: 4.5, why: 'a below-zero figure on the page' },
  { fg: 'negative-900', bg: 'negative-50', min: 4.5, why: 'the below-zero panel' },
  { fg: 'chart-text', bg: 'surface', min: 4.5, why: 'axis labels' },
  { fg: 'chart-1', bg: 'surface', min: 3, why: 'the balance line' },
  { fg: 'chart-2', bg: 'surface', min: 3, why: 'the configured-figure reference' },
  { fg: 'chart-3', bg: 'surface', min: 3, why: 'stacked series 3' },
  { fg: 'chart-4', bg: 'surface', min: 3, why: 'stacked series 4' },
  { fg: 'chart-5', bg: 'surface', min: 3, why: 'the trailing average' },
  { fg: 'chart-bar', bg: 'surface', min: 3, why: 'a bar (Classic: 4.10)' },
  { fg: 'chart-danger', bg: 'surface', min: 3, why: 'the lowest point and the overdraft line' },
  { fg: 'chart-axis', bg: 'surface', min: 2.4, why: 'the rule on zero (Classic: 2.56)' },
  { fg: 'chart-text', bg: 'chart-halo', min: 4.5, why: 'a haloed label over a bar' },
];

/** Lines and washes that must simply be *visible* — not text, so not AA. */
export const SEPARATION_RULES: ContrastRule[] = [
  { fg: 'canvas', bg: 'surface', min: 1.03, why: 'a card must lift off the page' },
  { fg: 'surface-muted', bg: 'surface', min: 1.04, why: 'a grey strip inside a card' },
  { fg: 'surface-sunk', bg: 'surface', min: 1.1, why: 'a stronger hover fill' },
  { fg: 'border-hairline', bg: 'surface', min: 1.06, why: 'a row rule' },
  { fg: 'border', bg: 'surface', min: 1.15, why: 'a card edge' },
  { fg: 'border', bg: 'canvas', min: 1.12, why: 'a card edge against the page' },
  { fg: 'border-strong', bg: 'surface', min: 1.35, why: 'an input edge' },
  { fg: 'chart-grid', bg: 'surface', min: 1.15, why: 'a gridline' },
  { fg: 'till-inset', bg: 'till', min: 1.1, why: 'the tab strip inside the till' },
  { fg: 'till-muted', bg: 'till', min: 1.3, why: 'an unselected dot on the till' },
  { fg: 'marker-muted', bg: 'surface', min: 2.4, why: 'a legend dot, and the chart axis' },
  { fg: 'marker-muted', bg: 'border-emphasis', min: 1.35, why: 'a dot against a focused edge' },
  // A tinted panel has to be a panel. Classic's washes sit 3–12% off white
  // and are read against the *card*, not the page (on the page some of them
  // are lighter than the canvas and are told apart by hue and a border) — so
  // the floor is against the surface, at Classic's own thinnest margin.
  { fg: 'accent-50', bg: 'surface', min: 1.03, why: 'an accent panel on a card' },
  { fg: 'accent-100', bg: 'surface', min: 1.075, why: 'a selected chip' },
  { fg: 'accent-100', bg: 'accent-50', min: 1.035, why: 'a chip on an accent panel' },
  { fg: 'accent-200', bg: 'surface', min: 1.15, why: 'the hatched in-progress bar' },
  { fg: 'accent-600', bg: 'surface', min: 3, why: 'the progress bar and every chart bar' },
  { fg: 'positive-50', bg: 'surface', min: 1.03, why: 'a healthy-pot panel' },
  { fg: 'positive-100', bg: 'surface', min: 1.075, why: 'the balanced chip' },
  { fg: 'positive-100', bg: 'positive-50', min: 1.035, why: 'a chip on a positive panel' },
  { fg: 'warning-50', bg: 'surface', min: 1.03, why: 'a warning panel' },
  { fg: 'warning-100', bg: 'surface', min: 1.075, why: 'a warning chip' },
  { fg: 'warning-100', bg: 'warning-50', min: 1.035, why: 'a chip on a warning panel' },
  { fg: 'danger-50', bg: 'surface', min: 1.03, why: 'a danger row' },
  { fg: 'negative-50', bg: 'surface', min: 1.03, why: 'a below-zero panel' },
];

/* -------------------------------------------------------------------------
 * Palette roles
 * ---------------------------------------------------------------------- */

export interface PaletteRoles {
  /** The darkest neutral stop: ink, and the till in a light theme. */
  ink: Oklch;
  /** The second-darkest: the till's inset in a light theme, its panel in a dark one. */
  deep: Oklch;
  /** The light stop: input edges and rules. */
  line: Oklch;
  /** The lightest stop: the page in a light theme, the brightest ink in a dark one. */
  page: Oklch;
  /** The most chromatic stop: links, focus, "here is where you are". */
  accent: Oklch;
}

/**
 * Read roles out of a row. The accent is the most chromatic stop (in every
 * row the household supplied that is the middle one, but measuring it means a
 * future row need not be ordered that way); the rest sort by lightness.
 */
export function paletteRoles(stops: readonly string[]): PaletteRoles {
  const colours = stops.map(fromHex);
  let accentIndex = 0;
  for (let i = 1; i < colours.length; i += 1) {
    const candidate = colours[i];
    const best = colours[accentIndex];
    if (candidate !== undefined && best !== undefined && candidate.c > best.c) accentIndex = i;
  }
  const accent = colours[accentIndex];
  const neutrals = colours.filter((_, i) => i !== accentIndex).sort((a, b) => a.l - b.l);
  const [ink, deep, line, page] = neutrals;
  if (!accent || !ink || !deep || !line || !page) throw new Error('a palette needs five stops');
  return { ink, deep, line, page, accent };
}

/* -------------------------------------------------------------------------
 * Derivation
 * ---------------------------------------------------------------------- */

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function hueMix(a: Oklch, b: Oklch, t: number): number {
  return mix({ ...a, l: 0.5, c: 0.1 }, { ...b, l: 0.5, c: 0.1 }, t).h;
}

interface Build {
  tokens: Map<string, Oklch>;
  /** Values that are expressions rather than colours (the two chart tints). */
  literals: Map<string, string>;
}

function lightBuild(roles: PaletteRoles, base: Map<string, Oklch>): Build {
  const tokens = new Map<string, Oklch>();
  const inkL = roles.ink.l;
  const surfaceL = clamp(roles.page.l + 0.016, 0.972, 0.996);
  const canvasL = clamp(roles.page.l, surfaceL - 0.034, surfaceL - 0.012);

  /** A neutral at lightness `l`, tinted the way this palette tints neutrals. */
  const neutral = (l: number): Oklch => {
    const t = clamp((l - inkL) / Math.max(0.0001, 1 - inkL), 0, 1);
    return {
      l,
      c: clamp(lerp(Math.min(roles.ink.c, 0.05), Math.min(roles.page.c, 0.012), t), 0.0015, 0.05),
      h: hueMix(roles.ink, roles.page, t),
    };
  };
  const ramp = (f: number): number => inkL + f * (1 - inkL);

  tokens.set('canvas', { l: canvasL, c: Math.min(roles.page.c, 0.02), h: roles.page.h });
  tokens.set('surface', { l: surfaceL, c: Math.min(roles.page.c, 0.012), h: roles.page.h });
  for (const [name, drop] of Object.entries(SURFACE_DROPS))
    tokens.set(name, neutral(surfaceL - drop));
  // The palette's own light stop takes the input edge when it is close to the
  // step the ladder wants — so the household sees the colour they picked.
  const wantedStrong = surfaceL - (SURFACE_DROPS['border-strong'] ?? 0.131);
  if (Math.abs(roles.line.l - wantedStrong) < 0.05) {
    tokens.set('border-strong', { ...roles.line, c: Math.min(roles.line.c, 0.05) });
  }
  tokens.set('border-emphasis', neutral(ramp(INK_STEPS['ink-muted'] ?? 0.4369)));
  tokens.set('marker-muted', neutral(ramp(INK_STEPS['ink-faint'] ?? 0.6263)));

  tokens.set('ink', roles.ink);
  for (const [name, f] of Object.entries(INK_STEPS)) tokens.set(name, neutral(ramp(f)));

  // The till: the palette's two darkest stops, exactly as supplied.
  const deepTone = (l: number): Oklch => ({
    l,
    c: Math.min(roles.deep.c, 0.06),
    h: roles.deep.h,
  });
  tokens.set('till', roles.ink);
  tokens.set('till-ink', { l: 1, c: 0, h: 0 });
  tokens.set('fill-ink', { l: 1, c: 0, h: 0 });
  // The till's tab strip is the palette's second stop — but white has to read
  // on it, so its lightness is capped where a light stop would have washed out
  // the label (Jade and Lagoon both supply a mid-teal here).
  const insetL = clamp(roles.deep.l, roles.ink.l + 0.05, 0.44);
  tokens.set('till-inset', { l: insetL, c: Math.min(roles.deep.c, 0.07), h: roles.deep.h });
  tokens.set(
    'till-hover',
    deepTone(Math.max(ramp(INK_STEPS['ink-body'] ?? 0.2071), insetL + 0.05)),
  );
  tokens.set(
    'till-muted',
    deepTone(Math.max(ramp(INK_STEPS['ink-soft'] ?? 0.3005), insetL + 0.11)),
  );

  // Accent: the palette's chromatic stop, on Classic's sky ladder.
  const accentScale = clamp(roles.accent.c / 0.169, 0.5, 1.2);
  for (const [name, role] of Object.entries(SHADE_ROLES)) {
    if (!name.startsWith('accent')) continue;
    const classic = base.get(name);
    if (classic === undefined) continue;
    void role;
    tokens.set(name, {
      l: classic.l,
      c: clamp(classic.c * accentScale, 0.004, roles.accent.c * 1.5),
      h: roles.accent.h,
    });
  }

  // Semantic families keep Classic's colours; only their washes are warmed
  // towards the page so a tint does not sit on the paper like a sticker.
  const page = tokens.get('surface') ?? roles.page;
  for (const [name, role] of Object.entries(SHADE_ROLES)) {
    if (name.startsWith('accent')) continue;
    const classic = base.get(name);
    if (classic === undefined) continue;
    tokens.set(
      name,
      role === 'tint' || role === 'tint-strong'
        ? mix(classic, { ...page, c: classic.c * 0.35 }, 0.25)
        : classic,
    );
  }

  chartTokens(tokens, base, 'light');
  return { tokens, literals: chartTints('light') };
}

function darkBuild(roles: PaletteRoles, base: Map<string, Oklch>): Build {
  const tokens = new Map<string, Oklch>();
  const canvasL = clamp(roles.ink.l * 0.8, 0.09, 0.22);
  const inkL = clamp(roles.page.l, 0.9, 0.97);

  const neutral = (l: number): Oklch => {
    const t = clamp((l - canvasL) / Math.max(0.0001, inkL - canvasL), 0, 1);
    return {
      l,
      c: clamp(lerp(Math.min(roles.ink.c, 0.045), Math.min(roles.page.c, 0.01), t), 0.0015, 0.045),
      h: hueMix(roles.ink, roles.page, t),
    };
  };

  tokens.set('canvas', { l: canvasL, c: Math.min(roles.ink.c, 0.045), h: roles.ink.h });
  for (const [name, lift] of Object.entries(DARK_LIFTS)) tokens.set(name, neutral(canvasL + lift));
  tokens.set('marker-muted', neutral(0.58));

  tokens.set('ink', { l: inkL, c: Math.min(roles.page.c, 0.012), h: roles.page.h });
  for (const [name, drop] of Object.entries(DARK_INK_DROPS)) tokens.set(name, neutral(inkL - drop));

  // The till stays the dark one. On a dark theme everything is dark, so its
  // identity comes from sitting *below* the cards rather than above them: the
  // page lifts to a card, the card lifts to a chip, and the till is the floor
  // — which is also what gives the ink ramp on it room to have a hierarchy at
  // all (helper copy on a light till has to be nearly white to be legible,
  // and then nothing quieter than it is left).
  const tillL = clamp(roles.deep.l * 0.45, canvasL - 0.02, canvasL + 0.04);
  const deepTone = (l: number): Oklch => ({ l, c: Math.min(roles.deep.c, 0.07), h: roles.deep.h });
  tokens.set('till', deepTone(tillL));
  tokens.set('till-inset', deepTone(tillL + 0.05));
  tokens.set('till-hover', deepTone(tillL + 0.1));
  tokens.set('till-muted', deepTone(tillL + 0.17));
  tokens.set('till-ink', { l: 0.975, c: Math.min(roles.page.c * 0.5, 0.008), h: roles.page.h });
  // The ink that sits on a *saturated* fill. Light themes paint those fills
  // dark and write on them in white; a dark theme has to paint them bright,
  // so the writing goes almost black. One token, decided here, is why no page
  // needed editing for that flip (decision 160).
  tokens.set('fill-ink', { l: 0.17, c: 0.012, h: roles.ink.h });

  for (const [name, role] of Object.entries(SHADE_ROLES)) {
    const classic = base.get(name);
    if (classic === undefined) continue;
    const isAccent = name.startsWith('accent');
    const hue = isAccent ? roles.accent.h : classic.h;
    const chroma = clamp(
      familyChroma(name, base, roles) * chromaScaleFor(role),
      0.012,
      DARK_ROLE_CHROMA[role],
    );
    // Keep shades Classic separates separated (decision 159): the dark ramp is
    // roles rather than numbers, so two shades of one family sharing a role
    // are spread either side of it, in their numbered order.
    const lightness = DARK_ROLE_LIGHTNESS[role] + roleSpread(name);
    tokens.set(name, { l: lightness, c: chroma, h: hue });
  }

  chartTokens(tokens, base, 'dark');
  return { tokens, literals: chartTints('dark') };
}

/** The numeric shade of a token (`accent-300` → 300; the bare name → 700). */
function shadeNumber(name: string): number {
  const shade = /-(\d{2,3})$/.exec(name)?.[1];
  return shade === undefined ? 700 : Number(shade);
}

const SPREAD_STEP = 0.03;

/**
 * Where a shade sits inside its role. `warning-900` and `warning-950` are
 * both "the loudest warning text", so they share a target lightness — this
 * pushes them either side of it, in number order, far enough apart to be two
 * colours rather than one.
 */
function roleSpread(name: string): number {
  const family = name.replace(/-\d{2,3}$/, '');
  const role = SHADE_ROLES[name];
  const siblings = Object.keys(SHADE_ROLES)
    .filter((other) => other.replace(/-\d{2,3}$/, '') === family && SHADE_ROLES[other] === role)
    .sort((a, b) => shadeNumber(a) - shadeNumber(b));
  const index = siblings.indexOf(name);
  if (index === -1 || siblings.length < 2) return 0;
  return (index - (siblings.length - 1) / 2) * SPREAD_STEP;
}

/**
 * Keep a ladder a ladder. Contrast enforcement only ever pushes a foreground
 * away from its background, so on a dark page a dim ink can be lifted into
 * its brighter neighbour. Walk the ladder from the quiet end and push the
 * louder rungs further out — always in the direction that adds contrast, so
 * nothing already fixed can come loose.
 */
function separateLadder(
  tokens: Map<string, Oklch>,
  ladder: readonly string[],
  mode: ThemeMode,
): void {
  const minimum = 0.022;
  const direction = mode === 'light' ? -1 : 1; // louder = darker on light, brighter on dark
  for (let i = ladder.length - 1; i > 0; i -= 1) {
    const quiet = tokens.get(ladder[i] ?? '');
    const louder = tokens.get(ladder[i - 1] ?? '');
    if (!quiet || !louder) continue;
    const gap = (louder.l - quiet.l) * direction;
    if (gap >= minimum) continue;
    tokens.set(ladder[i - 1] ?? '', { ...louder, l: clamp(quiet.l + direction * minimum, 0, 1) });
  }
}

/**
 * The loud end of each chromatic family, loudest first. Only the text shades:
 * the rest of a dark ramp is ordered by role, not by number (`accent-300` is
 * the till's eyebrow, brighter than the `accent-600` bar beneath it), so
 * forcing the whole ramp to march in numeric order would undo that.
 */
const FAMILY_LADDERS: ReadonlyArray<readonly string[]> = [
  ['accent-900', 'accent-800', 'accent'],
  ['positive-900', 'positive-800', 'positive'],
  ['warning-950', 'warning-900', 'warning', 'warning-700'],
  ['danger-800', 'danger'],
  ['negative-900', 'negative'],
];

const INK_LADDER = [
  'ink',
  'ink-emphasis',
  'ink-body',
  'ink-soft',
  'ink-muted',
  'ink-faint',
  'ink-ghost',
] as const;

function chromaScaleFor(role: ShadeRole): number {
  switch (role) {
    case 'tint':
      return 0.25;
    case 'tint-strong':
      return 0.32;
    case 'line':
      return 0.45;
    case 'marker':
      return 0.9;
    case 'fill':
      return 0.85;
    case 'text':
      return 0.72;
    case 'text-strong':
      return 0.5;
  }
}

/**
 * How colourful a family is allowed to be on a dark page, taken from the
 * family's own primary shade rather than from the shade being derived:
 * Classic's `danger-50` is a whisper of pink because it is a wash on white,
 * and scaling *that* would give a dark theme a grey wash where a dark red one
 * belongs — indistinguishable from `negative-50` a few degrees away.
 */
function familyChroma(name: string, base: Map<string, Oklch>, roles: PaletteRoles): number {
  if (name.startsWith('accent')) return roles.accent.c;
  const family = name.replace(/-\d{2,3}$/, '');
  return base.get(family)?.c ?? 0.12;
}

/**
 * Charts (SPEC §16.7). The furniture follows the theme's own surfaces so a
 * gridline is as quiet as a table rule; the five series keep Classic's hue
 * separation — that is what makes them tellable apart — but are re-lit for
 * the mode, and series 1 takes the theme's accent so a chart looks like the
 * page it sits on.
 */
function chartTokens(tokens: Map<string, Oklch>, base: Map<string, Oklch>, mode: ThemeMode): void {
  const accent = tokens.get('accent');
  const surface = tokens.get('surface');
  if (!accent || !surface) throw new Error('chart tokens need the accent and the surface first');
  const relight = (name: string, dark: number, chroma: number): Oklch => {
    const classic = base.get(name);
    if (classic === undefined) throw new Error(`missing base chart token ${name}`);
    return mode === 'light'
      ? classic
      : { l: dark, c: Math.min(classic.c * 1.05, chroma), h: classic.h };
  };
  tokens.set('chart-2', relight('chart-2', 0.76, 0.13));
  tokens.set('chart-3', relight('chart-3', 0.74, 0.05));
  tokens.set('chart-4', relight('chart-4', 0.74, 0.16));
  tokens.set('chart-5', relight('chart-5', 0.76, 0.12));
  void accent;
  void surface;
  aliasChartTokens(tokens);
}

/** Chart furniture that is simply another name for a page token. */
const CHART_ALIASES: Record<string, string> = {
  'chart-1': 'accent',
  'chart-bar': 'accent-600',
  'chart-bar-muted': 'accent-200',
  'chart-danger': 'danger',
  'chart-grid': 'border',
  'chart-axis': 'marker-muted',
  'chart-text': 'ink-soft',
  'chart-halo': 'surface',
};

function aliasChartTokens(tokens: Map<string, Oklch>): void {
  for (const [name, source] of Object.entries(CHART_ALIASES)) {
    const value = tokens.get(source);
    if (value !== undefined) tokens.set(name, value);
  }
}

/**
 * The two tints stay expressions, not colours: mixed from their own token so
 * a theme that moves the line moves its fill with it (decision 159). A dark
 * page needs a heavier mix to show the same amount of tint.
 */
function chartTints(mode: ThemeMode): Map<string, string> {
  const line = mode === 'light' ? 14 : 22;
  const danger = mode === 'light' ? 8 : 16;
  return new Map([
    ['chart-line-fill', `color-mix(in srgb, var(--color-chart-1) ${line}%, transparent)`],
    ['chart-danger-tint', `color-mix(in srgb, var(--color-chart-danger) ${danger}%, transparent)`],
  ]);
}

/* -------------------------------------------------------------------------
 * Legibility pass
 * ---------------------------------------------------------------------- */

/**
 * Aim a little past every floor. The generated stylesheet carries six-digit
 * hex, so a value that clears 4.50 in OKLCH can land on 4.49 once it is
 * rounded to the nearest 1/255 — and a rule that is only true before
 * rounding is not true.
 */
const MARGIN = 1.02;

function enforce(tokens: Map<string, Oklch>, mode: ThemeMode): void {
  // Several passes: a foreground fixed against one background may still be
  // short against another (a link is read on three different surfaces), and a
  // background nudged apart from its neighbour moves every text rule with it.
  for (let pass = 0; pass < 4; pass += 1) {
    separateLadder(tokens, INK_LADDER, mode);
    for (const ladder of FAMILY_LADDERS) separateLadder(tokens, ladder, mode);
    for (const rule of [...CONTRAST_RULES, ...SEPARATION_RULES]) {
      const fg = tokens.get(rule.fg);
      const bg = tokens.get(rule.bg);
      if (!fg || !bg) throw new Error(`a rule names an unknown token: ${rule.fg}/${rule.bg}`);
      const target = rule.min * MARGIN;
      if (contrast(fit(fg), fit(bg)) >= target) continue;
      tokens.set(rule.fg, ensureContrast(fg, bg, target));
    }
  }
}

/* -------------------------------------------------------------------------
 * Public entry point
 * ---------------------------------------------------------------------- */

export function themeId(paletteId: string, mode: ThemeMode): string {
  return `${paletteId}-${mode}`;
}

export function deriveTheme(
  palette: SeedPalette,
  mode: ThemeMode,
  base: Map<string, Oklch>,
  order: readonly string[],
): DerivedTheme {
  const roles = paletteRoles(palette.stops);
  const build = mode === 'light' ? lightBuild(roles, base) : darkBuild(roles, base);
  enforce(build.tokens, mode);
  // The chart furniture *is* the page furniture: re-point it after the
  // legibility pass so a gridline that moved with the table rules moves with
  // them here too, instead of keeping the value it had before the nudge.
  aliasChartTokens(build.tokens);

  const tokens: Record<string, string> = {};
  for (const name of order) {
    const literal = build.literals.get(name);
    if (literal !== undefined) {
      tokens[name] = literal;
      continue;
    }
    const colour = build.tokens.get(name);
    if (colour === undefined) throw new Error(`theme ${palette.id}-${mode} is missing ${name}`);
    tokens[name] = toHex(colour);
  }

  // The browser chrome is read before any stylesheet exists, so it cannot be
  // a variable: a light theme hands it the till (the app's dark furniture),
  // a dark theme hands it the page itself.
  const chromeToken = mode === 'light' ? 'till' : 'canvas';
  const chrome = tokens[chromeToken];
  if (chrome === undefined) throw new Error(`theme ${palette.id}-${mode} has no ${chromeToken}`);

  return {
    id: themeId(palette.id, mode),
    paletteId: palette.id,
    label: palette.label,
    blurb: palette.blurb,
    mode,
    tokens,
    chrome,
  };
}
