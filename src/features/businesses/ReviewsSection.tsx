/**
 * Ratings & reviews block on the business page.
 *
 * Top half is the score at a glance: the average, how many people rated, and a
 * 5→1 breakdown showing how the stars split. Each breakdown row is a FILTER —
 * tap "4★" and the reviews below narrow to four-star ones (the row stays lit so
 * it's obvious you're looking at a slice); tap it again for the mixed set.
 *
 * Bottom half rotates the written reviews one card at a time, the same motion
 * as the showcase and the home screen's deals, so a long review list never
 * turns the page into a wall of text.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Review } from '@/domain/types';
import { AutoCarousel, Button, Card, Stars, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const STARS = [5, 4, 3, 2, 1] as const;

export interface ReviewsSectionProps {
  ratingAvg?: number;
  ratingCount?: number;
  reviews: Review[];
  /** Owners can't rate their own listing, so they get no button. */
  canRate: boolean;
  hasMine: boolean;
  onRate: () => void;
}

export function ReviewsSection({
  ratingAvg,
  ratingCount,
  reviews,
  canRate,
  hasMine,
  onRate,
}: ReviewsSectionProps) {
  const colors = useColors();
  const [filter, setFilter] = useState<number | null>(null);

  // The histogram counts WRITTEN reviews. `ratingCount` can be higher (it also
  // carries a business's pre-existing rating history), so the headline number
  // and the bars are labelled separately rather than pretending to match.
  const counts = useMemo(() => {
    const map: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) if (map[r.rating] !== undefined) map[r.rating] += 1;
    return map;
  }, [reviews]);

  const written = reviews.length;
  const shown = filter ? reviews.filter((r) => r.rating === filter) : reviews;
  const avg = ratingAvg ?? (written > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / written : undefined);

  return (
    <View>
      <Card style={styles.scoreCard}>
        <View style={styles.scoreRow}>
          <View style={styles.score}>
            <Text variant="title" weight="bold">
              {typeof avg === 'number' ? avg.toFixed(1) : '—'}
            </Text>
            <Stars rating={avg} size={14} />
            <Text variant="caption" tone="muted" style={styles.scoreCount}>
              {typeof ratingCount === 'number' && ratingCount > 0
                ? `${ratingCount} rating${ratingCount === 1 ? '' : 's'}`
                : 'No ratings yet'}
            </Text>
          </View>

          <View style={styles.bars}>
            {STARS.map((star) => {
              const n = counts[star];
              const pct = written > 0 ? (n / written) * 100 : 0;
              const on = filter === star;
              return (
                <Pressable
                  key={star}
                  onPress={() => setFilter(on ? null : star)}
                  disabled={n === 0}
                  style={[
                    styles.barRow,
                    on && { backgroundColor: colors.brandSoft, borderColor: colors.brand },
                    n === 0 && styles.barRowEmpty,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${star} star, ${n} review${n === 1 ? '' : 's'}${
                    on ? ', showing only these' : ''
                  }`}
                >
                  <Text variant="caption" weight={on ? 'bold' : 'medium'} style={styles.barStar}>
                    {star}★
                  </Text>
                  <View style={[styles.barTrack, { backgroundColor: colors.surfaceAlt }]}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${pct}%`, backgroundColor: on ? colors.brand : colors.star },
                      ]}
                    />
                  </View>
                  <Text variant="caption" tone="muted" style={styles.barCount}>
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text variant="caption" tone="muted" style={styles.note}>
          🛡️ Ratings come only from verified customers — people with an order,
          booking, or bill from this business.
        </Text>
      </Card>

      {filter ? (
        <Pressable
          onPress={() => setFilter(null)}
          style={[styles.filterBar, { backgroundColor: colors.brandSoft }]}
          accessibilityRole="button"
        >
          <Text variant="label" weight="semibold">
            Showing {filter}★ reviews only
          </Text>
          <Text variant="caption" tone="muted">
            Tap to clear ✕
          </Text>
        </Pressable>
      ) : null}

      {shown.length > 0 ? (
        <View style={styles.slider}>
          <AutoCarousel
            items={shown}
            keyExtractor={(r) => r.id}
            renderItem={(r) => (
              <Card style={styles.reviewCard}>
                <View style={styles.reviewHead}>
                  <Text weight="semibold" numberOfLines={1} style={styles.reviewName}>
                    {r.customerName}
                  </Text>
                  <Text style={{ color: colors.star }}>
                    {'★'.repeat(r.rating)}
                    {'☆'.repeat(5 - r.rating)}
                  </Text>
                </View>
                <Text variant="caption" tone="muted">
                  {formatReviewDate(r)}
                </Text>
                <Text variant="label" style={styles.reviewComment} numberOfLines={5}>
                  {r.comment?.trim() || `Rated ${r.rating} out of 5.`}
                </Text>
              </Card>
            )}
          />
        </View>
      ) : (
        <Text variant="label" tone="muted" style={styles.empty}>
          {filter
            ? `No ${filter}★ reviews yet.`
            : 'No written reviews yet — be the first verified customer to rate.'}
        </Text>
      )}

      {canRate ? (
        <Button
          title={hasMine ? '✏️ Edit your rating' : '⭐ Rate this business'}
          variant="secondary"
          onPress={onRate}
          style={styles.rateBtn}
        />
      ) : null}
    </View>
  );
}

/** "12 Jun 2026" — with an "edited" marker when the customer changed it. */
function formatReviewDate(r: Review): string {
  const iso = r.updatedAt ?? r.createdAt;
  const date = new Date(iso);
  const label = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return r.updatedAt ? `${label} · edited` : label;
}

const styles = StyleSheet.create({
  scoreCard: { paddingVertical: spacing.lg },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  score: { alignItems: 'center', minWidth: 92, gap: 2 },
  scoreCount: { textAlign: 'center' },
  bars: { flex: 1, gap: 2 },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  barRowEmpty: { opacity: 0.5 },
  barStar: { width: 22 },
  barTrack: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 4 },
  barCount: { minWidth: 18, textAlign: 'right' },
  note: { marginTop: spacing.md },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  slider: { marginTop: spacing.md },
  reviewCard: { minHeight: 130 },
  reviewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  reviewName: { flexShrink: 1 },
  reviewComment: { marginTop: spacing.sm },
  empty: { marginTop: spacing.md },
  rateBtn: { marginTop: spacing.lg },
});
