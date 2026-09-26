/*
 * GENERATED FILE — do not edit by hand.
 * Run `npm run themes:build` after changing scripts/themes/*.
 *
 * The themes the Settings gallery offers (decision 160). Data only: an id, a
 * name, and the one colour that cannot be a CSS variable — `chrome`, the PWA
 * theme colour, which the browser reads before any stylesheet exists (SPEC
 * §14, §15.4). Every other colour in this app lives in CSS, and
 * `tests/colour-tokens.test.ts` keeps it that way.
 */

export type ThemeId =
  | 'classic-light'
  | 'classic-dark'
  | 'harbour-light'
  | 'harbour-dark'
  | 'fernwood-light'
  | 'fernwood-dark'
  | 'copper-light'
  | 'copper-dark'
  | 'midnight-light'
  | 'midnight-dark'
  | 'jade-light'
  | 'jade-dark'
  | 'parchment-light'
  | 'parchment-dark'
  | 'lagoon-light'
  | 'lagoon-dark'
  | 'cobalt-light'
  | 'cobalt-dark'
  | 'meadow-light'
  | 'meadow-dark'
  | 'damson-light'
  | 'damson-dark'
  | 'beacon-light'
  | 'beacon-dark'
  | 'kingfisher-light'
  | 'kingfisher-dark'
  | 'brass-light'
  | 'brass-dark';

export type ThemeMode = 'light' | 'dark';

