/**
 * Manage notifications (everywhere) — the customer-side switchboard, opened
 * from the Alerts tab. Turning a family off here silences it for EVERY
 * business; per-business muting lives in each workspace.
 */
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { Screen, Text } from '@/components/ui';
import { MuteSettings } from '@/features/notifications/MuteSettings';
import { spacing } from '@/theme/theme';

export default function NotificationSettingsScreen() {
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <Text variant="subheading" weight="bold">
        What you get alerted about
      </Text>
      <Text variant="caption" tone="muted" style={styles.subtitle}>
        Applies to every business. To silence just one of them, open its workspace › Manage
        notifications.
      </Text>
      <MuteSettings />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
});
