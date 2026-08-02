/**
 * Open/Closed (or Available/Rented) chip, shared by the business card and the
 * business page so a listing's status looks identical wherever you meet it.
 *
 * Soft-tinted rather than a saturated badge: status is supporting information,
 * not the loudest thing on the card.
 *
 * Deliberately GREEN rather than the orange brand color — "open" and
 * "available" are the one place where the color should mean the thing it
 * conventionally means, not carry the brand.
 */
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui';
import { palette, radius, spacing, useColors } from '@/theme/theme';

export function StatusChip({ label, positive }: { label: string; positive: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[styles.pill, { backgroundColor: positive ? colors.successSoft : colors.surfaceAlt }]}
    >
      <Text
        variant="caption"
        weight="bold"
        style={{ color: positive ? palette.successDark : colors.textMuted }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
});
