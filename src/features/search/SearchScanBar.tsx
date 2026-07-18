/**
 * The app's search entry, shared by Home and the category pages: a pressable
 * pill that opens the dedicated /search screen, with the bare QR scan button
 * (→ /scan) on its right.
 */
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { ScanIcon, SearchIcon, Text } from '@/components/ui';
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
          { backgroundColor: colors.surface, borderColor: colors.border },
          pressed && { opacity: 0.8 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Search businesses and services"
      >
        <SearchIcon size={18} />
        <Text tone="muted" style={styles.placeholder}>
          Search businesses, services…
        </Text>
      </Pressable>
      <Pressable
        onPress={() => router.push('/scan')}
        hitSlop={10}
        style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="Scan a business QR code"
      >
        <ScanIcon size={22} color={colors.brandText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  placeholder: { flex: 1, fontSize: 15 },
  scanBtn: { paddingHorizontal: spacing.xs },
});
