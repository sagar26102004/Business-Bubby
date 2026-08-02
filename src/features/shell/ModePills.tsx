/**
 * The three products in one app: Explore (browse local businesses) ⇄ Stalls
 * (what people around you are selling) ⇄ My Business (the business side).
 * Every one of those three home screens starts with this row, so a single tap
 * flips between them.
 *
 * Rendered as one segmented control — a single sand-colored track with the
 * active segment filled in brand green — rather than three floating pills.
 * It reads as one control with three states instead of three buttons, and it
 * no longer depends on sitting over a colored gradient to be legible.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon, Text, type IconName } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export type Mode = 'explore' | 'stalls' | 'business';

const MODES: { id: Mode; icon: IconName; label: string; href: '/' | '/stalls' | '/my-business' }[] =
  [
    { id: 'explore', icon: 'bag', label: 'Explore', href: '/' },
    { id: 'stalls', icon: 'ticket', label: 'Stalls', href: '/stalls' },
    { id: 'business', icon: 'store', label: 'My Business', href: '/my-business' },
  ];

export function ModePills({ active }: { active: Mode }) {
  const router = useRouter();
  const colors = useColors();

  return (
    <View style={[styles.track, { backgroundColor: colors.surface }]}>
      {MODES.map((m) => {
        const isActive = m.id === active;
        const tint = isActive ? colors.textInverse : colors.textMuted;
        const segment = (
          <View
            style={[styles.segment, isActive && { backgroundColor: colors.brand }]}
          >
            <Icon name={m.icon} size={16} color={tint} filled={isActive} />
            <Text
              variant="label"
              weight="bold"
              tone={isActive ? 'inverse' : 'muted'}
              numberOfLines={1}
              style={styles.label}
            >
              {m.label}
            </Text>
          </View>
        );
        return isActive ? (
          <View key={m.id} style={styles.slot}>
            {segment}
          </View>
        ) : (
          <Pressable key={m.id} style={styles.slot} onPress={() => router.push(m.href)}>
            {segment}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: radius.pill, padding: 4 },
  slot: { flex: 1 },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 1,
    height: 40,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
  },
  label: { fontSize: 13 },
});
