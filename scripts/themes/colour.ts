/**
 * Colour maths for the theme generator (decision 160, Phase 2 of the colour
 * work). Build-time only: nothing here ships to the browser, and the app
 * itself still never computes a colour — it reads the tokens this generator
 * writes into `src/app/themes.generated.css`.
 *
 * Everything works in OKLCH, because the job is "same relationship, different
 * hue": a perceptual space keeps a step of lightness looking like the same
 * step whatever the hue, which sRGB does not. Conversions are Björn
 * Ottosson's OKLab matrices; contrast is WCAG 2.1 relative luminance, because
 * that is the number the household's accessibility rule (SPEC §16.7) is
 * written against.
 */

export interface Rgb {
  /** 0–1, sRGB, gamma-encoded. */
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  /** 0–1 (not percent). */
  l: number;
  /** 0–~0.4. */
  c: number;
  /** degrees, 0–360. */
  h: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// --- sRGB ------------------------------------------------------------------

export function hexToRgb(hex: string): Rgb {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (v: number): string =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

const srgbToLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (v: number): number =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

// --- OKLab / OKLCH ---------------------------------------------------------

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(okA, okB);
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;
  return { l: okL, c: chroma, h: hue };
}

/** May land outside the sRGB gamut — use {@link fit} for a displayable colour. */
export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: linearToSrgb(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: linearToSrgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: linearToSrgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  };
}

function inGamut({ r, g, b }: Rgb): boolean {
  const ok = (v: number): boolean => v >= -0.0001 && v <= 1.0001;
  return ok(r) && ok(g) && ok(b);
}

/**
 * The nearest displayable colour: keep lightness and hue, walk the chroma
 * down until sRGB can show it. Clipping the channels instead would shift the
 * hue — a themed red would drift orange at the edge of the gamut.
 */
export function fit(colour: Oklch): Rgb {
  const l = clamp01(colour.l);
  const h = colour.h;
  const direct = oklchToRgb({ l, c: colour.c, h });
  if (inGamut(direct)) return direct;
  let low = 0;
  let high = colour.c;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToRgb({ l, c: mid, h }))) low = mid;
    else high = mid;
  }
  const { r, g, b } = oklchToRgb({ l, c: low, h });
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

/** An OKLCH colour as the 6-digit hex the generated stylesheet carries. */
export function toHex(colour: Oklch): string {
  return rgbToHex(fit(colour));
}

export function fromHex(hex: string): Oklch {
  return rgbToOklch(hexToRgb(hex));
}

// --- relationships ---------------------------------------------------------

export function withLightness(colour: Oklch, l: number): Oklch {
  return { ...colour, l: clamp01(l) };
}

export function withChroma(colour: Oklch, c: number): Oklch {
  return { ...colour, c: Math.max(0, c) };
}

/** Linear blend in OKLab (shortest way round the hue circle). */
export function mix(a: Oklch, b: Oklch, t: number): Oklch {
  const k = clamp01(t);
  let dh = ((b.h - a.h + 540) % 360) - 180;
  if (a.c < 1e-4) dh = 0;
  if (b.c < 1e-4) dh = 0;
  return {
    l: a.l + (b.l - a.l) * k,
    c: a.c + (b.c - a.c) * k,
    h: (a.h + dh * k + 360) % 360,
  };
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * srgbToLinear(clamp01(r)) +
    0.7152 * srgbToLinear(clamp01(g)) +
    0.0722 * srgbToLinear(clamp01(b))
  );
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function contrastHex(a: string, b: string): number {
  return contrast(hexToRgb(a), hexToRgb(b));
}

/**
 * Nudge a foreground's lightness — hue and chroma untouched — until it reads
 * against its background at `target`. This is what lets one derivation serve
 * 28 palettes: the shape of the scheme is chosen by hand, and the last
 * fraction of legibility is arithmetic rather than luck.
 *
 * It moves away from the background (darker on a light one, lighter on a dark
 * one), because that is the direction that keeps the intended colour: a red
 * that has to pass on white becomes a deeper red, not a pink.
 */
export function ensureContrast(
  foreground: Oklch,
  background: Oklch,
  target: number,
  options: { maxLightness?: number; minLightness?: number } = {},
): Oklch {
  const maxL = options.maxLightness ?? 1;
  const minL = options.minLightness ?? 0;
  const bgRgb = fit(background);
  const backgroundIsLight = relativeLuminance(bgRgb) > 0.18;
  const step = backgroundIsLight ? -0.005 : 0.005;
  let candidate = foreground;
  for (let i = 0; i <= 200; i += 1) {
    const l = clamp(foreground.l + step * i, minL, maxL);
    candidate = { ...foreground, l };
    if (contrast(fit(candidate), bgRgb) >= target) return candidate;
    if (l === minL || l === maxL) break;
  }
  return candidate;
}
