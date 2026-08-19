/**
 * Plan a party — a customer asks a cafe/restaurant to host their event.
 * They pick one of the business's party packages (or describe a custom
 * party), say how many people and when, and can offer their own budget.
 * It rides the normal order flow, so the business accepts, counters the
 * price, proposes, or rejects — negotiation included, bill at the end.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, Input, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

/** Index of the "describe your own party" choice in the package list. */
const CUSTOM = -1;

export default function PartyScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser, signInGuest } = useAuth();

  const [pkgIndex, setPkgIndex] = useState<number | null>(null);
  const [guests, setGuests] = useState('');
  const [when, setWhen] = useState('');
  const [occasion, setOccasion] = useState('');
  const [offer, setOffer] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: business, loading, error, reload } = useAsync(
    () => repos.businesses.getById(businessId),
    [businessId],
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!business) return <EmptyView title="Not found" />;

  const packages = business.partyPackages ?? [];
  // With no packages listed, every party is a custom request.
  const chosen = packages.length === 0 ? CUSTOM : pkgIndex;
  const guestCount = parseInt(guests, 10);
  const ready = chosen !== null && guestCount > 0 && when.trim().length > 0;

  const submit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    try {
      const pkg = chosen === CUSTOM ? null : packages[chosen!];
      // A logged-out customer acts as a real (anonymous) identity, the same way
      // guest chat and guest calls do — see `signInGuest`. Without it the row
      // carries no customer_id and RLS (`customer_id = auth.uid()`) refuses it.
      const me = currentUser ?? (await signInGuest());
      const order = await repos.orders.create({
        businessId: business.id,
        customerId: me.id,
        customerName: me.name || 'Guest',
        lines: [
          {
            kind: 'service',
            name: pkg ? pkg.name : `Party for ${guestCount} guests`,
            price: pkg?.price,
            offerPrice: offer.trim() || undefined,
            quantity: 1,
          },
        ],
        party: {
          guests: guestCount,
          when: when.trim(),
          occasion: occasion.trim() || undefined,
        },
        note: note.trim() || undefined,
      });
      router.replace(`/order/${order.id}`);
    } catch (err) {
      showAlert('Could not send', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Plan a party' }} />

      <Text variant="title" weight="bold">
        🎉 Party at {business.name}
      </Text>

      {packages.length > 0 ? (
        <>
          <Text variant="subheading" weight="bold" style={styles.groupTitle}>
            Pick a package
          </Text>
          {packages.map((pkg, i) => {
            const selected = chosen === i;
            return (
              <Pressable
                key={`${pkg.name}-${i}`}
                onPress={() => setPkgIndex(i)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Card
                  style={{
                    ...styles.pkgCard,
                    borderColor: selected ? colors.brand : colors.border,
                    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                  }}
                >
                  <View style={styles.pkgTop}>
                    <Text weight="semibold" style={styles.pkgName}>
                      {selected ? '✅ ' : ''}
                      {pkg.name}
                    </Text>
                    {pkg.price ? (
                      <Text weight="semibold" tone="brand">
                        {pkg.price}
                      </Text>
                    ) : null}
                  </View>
                  {pkg.description ? (
                    <Text variant="caption" tone="muted" style={styles.pkgDesc}>
                      {pkg.description}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setPkgIndex(CUSTOM)}
            accessibilityRole="button"
            accessibilityState={{ selected: chosen === CUSTOM }}
          >
            <Card
              style={{
                ...styles.pkgCard,
                borderColor: chosen === CUSTOM ? colors.brand : colors.border,
                borderWidth: chosen === CUSTOM ? 2 : StyleSheet.hairlineWidth,
              }}
            >
              <Text weight="semibold">
                {chosen === CUSTOM ? '✅ ' : ''}Something else
              </Text>
              <Text variant="caption" tone="muted" style={styles.pkgDesc}>
                Describe what you have in mind — the {business.providerType?.toLowerCase() ?? 'business'} quotes a price.
              </Text>
            </Card>
          </Pressable>
        </>
      ) : null}

      <Text variant="subheading" weight="bold" style={styles.groupTitle}>
        Party details
      </Text>
      <Input
        label="How many people?"
        placeholder="e.g. 20"
        value={guests}
        onChangeText={setGuests}
        keyboardType="number-pad"
      />
      <Input
        label="When?"
        placeholder="e.g. Sat 24 Aug, 7 pm"
        value={when}
        onChangeText={setWhen}
      />
      <Input
        label="Occasion (optional)"
        placeholder="e.g. Birthday, office get-together"
        value={occasion}
        onChangeText={setOccasion}
      />
      <Input
        label="💰 Your budget (optional)"
        placeholder="Name your price — they accept or counter"
        value={offer}
        onChangeText={setOffer}
      />
      <Input
        label="Anything else? (optional)"
        placeholder="e.g. Need a small stage and a mic, eggless cake"
        value={note}
        onChangeText={setNote}
        multiline
        style={styles.note}
      />

      <Button
        title="🎉 Send party request"
        onPress={submit}
        loading={submitting}
        disabled={!ready || submitting}
        style={styles.submit}
      />
      {packages.length > 0 && chosen === null ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          Pick a package (or “Something else”) to send your request.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupTitle: { marginTop: spacing.md, marginBottom: spacing.md },
  pkgCard: { marginBottom: spacing.md, borderRadius: radius.lg },
  pkgTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pkgName: { flex: 1 },
  pkgDesc: { marginTop: spacing.xs },
  note: { minHeight: 72, textAlignVertical: 'top' },
  submit: { marginTop: spacing.lg },
  hint: { marginTop: spacing.sm, textAlign: 'center' },
});
