/**
 * A tiny stale-while-revalidate query cache, backed by AsyncStorage.
 *
 * `useAsync` reads and writes this cache when a caller passes a `key`. The point
 * is a SNAPPY experience: a screen paints instantly from the last cached value
 * (even across app reloads, once hydrated), then the fresh network result is
 * fetched in the background and swapped in. Writes call `invalidate()` so the
 * affected reads refetch.
 *
 * This is deliberately small — no dependency graph, no automatic garbage beyond
 * a simple cap. If caching needs grow, this is the single place to swap in
 * TanStack Query without touching call sites.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'localo:querycache/v1';
/** Keep the persisted cache bounded; oldest entries are evicted past this. */
const MAX_ENTRIES = 300;
/**
 * The whole cache is ONE stored value, and Android reads a stored value through
 * a 2 MB window — anything bigger fails to load at all. So the persisted total
 * stays under MAX_TOTAL_BYTES; an entry too big to carry stays memory-only.
 */
const MAX_ENTRY_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 1_850_000;

/** UTF-8 size of a string — ₹ and › are 3 bytes, so characters undercount. */
function utf8Bytes(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) n += c > 0x7ff ? 2 : 1;
  }
  return n;
}

interface Entry {
  data: unknown;
  /** Epoch ms this entry was written — used for eviction. */
  at: number;
}

const store = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

let hydrated = false;
let hydrating: Promise<void> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Turn a string or array key into a stable string. */
export function keyOf(key: string | ReadonlyArray<string | number | boolean | null | undefined>): string {
  return typeof key === 'string' ? key : JSON.stringify(key);
}

/** Whether the persisted cache has been loaded into memory yet. */
export function isHydrated(): boolean {
  return hydrated;
}

/** Load the persisted cache into memory. Idempotent; safe to call often. */
export function hydrate(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!hydrating) {
    hydrating = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, Entry>;
          for (const [k, v] of Object.entries(parsed)) store.set(k, v);
        }
      })
      .catch(() => {
        /* a corrupt/absent cache is not fatal — start empty */
      })
      .finally(() => {
        hydrated = true;
      });
  }
  return hydrating;
}

// Warm the cache as soon as this module is imported.
void hydrate();

function schedulePersist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (store.size > MAX_ENTRIES) {
      const oldestFirst = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
      const overflow = store.size - MAX_ENTRIES;
      for (let i = 0; i < overflow; i++) store.delete(oldestFirst[i][0]);
    }
    // Newest first, so what's dropped for room is the stalest (see MAX_TOTAL_BYTES).
    const parts: string[] = [];
    let size = 0;
    for (const [k, v] of [...store].sort((a, b) => b[1].at - a[1].at)) {
      let part: string;
      try {
        part = `${JSON.stringify(k)}:${JSON.stringify(v)}`;
      } catch {
        continue;
      }
      const bytes = utf8Bytes(part);
      if (bytes > MAX_ENTRY_BYTES || size + bytes > MAX_TOTAL_BYTES) continue;
      parts.push(part);
      size += bytes;
    }
    AsyncStorage.setItem(STORAGE_KEY, `{${parts.join(',')}}`).catch(() => {});
  }, 400);
}

function notify(key: string) {
  const set = listeners.get(key);
  if (set) set.forEach((cb) => cb());
}

/** Synchronously read a cached value (undefined on miss). */
export function readCache<T>(key: string): T | undefined {
  const entry = store.get(key);
  return entry ? (entry.data as T) : undefined;
}

/** Write a value and wake every hook subscribed to this key. */
export function writeCache<T>(key: string, data: T) {
  store.set(key, { data, at: Date.now() });
  notify(key);
  schedulePersist();
}

/** Subscribe to writes/invalidations of one key. Returns an unsubscribe fn. */
export function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(key);
  };
}

/**
 * Drop cached entries so their reads refetch. Pass a string prefix (matches
 * keys that start with it) or a predicate. Call this after a mutation, e.g.
 * `invalidate('business:')` after editing a business.
 */
export function invalidate(match: string | ((key: string) => boolean)) {
  const pred = typeof match === 'string' ? (k: string) => k.startsWith(match) : match;
  for (const k of [...store.keys()]) {
    if (pred(k)) {
      store.delete(k);
      notify(k);
    }
  }
  schedulePersist();
}

/** Wipe the whole cache (memory + disk). Used on sign-out. */
export async function clearCache(): Promise<void> {
  store.clear();
  for (const key of listeners.keys()) notify(key);
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
