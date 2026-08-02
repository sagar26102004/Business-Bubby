/**
 * Business card used in the browse list, in the neighborhood style: a bold
 * name, one quiet meta line, and soft-tinted status chips — no saturated
 * badges competing with the content. Icons carry the meaning that emoji used
 * to, so every row lines up on the same baseline.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Business, PlaceKind } from '@/domain/types';
import { openState } from '@/domain/hours';
import { formatDistance, priceLevelLabel, rentalBasisLabel } from '@/domain/catalog';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { haversineKm } from '@/lib/geo';
import { Card, Icon, Stars, Tag, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { locationSummary } from './location';
import { StatusChip } from './StatusChip';

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

  const distance = formatDistance(business.distanceKm);
  const price = priceLevelLabel(business.priceLevel);

  // Open/Closed is computed from structured hours when present, else the stored
  // openNow flag; the 🕒 label prefers today's timings over the legacy summary.
  const status = openState(business);
  const hoursLabel = status.todayLabel ?? business.hours;

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
    <Card onPress={() => router.push(`/business/${business.id}`)} style={styles.card}>
      {/* Body */}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="subheading" weight="bold" style={styles.name} numberOfLines={1}>
            {business.name}
          </Text>
          {price ? (
            <Text variant="label" weight="semibold" tone="muted">
              {price}
            </Text>
          ) : null}
          <Pressable onPress={() => setFavorite((f) => !f)} hitSlop={10} style={styles.heart}>
            <Icon
              name="heart"
              size={19}
              color={favorite ? colors.danger : colors.textMuted}
              filled={favorite}
            />
          </Pressable>
        </View>

        {providerLine ? (
          <Text variant="label" tone="muted" style={styles.provider} numberOfLines={1}>
            {providerLine}
          </Text>
        ) : null}

        {/* Status · hours · distance — soft chips, not saturated badges. */}
        <View style={styles.badgeRow}>
          {business.rentalStatus ? (
            <StatusChip
              label={business.rentalStatus === 'available' ? 'Available' : 'Rented'}
              positive={business.rentalStatus === 'available'}
            />
          ) : typeof status.open === 'boolean' ? (
            <StatusChip label={status.open ? 'Open now' : 'Closed'} positive={status.open} />
          ) : null}
          {hoursLabel ? (
            <View style={styles.metaItem}>
              <Icon name="clock" size={13} color={colors.textMuted} strokeWidth={2.2} />
              <Text variant="caption" tone="muted">
                {hoursLabel}
              </Text>
            </View>
          ) : null}
          {distance ? (
            <View style={styles.metaItem}>
              <Icon name="pin" size={13} color={colors.textMuted} strokeWidth={2.2} />
              <Text variant="caption" weight="semibold" tone="muted">
                {distance}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.ratingRow}>
          <Stars rating={business.ratingAvg} count={business.ratingCount} />
        </View>

        <Text variant="caption" tone="muted" style={styles.location} numberOfLines={1}>
          {locationSummary(business.location)}
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
                •  {p.name}
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
  heart: { alignItems: 'center', justifyContent: 'center' },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: spacing.xs,
    marginTop: spacing.md,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  body: {},
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1 },
  provider: { marginTop: 3 },
  ratingRow: { marginTop: spacing.md },
  location: { marginTop: spacing.xs },
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
