'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { saveThemeAction } from '@/app/actions';
import { initialActionState } from '@/lib/action-state';
import { isThemeId, type ThemeEntry, type ThemeFamily, type ThemeId } from '@/lib/theme/theme';

/**
 * Appearance — pick a theme for this device (decision 160, SPEC §15.4).
 *
 * Every card is a real preview, not a picture of one: the swatch is ordinary
 * app markup (`bg-surface`, `text-ink-muted`, `bg-till`…) inside an element
 * carrying that theme's `data-theme`, so the theme blocks paint it exactly as
 * they will paint the page. If a theme ever renders badly, it renders badly
 * here first — there is no second implementation to disagree with the real one.
 *
 * Choosing applies immediately and saves in the same gesture: the click sets
 * `document.documentElement.dataset.theme` so the page around the gallery
 * turns over at once, and submits the cookie so the next request agrees. If
 * the save fails, the attribute goes back to what the server last knew.
 */
export interface ThemeGalleryProps {
  current: ThemeId;
  families: ThemeFamily[];
}

export function ThemeGallery({ current, families }: ThemeGalleryProps) {
  const [state, formAction, pending] = useActionState(saveThemeAction, initialActionState);
  const [selected, setSelected] = useState<ThemeId>(current);
  const [ready, setReady] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => setReady(true), []);

  // The server is the truth: if a save failed, put the page back.
  useEffect(() => {
    if (state.status !== 'error') return;
    setSelected(current);
    document.documentElement.dataset.theme = current;
  }, [state, current]);

  function choose(id: string): void {
    if (!isThemeId(id)) return;
    setSelected(id);
    document.documentElement.dataset.theme = id;
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      data-theme-gallery-ready={ready ? 'true' : 'false'}
      inert={!ready}
    >
      <fieldset>
        <legend className="sr-only">Theme for this device</legend>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {families.map((family) => (
            <div key={family.paletteId} className="rounded-lg border border-border bg-canvas p-2.5">
              <p className="text-sm font-semibold text-ink">{family.label}</p>
              <p className="mt-0.5 mb-2 text-xs text-ink-muted">{family.blurb}</p>
              <div className="grid grid-cols-2 gap-2">
                <ThemeChoice
                  theme={family.light}
                  selected={selected === family.light.id}
                  onChoose={choose}
                />
                <ThemeChoice
                  theme={family.dark}
                  selected={selected === family.dark.id}
                  onChoose={choose}
                />
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-soft">
        {pending ? 'Saving…' : (state.message ?? 'Picking a theme changes this device only.')}
      </p>
      <noscript>
        <p className="mt-2 text-xs text-ink-muted">
          With JavaScript off, choose a theme and press Save.
        </p>
        <button
          type="submit"
          className="mt-1 rounded bg-till px-3 py-1.5 text-sm font-medium text-till-ink"
        >
          Save theme
        </button>
      </noscript>
    </form>
  );
}

function ThemeChoice({
  theme,
  selected,
  onChoose,
}: {
  theme: ThemeEntry;
  selected: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <label
      className={`block cursor-pointer rounded-md border p-1.5 ${
        selected
          ? 'border-accent-500 ring-2 ring-accent-200'
          : 'border-border hover:border-border-emphasis'
      }`}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1.5">
          <input
            type="radio"
            name="themeId"
            value={theme.id}
            checked={selected}
            onChange={(event) => onChoose(event.target.value)}
            className="accent-ink"
          />
          <span className="text-xs font-medium text-ink-body capitalize">{theme.mode}</span>
        </span>
        {selected ? (
          <span className="rounded-full bg-accent-100 px-1.5 py-0.5 text-[10px] font-semibold text-accent-900">
            In use
          </span>
        ) : null}
      </span>
      <ThemePreview theme={theme} />
    </label>
  );
}

/**
 * A miniature of the app, drawn in the theme's own tokens. Nothing here names
 * a colour — the `data-theme` attribute does all the work, which is the whole
 * claim decision 159 made and this page is the proof of.
 */
function ThemePreview({ theme }: { theme: ThemeEntry }) {
  return (
    <span
      data-theme={theme.id}
      aria-hidden="true"
      className="mt-1.5 block overflow-hidden rounded border border-border bg-canvas"
    >
      <span className="flex items-center justify-between gap-1 bg-till px-1.5 py-1">
        <span className="text-[9px] font-semibold tracking-[0.12em] text-accent-300 uppercase">
          Till
        </span>
        <span className="rounded bg-surface px-1 text-[9px] font-medium text-ink">Save</span>
      </span>
      <span className="block p-1.5">
        <span className="block rounded border border-border bg-surface p-1.5">
          <span className="block text-[11px] leading-tight font-semibold text-ink">£1,284.50</span>
          <span className="block text-[9px] text-ink-muted">Household total</span>
          <span className="mt-1 flex flex-wrap gap-1">
            <span className="rounded-full bg-positive-50 px-1 text-[9px] font-semibold text-positive-800">
              +£240
            </span>
            <span className="rounded-full bg-warning-50 px-1 text-[9px] font-semibold text-warning-900">
              Watch
            </span>
            <span className="rounded-full bg-danger-50 px-1 text-[9px] font-semibold text-danger">
              −£18
            </span>
          </span>
        </span>
        <span className="mt-1 block text-[9px] font-medium text-accent underline">Horizon →</span>
      </span>
    </span>
  );
}
