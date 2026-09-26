/**
 * The seed palettes (decision 160). Build-time input only — these hex values
 * never reach `src`; the generator turns each row into a block of
 * `--color-*` declarations in `src/app/themes.generated.css`.
 *
 * Each row is five stops as the household supplied them, darkest → lightest.
 * The generator reads roles out of the row rather than trusting the order
 * blindly: the most chromatic stop becomes the accent, the remaining four sort
 * by lightness into ink, deep, light and page. So a row stays recognisable —
 * every one of its five colours appears somewhere structural — while the
 * *relationships* (which grey is a caption, which line is a table rule) stay
 * exactly the ones the app has always used.
 *
 * `classic` is today's scheme, seeded from the Tailwind values the app shipped
 * with (slate-900 / slate-700 / sky-700 / slate-300 / slate-50). Its light
 * form is not generated from these seeds at all — it is copied verbatim from
 * the base `@theme` block, so the default theme is byte-identical to the
 * scheme decision 159 tokenised. The seeds are here so `classic dark` has a
 * palette to derive from.
 */

export interface SeedPalette {
  /** Stable id used in the cookie, the DOM (`data-theme`) and the CSS selector. */
  id: string;
  /** What the household sees in the gallery. */
  label: string;
  /** One line under the name in the gallery. */
  blurb: string;
  /** Five stops, darkest → lightest, as supplied. */
  stops: [string, string, string, string, string];
}

export const SEED_PALETTES: SeedPalette[] = [
  {
    id: 'classic',
    label: 'Classic',
    blurb: 'The scheme the app has always worn: cool greys with a clear blue accent.',
    stops: ['#0f172a', '#334155', '#0369a1', '#cbd5e1', '#f8fafc'],
  },
  {
    id: 'harbour',
    label: 'Harbour',
    blurb: 'Deep navy and harbour blue on a cool, papery white.',
    stops: ['#0B1F3B', '#123A63', '#2F5D8C', '#C9D6E5', '#F2F5F8'],
  },
  {
    id: 'fernwood',
    label: 'Fernwood',
    blurb: 'Forest greens with a soft mint accent.',
    stops: ['#0E3B2E', '#1F6F54', '#5FB88A', '#D7E7DD', '#F6FBF7'],
  },
  {
    id: 'copper',
    label: 'Copper',
    blurb: 'Warm browns and beaten copper on unbleached paper.',
    stops: ['#2C2A28', '#6B5A4D', '#B87333', '#E7D4C2', '#FBF4EE'],
  },
  {
    id: 'midnight',
    label: 'Midnight',
    blurb: 'Near-black navy with a bright electric blue.',
    stops: ['#0A0F1E', '#1B2A41', '#3B82F6', '#94A3B8', '#E2E8F0'],
  },
  {
    id: 'jade',
    label: 'Jade',
    blurb: 'Deep teal and jade, cool and clinical.',
    stops: ['#052E2B', '#0F766E', '#34D399', '#A7F3D0', '#ECFDF5'],
  },
  {
    id: 'parchment',
    label: 'Parchment',
    blurb: 'Charcoal, old gold and warm cream.',
    stops: ['#2B2A28', '#6B6258', '#C9A86A', '#EFE2C8', '#FFF9EF'],
  },
  {
    id: 'lagoon',
    label: 'Lagoon',
    blurb: 'Ocean blues with a green signal light.',
    stops: ['#082F49', '#0E7490', '#22C55E', '#BAE6FD', '#F0FDFF'],
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    blurb: 'Royal blue on a very pale sky.',
    stops: ['#0F1B2D', '#1E3A8A', '#60A5FA', '#E0F2FE', '#F8FAFF'],
  },
  {
    id: 'meadow',
    label: 'Meadow',
    blurb: 'Olive and moss, quiet and outdoorsy.',
    stops: ['#1F2A1E', '#3E5A3C', '#8AAE6D', '#DCE6D6', '#F6FAF3'],
  },
  {
    id: 'damson',
    label: 'Damson',
    blurb: 'Plum and dusty rose on blush white.',
    stops: ['#2A1F25', '#7A4B57', '#D08C9B', '#F1D6DC', '#FFF6F8'],
  },
  {
    id: 'beacon',
    label: 'Beacon',
    blurb: 'Charcoal with a high-visibility amber — the easiest to read at arm’s length.',
    stops: ['#1A1A1A', '#3A3A3A', '#F2B705', '#F6D365', '#FFF3D6'],
  },
  {
    id: 'kingfisher',
    label: 'Kingfisher',
    blurb: 'Deep sea blue with a bright turquoise.',
    stops: ['#061A24', '#0B3A53', '#0FA3B1', '#B5E2FA', '#F3FAFF'],
  },
  {
    id: 'brass',
    label: 'Brass',
    blurb: 'Gunmetal and brass on warm ivory.',
    stops: ['#101418', '#2C3E50', '#B08D57', '#DCC9A6', '#FBF6EE'],
  },
];
