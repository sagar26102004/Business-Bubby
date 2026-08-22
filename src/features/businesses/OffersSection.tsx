/**
 * The offers a business is running, shown on its page directly under the
 * description — the first thing a customer reads after "who they are".
 *
 * An offer is the business's own promotion: some of what it already sells,
 * bundled at a special price ("Cold coffee + sandwich · ₹99"). Cards scroll
 * sideways so a busy shop can run several without pushing the rest of the page
 * down, and each shows what's included, the offer price, the normal price
 * struck through, and the saving.
 *
 * A card is tappable when `onPress` is given: it starts an order with the whole
 * bundle already picked, so an offer is something you can BUY, not just read.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Offer } from '@/domain/types';
import { Card, Tag, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { offerLineLabel, offerSavingPercent } from './offerUtils';

export interface OffersSectionProps {
  offers: Offer[];
  /** Tapping a card — starts an order for the bundle. */
  onPress?: (offer: Offer) => void;
  /** Call to action on each card, shown only when `onPress` is set. */
  actionLabel?: string;
}

export function OffersSection({
  offers,
  onPress,
  actionLabel = 'Order this offer →',
}: OffersSectionProps) {
  const colors = useColors();
  if (offers.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text variant="subheading" weight="bold" style={styles.heading}>
        🎉 Offers
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {offers.map((offer) => {
          const saving = offerSavingPercent(offer);
          return (
            <Card
              key={offer.id}
              style={{ ...styles.card, borderColor: colors.brand }}
              onPress={onPress ? () => onPress(offer) : undefined}
              accessibilityLabel={onPress ? `${offer.title} — ${actionLabel}` : undefined}
            >
              <View style={styles.top}>
                <Text variant="heading">{offer.emoji ?? '🎉'}</Text>
                {offer.tag ? <Tag label={offer.tag} tone="brand" /> : null}
              </View>

              <Text weight="bold" numberOfLines={2}>
                {offer.title}
              </Text>
              {offer.description ? (
                <Text variant="caption" tone="muted" numberOfLines={2} style={styles.description}>
                  {offer.description}
                </Text>
              ) : null}

              {/* What you get — the business's own items, as picked. */}
              {offer.lines.length > 0 ? (
                <View style={styles.lines}>
                  {offer.lines.map((line, i) => (
                    <Text key={`${line.name}-${i}`} variant="caption" tone="muted">
                      • {offerLineLabel(line)}
                    </Text>
                  ))}
                </View>
              ) : null}

              <View style={[styles.priceRow, { borderTopColor: colors.border }]}>
                {offer.price ? (
                  <Text variant="subheading" weight="bold" tone="brand">
                    {offer.price}
                  </Text>
                ) : null}
                {offer.wasPrice ? (
                  <Text
                    variant="caption"
                    tone="muted"
                    style={{ textDecorationLine: 'line-through' }}
                  >
                    {offer.wasPrice}
                  </Text>
                ) : null}
                {saving !== undefined ? (
                  <Text variant="caption" weight="bold" tone="success">
                    Save {saving}%
                  </Text>
                ) : null}
              </View>

              {/* Says out loud that the card does something — a price alone
                  reads as a poster, not a button. */}
              {onPress ? (
                <Text variant="caption" weight="bold" tone="brand" style={styles.action}>
                  {actionLabel}
                </Text>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  heading: { marginBottom: spacing.sm },
  row: { gap: spacing.md, paddingRight: spacing.md },
  card: { width: 240, borderWidth: 1, borderRadius: radius.md },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  description: { marginTop: 2 },
  action: { marginTop: spacing.sm },
  lines: { marginTop: spacing.sm, gap: 2 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
