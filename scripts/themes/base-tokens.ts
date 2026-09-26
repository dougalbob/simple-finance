/**
 * Read the base `@theme static` block out of `src/app/globals.css`.
 *
 * The base block is the Classic (light) theme — the scheme decision 159
 * tokenised, pixel-for-pixel what the app shipped with. The generator copies
 * it verbatim into `[data-theme='classic-light']` rather than re-deriving it,
 * so choosing the default theme explicitly can never move a pixel, and so
 * there is still exactly one place where Classic's colours are written down.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fromHex, type Oklch } from './colour';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const GLOBALS_CSS = path.join(REPO_ROOT, 'src', 'app', 'globals.css');

export interface BaseToken {
  /** Token name without the `--color-` prefix, e.g. `ink-muted`. */
  name: string;
  /** The declaration exactly as globals.css writes it, comments stripped. */
  value: string;
}

/** Every `--color-*` declaration in the base `@theme static` block, in order. */
export function readBaseTokens(cssPath: string = GLOBALS_CSS): BaseToken[] {
  const css = readFileSync(cssPath, 'utf8');
  const start = css.indexOf('@theme static {');
  if (start === -1) throw new Error('globals.css no longer has an `@theme static` block');
  let depth = 0;
  let end = -1;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error('globals.css `@theme static` block is not closed');
  const body = css
    .slice(start + '@theme static {'.length, end)
    // Comments may sit between declarations and inside a multi-line value.
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const tokens: BaseToken[] = [];
  for (const match of body.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    // Multi-line declarations (Prettier wraps the long commented ones) must
    // normalise to exactly the same text as their single-line twins, or two
    // tokens with the same colour would look different to every comparison.
    const normalised = value
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim();
    tokens.push({ name, value: normalised });
  }
  if (tokens.length === 0) throw new Error('no --color-* tokens found in the base block');
  return tokens;
}

/** Parse a base value (`#fff`, `oklch(55.4% 0.046 257.417)`) into OKLCH. */
export function parseCssColour(value: string): Oklch {
  const hex = /^#[0-9a-fA-F]{3,8}$/.exec(value.trim());
  if (hex) return fromHex(value.trim().slice(0, 7));
  const oklch = /^oklch\(\s*([0-9.]+)%\s+([0-9.]+)\s+([0-9.]+)\s*\)$/.exec(value.trim());
  if (oklch) {
    return {
      l: Number(oklch[1]) / 100,
      c: Number(oklch[2]),
      h: Number(oklch[3]),
    };
  }
  throw new Error(`Cannot parse colour value: ${value}`);
}

/** The base tokens as OKLCH, skipping derived values such as `color-mix(...)`. */
export function baseTokenColours(tokens: BaseToken[] = readBaseTokens()): Map<string, Oklch> {
  const map = new Map<string, Oklch>();
  for (const token of tokens) {
    try {
      map.set(token.name, parseCssColour(token.value));
    } catch {
      // color-mix() tints are relationships, not colours: the generator
      // re-states them per theme rather than resolving them here.
    }
  }
  return map;
}
