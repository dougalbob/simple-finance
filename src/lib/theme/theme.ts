import { DEFAULT_THEME_ID, THEMES, type ThemeEntry, type ThemeId } from './catalogue';

/**
 * Themes (decision 160, SPEC §15.4) — the pure half.
 *
 * A theme is one attribute on `<html>`. The choice is **per device**, not per
 * household: it is a preference about the screen in front of you, not a fact
 * about the money, so it lives in a cookie rather than in the settings table
 * and is not audited. Two people can read the same ledger in different
 * clothes, and nothing about a phone's appearance can ever disagree with the
 * database.
 *
 * Nothing here knows a colour. The catalogue it reads is generated from
 * `scripts/themes/` and carries names, not palettes — except `chrome`, the
 * browser's own strip, which is read before any stylesheet exists (SPEC §14).
 */

export { DEFAULT_THEME_ID, THEMES };
export type { ThemeEntry, ThemeId, ThemeMode } from './catalogue';

/** The cookie the layout reads on every request. */
export const THEME_COOKIE = 'sf-theme';

/** A year: long enough that a household never re-picks, short enough to lapse. */
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const BY_ID = new Map<string, ThemeEntry>(THEMES.map((theme) => [theme.id, theme]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && BY_ID.has(value);
}

/**
 * The theme a cookie value names, or the default. An unknown, stale or
 * missing value is never an error: a theme is a preference, and the app must
 * still render if someone edits the cookie or a theme is retired.
 */
export function resolveTheme(cookieValue: string | undefined | null): ThemeEntry {
  const fallback = BY_ID.get(DEFAULT_THEME_ID);
  if (fallback === undefined) throw new Error('the theme catalogue has no default');
  if (typeof cookieValue !== 'string') return fallback;
  return BY_ID.get(cookieValue.trim()) ?? fallback;
}

export function themeById(id: ThemeId): ThemeEntry {
  const theme = BY_ID.get(id);
  if (theme === undefined) throw new Error(`unknown theme: ${id}`);
  return theme;
}

export interface ThemeFamily {
  paletteId: string;
  label: string;
  blurb: string;
  light: ThemeEntry;
  dark: ThemeEntry;
}

/** The gallery's shape: one palette, its two modes, in catalogue order. */
export function themeFamilies(): ThemeFamily[] {
  const families: ThemeFamily[] = [];
  for (const theme of THEMES) {
    const existing = families.find((family) => family.paletteId === theme.paletteId);
    if (existing === undefined) {
      families.push({
        paletteId: theme.paletteId,
        label: theme.label,
        blurb: theme.blurb,
        light: theme,
        dark: theme,
      });
      continue;
    }
    if (theme.mode === 'light') existing.light = theme;
    else existing.dark = theme;
  }
  return families;
}
