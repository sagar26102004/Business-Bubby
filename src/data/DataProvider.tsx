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
  // The concrete backend is chosen exactly once, here.
  const repositories = useMemo(() => createMockRepositories(), []);
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
