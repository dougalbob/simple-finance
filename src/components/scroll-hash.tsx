'use client';

import { useEffect } from 'react';

/**
 * Scroll a `#hash` target into view after layout.
 *
 * Native navigation scrolls the document. Recurring's laptop schedule list
 * lives inside `overflow-y-auto`, so a deep link such as `#schedule-12`
 * would otherwise land on the page without moving the row into the panel
 * (decision 164).
 */
export function ScrollHashIntoView() {
  useEffect(() => {
    const scrollToHash = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
      if (id === '') return;
      const target = document.getElementById(id);
      if (target === null) return;
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    scrollToHash();
    const frame = window.requestAnimationFrame(scrollToHash);
    window.addEventListener('hashchange', scrollToHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', scrollToHash);
    };
  }, []);
  return null;
}
