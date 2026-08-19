/**
 * "The rest of it is over here." — the chips under a business's showcase that
 * open the gallery it keeps somewhere else.
 *
 * We host three photos and one video per listing, which is the whole showcase
 * for a cafe and a thumbnail's worth for a wedding designer. Rather than let
 * the big ones spill onto our storage, they paste a Drive folder or an
 * Instagram profile and it renders here, labelled by where it goes.
 */
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { ShowcaseLink } from '@/domain/types';
import { describeShowcaseLink } from '@/domain/showcase';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export function ShowcaseLinks({ links }: { links: ShowcaseLink[] }) {
  const colors = useColors();
  if (links.length === 0) return null;

  return (
    <View style={styles.row}>
      {links.map((link) => {
        const { icon, label } = describeShowcaseLink(link.kind);
        return (
          <Pressable
            key={link.id}
            onPress={() => Linking.openURL(link.url).catch(() => {})}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: colors.border, backgroundColor: colors.surface },
              pressed && styles.pressed,
            ]}
            accessibilityRole="link"
            accessibilityLabel={`Open ${label}`}
          >
            <Text variant="label" weight="semibold">
              {icon} {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.7 },
});
