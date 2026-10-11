'use client';

import { useEffect, useState } from 'react';
import { isOpenNow, todayHoursLabel } from '@/lib/hours';
import type { OpeningHours } from '@/lib/types';

/**
 * The Open/Closed chip. Computed in the visitor's browser, not on the server:
 * the page is cached for minutes at a time, and "Open now" baked into a cached
 * page would be wrong by the next shift change.
 */
export function OpenNow({ hours, fallback }: { hours?: OpeningHours; fallback?: boolean }) {
  const [state, setState] = useState<{ open?: boolean; label?: string } | null>(null);

  useEffect(() => {
    const now = new Date();
    const open = isOpenNow(hours, now);
    setState(
      open === undefined ? { open: fallback } : { open, label: todayHoursLabel(hours, now) },
    );
  }, [hours, fallback]);

  if (!state || state.open === undefined) return null;
  return (
    <span className={`chip ${state.open ? 'chip-open' : 'chip-closed'}`}>
      {state.open ? 'Open now' : 'Closed'}
      {state.label ? ` · ${state.label}` : ''}
    </span>
  );
}
