/**
 * Section 1 of the business page: who this business is, at a glance.
 *
 * The block is built around ONE optional display picture the owner uploads —
 * the shopfront, the cafe interior, a logo. When it's there the name, tagline
 * and status sit on top of it behind a scrim; when it isn't, the same block
 * renders on a soft tint so the layout never changes shape.
 *
 * Location lives here too, and deliberately small: one line of address and ONE
 * button — Get directions — with the distance from the viewer right beside it,
 * instead of the old heading + card + separate button stack.
 */
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Business, PlaceKind, SavedPlace } from '@/domain/types';
import { formatDistance } from '@/domain/catalog';
import { openState, summarizeHours } from '@/domain/hours';
import { haversineKm } from '@/lib/geo';
import { Card, Icon, Stars, Tag, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { hasShowableCoordinates, locationSummary } from './location';
import { StatusChip } from './StatusChip';

const PLACE_ICONS: Record<PlaceKind, string> = {
  current: '🧭',
  home: '🏠',
  work: '💼',
  custom: '📌',
};

const COVER_H = 200;

export interface BusinessHeroProps {
  business: Business;
  /** How far the business is from where the viewer is now. */
  distanceKm?: number;
  /** Rentals only: Current/Home/Work, to show how far the property is from each. */
  places?: SavedPlace[];
  onDirections: () => void;
  /** Owner only — adds or replaces the display picture. */
  onEditCover?: () => void;
}

export function BusinessHero({
  business,
  distanceKm,
  places = [],
  onDirections,
  onEditCover,
}: BusinessHeroProps) {
  const colors = useColors();
  const cover = business.coverImageUrl;
  const onPhoto = !!cover;
  const tone = onPhoto ? ('inverse' as const) : ('default' as const);
  const mutedTone = onPhoto ? ('inverse' as const) : ('muted' as const);

  const status = openState(business);
  const todayLabel = status.todayLabel ?? business.hours;
  const weekly = business.openingHours ? summarizeHours(business.openingHours) : undefined;
  const distanceLabel = formatDistance(distanceKm);

  return (
    <Card padded={false} style={styles.card}>
      {/* Identity — over the display picture when there is one. */}
      <View
        style={[
          styles.top,
          onPhoto ? styles.topPhoto : { backgroundColor: colors.brandSoft },
        ]}
      >
        {cover ? (
          <>
            <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" />
            <LinearGradient
              colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.72)']}
              style={StyleSheet.absoluteFill}
            />
          </>
        ) : null}

        <View style={[styles.identity, onPhoto && styles.identityOnPhoto]}>
          <Text variant="title" weight="bold" tone={tone}>
            {business.name}
          </Text>
          {business.providerType ? (
            <Text variant="label" weight="semibold" tone={mutedTone} style={styles.provider}>
              {business.providerType}
            </Text>
          ) : null}
          {business.tagline ? (
            <Text variant="label" tone={mutedTone} style={styles.tagline}>
              {business.tagline}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            {typeof business.ratingAvg === 'number' ? (
              <View style={[styles.ratingPill, { backgroundColor: colors.surface }]}>
                <Stars rating={business.ratingAvg} count={business.ratingCount} size={13} />
              </View>
            ) : null}
            {business.rentalStatus ? (
              <StatusChip
                label={business.rentalStatus === 'available' ? 'Available' : 'Rented'}
                positive={business.rentalStatus === 'available'}
              />
            ) : typeof status.open === 'boolean' ? (
              <StatusChip label={status.open ? 'Open now' : 'Closed'} positive={status.open} />
            ) : null}
            {todayLabel ? (
              <View style={[styles.hoursPill, { backgroundColor: colors.surface }]}>
                <Icon name="clock" size={12} color={colors.textMuted} strokeWidth={2.2} />
                <Text variant="caption" weight="semibold" tone="muted">
                  {todayLabel}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {onEditCover ? (
          <Pressable
            onPress={onEditCover}
            style={[styles.coverBtn, { backgroundColor: colors.surface }]}
            accessibilityRole="button"
            accessibilityLabel={cover ? 'Change display picture' : 'Add a display picture'}
          >
            <Text variant="caption" weight="semibold">
              📷 {cover ? 'Change photo' : 'Add photo'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Everything below the picture reads on plain surface. */}
      <View style={styles.body}>
        {business.tags && business.tags.length > 0 ? (
          <View style={styles.tags}>
            {business.tags.map((t) => (
              <Tag key={t} label={t} />
            ))}
          </View>
        ) : null}

        {business.description ? (
          <Text style={styles.description}>{business.description}</Text>
        ) : null}

        {weekly ? (
          <Text variant="caption" tone="muted" style={styles.weekly}>
            🕒 {weekly}
            {business.openingHours?.note ? ` · ${business.openingHours.note}` : ''}
          </Text>
        ) : null}

        {/* Location: one line, then one button with the distance beside it. */}
        <View style={[styles.locationBlock, { borderTopColor: colors.border }]}>
          <Text weight="medium">📍 {locationSummary(business.location)}</Text>
          {business.location.isHome ? (
            <Text variant="caption" tone="muted" style={styles.locNote}>
              {business.location.hidePreciseLocation
                ? 'Runs from home — exact address hidden by the owner'
                : 'Home-based business'}
            </Text>
          ) : null}
          {business.type === 'rental' && business.location.point
            ? places.map((p) => {
                const km = formatDistance(haversineKm(business.location.point!, p.point));
                if (!km) return null;
                return (
                  <Text key={p.id} variant="caption" tone="muted" style={styles.locNote}>
                    {PLACE_ICONS[p.kind]} {km} from{' '}
                    {p.kind === 'current' ? 'your current location' : p.label}
                  </Text>
                );
              })
            : null}

          {hasShowableCoordinates(business.location) ? (
            <View style={styles.directionsRow}>
              <Pressable
                onPress={onDirections}
                style={({ pressed }) => [
                  styles.directionsBtn,
                  { backgroundColor: colors.brand },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Text variant="label" weight="bold" tone="inverse">
                  🧭 Get directions
                </Text>
              </Pressable>
              {distanceLabel ? (
                <Text variant="label" weight="semibold" tone="muted">
                  {distanceLabel} away
                </Text>
              ) : null}
            </View>
          ) : distanceLabel ? (
            <Text variant="label" weight="semibold" tone="muted" style={styles.locNote}>
              {distanceLabel} away
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  top: { justifyContent: 'flex-end' },
  // Only a real display picture gets the tall frame — an empty tint block that
  // size would just be a grey void at the top of the page.
  topPhoto: { minHeight: COVER_H },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  identity: { padding: spacing.lg },
  identityOnPhoto: { paddingTop: spacing.xxl },
  provider: { marginTop: 2 },
  tagline: { marginTop: 2 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  hoursPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  coverBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  body: { padding: spacing.lg, paddingTop: spacing.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  description: { marginBottom: spacing.sm },
  weekly: { marginBottom: spacing.sm },
  locationBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
  },
  locNote: { marginTop: spacing.xs },
  directionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  directionsBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
  },
  pressed: { opacity: 0.75 },
});
