/**
 * The Supabase client — the single connection to the real backend.
 *
 * Configuration comes from env vars (safe to expose: the anon key is protected
 * by Row-Level Security). Copy `.env.example` to `.env` and fill in your own
 * project's values:
 *
 *   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
 *
 * Until those are set, `isSupabaseConfigured` is false and the app keeps
 * running on the in-memory mock (see DataProvider). Nothing here reaches out
 * to your brother's linked project — it only uses whatever you put in `.env`.
 */
import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True once real credentials are present — the app switches off the mock. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * The shared client, or null when unconfigured. Access it through
 * `getSupabase()` in code that only runs when configured.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // We are not a web app handling magic-link redirects in the URL.
        detectSessionInUrl: false,
      },
    })
  : null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env',
    );
  }
  return supabase;
}

// On native, pause/resume token auto-refresh with app foreground state so
// sessions stay fresh without burning cycles in the background. (No-op on web.)
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
