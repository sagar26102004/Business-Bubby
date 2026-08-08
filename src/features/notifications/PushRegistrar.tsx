/**
 * Mounted once in the root layout. Renders nothing; it does two jobs:
 *
 *  1. Registers this device's push token against the signed-in user, and
 *     un-registers it on sign-out — so the handset stops ringing for an account
 *     that is no longer using it.
 *  2. Routes a TAPPED call notification to that call, including when the tap is
 *     what launched the app from cold.
 *
 * Pairs with IncomingCallGate: the push gets the app open, the gate (which
 * polls) then shows the actual accept/decline UI and rings.
 */
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { configureNotificationHandler, getPushToken } from './push';

configureNotificationHandler();

/** Open the call a notification refers to, if it carries one. */
function openFromResponse(response: Notifications.NotificationResponse | null): void {
  const data = response?.notification.request.content.data as
    | { callId?: string }
    | undefined;
  if (data?.callId) router.push(`/call/session/${data.callId}`);
}

export function PushRegistrar() {
  const repos = useRepositories();
  const { currentUser } = useAuth();
  // Remember what we registered so sign-out can withdraw exactly that token.
  const registered = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;

    // A guest is a caller, never a callee — nothing would ever be pushed to
    // them, so don't ask for notification permission they don't need.
    if (!currentUser || currentUser.isAnonymous) {
      const stale = registered.current;
      registered.current = null;
      if (stale) void repos.push.unregister(stale).catch(() => {});
      return;
    }

    (async () => {
      const token = await getPushToken();
      if (!active || !token) return;
      try {
        await repos.push.register(token, Platform.OS);
        registered.current = token;
      } catch {
        // Table missing, offline, Path B routes not built yet — the app keeps
        // working, it just won't ring while closed.
      }
    })();

    return () => {
      active = false;
    };
  }, [repos, currentUser?.id, currentUser?.isAnonymous]);

  useEffect(() => {
    // Cold start: the tap that launched the app isn't delivered to the listener
    // below, so ask for it explicitly.
    void Notifications.getLastNotificationResponseAsync().then(openFromResponse);
    const sub = Notifications.addNotificationResponseReceivedListener(openFromResponse);
    return () => sub.remove();
  }, []);

  return null;
}
