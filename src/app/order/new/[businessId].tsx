/**
 * Place an order. The customer picks products to buy and/or services to avail
 * from the business's own catalog (products, menu, services), sets quantities,
 * and sends it. The business then accepts, rejects, or proposes back the part
 * it can provide — see /order/[orderId].
 *
 * The business's live OFFERS are pickable here too, each as one indivisible
 * line at the offer price. Tapping an offer card (business page, deals feed)
 * lands here with `?offer=<id>` and that bundle already in the order, so the
 * customer only has to send it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { OrderFulfillment } from '@/domain/types';
import type { NewOrderLineInput } from '@/data/repositories';
import { commerceVocab, offersDineIn, rentalBasisLabel } from '@/domain/catalog';
import { rentalCategory } from '@/domain/offeringSections';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, Input, LoadingView, Screen, Text } from '@/components/ui';
import {
  FULFILLMENT_META,
  offerKey,
  offerOfferings,
  totalLabel,
  totalOf,
} from '@/features/orders/orderUtils';
import { OfferingGroup, keyOf, type Offering } from '@/features/orders/OfferingPicker';
import { radius, spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

export default function NewOrderScreen() {
  const { businessId, offer: offerId } = useLocalSearchParams<{
    businessId: string;
    offer?: string;
  }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser, signInGuest } = useAuth();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [offers, setOffers] = useState<Record<string, string>>({});
  const [fulfillment, setFulfillment] = useState<OrderFulfillment | null>(null);
  // Enroll/subscribe: who the plan is for — starts with the customer themselves.
  const [enrollees, setEnrollees] = useState<string[]>([currentUser?.name ?? '']);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Member-on-behalf: who the order is for and which table to seat them at.
  const [onBehalfName, setOnBehalfName] = useState('');
  const [tableChoice, setTableChoice] = useState<number | 'auto'>('auto');

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return { business: null, openOrder: null, isMember: false, seats: [] };
    const employees = await repos.employees.listByBusiness(business.id);
    const isMember =
      currentUser?.id === business.ownerId ||
      employees.some((e) => e.userId && e.userId === currentUser?.id);
    // Dine-in works like a running tab: if the viewer already has an open
    // (unbilled) dine-in order here, new picks are ADDED to it, not a new
    // order. Members taking orders on a customer's behalf always start fresh.
    const mine = isMember
      ? []
      : await repos.orders.listForCustomer(currentUser?.id ?? 'guest', businessId);
    const openOrder =
      mine.find(
        (o) =>
          o.fulfillment === 'dine_in' &&
          !o.billId &&
          (o.status === 'requested' || o.status === 'accepted'),
      ) ?? null;
    // A member seating a customer needs to see which tables are free.
    const seats = isMember ? await repos.orders.tableStatus(business.id) : [];
    return { business, openOrder, isMember, seats };
  }, [businessId, currentUser?.id]);
  const business = data?.business;
  const openOrder = data?.openOrder ?? null;
  const isMember = data?.isMember ?? false;
  const seats = data?.seats ?? [];

  // The requestable catalog: products + menu count as goods; services and
  // rentals are both things the business PROVIDES rather than hands over, so a
  // rental rides as a 'service' line — same shape, no new line kind, and the
  // business reads it under its own "For rent" heading either way.
  const catalog = useMemo(() => {
    const products: Offering[] = [
      ...(business?.products ?? []).map((p): Offering => ({ ...p, kind: 'product' })),
      ...(business?.menu ?? []).map((m): Offering => ({ ...m, kind: 'product' })),
    ];
    const services: Offering[] = (business?.services ?? []).map(
      (s): Offering => ({ ...s, kind: 'service' }),
    );
    const rentals: Offering[] = (business?.rentals ?? []).map(
      (r): Offering => ({
        ...r,
        kind: 'service',
        // Rentals and services can share a name ("Tempo") on one listing, so
        // the key has to say which list it came from.
        key: `rental:${r.name}`,
        category: rentalCategory(r),
      }),
    );
    return { products, services, rentals };
  }, [business]);

  const offerings = useMemo(
    (): Offering[] => [...catalog.products, ...catalog.services, ...catalog.rentals],
    [catalog],
  );

  // The business's live promotions, each pickable as one bundle.
  const bundles = useMemo(() => (business ? offerOfferings(business) : []), [business]);
  // Everything that can go in this order — bundles lead, then the catalog.
  const pickable = useMemo(() => [...bundles, ...offerings], [bundles, offerings]);

  // One order per send, even if the button is hit twice before React repaints.
  const sending = useRef(false);

  // Arrived by tapping an offer: start with it in the order. Once only, so
  // removing it again doesn't put it straight back on the next render.
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !offerId) return;
    const bundle = bundles.find((b) => b.key === offerKey(offerId));
    if (!bundle) return;
    preselected.current = true;
    setQuantities((prev) => ({ ...prev, [keyOf(bundle)]: prev[keyOf(bundle)] ?? 1 }));
  }, [bundles, offerId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!business) return <EmptyView title="Not found" />;

  const { products, services, rentals } = catalog;
  // "per day" / "per month" — the price on a rental line is a rate, not a total.
  const rentalBasis = rentalBasisLabel(business.rentalBasis);

  // Cafes/restaurants ask how the order is handed over; stalls allow bargaining.
  // Not asked when adding to an open tab — that order is already dine-in.
  const asksFulfillment = offersDineIn(business) && !openOrder;
  // A member taking the order on a customer's behalf (a waiter at the counter).
  const onBehalf = isMember && !openOrder;
  // Table seating shows for a member placing a dine-in order at a tabled venue.
  const showTables = onBehalf && fulfillment === 'dine_in' && !!business.tableCount;
  const isStall = business.type === 'item';
  const vocab = commerceVocab(business);
  const isRent = vocab.mode === 'rent';
  // Gyms/classes enrol PEOPLE — the customer names everyone the plan covers
  // (themselves and/or their children), so the business knows who's signed up.
  const asksEnrollees = (vocab.mode === 'enroll' || vocab.mode === 'subscribe') && !openOrder;
  const namedEnrollees = enrollees.map((n) => n.trim()).filter(Boolean);
  const enrolleesReady = !asksEnrollees || namedEnrollees.length > 0;

  const picked = pickable
    .map((o) => ({
      offering: o,
      quantity: quantities[keyOf(o)] ?? 0,
      offerPrice: offers[keyOf(o)]?.trim() || undefined,
    }))
    .filter((p) => p.quantity > 0);
  const itemCount = picked.reduce((n, p) => n + p.quantity, 0);
  const total = totalOf(
    picked.map((p) => ({ price: p.offering.price, offerPrice: p.offerPrice, quantity: p.quantity })),
  );

  const bump = (o: Offering, delta: number) =>
    setQuantities((prev) => {
      const next = Math.max(0, (prev[keyOf(o)] ?? 0) + delta);
      return { ...prev, [keyOf(o)]: next };
    });

  const setEnrollee = (i: number, value: string) =>
    setEnrollees((prev) => prev.map((n, idx) => (idx === i ? value : n)));
  const addEnrollee = () => setEnrollees((prev) => [...prev, '']);
  const removeEnrollee = (i: number) =>
    setEnrollees((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const submit = async () => {
    if (picked.length === 0) return;
    // `submitting` is state, so two taps in the same frame both read the stale
    // `false` — the ref flips synchronously and is what actually stops a
    // double order.
    if (sending.current) return;

    // The button stays live when a choice is missing, so the tap SAYS what's
    // missing instead of doing nothing. These are the real gates: nothing gets
    // sent until they pass, whatever the button looked like.
    if (asksFulfillment && !fulfillment) {
      showAlert(
        'Dine in or take away?',
        'Choose how you want this order before sending it — the kitchen needs to know.',
      );
      return;
    }
    if (asksEnrollees && !enrolleesReady) {
      showAlert('Who is this for?', 'Add at least one name so the business knows who’s signed up.');
      return;
    }

    sending.current = true;
    setSubmitting(true);
    try {
      const lines: NewOrderLineInput[] = picked.map((p) => ({
        kind: p.offering.kind,
        name: p.offering.name,
        price: p.offering.price,
        offerPrice: isStall ? p.offerPrice : undefined,
        quantity: p.quantity,
      }));
      if (openOrder) {
        const order = await repos.orders.appendLines(openOrder.id, lines);
        router.replace(`/order/${order.id}`);
        return;
      }
      // A logged-out customer acts as a real (anonymous) identity, the same way
      // guest chat and guest calls do — see `signInGuest`. Without it the row
      // carries no customer_id and RLS (`customer_id = auth.uid()`) refuses it.
      const me = currentUser ?? (await signInGuest());
      const order = await repos.orders.create({
        businessId: business.id,
        // On behalf of a walk-in: the member types who it's for; it's still a
        // guest-side order (no account), just placed from the counter.
        customerId: onBehalf ? 'guest' : me.id,
        customerName: onBehalf ? onBehalfName.trim() || 'Walk-in' : me.name || 'Guest',
        lines,
        fulfillment: asksFulfillment ? (fulfillment ?? undefined) : undefined,
        tableNumber: showTables && tableChoice !== 'auto' ? tableChoice : undefined,
        enrollees: asksEnrollees ? namedEnrollees : undefined,
        note: note.trim() || undefined,
      });
      router.replace(`/order/${order.id}`);
    } catch (err) {
      showAlert('Could not order', err instanceof Error ? err.message : 'Try again.');
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  };

  if (pickable.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: isRent ? 'Request to rent' : 'Order' }} />
        <EmptyView
          title={isRent ? 'Nothing listed to rent yet' : 'Nothing to order yet'}
          subtitle={`${business.name} hasn’t listed ${
            isRent ? 'anything for rent' : 'products or services to order'
          }. Try chatting with them instead.`}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Stack.Screen
        options={{
          title: openOrder
            ? 'Add to your order'
            : vocab.mode === 'order'
              ? 'Place an order'
              : isRent
                ? 'Request to rent'
                : vocab.verb,
        }}
      />

      <Text variant="title" weight="bold">
        {onBehalf
          ? `New order · ${business.name}`
          : openOrder
          ? `Your tab at ${business.name}`
          : vocab.mode === 'enroll'
            ? `Enroll at ${business.name}`
            : vocab.mode === 'subscribe'
              ? `Subscribe to ${business.name}`
              : vocab.mode === 'rent'
                ? `Rent from ${business.name}`
                : `Order from ${business.name}`}
      </Text>

      {onBehalf ? (
        <Card style={styles.onBehalfCard}>
          <Text variant="subheading" weight="bold" style={styles.groupTitle}>
            🧑‍🍳 Taking this order for a customer
          </Text>
          <Text variant="caption" tone="muted" style={styles.onBehalfHint}>
            You’re placing this from the counter. Name the customer if you like — leave it blank and
            it’s recorded as a walk-in.
          </Text>
          <Input
            label="Customer name (optional)"
            placeholder="e.g. Rahul, or Table 4"
            value={onBehalfName}
            onChangeText={setOnBehalfName}
          />
        </Card>
      ) : null}

      {asksEnrollees ? (
        <View style={styles.group}>
          <Text variant="subheading" weight="bold" style={styles.groupTitle}>
            {vocab.mode === 'enroll' ? '🎟️ Who are you enrolling?' : '🔁 Who is this for?'}
          </Text>
          <Text variant="caption" tone="muted" style={styles.enrolleeHelper}>
            Add everyone this plan covers — yourself and/or your children. The business sees each name.
          </Text>
          {enrollees.map((name, i) => (
            <View key={i} style={styles.enrolleeRow}>
              <TextInput
                value={name}
                onChangeText={(v) => setEnrollee(i, v)}
                placeholder={i === 0 ? 'Your name' : 'Family member’s name'}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.enrolleeInput,
                  { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              />
              {enrollees.length > 1 ? (
                <Pressable
                  onPress={() => removeEnrollee(i)}
                  hitSlop={8}
                  style={styles.enrolleeRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${name.trim() || 'person'}`}
                >
                  <Text weight="bold" tone="muted">
                    ✕
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          <Pressable
            onPress={addEnrollee}
            style={styles.addPerson}
            accessibilityRole="button"
            accessibilityLabel="Add another person"
          >
            <Text weight="semibold" tone="brand">
              ＋ Add another person
            </Text>
          </Pressable>
        </View>
      ) : null}

      {asksFulfillment ? (
        <View style={styles.group}>
          <Text variant="subheading" weight="bold" style={styles.groupTitle}>
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
                      opacity: pressed ? 0.8 : 1,
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
        </View>
      ) : null}

      {showTables ? (
        <View style={styles.group}>
          <Text variant="subheading" weight="bold" style={styles.groupTitle}>
            🍽️ Table
          </Text>
          <Text variant="caption" tone="muted" style={styles.onBehalfHint}>
            Pick a free table, or leave it on Auto to seat them at the lowest free one.
          </Text>
          <View style={styles.tableGrid}>
            <TableChip
              label="Auto"
              selected={tableChoice === 'auto'}
              onPress={() => setTableChoice('auto')}
            />
            {seats.map((seat) => {
              const occupied = !!seat.order;
              return (
                <TableChip
                  key={seat.number}
                  label={`${seat.number}`}
                  sub={occupied ? seat.order?.customerName : undefined}
                  selected={tableChoice === seat.number}
                  disabled={occupied}
                  onPress={() => setTableChoice(seat.number)}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {bundles.length > 0 ? (
        <OfferingGroup
          title="🎉 Offers"
          offerings={bundles}
          quantities={quantities}
          onBump={bump}
        />
      ) : null}
      {products.length > 0 ? (
        <OfferingGroup
          title={isStall ? '🏷️ Items' : '🛍️ Products'}
          offerings={products}
          quantities={quantities}
          onBump={bump}
          offers={isStall ? offers : undefined}
          onOffer={isStall ? (o, v) => setOffers((prev) => ({ ...prev, [keyOf(o)]: v })) : undefined}
        />
      ) : null}
      {services.length > 0 ? (
        <OfferingGroup title="Services" offerings={services} quantities={quantities} onBump={bump} />
      ) : null}
      {rentals.length > 0 ? (
        <OfferingGroup
          title={rentalBasis ? `For rent · ${rentalBasis.toLowerCase()}` : 'For rent'}
          offerings={rentals}
          quantities={quantities}
          onBump={bump}
        />
      ) : null}

      {!openOrder ? (
        <Input
          // A rental request is useless to the owner without dates, so for
          // rentals the note asks the question outright instead of being a
          // blank "anything else?".
          label={isRent ? 'When do you need it, and for how long? (optional)' : 'Note (optional)'}
          placeholder={
            isRent ? 'e.g. from 1 September, for 3 months' : 'Anything the business should know'
          }
          value={note}
          onChangeText={setNote}
          multiline
          style={styles.note}
        />
      ) : null}

      <Card style={styles.summary}>
        <View style={styles.summaryRow}>
          <Text weight="semibold">
            {itemCount} item{itemCount === 1 ? '' : 's'} selected
          </Text>
          <Text weight="bold" tone="brand">
            {itemCount > 0 ? totalLabel(total) : '—'}
          </Text>
        </View>
        {total.hasUnpriced ? (
          <Text variant="caption" tone="muted">
            Some items have no listed price — the business confirms pricing on acceptance.
          </Text>
        ) : null}
        {asksFulfillment && !fulfillment && picked.length > 0 ? (
          <Text variant="caption" tone="muted">
            Choose dine-in or takeaway to send your order.
          </Text>
        ) : null}
        {asksEnrollees && !enrolleesReady && picked.length > 0 ? (
          <Text variant="caption" tone="muted">
            Add at least one name for who this plan is for.
          </Text>
        ) : null}
      </Card>

      <Button
        title={openOrder ? 'Add to my order' : `Send ${vocab.requestNoun}`}
        onPress={submit}
        loading={submitting}
        // Only an EMPTY order disables the button. With something picked but a
        // choice still missing it stays live on purpose: pressing it explains
        // what's missing, which a greyed-out button never did.
        disabled={picked.length === 0 || submitting}
        style={styles.submit}
      />
    </Screen>
  );
}

function TableChip({
  label,
  sub,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.tableChip,
        {
          backgroundColor: selected ? colors.brand : colors.surface,
          borderColor: selected ? colors.brand : colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text weight="semibold" tone={selected ? 'inverse' : 'default'}>
        {label}
      </Text>
      {sub ? (
        <Text variant="caption" tone={selected ? 'inverse' : 'muted'} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: spacing.lg },
  groupTitle: { marginBottom: spacing.md },
  fulfillmentRow: { flexDirection: 'row', gap: spacing.md },
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
  onBehalfCard: { marginBottom: spacing.lg },
  onBehalfHint: { marginBottom: spacing.md },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tableChip: {
    minWidth: 64,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enrolleeHelper: { marginBottom: spacing.md },
  enrolleeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  enrolleeInput: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
  },
  enrolleeRemove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addPerson: { paddingVertical: spacing.sm, marginTop: spacing.xs, alignSelf: 'flex-start' },
  note: { minHeight: 72, textAlignVertical: 'top' },
  summary: { marginTop: spacing.md },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  submit: { marginTop: spacing.lg },
});
