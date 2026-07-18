/**
 * Place an order. The customer picks products to buy and/or services to avail
 * from the business's own catalog (products, menu, services), sets quantities,
 * and sends it. The business then accepts, rejects, or proposes back the part
 * it can provide — see /order/[orderId].
 */
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { OfferingKind, OrderFulfillment } from '@/domain/types';
import type { NewOrderLineInput } from '@/data/repositories';
import { commerceVocab, offersDineIn } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, Input, LoadingView, Screen, Text } from '@/components/ui';
import { FULFILLMENT_META, totalLabel, totalOf } from '@/features/orders/orderUtils';
import { radius, spacing, useColors } from '@/theme/theme';

interface Offering {
  kind: OfferingKind;
  name: string;
  price?: string;
  description?: string;
  /** Free-text menu grouping ("Starters" → "Veg"), copied from MenuItem. */
  category?: string;
  subcategory?: string;
}

const keyOf = (o: Offering) => `${o.kind}:${o.name}`;

interface OfferingSubGroup {
  name: string;
  items: Offering[];
}

interface OfferingCategory {
  name: string;
  /** Items in the category without a subcategory. */
  direct: Offering[];
  subs: OfferingSubGroup[];
}

/**
 * Categories keep the order they first appear in the data; uncategorised items
 * list first.
 */
function groupOfferings(items: Offering[]): { ungrouped: Offering[]; groups: OfferingCategory[] } {
  const ungrouped: Offering[] = [];
  const groups: OfferingCategory[] = [];
  const byName = new Map<string, OfferingCategory>();
  for (const item of items) {
    if (!item.category) {
      ungrouped.push(item);
      continue;
    }
    let group = byName.get(item.category);
    if (!group) {
      group = { name: item.category, direct: [], subs: [] };
      byName.set(item.category, group);
      groups.push(group);
    }
    if (!item.subcategory) {
      group.direct.push(item);
      continue;
    }
    let sub = group.subs.find((s) => s.name === item.subcategory);
    if (!sub) {
      sub = { name: item.subcategory, items: [] };
      group.subs.push(sub);
    }
    sub.items.push(item);
  }
  return { ungrouped, groups };
}

const countOf = (g: OfferingCategory) =>
  g.direct.length + g.subs.reduce((n, s) => n + s.items.length, 0);

