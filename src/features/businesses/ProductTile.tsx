/**
 * Picture-first tile for the Stalls grid. Unlike BusinessCard (which sells a
 * business), this sells ONE item: the photo fills the block, the price sits on
 * it top-right, and the name + one-line description read underneath.
 */
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export interface StallProduct {
  /** Stable key: stall id + product id. */
  key: string;
  name: string;
  price?: string;
  description?: string;
  /** Cover photo — the first of the product's photos. */
  imageUrl?: string;
  sold?: boolean;
  /** Emoji shown when the seller hasn't added a photo. */
  emoji: string;
  sellerName: string;
  distanceLabel?: string;
  onPress: () => void;
}

export function ProductTile({ item }: { item: StallProduct }) {
  const colors = useColors();

  return (
    <Pressable
      onPress={item.onPress}
      style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.imageWrap, { backgroundColor: colors.surfaceAlt }]}>
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            style={[styles.image, item.sold && styles.faded]}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderEmoji}>{item.emoji}</Text>
          </View>
        )}
        {item.price ? (
          <View style={[styles.price, { backgroundColor: colors.brand }]}>
            <Text variant="caption" weight="bold" tone="inverse">
              {item.price}
            </Text>
          </View>
        ) : null}
        {/* Sold items stay listed — their public thread is worth reading. */}
        {item.sold ? (
          <View style={[styles.sold, { backgroundColor: colors.textMuted }]}>
            <Text variant="caption" weight="bold" tone="inverse">
              SOLD
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text weight="bold" numberOfLines={1}>
          {item.name}
        </Text>
        {item.description ? (
          <Text variant="caption" tone="muted" numberOfLines={2} style={styles.description}>
            {item.description}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted" numberOfLines={1} style={styles.seller}>
          {item.sellerName}
          {item.distanceLabel ? ` · ${item.distanceLabel}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  imageWrap: { width: '100%', aspectRatio: 1 },
  image: { width: '100%', height: '100%' },
  faded: { opacity: 0.45 },
  sold: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholderEmoji: { fontSize: 44 },
  price: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  body: { padding: spacing.md },
  description: { marginTop: 2 },
  seller: { marginTop: spacing.sm },
});
