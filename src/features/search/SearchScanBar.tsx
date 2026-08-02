/**
 * The app's search entry, shared by Home and the category pages: a pressable
 * pill that opens the dedicated /search screen, with the bare QR scan button
 * (→ /scan) on its right.
 */
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export function SearchScanBar({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const router = useRouter();

  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={() => router.push('/search')}
        style={({ pressed }) => [
          styles.bar,
          { backgroundColor: colors.surfaceAlt },
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Search businesses and services"
      >
        <Icon name="search" size={18} color={colors.textMuted} />
        <Text tone="muted" style={styles.placeholder}>
          Search businesses, services…
        </Text>
      </Pressable>
      <Pressable
        onPress={() => router.push('/scan')}
        hitSlop={10}
        style={({ pressed }) => [
          styles.scanBtn,
          { backgroundColor: colors.surfaceAlt },
          pressed && { opacity: 0.6 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Scan a business QR code"
      >
        <Icon name="scan" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Filled rather than outlined: on the white header sheet a tinted field reads
  // as an input, where a white-on-white bordered pill nearly disappears.
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
  },
  placeholder: { flex: 1, fontSize: 15 },
  scanBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
