/**
 * "You're acting as a platform super-admin" — shown on any owner-facing screen
 * a super-admin has opened for a business they don't own.
 *
 * Why it exists: a super-admin onboards businesses for owners who aren't running
 * the app yet, so they spend most of their time editing OTHER PEOPLE'S shops.
 * Nothing else on those screens looks different from editing your own, and
 * repricing the wrong restaurant's menu is a genuinely easy mistake. This names
 * the business being edited, every time.
 */
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export interface SuperAdminBannerProps {
  /** The business being acted on. */
  businessName: string;
  /** What this screen edits, e.g. "menu & prices" — completes the sentence. */
  what?: string;
}

export function SuperAdminBanner({ businessName, what }: SuperAdminBannerProps) {
  const colors = useColors();
  return (
    <View
      style={[styles.wrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
    >
      <Text variant="caption" weight="bold">
        🛡️ Acting as platform super-admin
      </Text>
      <Text variant="caption" tone="muted">
        You’re editing {what ? `the ${what} of ` : ''}
        <Text variant="caption" weight="semibold">
          {businessName}
        </Text>
        , which you don’t own. Changes are live for their customers immediately.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 2,
    marginBottom: spacing.lg,
  },
});
