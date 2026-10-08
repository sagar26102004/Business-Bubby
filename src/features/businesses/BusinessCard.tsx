/**
 * The listing card (One Place redesign — docs/redesign-one-place/explore.png,
 * "Neighborhood Business Card" in DESIGN.md). Every list of businesses uses it:
 * Explore, Browse, Search.
 *
 *  ┌──────┐ [Open now] [#Cafe]              ★ 4.8 (240)
 *  │photo │ Green Valley Artisan Cafe
 *  └──────┘ 450 m away · Until 10 PM
 *           (Coffee) (Bakery) (Outdoor)
 *  ┌ Popular: Vanilla Cold Brew ₹180 ──────────────┐
 *  (📞) (💬) [        🛒 Order now        ]
 *
 * The "Popular" strip is the first thing the business sells and the action
 * button is that bucket's own door (BUCKET_META in domain/offerings.ts): a dish
 * is ordered (terracotta), a service or rental requested (sage), a plan
 * enrolled in (outline). A business with nothing listed gets "View page".
 */
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Business, PlaceKind } from '@/domain/types';
import { openState } from '@/domain/hours';
import { formatDistance, rentalBasisLabel } from '@/domain/catalog';
import { offeringBuckets, type OfferingBucket } from '@/domain/offerings';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { haversineKm } from '@/lib/geo';
import { Button, Card, Icon, Tag, Text } from '@/components/ui';
import { catalogLink } from '@/features/offerings/links';
import { radius, spacing, useColors } from '@/theme/theme';
import { THUMB_WIDTH, thumbUrl } from '@/lib/media';
import { ON_HOLD } from '@/lib/onHold';
import { useServiceGate } from '@/features/businesses/serviceGate';

const PLACE_ICONS: Record<PlaceKind, string> = {
  current: '🧭',
  home: '🏠',
  work: '💼',
  custom: '📌',
};

/** How each bucket's door looks on a card. */
const DOOR: Record<OfferingBucket, { label: string; icon: 'cart' | 'bag' | 'tools' | 'key' | 'ticket'; variant: 'cta' | 'primary' | 'outline' }> = {
  menu: { label: 'Order now', icon: 'cart', variant: 'cta' },
  products: { label: 'Buy now', icon: 'bag', variant: 'cta' },
  services: { label: 'Request service', icon: 'tools', variant: 'primary' },
  rentals: { label: 'Request to rent', icon: 'key', variant: 'primary' },
  plans: { label: 'View plans', icon: 'ticket', variant: 'outline' },
};

