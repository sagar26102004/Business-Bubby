/**
 * "Your order" — what the customer picked on the menu, before it's sent.
 *
 * Owns its top bar (back chevron, title, and an "Add" button that goes back to
 * the menu for more), and keeps "Confirm order" stuck to the bottom so it's
 * reachable without scrolling a long order. Confirming asks dine-in or takeaway,
 * then sends it — or, when the customer already has an open dine-in tab here,
 * appends to that tab instead of starting a second order.
 */
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OrderFulfillment } from '@/domain/types';
import type { NewOrderLineInput } from '@/data/repositories';
import { offersDineIn } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Card, EmptyView, ErrorView, Input, LoadingView, Text } from '@/components/ui';
import { VegDot } from '@/features/businesses/FoodMenuEditor';
import { useCart } from '@/features/orders/CartContext';
import { FULFILLMENT_META, totalLabel, totalOf } from '@/features/orders/orderUtils';
import { radius, spacing, useColors } from '@/theme/theme';

export default function CartScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const dismiss = useDismiss(`/menu/${businessId}`);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();
  const cart = useCart(businessId);

  const [note, setNote] = useState('');
  const [fulfillment, setFulfillment] = useState<OrderFulfillment | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return { business: null, openOrder: null };
    // An open dine-in tab means this round is ADDED to it, not a new order.
    const mine = await repos.orders.listForCustomer(currentUser?.id ?? 'guest', businessId);
    const openOrder =
      mine.find(
        (o) =>
          o.fulfillment === 'dine_in' &&
          !o.billId &&
          (o.status === 'requested' || o.status === 'accepted'),
      ) ?? null;
    return { business, openOrder };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data?.business) return <EmptyView title="Not found" />;

  const { business, openOrder } = data;
  const total = totalOf(cart.lines.map((l) => ({ price: l.item.price, quantity: l.quantity })));
  // Adding to an existing tab: it's already dine-in, so don't ask again.
  const asksFulfillment = offersDineIn(business) && !openOrder;
  const ready = cart.itemCount > 0 && (!asksFulfillment || fulfillment !== null);

  const submit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    try {
      const lines: NewOrderLineInput[] = cart.lines.map((l) => ({
        kind: 'product',
        name: l.item.name,
        price: l.item.price,
        quantity: l.quantity,
      }));
      const order = openOrder
        ? await repos.orders.appendLines(openOrder.id, lines)
        : await repos.orders.create({
            businessId: business.id,
            customerId: currentUser?.id ?? 'guest',
            customerName: currentUser?.name ?? 'Guest',
            lines,
            fulfillment: asksFulfillment ? (fulfillment ?? undefined) : undefined,
            note: note.trim() || undefined,
          });
      cart.clear();
      router.replace(`/order/${order.id}`);
    } catch (err) {
      Alert.alert('Could not order', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Own top bar: back · "Your order" · Add (straight back to the menu). */}
      <View
        style={[
          styles.topBar,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
            paddingTop: insets.top + spacing.sm,
          },
        ]}
      >
        <Pressable
          onPress={dismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={[styles.backBtn, { borderColor: colors.border }]}
        >
          <Text weight="bold">‹</Text>
        </Pressable>
        <View style={styles.topTitle}>
          <Text variant="subheading" weight="bold">
            Your order
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {business.name}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push(`/menu/${businessId}`)}
          accessibilityRole="button"
          accessibilityLabel="Add more items"
          style={({ pressed }) => [
            styles.addBtn,
            { borderColor: colors.brand, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text weight="bold" tone="brand">
            ＋ Add
          </Text>
        </Pressable>
      </View>

      {cart.itemCount === 0 ? (
        <EmptyView
          title="Nothing picked yet"
          subtitle="Tap Add above to go back to the menu and choose some dishes."
        />
      ) : (
        <>
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 140 }]}>
            {openOrder ? (
              <Card style={styles.tabNote}>
                <Text weight="semibold">🍽️ Adding to your open tab</Text>
                <Text variant="caption" tone="muted">
                  You’re already dining in here — these go onto the same tab, with one bill at the end.
                </Text>
              </Card>
            ) : null}

            <Card style={styles.list}>
              {cart.lines.map((line, i) => (
                <View
                  key={`${line.item.name}-${i}`}
                  style={[
                    styles.row,
                    i < cart.lines.length - 1 && {
                      borderBottomColor: colors.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <VegDot isVeg={line.item.isVeg} />
                  <View style={styles.rowInfo}>
                    <Text weight="medium">{line.item.name}</Text>
                    <Text variant="caption" tone="muted">
                      {line.item.price ?? 'Price on request'}
                    </Text>
                  </View>
                  <View style={[styles.stepper, { borderColor: colors.brand }]}>
                    <Pressable
                      onPress={() => cart.bump(line.item, -1)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove one ${line.item.name}`}
                    >
                      <Text weight="bold" tone="brand">
                        −
                      </Text>
                    </Pressable>
                    <Text weight="bold" tone="brand">
                      {line.quantity}
                    </Text>
                    <Pressable
                      onPress={() => cart.bump(line.item, 1)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Add one more ${line.item.name}`}
                    >
                      <Text weight="bold" tone="brand">
                        ＋
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>

            {asksFulfillment ? (
              <>
                <Text variant="subheading" weight="bold" style={styles.heading}>
                  Dine in or take away?
                </Text>
                <View style={styles.fulfillmentRow}>
                  {(Object.keys(FULFILLMENT_META) as OrderFulfillment[]).map((f) => {
                    const selected = fulfillment === f;
                    return (
                      <Pressable
                        key={f}
                        onPress={() => setFulfillment(f)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.fulfillmentOption,
                          {
                            backgroundColor: selected ? colors.brand : colors.surface,
                            borderColor: selected ? colors.brand : colors.border,
                            opacity: pressed ? 0.85 : 1,
                          },
                        ]}
                      >
                        <Text style={styles.fulfillmentIcon}>{FULFILLMENT_META[f].icon}</Text>
                        <Text weight="semibold" tone={selected ? 'inverse' : 'default'}>
                          {FULFILLMENT_META[f].label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {!openOrder ? (
              <Input
                label="Note (optional)"
                placeholder="Less spicy, no onion…"
                value={note}
                onChangeText={setNote}
                multiline
                style={styles.note}
              />
            ) : null}
          </ScrollView>

          {/* Sticky confirm — no scrolling to the end to send the order. */}
          <View
            style={[
              styles.bar,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                paddingBottom: insets.bottom + spacing.md,
              },
            ]}
          >
            <View style={styles.barInfo}>
              <Text weight="bold">{totalLabel(total)}</Text>
              <Text variant="caption" tone="muted">
                {asksFulfillment && !fulfillment
                  ? 'Choose dine-in or takeaway'
                  : `${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'}`}
              </Text>
            </View>
            <Pressable
              onPress={submit}
              disabled={!ready || submitting}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.barBtn,
                {
                  backgroundColor: ready ? colors.brand : colors.surfaceAlt,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text weight="bold" tone={ready ? 'inverse' : 'muted'}>
                {submitting ? 'Sending…' : openOrder ? 'Add to my tab' : 'Confirm order'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { flex: 1 },
  addBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  scroll: { padding: spacing.lg },
  tabNote: { marginBottom: spacing.md },
  list: { marginBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowInfo: { flex: 1 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minWidth: 92,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  heading: { marginBottom: spacing.md },
  fulfillmentRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  fulfillmentOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  fulfillmentIcon: { fontSize: 18 },
  note: { minHeight: 72, textAlignVertical: 'top' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barInfo: { flex: 1 },
  barBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
  },
});
