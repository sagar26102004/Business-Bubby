/**
 * Which concrete backend this build talks to — decided once, from the same
 * env var `DataProvider` uses to pick a repository set.
 *
 * It lives in its own module because two very different places need the
 * answer: `DataProvider` (to build the repositories) and the root layout (to
 * decide whether a deep link survives a cold start — see `IS_EPHEMERAL_BACKEND`).
 */
import { isApiConfigured } from '@/data/api/client';
import { isSupabaseConfigured } from '@/lib/supabase';

export type BackendName = 'mock' | 'supabase' | 'api';

/**
 * Resolve `EXPO_PUBLIC_BACKEND` to the backend that will ACTUALLY be used,
 * including the fallbacks: `api` needs both a server URL and Supabase (for the
 * JWT), and `supabase` needs credentials. Anything unset or misconfigured ends
 * up on the mock.
 */
export function selectedBackend(): BackendName {
  const requested = (process.env.EXPO_PUBLIC_BACKEND ?? '').toLowerCase();
  if (requested === 'mock') return 'mock';
  if (requested === 'api') {
    return isApiConfigured && isSupabaseConfigured
      ? 'api'
      : isSupabaseConfigured
        ? 'supabase'
        : 'mock';
  }
  // 'supabase' and unset behave the same: Supabase when configured, else mock.
  return isSupabaseConfigured ? 'supabase' : 'mock';
}

/**
 * True when app state lives only in memory (the mock), so a page reload / app
 * restart wipes the data AND the signed-in identity. Real backends persist
 * both, which is why deep links only need special handling on the mock.
 */
export const IS_EPHEMERAL_BACKEND = selectedBackend() === 'mock';
