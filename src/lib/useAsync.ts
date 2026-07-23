/**
 * Async-data hook with optional stale-while-revalidate caching.
 *
 * Basic use is unchanged: `useAsync(fn, deps)` runs `fn`, tracks
 * loading/error/data, and re-runs when a `deps` value changes or `reload()` is
 * called.
 *
 * Pass `{ key }` to make it SNAPPY: the last result for that key is served
 * instantly from `queryCache` (even across reloads) while a fresh result is
 * fetched in the background and swapped in. `validating` is true during that
 * background refresh. Screens sharing a key stay in sync, and a mutation can
 * refresh them by calling `invalidate(key)` from `@/lib/queryCache`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { hydrate, isHydrated, keyOf, readCache, subscribe, writeCache } from './queryCache';

export interface AsyncState<T> {
  data: T | undefined;
  /** True only when there's nothing to show yet (no cache, first fetch). */
  loading: boolean;
  /** True while a background refresh runs over already-shown cached data. */
  validating: boolean;
  error: Error | undefined;
  reload: () => void;
}

export interface UseAsyncOptions {
  /** Cache key. Omit to disable caching (behaves like the original hook). */
  key?: string | ReadonlyArray<string | number | boolean | null | undefined>;
  /** When false, the fetch is skipped (e.g. waiting on a param). Default true. */
  enabled?: boolean;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList = [],
  options: UseAsyncOptions = {},
): AsyncState<T> {
  const cacheKey = options.key !== undefined ? keyOf(options.key) : undefined;
  const enabled = options.enabled !== false;

  const initial = cacheKey ? readCache<T>(cacheKey) : undefined;
  const [data, setData] = useState<T | undefined>(initial);
  const [loading, setLoading] = useState(enabled && initial === undefined);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<Error>();
  const [nonce, setNonce] = useState(0);

  // Keep the latest fn without making it a dependency (callers pass inline fns).
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Stay in sync with other hooks sharing this key, and refetch on invalidation.
  useEffect(() => {
    if (!cacheKey) return;
    return subscribe(cacheKey, () => {
      const next = readCache<T>(cacheKey);
      if (next !== undefined) setData(next);
      else setNonce((n) => n + 1); // invalidated → pull fresh
    });
  }, [cacheKey]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;

    const run = () => {
      const cached = cacheKey ? readCache<T>(cacheKey) : undefined;
      if (cached !== undefined) {
        setData(cached);
        setLoading(false);
        setValidating(true);
      } else {
        setLoading(true);
      }
      setError(undefined);
      fnRef
        .current()
        .then((result) => {
          if (!active) return;
          if (cacheKey) writeCache(cacheKey, result);
          setData(result);
        })
        .catch((err: unknown) => {
          if (active) setError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
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

  return { data, loading, validating, error, reload };
}
