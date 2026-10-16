/**
 * A paged feed of nearby business cards (BusinessRepository.nearby — rules in
 * domain/nearby.ts): the first `firstPage` cards (cached by `key`, so a reopen
 * paints at once), then `nextPage` more each time `loadMore` is called — wire it
 * to a FlatList's `onEndReached`. Used by Explore and the category pages, so
 * neither ever downloads the whole directory (40,000 listings since Oct 2026).
 *
 * Any change to `key` starts the feed again from page one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Business } from '@/domain/types';
import type { NearbyQuery } from '@/domain/nearby';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { isListedPublicly } from '@/lib/onHold';

export interface NearbyFeed {
  /** The loaded pages, in the database's order, each business once. */
  items: Business[];
  /** Nothing to show yet (first page loading, no cache). */
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
  /** Fetch the next page, if there is one and none is in flight. */
  loadMore: () => void;
  loadingMore: boolean;
  hasMore: boolean;
}

type CacheKey = ReadonlyArray<string | number | boolean | null | undefined>;

export function useNearbyFeed(
  query: Omit<NearbyQuery, 'offset' | 'limit'>,
  key: CacheKey,
  { firstPage = 20, nextPage = 10, enabled = true }: { firstPage?: number; nextPage?: number; enabled?: boolean } = {},
): NearbyFeed {
  const repos = useRepositories();
  const feedId = key.map(String).join('|');
  // The latest query, read when a page is fetched (it changes only with the key).
  const queryRef = useRef(query);
  queryRef.current = query;

  const { data: first, loading, error, reload } = useAsync(
    () => repos.businesses.nearby({ ...queryRef.current, offset: 0, limit: firstPage }),
    [feedId],
    { key, enabled },
  );

  const [more, setMore] = useState<Business[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const feedIdRef = useRef(feedId);
  useEffect(() => {
    feedIdRef.current = feedId;
    setMore([]);
    setHasMore(true);
    setLoadingMore(false);
  }, [feedId]);
  useEffect(() => {
    if (first && first.length < firstPage) setHasMore(false);
  }, [first, firstPage]);

  const loadMore = useCallback(() => {
    if (!first || !hasMore || loadingMore) return;
    const at = feedIdRef.current;
    setLoadingMore(true);
    repos.businesses
      .nearby({ ...queryRef.current, offset: firstPage + more.length, limit: nextPage })
      .then((page) => {
        if (feedIdRef.current !== at) return; // the feed changed meanwhile
        setMore((m) => [...m, ...page]);
        if (page.length < nextPage) setHasMore(false);
      })
      .catch(() => {}) // a failed page just stops here; scrolling again retries
      .finally(() => {
        if (feedIdRef.current === at) setLoadingMore(false);
      });
  }, [first, hasMore, loadingMore, more.length, firstPage, nextPage, repos]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...(first ?? []), ...more].filter((b) => {
      if (seen.has(b.id) || !isListedPublicly(b)) return false;
      seen.add(b.id);
      return true;
    });
  }, [first, more]);

  return { items, loading, error, reload, loadMore, loadingMore, hasMore };
}
