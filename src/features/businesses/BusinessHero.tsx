/**
 * Section 1 of the business page (One Place redesign —
 * docs/redesign-one-place/business.html): who this business is, at a glance.
 *
 *  - A wide COVER — the owner's display picture, or a sage panel with the
 *    business's emoji — carrying three overlay chips: open state / today's
 *    hours, distance, and how many showcase photos there are.
 *  - The identity block on plain paper: name, tagline, ★ rating with the
 *    review count, #tag chips, and the address row with "Get directions ›".
 *  - The ACTION ROW: four equal tiles — Call · Chat · the business's own door
 *    (Order / Request / Enroll…) · Route — passed in by the page.
 *  - Description, weekly hours and the home-based / rental-distance notes.
 */
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { Business, PlaceKind, SavedPlace } from '@/domain/types';
import { formatDistance, getType } from '@/domain/catalog';
import { openState, summarizeHours } from '@/domain/hours';
import { tagEmoji } from '@/domain/intents';
import { haversineKm } from '@/lib/geo';
import { Icon, Tag, Text, type IconName } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { hasShowableCoordinates, locationSummary } from './location';

const PLACE_ICONS: Record<PlaceKind, string> = {
  current: '🧭',
  home: '🏠',
  work: '💼',
  custom: '📌',
};

const COVER_H = 210;

export interface HeroAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** The one highlighted tile — the business's own door. */
  primary?: boolean;
}

export interface BusinessHeroProps {
  business: Business;
  /** How far the business is from where the viewer is now. */
  distanceKm?: number;
  /** Rentals only: Current/Home/Work, to show how far the property is from each. */
  places?: SavedPlace[];
  onDirections: () => void;
  /** Owner only — adds or replaces the display picture. */
  onEditCover?: () => void;
  /** The four tiles under the identity block. */
  actions?: HeroAction[];
}

