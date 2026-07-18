/**
 * The three products in one app, Flipkart-style: 🛍️ Explore (browse local
 * businesses) ⇄ 🏷️ Stalls (what people around you are selling) ⇄ 🏢 My Business
 * (the business side). Every one of those three home screens starts with this
 * row, so a single tap flips between them; the active pill is solid.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export type Mode = 'explore' | 'stalls' | 'business';

const MODES: { id: Mode; icon: string; label: string; href: '/' | '/stalls' | '/my-business' }[] = [
  { id: 'explore', icon: '🛍️', label: 'Explore', href: '/' },
  { id: 'stalls', icon: '🏷️', label: 'Stalls', href: '/stalls' },
  { id: 'business', icon: '🏢', label: 'My Business', href: '/my-business' },
];

export function ModePills({ active }: { active: Mode }) {
  const router = useRouter();
  const colors = useColors();

  return (
    <View style={styles.row}>
      {MODES.map((m) => {
        const isActive = m.id === active;
        const pill = (
          <View
            style={[
              styles.pill,
              { backgroundColor: isActive ? colors.surface : colors.surface + 'C9' },
            ]}
          >
            <Text style={styles.icon}>{m.icon}</Text>
            <Text
              variant="label"
              weight={isActive ? 'bold' : 'semibold'}
              tone={isActive ? 'default' : 'muted'}
              numberOfLines={1}
            >
              {m.label}
            </Text>
          </View>
        );
        return isActive ? (
          <View key={m.id} style={styles.slot}>
            {pill}
          </View>
        ) : (
          <Pressable key={m.id} style={styles.slot} onPress={() => router.push(m.href)}>
            {pill}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  slot: { flex: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 46,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
  },
  icon: { fontSize: 16 },
});
