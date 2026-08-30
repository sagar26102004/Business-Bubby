/**
 * Async-data hook with optional stale-while-revalidate caching.
 *
 * Basic use is unchanged: `useAsync(fn, deps)` runs `fn`, tracks
 * loading/error/data, and re-runs when a `deps` value changes or `reload()` is
 * called.
 *
 * It also keeps what it fetched FRESH, which is what stops the app feeling
 * stale ("I have to leave the screen and come back before I see it"):
 *  - **on focus** — every time the screen is returned to, the data is refetched
 *    quietly. This is the one that matters: you act on screen B (accept an
 *    order, send a reply, register a business), come back to screen A, and A is
 *    already up to date instead of still showing what it read on mount.
 *  - **on foreground** — the same when the app itself comes back from the
 *    background, for the screen it was left on.
 *  - **on an interval** — pass `refreshMs` for screens whose data is changed by
 *    the OTHER side (a chat thread, the orders desk); it polls only while the
 *    screen is focused, and never stacks a second request on a slow one.
 *
 * All three are QUIET: what's on screen stays on screen (`validating` goes
 * true), there's no spinner flash, and a failed background refresh is swallowed
 * rather than replacing a working screen with an error page.
 *
 * Pass `{ key }` to make it SNAPPY too: the last result for that key is served
 * instantly from `queryCache` (even across reloads) while a fresh result is
 * fetched in the background and swapped in. Screens sharing a key stay in sync,
 * and a mutation can refresh them by calling `invalidate(key)` from
 * `@/lib/queryCache`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { hydrate, isHydrated, keyOf, readCache, subscribe, writeCache } from './queryCache';

/** Poll interval for a live conversation (messages arrive from the other side). */
export const CHAT_REFRESH_MS = 4000;
/** Poll interval for a live desk — orders, inbox, requests waiting on someone. */
export const LIVE_REFRESH_MS = 10000;

/**
 * A fetch this recent counts as "just ran", so the focus event that follows a
 * screen's own mount doesn't immediately fetch the very same thing again.
 */
const FRESH_MS = 1000;

export interface AsyncState<T> {
  data: T | undefined;
  /** True only when there's nothing to show yet (no cache, first fetch). */
  loading: boolean;
  /** True while a background refresh runs over already-shown data. */
  validating: boolean;
  error: Error | undefined;
  /** Refetch from scratch — drops back to the loading state. */
  reload: () => void;
  /** Refetch quietly, keeping what's on screen. Use after a mutation. */
  refresh: () => void;
}

export interface UseAsyncOptions {
  /** Cache key. Omit to disable caching (behaves like the original hook). */
  key?: string | ReadonlyArray<string | number | boolean | null | undefined>;
  /** When false, the fetch is skipped (e.g. waiting on a param). Default true. */
  enabled?: boolean;
  /**
   * Refetch quietly whenever the screen is returned to. Default true. Turn it
   * off for a screen holding UNSAVED input seeded from this data, where a
   * refetch would wipe what the user has typed.
   */
  refetchOnFocus?: boolean;
  /** Refetch quietly when the app returns to the foreground. Default true. */
  refetchOnForeground?: boolean;
  /** Poll this often (ms) while the screen is focused. Off by default. */
  refreshMs?: number;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList = [],
  options: UseAsyncOptions = {},
): AsyncState<T> {
  const cacheKey = options.key !== undefined ? keyOf(options.key) : undefined;
  const enabled = options.enabled !== false;
  const refetchOnFocus = options.refetchOnFocus !== false;
  const refetchOnForeground = options.refetchOnForeground !== false;
  const refreshMs = options.refreshMs;

  const initial = cacheKey ? readCache<T>(cacheKey) : undefined;
  const [data, setData] = useState<T | undefined>(initial);
  const [loading, setLoading] = useState(enabled && initial === undefined);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<Error>();
  const [nonce, setNonce] = useState(0);

  // Keep the latest fn without making it a dependency (callers pass inline fns).
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // The latest data, readable from callbacks that must not re-subscribe.
  const dataRef = useRef(data);
  dataRef.current = data;
  /** The next run keeps the screen up instead of dropping to a spinner. */
  const quietRef = useRef(false);
  /** A fetch is in flight — a poll tick skips instead of stacking requests. */
  const runningRef = useRef(false);
  /** When the last fetch started (see FRESH_MS). */
  const ranAtRef = useRef(0);
  /** Whether this screen is the one being looked at right now. */
  const focusedRef = useRef(true);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const refresh = useCallback(() => {
    quietRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  // Stay in sync with other hooks sharing this key, and refetch on invalidation.
  useEffect(() => {
    if (!cacheKey) return;
    return subscribe(cacheKey, () => {
      const next = readCache<T>(cacheKey);
      if (next !== undefined) setData(next);
      else refresh(); // invalidated → pull fresh, without a spinner
    });
  }, [cacheKey, refresh]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;

    const run = () => {
      const quiet = quietRef.current;
      quietRef.current = false;
      ranAtRef.current = Date.now();

      const cached = cacheKey ? readCache<T>(cacheKey) : undefined;
      if (cached !== undefined) {
        setData(cached);
        setLoading(false);
        setValidating(true);
      } else if (quiet && dataRef.current !== undefined) {
        // Background refresh: leave what's on screen alone until it's replaced.
        setValidating(true);
      } else {
        setLoading(true);
        setError(undefined);
      }

      runningRef.current = true;
      fnRef
        .current()
        .then((result) => {
          if (!active) return;
          if (cacheKey) writeCache(cacheKey, result);
          setData(result);
          setError(undefined);
        })
        .catch((err: unknown) => {
          if (!active) return;
          // A background refresh that fails must never replace a working screen
          // with an error page — the next one will try again.
          if (quiet && dataRef.current !== undefined) return;
          setError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          runningRef.current = false;
          if (active) {
            setLoading(false);
            setValidating(false);
          }
        });
    };

    // On a cold start the persisted cache may not be in memory yet; wait for it
    // so the first paint can use it, then fetch fresh.
    if (cacheKey && !isHydrated()) {
      hydrate().then(() => {
        if (active) run();
      });
    } else {
      run();
    }

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, cacheKey, enabled]);

  // Refetch on focus, and poll while focused. Declared AFTER the fetch effect so
  // a screen's own mount has already stamped `ranAtRef` by the time the first
  // focus lands — otherwise every screen would fetch twice on open.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (enabled && refetchOnFocus && Date.now() - ranAtRef.current > FRESH_MS) refresh();

      const timer =
        enabled && refreshMs
          ? setInterval(() => {
              if (!runningRef.current) refresh();
            }, refreshMs)
          : undefined;

      return () => {
        focusedRef.current = false;
        if (timer) clearInterval(timer);
      };
    }, [enabled, refetchOnFocus, refreshMs, refresh]),
  );

  // Coming back to the app is a focus too — refresh the screen it was left on.
  useEffect(() => {
    if (!enabled || !refetchOnForeground) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focusedRef.current) refresh();
    });
    return () => sub.remove();
  }, [enabled, refetchOnForeground, refresh]);

  return { data, loading, validating, error, reload, refresh };
}
