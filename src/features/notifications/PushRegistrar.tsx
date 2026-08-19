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
// Type-only — the runtime module comes from ./notificationsModule, which
// refuses to load it in Expo Go on Android (where the import itself throws).
import type * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import {
  canDrawOverlays,
  canUseFullScreenIntent,
  openFullScreenIntentSettings,
  openOverlaySettings,
  setAnswerUriTemplate,
  setDeclineEndpoint,
} from '../../../modules/call-notification';
import { SUPABASE_URL } from '@/lib/supabase';
import { API_ROOT } from '@/data/api/client';
import { selectedBackend } from '@/data/backend';
import { useAuth, useRepositories } from '@/data/DataProvider';
import type { Repositories } from '@/data/repositories';
import { showAlert } from '@/lib/alert';
import { getNotifications } from './notificationsModule';
import {
  answerUrlFor,
  configureNotificationHandler,
  describeError,
  getPushToken,
  recordRegistration,
} from './push';

configureNotificationHandler();

/** Remembers that we've already offered this, so it's an ask and not a nag. */
const CALL_POPUP_PROMPT_KEY = 'localo.callPopupPrompted';

/**
 * The absolute URL the notification's Decline pill posts `{ callId, pushToken }`
 * to when the app is closed — one per backend, because that button runs in
 * Kotlin with no session and can only be handed a plain address.
 *
 * Null on the mock (nothing to tell), which leaves Decline doing what it always
 * did: silence this phone and let the call ring out.
 */
function declineEndpointUrl(): string | null {
  if (selectedBackend() === 'api') return `${API_ROOT}/calls/decline-by-device`;
  if (selectedBackend() === 'supabase' && SUPABASE_URL) {
    return `${SUPABASE_URL}/functions/v1/call-decline`;
  }
  return null;
}

/**
 * Offer to enable the full-screen call screen — ONCE per install.
 *
 * There are two unrelated system switches that each allow it, so this only asks
 * when BOTH are off. Android 14 ships USE_FULL_SCREEN_INTENT off for apps Play
 * doesn't classify as calling apps, and gives no runtime dialog for either one,
 * so all an app can do is point at the setting. Asked here because this is the
 * moment we know the person can actually receive calls (signed in, registering
 * a device).
 *
 * Anyone who says no can still turn it on later — see CallAlertsCheck, which
 * offers both switches — and calls keep ringing regardless.
 */
async function offerCallPopupOnce(): Promise<void> {
  const [fullScreen, overlay] = await Promise.all([canUseFullScreenIntent(), canDrawOverlays()]);
  if (fullScreen !== false || overlay === true) return;
  if (await AsyncStorage.getItem(CALL_POPUP_PROMPT_KEY)) return;
  // Written before the alert, not after: a dismissed prompt must not come back
  // on the next launch just because nothing was tapped.
  await AsyncStorage.setItem(CALL_POPUP_PROMPT_KEY, '1');
  showAlert(
    'Show calls full screen?',
    "Android needs your permission before an incoming call can take over the screen like a phone call. Either switch below is enough. Without one, calls still ring with Answer and Decline — they just look like an ordinary notification.",
    [
      { text: 'Not now', style: 'cancel' },
      // Both offered because they are separate switches on separate screens and
      // which one a given phone will actually grant is impossible to predict.
      { text: 'Over other apps', onPress: () => void openOverlaySettings() },
      { text: 'Full screen', onPress: () => void openFullScreenIntentSettings() },
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
      // Named rather than passed over in silence: "browsing as a guest" is the
      // single likeliest reason a healthy-looking phone is never rung, and it
      // is invisible from the server — which just sees nobody registered.
      recordRegistration(
        'You are browsing as a guest. Sign in on this phone so calls can be sent to it.',
      );
      const stale = registered.current;
      registered.current = null;
      if (stale) void repos.push.unregister(stale).catch(() => {});
      return;
    }

    /**
     * One attempt at making this phone reachable.
     *
     * ⚠️ RETRIED, because it used to be a single shot at cold start and every
     * failure was permanent. `getPushToken` needs a round trip to Expo's
     * servers, so a launch with no network yet — the normal case for an app
     * opened the moment the phone wakes — returned null, the effect returned,
     * and nothing ever tried again. The phone then stayed unreachable until it
     * was reinstalled, while the call-alerts check (which asks for a token
     * itself, later, with the network up) showed a cheerful tick. That is the
     * exact shape of "the check says registered and the server says no devices".
     */
    const attempt = async (): Promise<void> => {
      // Hand the deep-link shape to the native side FIRST. A push that lands
      // while the app is closed is drawn by Kotlin, which has no way to build
      // this itself — and a stored template outlives the process, so doing it
      // here means it is ready long before anyone calls.
      await setAnswerUriTemplate(answerUrlFor);
      const token = await getPushToken();
      if (!active) return;
      if (!token) {
        recordRegistration(
          'This phone could not get a push address (notification permission refused, no network at the time, or this build has no Firebase credentials). It will try again when you reopen the app.',
        );
        return;
      }
      // This device can be rung now — so it's the right moment to ask whether
      // that ring may take over the screen.
      await offerCallPopupOnce().catch(() => {});
      try {
        await repos.push.register(token, Platform.OS);
        registered.current = token;
        // Only now is the token a credential the server will recognise, so the
        // decline endpoint is handed over AFTER registration succeeds — storing
        // it first would leave a phone that failed to register able to post
        // declines the function can only reject.
        // …and it must point at the backend actually in use: Path B fires the
        // decline inside Express, Path A at the `call-decline` edge function.
        // The native side stores ONE url, so getting this wrong means Decline
        // silently goes back to ringing out.
        const declineUrl = declineEndpointUrl();
        if (declineUrl) await setDeclineEndpoint(declineUrl, token);
        recordRegistration(null);
      } catch (err) {
        // Table missing, offline, RLS refusing the write, Path B routes not
        // built yet — the app keeps working, it just won't ring while closed.
        // KEEP THE REASON. Swallowing it silently is what made "no registered
        // devices" unexplainable from the phone for as long as it was.
        recordRegistration(describeError(err));
      }
    };

    void attempt();

    // Try again every time the app comes back to the front, until it sticks.
    // Foreground is the right trigger: it is when the network is most likely to
    // be up, and it costs nothing once `registered.current` is set. Without a
    // retry the whole feature hangs on one throw at launch that nobody sees.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && active && !registered.current) void attempt();
    });

    return () => {
      active = false;
      sub.remove();
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
    // Nor in Expo Go on Android, which has no notifications module to ask.
    const N = getNotifications();
    if (!N) return;

    // Cold start: the tap that launched the app isn't delivered to the listener
    // below, so ask for it explicitly.
    void N.getLastNotificationResponseAsync().then(handle).catch(() => {});
    const sub = N.addNotificationResponseReceivedListener((r) => void handle(r));
    return () => sub.remove();
  }, []);

  return null;
}
