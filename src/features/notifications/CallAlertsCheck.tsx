/**
 * "Can this phone actually ring?" — every link in the chain, checked on the
 * device, plus buttons that ring it and show the call screen here and now, plus
 * the log of what happened to calls that arrived while the app was closed.
 *
 * Worth building because the failure is INVISIBLE and the chain is long: a
 * permission asked once and never again, a notification channel that only
 * exists after the app has run, an Accept/Decline category registered at
 * sign-in, a push token that changes on every reinstall, a call screen that
 * needs one of two unrelated system switches, and a battery setting that can
 * stop the push arriving at all. Any one of them silently means the phone never
 * rings, and from the caller's side all seven look identical.
 *
 * The two test buttons are the important half: together they separate "this
 * phone cannot draw a call" from "the push never arrived", which is otherwise a
 * two-device experiment. The ring log settles it outright.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as ExpoLinking from 'expo-linking';
import { Button, Card, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';
import {
  canDrawOverlays,
  canUseFullScreenIntent,
  clearRingLog,
  getRingLog,
  isCallNotificationAvailable,
  isIgnoringBatteryOptimizations,
  openBatterySettings,
  openFullScreenIntentSettings,
  openOverlaySettings,
  showCallScreen,
  showIncomingCall,
} from '../../../modules/call-notification';
import { useRepositories } from '@/data/DataProvider';
import {
  CALL_CATEGORY_ID,
  CALL_CHANNEL_ID,
  getLastRegistration,
  getPushToken,
} from './push';
import { getLastRingPush } from './ringPushLog';

/** Identifies each row, so the buttons below can key off a fixed name. */
type CheckId =
  | 'permission'
  | 'channel'
  | 'category'
  | 'token'
  | 'registered'
  | 'module'
  | 'callScreen'
  | 'battery';

interface Check {
  id: CheckId;
  label: string;
  ok: boolean;
  /** Shown only when the check fails — what it means and what to do. */
  fix?: string;
}

/** How long the test call hangs around before clearing itself. */
const TEST_RING_MS = 15_000;

