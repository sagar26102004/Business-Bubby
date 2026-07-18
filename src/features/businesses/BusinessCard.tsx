/**
 * Rich business card used in the browse list, modeled on the reference design:
 * a colored thumbnail header (favorite + open/distance badges) over a body with
 * name, price level, provider type, rating, location, and tag chips.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Business, PlaceKind } from '@/domain/types';
import { formatDistance, getType, priceLevelLabel, rentalBasisLabel } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { haversineKm } from '@/lib/geo';
import { Card, Stars, Tag, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { locationSummary } from './location';

const PLACE_ICONS: Record<PlaceKind, string> = {
  current: '🧭',
  home: '🏠',
  work: '💼',
  custom: '📌',
};

export function BusinessCard({ business }: { business: Business }) {
  const router = useRouter();
  const colors = useColors();
  const repos = useRepositories();
  const [favorite, setFavorite] = useState(false);

  const type = getType(business.type);
  const thumbColor = type?.color ?? colors.brand;
  const distance = formatDistance(business.distanceKm);
  const price = priceLevelLabel(business.priceLevel);

  // Rentals: what matters is how far the flat/room is from the places the
  // renter lives their life around, so show Current/Home/Work distances.
  const isRental = business.type === 'rental';
  const { data: places } = useAsync(
    async () => (isRental ? repos.places.listPlaces() : null),
    [isRental],
  );
  const propertyPoint = business.location.point;
  const placeDistances =
    isRental && propertyPoint
      ? (places ?? [])
          .map((p) => ({
            id: p.id,
            icon: PLACE_ICONS[p.kind],
            label: p.kind === 'current' ? 'you' : p.label,
            distance: formatDistance(haversineKm(propertyPoint, p.point)),
          }))
          .filter((d) => d.distance)
      : [];

  // Personal stall (type 'item'): the card sells the stall's contents, so
  // show an item count and a preview of what's inside.
  const stallItems = business.type === 'item' ? business.products ?? [] : [];
  const basis = isRental ? rentalBasisLabel(business.rentalBasis) : undefined;
  const providerLine =
    stallItems.length > 0
      ? `${business.providerType ?? 'Personal stall'} · ${stallItems.length} item${stallItems.length === 1 ? '' : 's'}`
      : basis
        ? [business.providerType, basis].filter(Boolean).join(' · ')
        : business.providerType;

  return (
    <Card onPress={() => router.push(`/business/${business.id}`)} padded={false} style={styles.card}>
      {/* Thumbnail header */}
      <View style={[styles.thumb, { backgroundColor: thumbColor }]}>
        <Text style={styles.thumbEmoji}>{type?.icon ?? '🏬'}</Text>

        <Pressable
          onPress={() => setFavorite((f) => !f)}
          hitSlop={8}
          style={[styles.heart, { backgroundColor: colors.surface }]}
        >
          <Text style={{ fontSize: 15, color: favorite ? colors.danger : colors.textMuted }}>
            {favorite ? '♥' : '♡'}
          </Text>
        </Pressable>

        <View style={styles.badgeRow}>
          {business.rentalStatus ? (
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor:
                    business.rentalStatus === 'available' ? colors.success : colors.danger,
                },
              ]}
            >
              <Text variant="caption" weight="semibold" tone="inverse">
                {business.rentalStatus === 'available' ? 'Available' : 'Rented'}
              </Text>
            </View>
          ) : typeof business.openNow === 'boolean' ? (
            <View
              style={[
                styles.statusPill,
                { backgroundColor: business.openNow ? colors.success : colors.textMuted },
              ]}
            >
              <Text variant="caption" weight="semibold" tone="inverse">
                {business.openNow ? 'Open Now' : 'Closed'}
              </Text>
            </View>
          ) : null}
          {business.hours ? (
            <View style={[styles.hoursPill, { backgroundColor: 'rgba(0,0,0,0.35)' }]}>
              <Text variant="caption" weight="semibold" tone="inverse">
                🕒 {business.hours}
              </Text>
            </View>
          ) : null}
          {distance ? (
            <Text variant="caption" weight="semibold" tone="inverse" style={styles.distance}>
              {distance}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Body */}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="subheading" weight="semibold" style={styles.name} numberOfLines={1}>
            {business.name}
          </Text>
          {price ? (
            <Text variant="label" weight="semibold" tone="muted">
              {price}
            </Text>
          ) : null}
        </View>

        {providerLine ? (
          <Text variant="caption" tone="muted" style={styles.provider}>
            {providerLine}
          </Text>
        ) : null}

        <View style={styles.ratingRow}>
          <Stars rating={business.ratingAvg} count={business.ratingCount} />
        </View>

        <Text variant="caption" tone="muted" style={styles.location} numberOfLines={1}>
          📍 {locationSummary(business.location)}
        </Text>

        {placeDistances.length > 0 ? (
          <View style={styles.distances}>
            {placeDistances.map((d) => (
              <Text key={d.id} variant="caption" tone="muted">
                {d.icon} {d.distance} from {d.label}
              </Text>
            ))}
          </View>
        ) : null}

        {stallItems.length > 0 ? (
          <View style={styles.stallItems}>
            {stallItems.slice(0, 3).map((p, i) => (
              <Text key={`${p.name}-${i}`} variant="caption" tone="muted" numberOfLines={1}>
                🏷️ {p.name}
                {p.price ? ` · ${p.price}` : ''}
              </Text>
            ))}
            {stallItems.length > 3 ? (
              <Text variant="caption" tone="muted">
                +{stallItems.length - 3} more
              </Text>
            ) : null}
          </View>
        ) : null}

        {business.tags && business.tags.length > 0 ? (
          <View style={styles.tags}>
            {business.tags.slice(0, 3).map((t) => (
              <Tag key={t} label={t} />
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  thumb: {
    height: 132,
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  thumbEmoji: {
    position: 'absolute',
    alignSelf: 'center',
    top: 30,
    fontSize: 56,
    opacity: 0.9,
  },
  heart: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  hoursPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  distance: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 3 },
  body: { padding: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { flex: 1 },
  provider: { marginTop: 2 },
  ratingRow: { marginTop: spacing.sm },
  location: { marginTop: spacing.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  stallItems: { marginTop: spacing.sm, gap: 2 },
  distances: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: 2,
    marginTop: spacing.sm,
  },
});
