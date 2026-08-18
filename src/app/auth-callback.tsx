/**
 * Where Google sends the browser back to.
 *
 * `signInWithGoogle` (src/data/supabase/auth.ts) opens Google in an auth
 * session and asks it to return to `Linking.createURL('/auth-callback')` —
 * `localo://auth-callback` on a device, `<origin>/auth-callback` on web. The
 * code exchange happens THERE, in the repository, because the auth session
 * hands the redirect url straight back to the caller that opened it.
 *
 * So this screen does no work at all. It exists because a redirect target that
 * resolves to nothing is a bug waiting to happen: on web the popup is a real
 * page load, and without this route the user watches a "not found" screen for
 * the moment before it closes. On Android the same url can also arrive as a
 * cold deep link (the browser hands off to the app instead of returning to the
 * session that opened it), and then there is nothing left to exchange — the
 * session either landed or it did not, so send them somewhere real rather than
 * leaving them parked on a dead route.
 */
import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/data/DataProvider';
import { LoadingView, Screen, Text } from '@/components/ui';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { currentUser, authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    // Signed in → home. Not signed in → back to the door, which is also what a
    // cancelled or expired Google round-trip should look like.
    router.replace(currentUser && !currentUser.isAnonymous ? '/' : '/sign-in');
  }, [authLoading, currentUser, router]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Signing in' }} />
      <LoadingView />
      <Text tone="muted">Finishing sign-in…</Text>
    </Screen>
  );
}
