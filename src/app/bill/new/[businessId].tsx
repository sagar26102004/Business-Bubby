/**
 * Create a bill (business members only) — the counter-side twin of placing an
 * order. The member picks WHO the bill is for (anyone with an app account, not
 * just people who've dealt with this business before, or a plain name with no
 * account at all), then builds it from the same catalog picker a customer uses
 * to order: collapsible category groups with quantity steppers, plus custom
 * off-catalog lines. The bill can then be shared in chat or through any app.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { User } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Avatar,
  Button,
  Card,
  EmptyView,
  ErrorView,
  Input,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { formatMoney, parsePrice } from '@/lib/money';
import { totalLabel, totalOf } from '@/features/orders/orderUtils';
import { OfferingGroup, StepBtn, keyOf, type Offering } from '@/features/orders/OfferingPicker';
import { spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

/** A line the member typed by hand (not on the catalog). */
interface CustomLine {
  name: string;
  price?: string;
  quantity: number;
}

/** Who the bill is for: an app account, or a name with no account behind it. */
interface BillCustomer {
  /** Set only when the customer has an app account. */
  id?: string;
  name: string;
}

export default function NewBillScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const [customer, setCustomer] = useState<BillCustomer | null>(null);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customLines, setCustomLines] = useState<CustomLine[]>([]);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, threads, orders] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.chat.listBusinessThreads(business.id),
      repos.orders.listForBusiness(business.id),
    ]);
    // Customers this business already knows — from chats and past orders. These
    // are a shortcut only; the search below reaches every account.
    const known = new Map<string, BillCustomer>();
    threads.forEach((t) => known.set(t.participantId, { id: t.participantId, name: t.participantName }));
    orders.forEach((o) => known.set(o.customerId, { id: o.customerId, name: o.customerName }));
    return { business, employees, knownCustomers: Array.from(known.values()) };
  }, [businessId]);

  // The billable catalog, shaped exactly like the order screen's.
  const offerings = useMemo((): Offering[] => {
    const b = data?.business;
    if (!b) return [];
    return [
      ...(b.products ?? []).map((p): Offering => ({ ...p, kind: 'product' })),
      ...(b.menu ?? []).map((m): Offering => ({ ...m, kind: 'product' })),
      ...(b.services ?? []).map((s): Offering => ({ ...s, kind: 'service' })),
    ];
  }, [data?.business]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees, knownCustomers } = data;
  const isMember =
    currentUser?.id === business.ownerId ||
    employees.some((e) => e.userId && e.userId === currentUser?.id);

  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'New bill' }} />
        <EmptyView title="Members only" subtitle="Only this business's team can create bills." />
      </Screen>
    );
  }

  const products = offerings.filter((o) => o.kind === 'product');
  const services = offerings.filter((o) => o.kind === 'service');

  const bump = (o: Offering, delta: number) =>
    setQuantities((prev) => {
      const next = Math.max(0, (prev[keyOf(o)] ?? 0) + delta);
      return { ...prev, [keyOf(o)]: next };
    });

  const runSearch = async (next: string) => {
    setTerm(next);
    if (next.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(await repos.users.search(next));
    } finally {
      setSearching(false);
    }
  };

  const pick = (c: BillCustomer | null) => {
    setCustomer(c);
    setTerm('');
    setResults([]);
  };

  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    const price = customPrice.trim() || undefined;
    setCustomLines((prev) => {
      const existing = prev.findIndex((l) => l.name === name && l.price === price);
      if (existing >= 0) {
        return prev.map((l, i) => (i === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { name, price, quantity: 1 }];
    });
    setCustomName('');
    setCustomPrice('');
  };

  const bumpCustom = (index: number, delta: number) =>
    setCustomLines((prev) =>
      prev
        .map((l, i) => (i === index ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );

  // Everything on the bill: catalog picks first, then the typed-in lines.
  const lines = [
    ...offerings
      .map((o) => ({ name: o.name, price: o.price, quantity: quantities[keyOf(o)] ?? 0 }))
      .filter((l) => l.quantity > 0),
    ...customLines,
  ];
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  const total = totalOf(lines);
  const canSubmit = !!customer && lines.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit || !customer) return;
    setSubmitting(true);
    try {
      const bill = await repos.bills.create({
        businessId: business.id,
        customerId: customer.id,
        customerName: customer.name,
        lines,
        note: note.trim() || undefined,
        issuedByName: currentUser?.name ?? 'Owner',
      });
      router.replace(`/bill/${bill.id}`);
    } catch (err) {
      showAlert('Could not create bill', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const typed = term.trim();
  const alreadyListed = (id: string) => knownCustomers.some((c) => c.id === id);

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'New bill' }} />

      {/* Who is being billed — any account, or a name with no account. */}
      <Label>Customer</Label>
      {customer ? (
        <Card style={[styles.selected, { borderColor: colors.brand }]}>
          <View style={styles.selectedRow}>
            <Avatar name={customer.name} size={36} />
            <View style={styles.flex}>
              <Text weight="semibold">{customer.name}</Text>
              <Text variant="caption" tone="muted">
                {customer.id
                  ? 'Has an app account — you can send this bill in their chat.'
                  : 'No app account — share the bill from the next screen.'}
              </Text>
            </View>
            <Text tone="brand" weight="semibold" onPress={() => pick(null)}>
              Change
            </Text>
          </View>
        </Card>
      ) : (
        <>
          {knownCustomers.length > 0 ? (
            <View style={styles.pillRow}>
              {knownCustomers.map((c) => (
                <Tag key={c.id} label={c.name} onPress={() => pick(c)} />
              ))}
            </View>
          ) : null}
          <Input
            placeholder="Search everyone by name, or type a new one"
            value={term}
            onChangeText={runSearch}
          />
          {searching ? (
            <Text variant="caption" tone="muted" style={styles.hint}>
              Searching…
            </Text>
          ) : null}
          {results.length > 0 ? (
            <Card style={styles.results}>
              {results.map((u, i) => (
                <Pressable
                  key={u.id}
                  onPress={() => pick({ id: u.id, name: u.name })}
                  style={[
                    styles.resultRow,
                    i < results.length - 1 && {
                      borderBottomColor: colors.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Bill ${u.name}`}
                >
                  <Avatar name={u.name} size={32} />
                  <View style={styles.flex}>
                    <Text weight="medium">{u.name}</Text>
                    <Text variant="caption" tone="muted">
                      {alreadyListed(u.id) ? 'Existing customer' : 'App account'}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </Card>
          ) : null}
          {typed.length >= 2 ? (
            <Button
              title={`＋ Bill “${typed}” without an account`}
              variant="secondary"
              onPress={() => pick({ name: typed })}
              style={styles.walkIn}
            />
          ) : (
            <Text variant="caption" tone="muted" style={styles.hint}>
              Type at least 2 letters to find an account — or bill a walk-in by name.
            </Text>
          )}
        </>
      )}

      {/* Items — the same picker a customer orders from. */}
      {products.length > 0 ? (
        <OfferingGroup
          title={business.type === 'item' ? '🏷️ Items' : '🛍️ Products'}
          offerings={products}
          quantities={quantities}
          onBump={bump}
        />
      ) : null}
      {services.length > 0 ? (
        <OfferingGroup title="🛠️ Services" offerings={services} quantities={quantities} onBump={bump} />
      ) : null}

      {/* Anything not on the catalog. */}
      <Label>Something else</Label>
      <View style={styles.customRow}>
        <View style={styles.flex}>
          <Input placeholder="Custom item" value={customName} onChangeText={setCustomName} onSubmitEditing={addCustom} />
        </View>
        <View style={styles.priceField}>
          <Input placeholder="₹" value={customPrice} onChangeText={setCustomPrice} onSubmitEditing={addCustom} />
        </View>
      </View>
      <Button title="Add item" variant="secondary" onPress={addCustom} disabled={!customName.trim()} />

      {customLines.length > 0 ? (
        <Card style={styles.customList}>
          {customLines.map((line, i) => {
            const unit = parsePrice(line.price);
            return (
              <View
                key={`${line.name}-${i}`}
                style={[
                  styles.lineRow,
                  i < customLines.length - 1 && {
                    borderBottomColor: colors.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.flex}>
                  <Text weight="medium">{line.name}</Text>
                  <Text variant="caption" weight="semibold" tone="brand">
                    {unit !== undefined ? formatMoney(unit * line.quantity) : 'Price on request'}
                  </Text>
                </View>
                <View style={styles.stepper}>
                  <StepBtn label="−" onPress={() => bumpCustom(i, -1)} />
                  <Text weight="semibold" style={styles.qty}>
                    {line.quantity}
                  </Text>
                  <StepBtn label="+" onPress={() => bumpCustom(i, 1)} />
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      <Input
        label="Note (optional)"
        placeholder="e.g. Payable on pickup"
        value={note}
        onChangeText={setNote}
        style={styles.note}
      />

      <Card style={styles.summary}>
        <View style={styles.summaryRow}>
          <Text weight="semibold">
            {itemCount} item{itemCount === 1 ? '' : 's'} on this bill
          </Text>
          <Text weight="bold" tone="brand">
            {itemCount > 0 ? totalLabel(total) : '—'}
          </Text>
        </View>
        {!customer && lines.length > 0 ? (
          <Text variant="caption" tone="muted">
            Pick who this bill is for to issue it.
          </Text>
        ) : null}
      </Card>

      <Button
        title="🧾 Create bill"
        onPress={submit}
        loading={submitting}
        disabled={!canSubmit}
        style={styles.submit}
      />
    </Screen>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="label" weight="semibold" style={styles.label}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  hint: { marginTop: spacing.xs },
  selected: { borderWidth: 1.5 },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  results: { marginTop: spacing.sm, padding: 0, overflow: 'hidden' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  walkIn: { marginTop: spacing.sm },
  customRow: { flexDirection: 'row', gap: spacing.md },
  priceField: { width: 90 },
  customList: { marginTop: spacing.md },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qty: { minWidth: 22, textAlign: 'center' },
  note: { marginTop: spacing.lg },
  summary: { marginTop: spacing.md },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  submit: { marginTop: spacing.lg },
});
