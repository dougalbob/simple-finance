import { cookies } from 'next/headers';
import {
  resolveTheme,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE_SECONDS,
  type ThemeEntry,
  type ThemeId,
} from './theme';

/**
 * Next.js adapter for the theme cookie (decision 160) — the same split the
 * auth module uses: `theme.ts` is pure and testable, this file is the only
 * place that touches the framework.
 *
 * Reading it in the root layout is what avoids a flash of the wrong theme:
 * the server already knows which theme this device wants, so the very first
 * byte of HTML carries `data-theme`. No inline script, no client hydration
 * step, nothing to un-paint.
 */
export async function currentTheme(): Promise<ThemeEntry> {
  const jar = await cookies();
  return resolveTheme(jar.get(THEME_COOKIE)?.value);
}

/** Remember a theme on this device. Server actions only. */
export async function rememberTheme(id: ThemeId): Promise<void> {
  const jar = await cookies();
  jar.set(THEME_COOKIE, id, {
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    // Nothing in the browser needs to read it: the server renders the
    // attribute, so the cookie can stay out of reach of any script.
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
}
