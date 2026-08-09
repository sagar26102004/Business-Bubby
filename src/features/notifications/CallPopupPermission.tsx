/**
 * The one permission that decides whether an incoming call LOOKS like a call.
 *
 * Android 14 turned USE_FULL_SCREEN_INTENT from an install-time grant into a
 * per-app switch that ships OFF for everyone Google Play doesn't classify as a
 * calling app. Declaring it in the manifest changes nothing, and there is no
 * runtime dialog — the only thing an app may do is walk the user to the toggle.
 *
 * Without it a call still rings, with Answer and Decline buttons, but as a
 * banner rather than the full call screen. So this is an invitation, never a
 * gate: nothing here blocks the app, and it disappears entirely once granted
 * (or on any device where the question doesn't apply).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { Button, Card, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';
import {
  canUseFullScreenIntent,
  openFullScreenIntentSettings,
} from '../../../modules/call-notification';

export function CallPopupPermission() {
  // null = not asked yet or not applicable here (web, Expo Go, older Android).
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const check = useCallback(() => {
    void canUseFullScreenIntent().then(setAllowed);
  }, []);

  useEffect(() => {
    check();
    // The user grants this in Settings, i.e. OUTSIDE the app — so the only
    // moment we can notice is when they come back to it.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  if (allowed !== false) return null;

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
