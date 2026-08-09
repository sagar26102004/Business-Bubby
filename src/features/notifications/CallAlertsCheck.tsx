/**
 * "Can this phone actually ring?" — every link in the chain, checked on the
 * device, plus a button that rings it here and now.
 *
 * Worth building because the failure is INVISIBLE and the chain is long: a
 * permission asked once and never again, a notification channel that only
 * exists after the app has run, an Accept/Decline category registered at
 * sign-in, a push token that changes on every reinstall, a native popup that
 * may not be in this build, and a full-screen permission Android hands out to
 * almost nobody. Any one of them silently means the phone never rings, and
 * from the caller's side all six look identical.
 *
 * The test ring is the important half: it separates "this phone cannot draw a
 * call notification" from "the push never arrived", which is otherwise a
 * two-device experiment.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as ExpoLinking from 'expo-linking';
import { Button, Card, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';
import {
  canUseFullScreenIntent,
  isCallNotificationAvailable,
  openFullScreenIntentSettings,
  showIncomingCall,
} from '../../../modules/call-notification';
import { CALL_CATEGORY_ID, CALL_CHANNEL_ID, getPushToken } from './push';
import { getLastRingPush } from './ringPushLog';

interface Check {
  label: string;
  ok: boolean;
  /** Shown only when the check fails — what it means and what to do. */
  fix?: string;
}

/** How long the test notification hangs around before clearing itself. */
const TEST_RING_MS = 15_000;

export function CallAlertsCheck() {
  const colors = useColors();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const run = useCallback(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      const [permission, channel, categories, fullScreen, token] = await Promise.all([
        Notifications.getPermissionsAsync().catch(() => null),
        Notifications.getNotificationChannelAsync(CALL_CHANNEL_ID).catch(() => null),
        Notifications.getNotificationCategoriesAsync().catch(() => []),
        canUseFullScreenIntent(),
        getPushToken(),
      ]);

      const next: Check[] = [
        {
          label: 'Notifications allowed',
          ok: permission?.granted === true,
          fix: 'Android only asks once. Turn Localo’s notifications back on in system Settings.',
        },
        {
          label: 'Ring channel installed',
          ok: !!channel,
          fix: 'Created when you sign in. Sign out and back in, or reinstall.',
        },
        {
          label: 'Answer / Decline buttons',
          ok: categories.some((c) => c.identifier === CALL_CATEGORY_ID),
          fix: 'Registered at sign-in. Sign out and back in.',
        },
        {
          label: 'Registered for calls while closed',
          ok: !!token,
          // The token changes on every install, so a phone that was reinstalled
          // and not signed into is registered under an address that is gone.
          fix: 'This phone has no push address. Sign in again — a reinstall invalidates the old one.',
        },
        {
          label: 'Call popup available',
          ok: isCallNotificationAvailable(),
          fix: 'This build has no call popup; calls fall back to a plain notification with buttons.',
        },
        {
          label: 'Calls can take over the screen',
          ok: fullScreen !== false,
          fix: 'Optional. Without it a call arrives as a notification instead of a full call screen.',
        },
      ];
      setChecks(next);
    })();
  }, []);

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
   * Answer points at the app's home rather than a call session, because there
   * is no call behind this — the question being answered is only "does anything
   * appear, and does it have buttons".
   */
  const testRing = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const shown = await showIncomingCall({
        callId: 'test-ring',
        callerName: 'Test call',
        businessName: 'this phone',
        channelId: CALL_CHANNEL_ID,
        answerUri: ExpoLinking.createURL('/'),
        timeoutMs: TEST_RING_MS,
      });
      if (shown) {
        setTestResult('Posted the call popup. If nothing appeared, Android is blocking it.');
      } else {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '📞 Test call',
            body: 'Incoming call for this phone',
            categoryIdentifier: CALL_CATEGORY_ID,
            data: { kind: 'incoming_call', callId: 'test-ring' },
          },
          trigger: { channelId: CALL_CHANNEL_ID },
        });
        setTestResult('Posted an ordinary notification — the call popup was unavailable.');
      }
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Nothing could be posted.');
    } finally {
      setTesting(false);
    }
  };

  if (Platform.OS === 'web' || !checks) return null;

  const failing = checks.filter((c) => !c.ok);
  const lastPush = getLastRingPush();

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
          <View key={c.label} style={styles.row}>
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

      {lastPush ? (
        <Text variant="caption" tone="muted" style={styles.body}>
          Last call you placed from this device:{' '}
          {lastPush.sent !== undefined
            ? `pushed to ${lastPush.sent} device${lastPush.sent === 1 ? '' : 's'}`
            : (lastPush.reason ?? 'no answer from the server')}
          .
        </Text>
      ) : null}

      <Button
        title={testing ? 'Ringing…' : 'Ring this phone now'}
        onPress={() => void testRing()}
        disabled={testing}
        style={styles.button}
      />
      {testResult ? (
        <Text variant="caption" tone="muted" style={[styles.body, { color: colors.textMuted }]}>
          {testResult}
        </Text>
      ) : null}

      {checks.some((c) => c.label === 'Notifications allowed' && !c.ok) ? (
        <Button
          title="Open app settings"
          variant="secondary"
          onPress={() => void Linking.openSettings()}
          style={styles.button}
        />
      ) : null}
      {checks.some((c) => c.label === 'Calls can take over the screen' && !c.ok) ? (
        <Button
          title="Allow full-screen calls"
          variant="secondary"
          onPress={() => void openFullScreenIntentSettings()}
          style={styles.button}
        />
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
});
