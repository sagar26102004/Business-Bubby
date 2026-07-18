/**
 * Create a bill (business members only). The member picks the customer — a
 * known one from past chats/orders, or a walk-in typed by name — then builds
 * the lines: quick-add from the business's own catalog, or custom lines with
 * a price. The bill can then be shared in chat or through any other app.
 */
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, Input, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { formatMoney, parsePrice } from '@/lib/money';
import { totalLabel, totalOf } from '@/features/orders/orderUtils';
import { spacing, useColors } from '@/theme/theme';

interface DraftLine {
  name: string;
  price?: string;
  quantity: number;
}

interface KnownCustomer {
  id: string;
  name: string;
}

export default function NewBillScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const [customer, setCustomer] = useState<KnownCustomer | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
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
    // Customers this business already knows — from chats and past orders.
    const known = new Map<string, KnownCustomer>();
    threads.forEach((t) => known.set(t.participantId, { id: t.participantId, name: t.participantName }));
    orders.forEach((o) => known.set(o.customerId, { id: o.customerId, name: o.customerName }));
    return { business, employees, knownCustomers: Array.from(known.values()) };
  }, [businessId]);

  const catalog = useMemo(() => {
    const b = data?.business;
    if (!b) return [];
    return [...(b.products ?? []), ...(b.menu ?? []), ...(b.services ?? [])];
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

  const addLine = (name: string, price?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLines((prev) => {
      const existing = prev.findIndex((l) => l.name === trimmed && l.price === price);
      if (existing >= 0) {
        return prev.map((l, i) => (i === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { name: trimmed, price, quantity: 1 }];
    });
  };

  const addCustom = () => {
    addLine(customName, customPrice.trim() || undefined);
    setCustomName('');
    setCustomPrice('');
  };

  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const customerName = customer?.name ?? walkInName.trim();
  const total = totalOf(lines);
  const canSubmit = !!customerName && lines.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const bill = await repos.bills.create({
        businessId: business.id,
        customerId: customer?.id,
        customerName,
        lines,
        note: note.trim() || undefined,
        issuedByName: currentUser?.name ?? 'Owner',
      });
      router.replace(`/bill/${bill.id}`);
    } catch (err) {
      Alert.alert('Could not create bill', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'New bill' }} />

      <Text variant="title" weight="bold">
        Bill a customer
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        Build the bill, then share it in their chat or through any app.
      </Text>

      {/* Who is being billed */}
      <Label>Customer</Label>
      {knownCustomers.length > 0 ? (
        <View style={styles.pillRow}>
          {knownCustomers.map((c) => (
            <Tag
              key={c.id}
              label={c.name}
              selected={customer?.id === c.id}
              onPress={() => {
                setCustomer((prev) => (prev?.id === c.id ? null : c));
                setWalkInName('');
              }}
            />
          ))}
        </View>
      ) : null}
      {!customer ? (
        <Input
          placeholder="Or type a walk-in customer's name"
          value={walkInName}
          onChangeText={setWalkInName}
        />
      ) : (
        <Text variant="caption" tone="muted" style={styles.customerHint}>
          {customer.name} has an app account — you’ll be able to send this bill in their chat.
        </Text>
      )}

      {/* Line items */}
      <Label>Items</Label>
      {catalog.length > 0 ? (
        <>
          <Text variant="caption" tone="muted" style={styles.hint}>
            Tap to add from your listed products & services (tap again for +1):
          </Text>
          <View style={styles.pillRow}>
            {catalog.map((item, i) => (
              <Tag
                key={`${item.name}-${i}`}
                label={item.price ? `${item.name} · ${item.price}` : item.name}
                onPress={() => addLine(item.name, item.price)}
              />
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.customRow}>
        <View style={styles.flex}>
          <Input placeholder="Custom item" value={customName} onChangeText={setCustomName} onSubmitEditing={addCustom} />
        </View>
        <View style={styles.priceField}>
          <Input placeholder="$" value={customPrice} onChangeText={setCustomPrice} onSubmitEditing={addCustom} />
        </View>
      </View>
      <Button title="Add item" variant="secondary" onPress={addCustom} disabled={!customName.trim()} />

      {lines.length > 0 ? (
        <Card style={styles.lines}>
          {lines.map((line, i) => {
            const unit = parsePrice(line.price);
            return (
              <View
                key={`${line.name}-${i}`}
                style={[
                  styles.lineRow,
                  i < lines.length - 1 && {
                    borderBottomColor: colors.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.flex}>
                  <Text weight="medium">{line.name}</Text>
                  <Text variant="caption" tone="muted">
                    {line.quantity} × {line.price ?? 'TBC'}
                  </Text>
                </View>
                <Text weight="semibold" tone="brand">
                  {unit !== undefined ? formatMoney(unit * line.quantity) : 'TBC'}
                </Text>
                <Text tone="danger" weight="semibold" onPress={() => removeLine(i)}>
                  ✕
                </Text>
              </View>
            );
          })}
          <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
            <Text weight="semibold">Total</Text>
            <Text weight="bold" tone="brand">
              {totalLabel(total)}
            </Text>
          </View>
        </Card>
      ) : null}

      <Input
        label="Note (optional)"
        placeholder="e.g. Payable on pickup"
        value={note}
        onChangeText={setNote}
      />

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
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  customerHint: { marginBottom: spacing.sm },
  hint: { marginBottom: spacing.sm },
  customRow: { flexDirection: 'row', gap: spacing.md },
  priceField: { width: 90 },
  lines: { marginTop: spacing.md },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submit: { marginTop: spacing.lg },
});
