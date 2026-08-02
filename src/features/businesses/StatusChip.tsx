/**
 * Open/Closed (or Available/Rented) chip, shared by the business card and the
 * business page so a listing's status looks identical wherever you meet it.
 *
 * Soft-tinted rather than a saturated badge: status is supporting information,
 * not the loudest thing on the card.
 */
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export function StatusChip({ label, positive }: { label: string; positive: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[styles.pill, { backgroundColor: positive ? colors.brandSoft : colors.surfaceAlt }]}
    >
      <Text
        variant="caption"
        weight="bold"
        style={{ color: positive ? colors.brandText : colors.textMuted }}
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
