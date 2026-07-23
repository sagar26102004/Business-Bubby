/**
 * DataProvider wires a concrete set of repositories into React context and
 * tracks the signed-in user. Screens read data through the hooks below and
 * never import a concrete repository directly.
 *
 * The app opens as a guest (currentUser === null). Signing in/up is mocked.
 * To move off mock data later, change the single `createMockRepositories()`
 * call here to your real implementation — nothing else needs to change.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '@/domain/types';
import type { Repositories, SignUpInput } from '@/data/repositories';
import { createMockRepositories, resetMockData } from '@/data/mock/mockRepositories';
import { createSupabaseRepositories } from '@/data/supabase';
import { createApiRepositories } from '@/data/api';
import { isApiConfigured } from '@/data/api/client';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * Pick the concrete backend, exactly once. `EXPO_PUBLIC_BACKEND` chooses:
 *   - `api`      → the Node/Express + Prisma server (Path B). Needs
 *                  EXPO_PUBLIC_API_URL (the server) AND Supabase (for the JWT
 *                  the app signs in with). Falls back if misconfigured.
 *   - `supabase` → the app talks straight to Supabase (Path A).
 *   - `mock`     → the in-memory mock (dev/offline).
 * Unset keeps the old behaviour: Supabase when configured, otherwise mock.
 */
function selectRepositories(): Repositories {
  const backend = (process.env.EXPO_PUBLIC_BACKEND ?? '').toLowerCase();
  const supabaseOrMock = () =>
    isSupabaseConfigured ? createSupabaseRepositories() : createMockRepositories();

  if (backend === 'mock') return createMockRepositories();
  if (backend === 'api') {
    return isApiConfigured && isSupabaseConfigured ? createApiRepositories() : supabaseOrMock();
  }
  if (backend === 'supabase') return supabaseOrMock();
  return supabaseOrMock();
}

interface DataContextValue {
  repositories: Repositories;
  currentUser: User | null;
  authLoading: boolean;
  /** Update the signed-in user locally (e.g. after editing the profile). */
  setCurrentUser: (user: User) => void;
  signIn: (email: string, password?: string) => Promise<User>;
  signUp: (input: SignUpInput) => Promise<User>;
  signOut: () => Promise<void>;
  /** Dev/testing: impersonate a specific user. */
  signInAs: (userId: string) => Promise<User>;
  /** Dev/testing: restore seed data and sign out. */
  resetData: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  // The concrete backend is chosen exactly once, here: real Supabase when
  // credentials are present (see .env / lib/supabase), otherwise the in-memory
  // mock. Repositories not yet migrated still come from the mock (see
  // data/supabase/index.ts).
  const repositories = useMemo(() => selectRepositories(), []);
  const [currentUser, setCurrentUserState] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let active = true;
    repositories.auth
      .getCurrentUser()
      .then((user) => active && setCurrentUserState(user))
      .finally(() => active && setAuthLoading(false));
    return () => {
      active = false;
    };
  }, [repositories]);

  const setCurrentUser = useCallback((user: User) => setCurrentUserState(user), []);

  const signIn = useCallback(
    async (email: string, password?: string) => {
      const user = await repositories.auth.signIn(email, password);
      setCurrentUserState(user);
      return user;
    },
    [repositories],
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      const user = await repositories.auth.signUp(input);
      setCurrentUserState(user);
      return user;
    },
    [repositories],
  );

  const signOut = useCallback(async () => {
    await repositories.auth.signOut();
    setCurrentUserState(null);
  }, [repositories]);

  const signInAs = useCallback(
    async (userId: string) => {
      const user = await repositories.auth.signInAs(userId);
      setCurrentUserState(user);
      return user;
    },
    [repositories],
  );

  const resetData = useCallback(() => {
    resetMockData();
    setCurrentUserState(null);
  }, []);

  const value = useMemo(
    () => ({
      repositories,
      currentUser,
      authLoading,
      setCurrentUser,
      signIn,
      signUp,
      signOut,
      signInAs,
      resetData,
    }),
    [repositories, currentUser, authLoading, setCurrentUser, signIn, signUp, signOut, signInAs, resetData],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within a DataProvider');
  return ctx;
}

/** Access the repository set (businesses, employees, users, auth). */
export function useRepositories(): Repositories {
  return useData().repositories;
}

/** Access auth state and helpers. `isGuest` is true when not signed in. */
export function useAuth() {
  const { currentUser, authLoading, setCurrentUser, signIn, signUp, signOut, signInAs, resetData } =
    useData();
  return {
    currentUser,
    isGuest: !currentUser,
    authLoading,
    setCurrentUser,
    signIn,
    signUp,
    signOut,
    signInAs,
    resetData,
  };
}