export function BusinessHero({
  business,
  distanceKm,
  places = [],
  onDirections,
  onEditCover,
  actions = [],
}: BusinessHeroProps) {
  const colors = useColors();
  const cover = business.coverImageUrl;

  const status = openState(business);
  const todayLabel = status.todayLabel ?? business.hours;
  const weekly = business.openingHours ? summarizeHours(business.openingHours) : undefined;
  const distanceLabel = formatDistance(distanceKm);
  const photoCount = (business.portfolio ?? []).filter((p) => p.kind === 'photo').length;
  const tags = business.tags ?? [];
  const emoji = tagEmoji(tags[0] ?? '', getType(business.type)?.icon ?? '🏪');

  const openChip = business.rentalStatus
    ? business.rentalStatus === 'available'
      ? 'Available now'
      : 'Rented out'
    : typeof status.open === 'boolean'
      ? status.open
        ? todayLabel
          ? `Open · ${todayLabel}`
          : 'Open now'
        : 'Closed now'
      : todayLabel;
  const openPositive = business.rentalStatus ? business.rentalStatus === 'available' : status.open;

  return (
    <View style={styles.wrap}>
      {/* Cover — bleeds to the screen edges. */}
      <View style={[styles.cover, { backgroundColor: colors.brandSoft }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Text style={styles.coverEmoji}>{emoji}</Text>
        )}
        <View style={styles.overlayRow}>
          {openChip ? (
            <View style={[styles.overlayChip, { backgroundColor: colors.surface }]}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: openPositive ? colors.success : colors.danger },
                ]}
              />
              <Text variant="caption" weight="bold" numberOfLines={1}>
                {openChip}
              </Text>
            </View>
          ) : null}
          {distanceLabel ? (
            <View style={[styles.overlayChip, { backgroundColor: colors.surface }]}>
              <Icon name="directions" size={12} color={colors.brand} />
              <Text variant="caption" weight="bold">
                {distanceLabel} away
              </Text>
            </View>
          ) : null}
          <View style={styles.flex} />
          {photoCount > 0 ? (
            <View style={[styles.overlayChip, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
              <Icon name="image" size={12} color="#FFFFFF" />
              <Text variant="caption" weight="bold" tone="inverse">
                {photoCount} photo{photoCount === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
        </View>
        {onEditCover ? (
          <Pressable
            onPress={onEditCover}
            style={[styles.coverBtn, { backgroundColor: colors.surface }]}
            accessibilityRole="button"
            accessibilityLabel={cover ? 'Change display picture' : 'Add a display picture'}
          >
            <Icon name="camera" size={14} color={colors.text} />
            <Text variant="caption" weight="bold">
              {cover ? 'Change photo' : 'Add photo'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Identity */}
      <View style={styles.identity}>
        <Text variant="title" weight="bold">
          {business.name}
        </Text>
        {business.tagline || business.providerType ? (
          <Text tone="muted" style={styles.tagline}>
            {business.tagline ?? business.providerType}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {typeof business.ratingAvg === 'number' && (business.ratingCount ?? 0) > 0 ? (
            <View style={styles.rating}>
              <Icon name="star" size={16} color={colors.star} filled />
              <Text weight="bold">{business.ratingAvg.toFixed(1)}</Text>
              <Text tone="muted" variant="label">
                ({business.ratingCount} review{business.ratingCount === 1 ? '' : 's'})
              </Text>
            </View>
          ) : (
            <Tag label="New on One Place" tone="cta" size="sm" />
          )}
          {business.providerType && business.tagline ? (
            <Tag label={business.providerType} tone="soft" size="sm" lineIcon="shield" />
          ) : null}
        </View>

        {tags.length > 0 ? (
          <View style={styles.tags}>
            {tags.map((t) => (
              <Tag key={t} label={`#${t.replace(/\s+/g, '')}`} tone="soft" size="sm" />
            ))}
          </View>
        ) : null}

        {/* Address row */}
        <View style={styles.addressRow}>
          <Icon name="pin" size={16} color={colors.cta} />
          <Text variant="label" tone="muted" style={styles.flex} numberOfLines={2}>
            {locationSummary(business.location)}
          </Text>
          {hasShowableCoordinates(business.location) ? (
            <Pressable
              onPress={onDirections}
              hitSlop={8}
              accessibilityRole="button"
              style={styles.directions}
            >
              <Text variant="label" weight="bold" tone="brand">
                Get directions
              </Text>
              <Icon name="arrowRight" size={14} color={colors.brandText} />
            </Pressable>
          ) : null}
        </View>
        {business.location.isHome ? (
          <Text variant="caption" tone="muted" style={styles.note}>
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
                <Text key={p.id} variant="caption" tone="muted" style={styles.note}>
                  {PLACE_ICONS[p.kind]} {km} from{' '}
                  {p.kind === 'current' ? 'your current location' : p.label}
                </Text>
              );
            })
          : null}
      </View>

      {/* Action row */}
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              style={({ pressed }) => [
                styles.action,
                a.primary
                  ? { backgroundColor: colors.cta, borderColor: colors.cta }
                  : { backgroundColor: colors.surface, borderColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              <Icon name={a.icon} size={20} color={a.primary ? colors.textInverse : colors.brand} />
              <Text
                variant="caption"
                weight="bold"
                tone={a.primary ? 'inverse' : 'default'}
                numberOfLines={1}
              >
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {business.description ? <Text style={styles.description}>{business.description}</Text> : null}
      {weekly ? (
        <View style={styles.weekly}>
          <Icon name="clock" size={14} color={colors.textMuted} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            {weekly}
            {business.openingHours?.note ? ` · ${business.openingHours.note}` : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  // The cover bleeds past the Screen's side padding and sits flush under the header.
  cover: {
    height: COVER_H,
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coverEmoji: { fontSize: 72, lineHeight: 84 },
  overlayRow: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  overlayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
    maxWidth: '60%',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  coverBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  identity: { marginTop: spacing.lg },
  tagline: { marginTop: 2 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, marginTop: spacing.md },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  directions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  note: { marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    minHeight: 64,
  },
  pressed: { opacity: 0.75 },
  description: { marginTop: spacing.lg },
  weekly: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
});
