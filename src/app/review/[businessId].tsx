/**
 * Rate a business. Ratings are verified-customer only — the repository gates
 * new reviews behind a real transaction (accepted order, accepted/completed
 * booking, or a bill), so strangers can't post fraud ratings. A 1 or 2 star
 * rating requires a written reason. Resubmitting edits the existing review.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  Input,
  LoadingView,
  Screen,
  Text,
} from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

const RATING_LABELS = ['', 'Terrible', 'Poor', 'Okay', 'Good', 'Excellent'];

export default function ReviewScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const { currentUser, isGuest } = useAuth();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    if (!currentUser) return { business, mine: null, gate: null };
    const [mine, gate] = await Promise.all([
      repos.reviews.getMine(businessId, currentUser.id),
      repos.reviews.checkEligibility(businessId, currentUser.id),
    ]);
    return { business, mine, gate };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" subtitle="This listing may have been removed." />;

  const { business, mine, gate } = data;

  // Pre-fill once when editing an existing review.
  if (mine && !prefilled) {
    setPrefilled(true);
    setRating(mine.rating);
    setComment(mine.comment ?? '');
  }

  // Guests first sign in; a review needs a real account behind it.
  if (isGuest) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Rate' }} />
        <GateMessage
          icon="⭐"
          title="Sign in to rate"
          body={`Ratings on Localo come from real customers, so you need an account to rate ${business.name}.`}
        />
        <Button title="Sign in" onPress={() => router.push('/sign-in')} />
      </Screen>
    );
  }

  // Not a verified customer (and no existing review to edit) — explain why.
  if (!mine && gate && !gate.eligible) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Rate' }} />
        <GateMessage
          icon="🛡️"
          title="Only customers can rate"
          body={gate.reason ?? 'Do business with this listing first, then rate your experience.'}
        />
        <Button title="Back to the business" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const lowRating = rating > 0 && rating <= 2;
  const canSubmit = rating > 0 && (!lowRating || comment.trim().length > 0);

  const submit = async () => {
    if (!currentUser) return;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      await repos.reviews.submit({
        businessId,
        customerId: currentUser.id,
        customerName: currentUser.name,
        rating,
        comment,
      });
      router.back();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Couldn’t save your rating.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: mine ? 'Edit your rating' : 'Rate' }} />

      <Text variant="subheading" weight="bold" style={styles.name}>
        {business.name}
      </Text>
      <Text tone="muted" style={styles.hint}>
        {mine
          ? 'You’ve rated this business before — update your rating below.'
          : 'You’re rating as a verified customer. Your name shows with the review.'}
      </Text>

      {/* Star picker */}
      <Card style={styles.pickerCard}>
        <View style={styles.starRow}>
          {[1, 2, 3, 4, 5].map((value) => (
            <Pressable
              key={value}
              onPress={() => setRating(value)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
            >
              <Text style={[styles.star, { color: value <= rating ? colors.star : colors.border }]}>
                ★
              </Text>
            </Pressable>
          ))}
        </View>
        <Text
          variant="label"
          weight="semibold"
          tone={rating === 0 ? 'muted' : lowRating ? 'danger' : 'default'}
          style={styles.ratingLabel}
        >
          {rating === 0 ? 'Tap a star to rate' : RATING_LABELS[rating]}
        </Text>
      </Card>

      <Input
        label={lowRating ? 'What went wrong? (required)' : 'Tell others about your experience (optional)'}
        placeholder={
          lowRating
            ? 'Low ratings need a reason the business can act on…'
            : 'What stood out about this business?'
        }
        value={comment}
        onChangeText={setComment}
        multiline
        numberOfLines={4}
        style={styles.commentInput}
        helper={
          lowRating
            ? 'A written reason is required with 1 and 2 star ratings — it keeps ratings fair and helps the business fix things.'
            : undefined
        }
      />

      {submitError ? (
        <Text tone="danger" variant="label" style={styles.error}>
          {submitError}
        </Text>
      ) : null}

      <Button
        title={mine ? 'Update rating' : 'Submit rating'}
        onPress={submit}
        disabled={!canSubmit}
        loading={submitting}
      />
    </Screen>
  );
}

function GateMessage({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View style={styles.gate}>
      <Text style={styles.gateIcon}>{icon}</Text>
      <Text variant="subheading" weight="bold" style={styles.gateText}>
        {title}
      </Text>
      <Text tone="muted" style={styles.gateText}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { marginBottom: spacing.xs },
  hint: { marginBottom: spacing.lg },
  pickerCard: { alignItems: 'center', marginBottom: spacing.lg },
  starRow: { flexDirection: 'row', gap: spacing.md },
  star: { fontSize: 40, lineHeight: 48 },
  ratingLabel: { marginTop: spacing.sm },
  commentInput: { minHeight: 96, textAlignVertical: 'top' },
  error: { marginBottom: spacing.md },
  gate: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  gateIcon: { fontSize: 44 },
  gateText: { textAlign: 'center', maxWidth: 320 },
});