export function BusinessCard({ business }: { business: Business }) {
  const router = useRouter();
  const colors = useColors();
  const repos = useRepositories();
  // Call / Chat / the door on a platform-held listing show "not active" instead.
  const gate = useServiceGate();

  const distance = formatDistance(business.distanceKm);
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

  // ON HOLD (redesign 2026-10): stall — the stall's item preview.
  const stallItems = !ON_HOLD.stalls && business.type === 'item' ? business.products ?? [] : [];

  // The lead offering and its door.
  const lead = offeringBuckets(business)[0];
  const leadItem = lead?.items.find((i) => i.price) ?? lead?.items[0];
  const door = lead ? DOOR[lead.bucket] : undefined;

  const tags = business.tags ?? [];
  const basis = isRental ? rentalBasisLabel(business.rentalBasis) : undefined;
  const cover = business.coverImageUrl;
  const open = () => router.push(`/business/${business.id}`);

  // "450 m away · Until 10 PM" — the distance leads; hours colour by state.
  const metaHours =
    business.rentalStatus
      ? business.rentalStatus === 'available'
        ? 'Available now'
        : 'Rented out'
      : hoursLabel;
  const metaPositive = business.rentalStatus ? business.rentalStatus === 'available' : status.open;

  return (
    // The card BODY is the link to the page; the footer's buttons sit outside it
    // (a button inside a button is invalid HTML on web, and taps would bubble).
    <Card style={styles.card}>
      <Pressable
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={business.name}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={styles.top}>
          {/* The cover photo only when the business uploaded one — no stand-in tile. */}
          {cover ? (
            <Image source={{ uri: thumbUrl(cover, THUMB_WIDTH) }} style={styles.thumb} resizeMode="cover" />
          ) : null}

          <View style={styles.main}>
            <View style={styles.chipRow}>
              {business.rentalStatus ? (
                <Tag
                  label={business.rentalStatus === 'available' ? 'Available' : 'Rented'}
                  tone={business.rentalStatus === 'available' ? 'status' : 'default'}
                  size="sm"
                  dot
                />
              ) : typeof status.open === 'boolean' ? (
                <Tag
                  label={status.open ? 'Open now' : 'Closed'}
                  tone={status.open ? 'status' : 'default'}
                  size="sm"
                  dot
                />
              ) : null}
              {business.providerType ? (
                <Tag label={business.providerType} tone="soft" size="sm" />
              ) : null}
              <View style={styles.spacer} />
              {typeof business.ratingAvg === 'number' && (business.ratingCount ?? 0) > 0 ? (
                <View style={styles.rating}>
                  <Icon name="star" size={14} color={colors.star} filled />
                  <Text variant="caption" weight="bold">
                    {business.ratingAvg.toFixed(1)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    ({business.ratingCount})
                  </Text>
                </View>
              ) : (
                <Tag label="New" tone="cta" size="sm" />
              )}
            </View>

            <Text variant="subheading" weight="bold" numberOfLines={1} style={styles.name}>
              {business.name}
            </Text>

            <Text variant="caption" numberOfLines={1}>
              {distance ? (
                <Text variant="caption" tone="muted">
                  {distance} away
                </Text>
              ) : null}
              {distance && metaHours ? <Text variant="caption" tone="muted"> · </Text> : null}
              {metaHours ? (
                <Text
                  variant="caption"
                  weight="bold"
                  style={{ color: metaPositive ? colors.successText : colors.danger }}
                >
                  {metaHours}
                </Text>
              ) : null}
              {basis ? <Text variant="caption" tone="muted"> · {basis}</Text> : null}
            </Text>

            {tags.length > 0 ? (
              <View style={styles.tags}>
                {tags.slice(0, 3).map((t) => (
                  <Tag key={t} label={t} size="sm" />
                ))}
              </View>
            ) : null}
          </View>
        </View>

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
          <View style={styles.distances}>
            {stallItems.slice(0, 3).map((p, i) => (
              <Text key={`${p.name}-${i}`} variant="caption" tone="muted" numberOfLines={1}>
                •  {p.name}
                {p.price ? ` · ${p.price}` : ''}
              </Text>
            ))}
          </View>
        ) : null}

        {leadItem ? (
          <View style={[styles.popular, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text variant="caption" numberOfLines={1} style={styles.popularText}>
              <Text variant="caption" tone="muted">
                {lead!.bucket === 'plans' ? 'Plans from: ' : 'Popular: '}
              </Text>
              <Text variant="caption" weight="bold">
                {leadItem.name}
                {leadItem.price ? ` ${leadItem.price}` : ''}
                {leadItem.badge ? ` ${leadItem.badge}` : ''}
              </Text>
            </Text>
            <Text variant="caption" tone="muted">
              {lead!.subtitle}
            </Text>
          </View>
        ) : null}
      </Pressable>

      <View style={styles.footer}>
        <RoundAction
          icon="phone"
          label={`Call ${business.name}`}
          onPress={() => gate.guard(business, 'Calling', () => router.push(`/call/${business.id}`))}
        />
        <RoundAction
          icon="chat"
          label={`Chat with ${business.name}`}
          onPress={() => gate.guard(business, 'Chat', () => router.push(`/chat/${business.id}`))}
        />
        {lead && door ? (
          <Button
            title={door.label}
            icon={door.icon}
            variant={door.variant}
            size="sm"
            onPress={() =>
              gate.guard(business, lead.bucket === 'plans' ? 'Enrolling' : 'Ordering', () =>
                router.push(catalogLink(business.id, lead.bucket)),
              )
            }
            style={styles.door}
          />
        ) : (
          <Button title="View page" variant="secondary" size="sm" onPress={open} style={styles.door} />
        )}
      </View>
      {gate.popup}
    </Card>
  );
}

function RoundAction({
  icon,
  label,
  onPress,
}: {
  icon: 'phone' | 'chat';
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.round,
        { borderColor: colors.border, backgroundColor: colors.surface },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={icon} size={17} color={colors.brandText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, gap: spacing.md },
  body: { gap: spacing.md },
  pressed: { opacity: 0.75 },
  top: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  main: { flex: 1, minWidth: 0, gap: 3 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  spacer: { flex: 1 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  name: { marginTop: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  distances: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2 },
  popular: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  popularText: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  round: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  door: { flex: 1 },
});