export interface ThemeEntry {
  /** Cookie value, `data-theme` attribute and CSS selector. */
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
  {
    id: 'classic-light',
    paletteId: 'classic',
    label: 'Classic',
    blurb: 'The scheme the app has always worn: cool greys with a clear blue accent.',
    mode: 'light',
    chrome: '#0f172a',
  },
  {
    id: 'classic-dark',
    paletteId: 'classic',
    label: 'Classic',
    blurb: 'The scheme the app has always worn: cool greys with a clear blue accent.',
    mode: 'dark',
    chrome: '#070e20',
  },
  {
    id: 'harbour-light',
    paletteId: 'harbour',
    label: 'Harbour',
    blurb: 'Deep navy and harbour blue on a cool, papery white.',
    mode: 'light',
    chrome: '#0b1f3b',
  },
  {
    id: 'harbour-dark',
    paletteId: 'harbour',
    label: 'Harbour',
    blurb: 'Deep navy and harbour blue on a cool, papery white.',
    mode: 'dark',
    chrome: '#061428',
  },
  {
    id: 'fernwood-light',
    paletteId: 'fernwood',
    label: 'Fernwood',
    blurb: 'Forest greens with a soft mint accent.',
    mode: 'light',
    chrome: '#0e3b2e',
  },
  {
    id: 'fernwood-dark',
    paletteId: 'fernwood',
    label: 'Fernwood',
    blurb: 'Forest greens with a soft mint accent.',
    mode: 'dark',
    chrome: '#002117',
  },
  {
    id: 'copper-light',
    paletteId: 'copper',
    label: 'Copper',
    blurb: 'Warm browns and beaten copper on unbleached paper.',
    mode: 'light',
    chrome: '#2c2a28',
  },
  {
    id: 'copper-dark',
    paletteId: 'copper',
    label: 'Copper',
    blurb: 'Warm browns and beaten copper on unbleached paper.',
    mode: 'dark',
    chrome: '#1c1a18',
  },
  {
    id: 'midnight-light',
    paletteId: 'midnight',
    label: 'Midnight',
    blurb: 'Near-black navy with a bright electric blue.',
    mode: 'light',
    chrome: '#0a0f1e',
  },
  {
    id: 'midnight-dark',
    paletteId: 'midnight',
    label: 'Midnight',
    blurb: 'Near-black navy with a bright electric blue.',
    mode: 'dark',
    chrome: '#040816',
  },
  {
    id: 'jade-light',
    paletteId: 'jade',
    label: 'Jade',
    blurb: 'Deep teal and jade, cool and clinical.',
    mode: 'light',
    chrome: '#052e2b',
  },
  {
    id: 'jade-dark',
    paletteId: 'jade',
    label: 'Jade',
    blurb: 'Deep teal and jade, cool and clinical.',
    mode: 'dark',
    chrome: '#00201d',
  },
  {
    id: 'parchment-light',
    paletteId: 'parchment',
    label: 'Parchment',
    blurb: 'Charcoal, old gold and warm cream.',
    mode: 'light',
    chrome: '#2b2a28',
  },
  {
    id: 'parchment-dark',
    paletteId: 'parchment',
    label: 'Parchment',
    blurb: 'Charcoal, old gold and warm cream.',
    mode: 'dark',
    chrome: '#1b1a19',
  },
  {
    id: 'lagoon-light',
    paletteId: 'lagoon',
    label: 'Lagoon',
    blurb: 'Ocean blues with a green signal light.',
    mode: 'light',
    chrome: '#082f49',
  },
  {
    id: 'lagoon-dark',
    paletteId: 'lagoon',
    label: 'Lagoon',
    blurb: 'Ocean blues with a green signal light.',
    mode: 'dark',
    chrome: '#051d2e',
  },
  {
    id: 'cobalt-light',
    paletteId: 'cobalt',
    label: 'Cobalt',
    blurb: 'Royal blue on a very pale sky.',
    mode: 'light',
    chrome: '#0f1b2d',
  },
  {
    id: 'cobalt-dark',
    paletteId: 'cobalt',
    label: 'Cobalt',
    blurb: 'Royal blue on a very pale sky.',
    mode: 'dark',
    chrome: '#061122',
  },
  {
    id: 'meadow-light',
    paletteId: 'meadow',
    label: 'Meadow',
    blurb: 'Olive and moss, quiet and outdoorsy.',
    mode: 'light',
    chrome: '#1f2a1e',
  },
  {
    id: 'meadow-dark',
    paletteId: 'meadow',
    label: 'Meadow',
    blurb: 'Olive and moss, quiet and outdoorsy.',
    mode: 'dark',
    chrome: '#121d12',
  },
  {
    id: 'damson-light',
    paletteId: 'damson',
    label: 'Damson',
    blurb: 'Plum and dusty rose on blush white.',
    mode: 'light',
    chrome: '#2a1f25',
  },
  {
    id: 'damson-dark',
    paletteId: 'damson',
    label: 'Damson',
    blurb: 'Plum and dusty rose on blush white.',
    mode: 'dark',
    chrome: '#1e1319',
  },
  {
    id: 'beacon-light',
    paletteId: 'beacon',
    label: 'Beacon',
    blurb: 'Charcoal with a high-visibility amber — the easiest to read at arm’s length.',
    mode: 'light',
    chrome: '#1a1a1a',
  },
  {
    id: 'beacon-dark',
    paletteId: 'beacon',
    label: 'Beacon',
    blurb: 'Charcoal with a high-visibility amber — the easiest to read at arm’s length.',
    mode: 'dark',
    chrome: '#101010',
  },
  {
    id: 'kingfisher-light',
    paletteId: 'kingfisher',
    label: 'Kingfisher',
    blurb: 'Deep sea blue with a bright turquoise.',
    mode: 'light',
    chrome: '#061a24',
  },
  {
    id: 'kingfisher-dark',
    paletteId: 'kingfisher',
    label: 'Kingfisher',
    blurb: 'Deep sea blue with a bright turquoise.',
    mode: 'dark',
    chrome: '#00111a',
  },
  {
    id: 'brass-light',
    paletteId: 'brass',
    label: 'Brass',
    blurb: 'Gunmetal and brass on warm ivory.',
    mode: 'light',
    chrome: '#101418',
  },
  {
    id: 'brass-dark',
    paletteId: 'brass',
    label: 'Brass',
    blurb: 'Gunmetal and brass on warm ivory.',
    mode: 'dark',
    chrome: '#080c10',
  },
];

/** The scheme the app has always worn — what an installation with no cookie gets. */
export const DEFAULT_THEME_ID: ThemeId = 'classic-light';