export default function NewOrderScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

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

  // The orderable catalog: products + menu count as goods, services as services.
  const offerings = useMemo((): Offering[] => {
    if (!business) return [];
    return [
      ...(business.products ?? []).map((p): Offering => ({ ...p, kind: 'product' })),
      ...(business.menu ?? []).map((m): Offering => ({ ...m, kind: 'product' })),
      ...(business.services ?? []).map((s): Offering => ({ ...s, kind: 'service' })),
    ];
  }, [business]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!business) return <EmptyView title="Not found" />;

  const products = offerings.filter((o) => o.kind === 'product');
  const services = offerings.filter((o) => o.kind === 'service');

  // Cafes/restaurants ask how the order is handed over; stalls allow bargaining.
  // Not asked when adding to an open tab — that order is already dine-in.
  const asksFulfillment = offersDineIn(business) && !openOrder;
  // A member taking the order on a customer's behalf (a waiter at the counter).
  const onBehalf = isMember && !openOrder;
  // Table seating shows for a member placing a dine-in order at a tabled venue.
  const showTables = onBehalf && fulfillment === 'dine_in' && !!business.tableCount;
  const isStall = business.type === 'item';
  const vocab = commerceVocab(business);
  // Gyms/classes enrol PEOPLE — the customer names everyone the plan covers
  // (themselves and/or their children), so the business knows who's signed up.
  const asksEnrollees = (vocab.mode === 'enroll' || vocab.mode === 'subscribe') && !openOrder;
  const namedEnrollees = enrollees.map((n) => n.trim()).filter(Boolean);
  const enrolleesReady = !asksEnrollees || namedEnrollees.length > 0;

  const picked = offerings
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
    if (picked.length === 0 || submitting) return;
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
      const order = await repos.orders.create({
        businessId: business.id,
        // On behalf of a walk-in: the member types who it's for; it's still a
        // guest-side order (no account), just placed from the counter.
        customerId: onBehalf ? 'guest' : currentUser?.id ?? 'guest',
        customerName: onBehalf
          ? onBehalfName.trim() || 'Walk-in'
          : currentUser?.name ?? 'Guest',
        lines,
        fulfillment: asksFulfillment ? (fulfillment ?? undefined) : undefined,
        tableNumber: showTables && tableChoice !== 'auto' ? tableChoice : undefined,
        enrollees: asksEnrollees ? namedEnrollees : undefined,
        note: note.trim() || undefined,
      });
      router.replace(`/order/${order.id}`);
    } catch (err) {
      Alert.alert('Could not order', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (offerings.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Order' }} />
        <EmptyView
          title="Nothing to order yet"
          subtitle={`${business.name} hasn’t listed products or services to order. Try chatting with them instead.`}
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
      <Text tone="muted" style={styles.subtitle}>
        {openOrder
          ? 'You have an open dine-in order here — anything you pick is added to it, with one bill at the end.'
          : isStall
            ? 'Pick what you want — you can offer your own price and the seller accepts or counters.'
            : 'Pick what you want — the business confirms what it can provide and you get the bill.'}
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
        <OfferingGroup title="🛠️ Services" offerings={services} quantities={quantities} onBump={bump} />
      ) : null}

      {!openOrder ? (
        <Input
          label="Note (optional)"
          placeholder="Anything the business should know"
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
        disabled={picked.length === 0 || submitting || (asksFulfillment && !fulfillment) || !enrolleesReady}
        style={styles.submit}
      />
    </Screen>
  );
}

function OfferingGroup({
  title,
  offerings,
  quantities,
  onBump,
  offers,
  onOffer,
}: {
  title: string;
  offerings: Offering[];
  quantities: Record<string, number>;
  onBump: (o: Offering, delta: number) => void;
  /** When set (personal stalls), picked items show a "your offer" bargain input. */
  offers?: Record<string, string>;
  onOffer?: (o: Offering, value: string) => void;
}) {
  const colors = useColors();
  const { ungrouped, groups } = useMemo(() => groupOfferings(offerings), [offerings]);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set());

  const toggleCat = (name: string) =>
    setOpenCats((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  const toggleSub = (key: string) =>
    setOpenSubs((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // How many units are picked inside a set of items — shown on collapsed
  // category/subcategory bars so selections never disappear from view.
  const pickedIn = (items: Offering[]) => items.reduce((n, o) => n + (quantities[keyOf(o)] ?? 0), 0);

  const renderRow = (o: Offering, divider: boolean, indent?: boolean) => (
    <OfferingRow
      key={keyOf(o)}
      offering={o}
      qty={quantities[keyOf(o)] ?? 0}
      onBump={onBump}
      offerValue={offers?.[keyOf(o)]}
      onOffer={onOffer}
      divider={divider}
      indent={indent}
    />
  );

  return (
    <View style={styles.group}>
      <Text variant="subheading" weight="bold" style={styles.groupTitle}>
        {title}
      </Text>
      <Card>
        {ungrouped.map((o, i) => renderRow(o, i < ungrouped.length - 1 || groups.length > 0))}

        {groups.map((group) => {
          const catOpen = openCats.has(group.name);
          const catPicked = pickedIn([...group.direct, ...group.subs.flatMap((s) => s.items)]);
          return (
            <View key={group.name} style={[styles.catBlock, { borderTopColor: colors.border }]}>
              <Pressable
                onPress={() => toggleCat(group.name)}
                style={styles.catRow}
                accessibilityRole="button"
                accessibilityLabel={`${group.name}, ${countOf(group)} items`}
              >
                <Text weight="semibold">{group.name}</Text>
                <View style={styles.catMeta}>
                  {catPicked > 0 ? (
                    <Text variant="caption" weight="bold" tone="brand">
                      {catPicked} ✓
                    </Text>
                  ) : null}
                  <Text variant="caption" tone="muted">
                    {countOf(group)} · {catOpen ? '▲' : '▼'}
                  </Text>
                </View>
              </Pressable>

              {catOpen ? (
                <View style={styles.catBody}>
                  {group.direct.map((o) => renderRow(o, true))}
                  {group.subs.map((sub) => {
                    const subKey = `${group.name}|${sub.name}`;
                    const subOpen = openSubs.has(subKey);
                    const subPicked = pickedIn(sub.items);
                    return (
                      <View key={subKey}>
                        <Pressable
                          onPress={() => toggleSub(subKey)}
                          style={[styles.subRow, { backgroundColor: colors.surfaceAlt }]}
                          accessibilityRole="button"
                          accessibilityLabel={`${sub.name}, ${sub.items.length} items`}
                        >
                          <Text variant="label" weight="semibold">
                            {sub.name}
                          </Text>
                          <View style={styles.catMeta}>
                            {subPicked > 0 ? (
                              <Text variant="caption" weight="bold" tone="brand">
                                {subPicked} ✓
                              </Text>
                            ) : null}
                            <Text variant="caption" tone="muted">
                              {sub.items.length} · {subOpen ? '▲' : '▼'}
                            </Text>
                          </View>
                        </Pressable>
                        {subOpen ? sub.items.map((o) => renderRow(o, true, true)) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
    </View>
  );
}

function OfferingRow({
  offering: o,
  qty,
  onBump,
  offerValue,
  onOffer,
  divider,
  indent,
}: {
  offering: Offering;
  qty: number;
  onBump: (o: Offering, delta: number) => void;
  offerValue?: string;
  onOffer?: (o: Offering, value: string) => void;
  divider: boolean;
  indent?: boolean;
}) {
  const colors = useColors();
  const bargaining = !!onOffer && qty > 0;
  return (
    <View
      style={[
        indent && styles.itemIndent,
        divider && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.rowInfo}>
          <Text weight="medium">{o.name}</Text>
          {o.description ? (
            <Text variant="caption" tone="muted">
              {o.description}
            </Text>
          ) : null}
          <Text variant="caption" weight="semibold" tone="brand">
            {o.price ?? 'Price on request'}
          </Text>
        </View>
        <View style={styles.stepper}>
          <StepBtn label="−" disabled={qty === 0} onPress={() => onBump(o, -1)} />
          <Text weight="semibold" style={styles.qty}>
            {qty}
          </Text>
          <StepBtn label="+" onPress={() => onBump(o, 1)} />
        </View>
      </View>
      {bargaining ? (
        <Input
          label="💰 Your offer (optional)"
          placeholder={o.price ? `Listed at ${o.price} — name your price` : 'Name your price'}
          value={offerValue ?? ''}
          onChangeText={(v) => onOffer(o, v)}
          style={styles.offerInput}
        />
      ) : null}
    </View>
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

function StepBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.stepBtn,
        {
          backgroundColor: disabled ? colors.surfaceAlt : colors.brand,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Add one' : 'Remove one'}
    >
      <Text weight="bold" tone={disabled ? 'muted' : 'inverse'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  group: { marginBottom: spacing.lg },
  groupTitle: { marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowInfo: { flex: 1, gap: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: { minWidth: 22, textAlign: 'center' },
  catBlock: { borderTopWidth: StyleSheet.hairlineWidth },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  catMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  catBody: { paddingBottom: spacing.sm },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  itemIndent: { paddingLeft: spacing.md },
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
  offerInput: { marginBottom: spacing.md },
  note: { minHeight: 72, textAlignVertical: 'top' },
  summary: { marginTop: spacing.md },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  submit: { marginTop: spacing.lg },
});
