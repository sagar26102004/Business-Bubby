/**
 * "Can this phone actually reach me?" — the two settings that decide whether a
 * closed app rings, both of which Android hands to the user rather than to us.
 *
 * Worth its own card because the failure is INVISIBLE. Notification permission
 * is asked for once and, if declined, never asked again; full-screen intent is
 * never asked for at all. Either way the app looks fine, calls look fine from
 * the caller's side, and this handset simply never rings — which is the one
 * failure a business cannot afford.
 *
 * Renders NOTHING when both are in order, so it is invisible on a healthy
 * device and only speaks up when there is something to fix.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Button, Card, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';
import {
  canUseFullScreenIntent,
  openFullScreenIntentSettings,
} from '../../../modules/call-notification';

interface Health {
  /** Are notifications allowed at all? Without this nothing rings, ever. */
  notificationsAllowed: boolean;
  /** May a call take over the screen? null = the question doesn't apply here. */
  fullScreen: boolean | null;
}

export function CallAlertsCheck() {
  const [health, setHealth] = useState<Health | null>(null);

  const check = useCallback(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      const [permission, fullScreen] = await Promise.all([
        Notifications.getPermissionsAsync().catch(() => null),
        canUseFullScreenIntent(),
      ]);
      setHealth({ notificationsAllowed: permission?.granted !== false, fullScreen });
    })();
  }, []);

  useEffect(() => {
    check();
    // Both toggles live in system Settings, i.e. OUTSIDE the app — coming back
    // to it is the only moment we can notice they changed.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  if (!health) return null;

  // Notifications off is the more serious of the two and makes the other moot,
  // so it is shown alone rather than stacked with a second thing to fix.
  if (!health.notificationsAllowed) {
    return (
      <Card style={styles.card}>
        <Text weight="bold">🔕 This phone can&apos;t alert you</Text>
        <Text variant="caption" tone="muted" style={styles.body}>
          Notifications are turned off for Localo, so calls and messages won&apos;t reach you while
          the app is closed. Android only asks once — after that it has to be turned back on in
          Settings.
        </Text>
        <Button
          title="Open app settings"
          onPress={() => void Linking.openSettings()}
          style={styles.button}
        />
      </Card>
    );
  }

  if (health.fullScreen !== false) return null;

  return (
    <Card style={styles.card}>
      <Text weight="bold">📞 Show calls full screen</Text>
      <Text variant="caption" tone="muted" style={styles.body}>
        Android needs your permission before an incoming call can take over the screen the way a
        phone call does. Until then calls still ring with Answer and Decline buttons — they just
        arrive as an ordinary notification.
      </Text>
      <Button
        title="Open Android settings"
        variant="secondary"
        onPress={() => void openFullScreenIntentSettings()}
        style={styles.button}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  body: { marginTop: spacing.xs },
  button: { marginTop: spacing.md },
});
