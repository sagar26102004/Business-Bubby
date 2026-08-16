/**
 * Navigation helpers.
 *
 * `useDismiss` is "close this screen": go back if there is somewhere to go
 * back to, otherwise REPLACE with a sensible parent.
 *
 * The fallback is not theoretical. Deep links survive a cold start (a printed
 * QR code, a push notification, an Android App Link — see `ColdStartRedirect`
 * in app/_layout.tsx), so a screen can be the very first route in the stack.
 * A bare `router.back()` there does nothing at all: the action completes, the
 * screen doesn't move, and the person taps the button again. In development it
 * also logs "The action 'GO_BACK' was not handled by any navigator".
 */
import { useCallback } from 'react';
import { useRouter, type Href } from 'expo-router';

export function useDismiss(fallback: Href): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}
