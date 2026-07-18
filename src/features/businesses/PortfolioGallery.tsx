/**
 * Work showcase gallery. A horizontal strip of a business's portfolio —
 * photos open in a full-screen lightbox, videos open their watch link in the
 * browser/app (inline playback arrives with the real backend).
 */
import { useState } from 'react';
import { Image, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PortfolioItem } from '@/domain/types';
import { Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export function PortfolioGallery({ items }: { items: PortfolioItem[] }) {
  const colors = useColors();
  const [openItem, setOpenItem] = useState<PortfolioItem | null>(null);

  const open = (item: PortfolioItem) => {
    if (item.kind === 'video') {
      Linking.openURL(item.url).catch(() => {});
      return;
    }
    setOpenItem(item);
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => open(item)}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={item.title ?? (item.kind === 'video' ? 'Watch video' : 'View photo')}
          >
            <Image
              source={{ uri: item.thumbnailUrl ?? item.url }}
              style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}
              resizeMode="cover"
            />
            {item.kind === 'video' ? (
              <View style={styles.playBadge}>
                <Text style={styles.playIcon}>▶</Text>
              </View>
            ) : null}
            {item.title ? (
              <Text variant="caption" weight="medium" numberOfLines={2} style={styles.tileTitle}>
                {item.title}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>

      {/* Photo lightbox */}
      <Modal
        visible={openItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenItem(null)}
      >
        <Pressable style={styles.lightbox} onPress={() => setOpenItem(null)}>
          {openItem ? (
            <View style={styles.lightboxInner}>
              <Image source={{ uri: openItem.url }} style={styles.lightboxImage} resizeMode="contain" />
              {openItem.title ? (
                <Text weight="semibold" tone="inverse" style={styles.lightboxText}>
                  {openItem.title}
                </Text>
              ) : null}
              {openItem.description ? (
                <Text variant="label" tone="inverse" style={[styles.lightboxText, styles.lightboxDesc]}>
                  {openItem.description}
                </Text>
              ) : null}
              <Text variant="caption" tone="inverse" style={styles.lightboxHint}>
                Tap anywhere to close
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const TILE_W = 168;

const styles = StyleSheet.create({
  row: { gap: spacing.md, paddingRight: spacing.lg },
  tile: { width: TILE_W },
  pressed: { opacity: 0.85 },
  thumb: { width: TILE_W, height: 118, borderRadius: radius.md },
  playBadge: {
    position: 'absolute',
    top: 118 / 2 - 20,
    left: TILE_W / 2 - 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#FFFFFF', fontSize: 16, marginLeft: 3 },
  tileTitle: { marginTop: spacing.xs },
  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  lightboxInner: { width: '100%', alignItems: 'center' },
  lightboxImage: { width: '100%', height: 380, borderRadius: radius.md },
  lightboxText: { textAlign: 'center', marginTop: spacing.md },
  lightboxDesc: { opacity: 0.85, marginTop: spacing.xs },
  lightboxHint: { opacity: 0.6, marginTop: spacing.lg },
});
