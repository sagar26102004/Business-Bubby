/**
 * Mounted once in the root layout. Renders nothing; it does three jobs:
 *
 *  1. Registers this device's push token against the signed-in user, and
 *     un-registers it on sign-out — so the handset stops ringing for an account
 *     that is no longer using it.
 *  2. Acts on the ACCEPT / DECLINE buttons carried by an incoming-call
 *     notification, so the owner answers straight from the popup.
 *  3. Routes a plain tap (notification body, no button) to that call, including
 *     when the tap is what launched the app from cold.
 *
 * Pairs with IncomingCallGate: the push gets the app open, the gate (which
 * polls) then shows the accept/decline UI and rings.
 */
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import {
  canUseFullScreenIntent,
  openFullScreenIntentSettings,
  setAnswerUriTemplate,
} from '../../../modules/call-notification';
import { useAuth, useRepositories } from '@/data/DataProvider';
import type { Repositories } from '@/data/repositories';
import { answerUrlFor, configureNotificationHandler, getPushToken } from './push';

configureNotificationHandler();

/** Remembers that we've already offered this, so it's an ask and not a nag. */
const CALL_POPUP_PROMPT_KEY = 'localo.callPopupPrompted';

/**
 * Offer to enable the full-screen call popup — ONCE per install.
 *
 * Android 14 ships USE_FULL_SCREEN_INTENT switched off for apps Play doesn't
 * classify as calling apps, and gives no runtime dialog for it, so the app can
 * only point at the setting. Asked here because this is the moment we know the
 * person can actually receive calls (signed in, registering a device).
 *
 * Anyone who says no can still turn it on later from Notifications settings —
 * see CallPopupPermission — and calls keep ringing regardless.
 */
async function offerCallPopupOnce(): Promise<void> {
  if ((await canUseFullScreenIntent()) !== false) return;
  if (await AsyncStorage.getItem(CALL_POPUP_PROMPT_KEY)) return;
  // Written before the alert, not after: a dismissed prompt must not come back
  // on the next launch just because nothing was tapped.
  await AsyncStorage.setItem(CALL_POPUP_PROMPT_KEY, '1');
  Alert.alert(
    'Show calls full screen?',
    "Android needs your permission before an incoming call can take over the screen like a phone call. Without it calls still ring with Answer and Decline — they just look like an ordinary notification.",
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => void openFullScreenIntentSettings() },
    ],
  );
}

/** The callId a call notification carries, or null if it isn't one. */
function callIdOf(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { callId?: string } | undefined;
  return data?.callId ?? null;
}

export function PushRegistrar() {
  const repos = useRepositories();
  const { currentUser } = useAuth();
  // Remember what we registered so sign-out can withdraw exactly that token.
  const registered = useRef<string | null>(null);
  // The response listener is registered ONCE (re-subscribing on every auth
  // change would drop the cold-start response), so it reads the live values
  // through refs rather than closing over stale ones.
  const live = useRef<{ repos: Repositories; userId?: string }>({ repos });
  live.current = { repos, userId: currentUser?.id };

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
      // Hand the deep-link shape to the native side FIRST. A push that lands
      // while the app is closed is drawn by Kotlin, which has no way to build
      // this itself — and a stored template outlives the process, so doing it
      // here means it is ready long before anyone calls.
      await setAnswerUriTemplate(answerUrlFor);
      const token = await getPushToken();
      if (!active || !token) return;
      // This device can be rung now — so it's the right moment to ask whether
      // that ring may take over the screen.
      await offerCallPopupOnce().catch(() => {});
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
    const handle = async (response: Notifications.NotificationResponse | null) => {
      const callId = callIdOf(response);
      if (!callId || !response) return;
      const { repos: r, userId } = live.current;

      if (response.actionIdentifier === 'decline') {
        // Fire-and-forget: Decline does NOT open the app, so this only runs
        // when the process happens to still be alive (backgrounded, the common
        // case). If it was fully killed nothing runs here and the call simply
        // rings out to "missed" — the right outcome either way, since the user
        // has told us they aren't answering.
        if (userId) await r.calls.decline(callId, userId).catch(() => {});
        return;
      }

      // Accept, or a plain tap on the notification body. Join FIRST so the
      // caller hears the answer immediately, then land on the live call —
      // otherwise the session screen would open still showing "Join call" and
      // the person who just pressed Accept would have to press it again.
      if (response.actionIdentifier === 'accept' && userId) {
        await r.calls.join(callId, userId).catch(() => {});
      }
      router.push(`/call/session/${callId}`);
    };

    // There are no OS notifications to respond to in a browser tab, and asking
    // THROWS there rather than returning nothing — synchronously, out of an
    // effect, which takes the whole page down with it. Nothing below this line
    // has a web equivalent.
    if (Platform.OS === 'web') return;

    // Cold start: the tap that launched the app isn't delivered to the listener
    // below, so ask for it explicitly.
    void Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    return () => sub.remove();
  }, []);

  return null;
}