export function CallAlertsCheck() {
  const colors = useColors();
  const repos = useRepositories();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  // The ring-push result lives in memory rather than state, so nothing tells
  // React it changed. Bumping this is how the web card re-reads it.
  const [, setTick] = useState(0);

  const run = useCallback(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      const [permission, channel, categories, fullScreen, overlay, battery, token, entries] =
        await Promise.all([
          Notifications.getPermissionsAsync().catch(() => null),
          Notifications.getNotificationChannelAsync(CALL_CHANNEL_ID).catch(() => null),
          Notifications.getNotificationCategoriesAsync().catch(() => []),
          canUseFullScreenIntent(),
          canDrawOverlays(),
          isIgnoringBatteryOptimizations(),
          getPushToken(),
          getRingLog(),
        ]);

      // Asked AFTER the token, because it is a question about that token. A
      // failure here is a "no" — the point of the row is that we could not
      // confirm the server will ring this phone, and an unreachable server
      // cannot confirm it either.
      const registered = token
        ? await repos.push.isRegistered(token).catch(() => false)
        : false;

      const next: Check[] = [
        {
          id: 'permission',
          label: 'Notifications allowed',
          ok: permission?.granted === true,
          fix: 'Android only asks once. Turn Localo’s notifications back on in system Settings.',
        },
        {
          id: 'channel',
          label: 'Ring channel installed',
          ok: !!channel,
          fix: 'Created when you sign in. Sign out and back in, or reinstall.',
        },
        {
          id: 'category',
          label: 'Answer / Decline buttons',
          ok: categories.some((c) => c.identifier === CALL_CATEGORY_ID),
          fix: 'Registered at sign-in. Sign out and back in.',
        },
        {
          id: 'token',
          label: 'This phone has a push address',
          ok: !!token,
          // The token changes on every install, so a phone that was reinstalled
          // and not signed into is registered under an address that is gone.
          fix: 'This phone has no push address. Sign in again — a reinstall invalidates the old one.',
        },
        {
          id: 'registered',
          // ⚠️ THE ONE ABOVE IS NOT THIS ONE. Minting a token happens entirely
          // on the device; storing it happens on the server and can fail on its
          // own — silently, because a registration error must never break the
          // app, and not at all when you are browsing as a guest. A phone that
          // passes the row above and fails this one looks completely healthy
          // and is never rung, which is exactly the hole this check exists to
          // close: the server said "no registered devices" while the phone
          // said it was registered, and both were telling the truth.
          label: 'Your account will be rung on this phone',
          ok: registered === true,
          // Prefer what actually went wrong over the generic advice — the
          // registrar now keeps the reason instead of discarding it.
          fix:
            getLastRegistration() ??
            'This phone has an address but the server has not stored it against your account. Make sure you are SIGNED IN (not browsing as a guest), then reopen this screen.',
        },
        {
          id: 'module',
          label: 'Call screen in this build',
          ok: isCallNotificationAvailable(),
          fix: 'This build has no call screen; calls fall back to a notification with buttons.',
        },
        {
          id: 'callScreen',
          // Either permission is enough — they are two routes to the same place.
          label: 'Calls can take over the screen',
          ok: fullScreen !== false || overlay === true,
          fix: 'Calls will ring as a notification instead of a full call screen. Granting either switch below fixes it.',
        },
        {
          id: 'battery',
          label: 'Allowed to wake for calls',
          ok: battery !== false,
          fix: 'Battery saving can stop calls reaching this phone at all while the app is closed — nothing else here can help if it does.',
        },
      ];
      setChecks(next);
      setLog(entries);
    })();
  }, [repos]);

  useEffect(() => {
    run();
    // These live in system Settings, i.e. outside the app — coming back to it
    // is the only moment we can notice they changed.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, [run]);

  /**
   * Ring this phone right now, through exactly the path a real call uses.
   *
   * Answer points at a call id that doesn't exist, because there is no call
   * behind this — the questions being answered are only "does anything appear",
   * "does it have buttons", and "does the full-screen version come up".
   */
  const testRing = async (withScreen: boolean) => {
    setTesting(true);
    setTestResult(null);
    try {
      if (withScreen) {
        const outcome = await showCallScreen({
          callId: 'test-ring',
          callerName: 'Test call',
          businessName: 'this phone',
          timeoutMs: TEST_RING_MS,
        });
        setTestResult(
          outcome === null
            ? 'This build has no call screen.'
            : // Android only lets a full-screen intent TAKE OVER the display
              // when the phone is locked or idle; with the app in front of you
              // it deliberately downgrades to a notification, which looks like
              // a failure and isn't. The overlay route has no such rule.
              outcome.includes('full-screen intent')
              ? `${outcome}. On this route Android only takes over the screen when the phone is locked — lock it and call again to see the real thing.`
              : outcome,
        );
        return;
      }

      const shown = await showIncomingCall({
        callId: 'test-ring',
        callerName: 'Test call',
        businessName: 'this phone',
        channelId: CALL_CHANNEL_ID,
        answerUri: ExpoLinking.createURL('/'),
        timeoutMs: TEST_RING_MS,
      });
      setTestResult(
        shown
          ? 'Posted the call notification. If nothing appeared, Android is blocking it.'
          : 'Nothing could be posted — check the failing rows above.',
      );
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Nothing could be posted.');
    } finally {
      setTesting(false);
    }
  };

  const lastPush = getLastRingPush();
  /**
   * What the server made of the last call placed from this device.
   *
   * `sent` counts devices the push service ACCEPTED, so it can be short of
   * `attempted` — the half-failure that used to be invisible, and the one that
   * matters when a business has two phones and only one rings.
   */
  const lastPushLine = lastPush
    ? lastPush.sent
      ? `pushed to ${lastPush.sent} device${lastPush.sent === 1 ? '' : 's'}` +
        (lastPush.attempted && lastPush.attempted > lastPush.sent
          ? ` of ${lastPush.attempted} — the rest were refused: ${(lastPush.failures ?? []).join('; ')}`
          : '')
      : (lastPush.reason ?? 'the server rang nobody and said nothing')
    : null;

  /**
   * A browser tab can place calls but never receives them, so none of the
   * device checks apply — except the one that matters most from the calling
   * side, and which is otherwise only visible in the Supabase dashboard: did
   * the server find anyone to ring at all? "No registered devices" and "the
   * phone dropped it" are the same silence from here, and completely different
   * problems.
   */
  if (Platform.OS === 'web') {
    if (!lastPushLine) return null;
    return (
      <Card style={styles.card}>
        <Text weight="bold">📞 Last call you placed</Text>
        <Text variant="caption" tone="muted" style={styles.body}>
          The server {lastPushLine}. Calls only ring on phones — this is here so
          you can tell a call that was never sent from one that was never shown.
        </Text>
        <Button
          title="Check again"
          variant="secondary"
          onPress={() => setTick((t) => t + 1)}
          style={styles.button}
        />
      </Card>
    );
  }

  if (!checks) return null;

  const failed = (id: CheckId) => checks.some((c) => c.id === id && !c.ok);
  const failing = checks.filter((c) => !c.ok);

  return (
    <Card style={styles.card}>
      <Text weight="bold">📞 Call alerts on this phone</Text>
      <Text variant="caption" tone="muted" style={styles.body}>
        {failing.length === 0
          ? 'Everything needed to ring while the app is closed is in place.'
          : `${failing.length} thing${failing.length === 1 ? '' : 's'} would stop this phone ringing.`}
      </Text>

      <View style={styles.rows}>
        {checks.map((c) => (
          <View key={c.id} style={styles.row}>
            <Text variant="caption">{c.ok ? '✅' : '⚠️'}</Text>
            <View style={styles.rowText}>
              <Text variant="caption" weight={c.ok ? 'regular' : 'semibold'}>
                {c.label}
              </Text>
              {!c.ok && c.fix ? (
                <Text variant="caption" tone="muted">
                  {c.fix}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {lastPushLine ? (
        <Text variant="caption" tone="muted" style={styles.body}>
          Last call you placed from this device: {lastPushLine}.
        </Text>
      ) : null}

      <Button
        title={testing ? 'Ringing…' : 'Ring this phone now'}
        onPress={() => void testRing(false)}
        disabled={testing}
        style={styles.button}
      />
      <Button
        title="Show the call screen"
        variant="secondary"
        onPress={() => void testRing(true)}
        disabled={testing}
        style={styles.button}
      />
      {testResult ? (
        <Text variant="caption" tone="muted" style={[styles.body, { color: colors.textMuted }]}>
          {testResult}
        </Text>
      ) : null}

      {failed('permission') ? (
        <Button
          title="Open app settings"
          variant="secondary"
          onPress={() => void Linking.openSettings()}
          style={styles.button}
        />
      ) : null}
      {failed('callScreen') ? (
        <>
          <Button
            title="Allow full-screen calls"
            variant="secondary"
            onPress={() => void openFullScreenIntentSettings()}
            style={styles.button}
          />
          <Button
            title="Allow display over other apps"
            variant="secondary"
            onPress={() => void openOverlaySettings()}
            style={styles.button}
          />
        </>
      ) : null}
      {failed('battery') ? (
        <Button
          title="Stop battery saving for Localo"
          variant="secondary"
          onPress={() => void openBatterySettings()}
          style={styles.button}
        />
      ) : null}

      {/*
        The ring log. Hidden behind a tap because it is meaningless to most
        people and indispensable to whoever is debugging a phone that stays
        quiet — it is written by the push handler while the app is CLOSED, which
        is the one situation with no other way to see anything at all. An empty
        log after a missed call is itself the answer: the push never arrived.
      */}
      <Button
        title={showLog ? 'Hide call history' : 'What happened to my calls?'}
        variant="secondary"
        onPress={() => {
          setShowLog((s) => !s);
          run();
        }}
        style={styles.button}
      />
      {showLog ? (
        <View style={styles.log}>
          {log.length === 0 ? (
            <Text variant="caption" tone="muted">
              Nothing recorded yet. If someone called this phone and this stays
              empty, the call never reached the device — that points at the push
              address or battery saving, not at the notification.
            </Text>
          ) : (
            log.map((line, i) => (
              <Text key={`${i}-${line}`} variant="caption" tone="muted">
                {line}
              </Text>
            ))
          )}
          {log.length > 0 ? (
            <Button
              title="Clear"
              variant="secondary"
              onPress={() => {
                void clearRingLog().then(run);
              }}
              style={styles.button}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  body: { marginTop: spacing.xs },
  rows: { marginTop: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowText: { flex: 1 },
  button: { marginTop: spacing.md },
  log: { marginTop: spacing.md, gap: spacing.xs },
});
