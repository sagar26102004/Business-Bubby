/**
 * Manage notifications (everywhere) — the customer-side switchboard, opened
 * from the Alerts tab. Turning a family off here silences it for EVERY
 * business; per-business muting lives in each workspace.
 */
import { Stack } from 'expo-router';
import { Screen, Text } from '@/components/ui';
import { CallAlertsCheck } from '@/features/notifications/CallAlertsCheck';
import { MuteSettings } from '@/features/notifications/MuteSettings';

export default function NotificationSettingsScreen() {
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Notifications' }} />
      {/* Renders nothing unless this device can't actually alert you. */}
      <CallAlertsCheck />
      <Text variant="subheading" weight="bold">
        What you get alerted about
      </Text>
      <MuteSettings />
    </Screen>
  );
}
