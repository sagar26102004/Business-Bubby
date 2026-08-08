/**
 * Fulfil an order by QR — the staff side of scan-to-pay / scan-to-collect.
 * A team member with scan permission lands here (by scanning the order's QR
 * ticket, or from the order/billing screens) and walks the order through:
 *   place → 💰 mark paid → ✅ mark collected.
 *
 * Business-agnostic on purpose: it reads the order + its bill through the
 * generic fulfillment helpers, so the same screen serves a samosa counter's
 * takeaway today and any other pickup the moment `usesQrHandover` widens.
 */
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  HANDOVER_META,
  canScanFor,
  handoverOf,
  usesQrHandover,
} from '@/features/fulfillment/fulfillment';
import { includedLines, totalLabel, totalOf } from '@/features/orders/orderUtils';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

export default function FulfillOrderScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const order = await repos.orders.getById(orderId);
    if (!order) return null;
    const [business, employees, bill] = await Promise.all([
      repos.businesses.getById(order.businessId),
      repos.employees.listByBusiness(order.businessId),
      order.billId ? repos.bills.getById(order.billId) : Promise.resolve(null),
    ]);
    return { order, business, employees, bill };
  }, [orderId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data || !data.business) return <EmptyView title="Order not found" />;

  const { order, business, employees, bill } = data;
  const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
  const allowed = canScanFor(business, currentUser, meEmployee);
  const myName = currentUser?.name ?? 'Team';

  if (!allowed) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Fulfil order' }} />
        <EmptyView
          title="No scan access"
          subtitle={`Only ${business.name}'s owner and members with Billing or Orders access can scan orders. Ask the owner to grant you access.`}
        />
      </Screen>
    );
  }

  const kept = includedLines(order);
  const total = totalLabel(totalOf(kept));
  const handover = usesQrHandover(order) ? handoverOf(order, bill) : null;
  const isTerminal = order.status === 'rejected' || order.status === 'declined';
  // Food rush: a fresh takeaway order is billed on the spot the moment staff
  // mark it — there's no separate accept/review step to slow the counter down.
  // (Expensive orders that need approval aren't takeaway, so they still hit the
  // "review it first" gate further down.)
  const quickBillable = !!handover && !order.billId && order.status === 'requested';
  const showMarkActions = !!handover && !isTerminal && (!!order.billId || quickBillable);

  // `scanNext` sends staff straight back to the scanner once an order is fully
  // done, so a counter can scan → act → scan the next one without tapping back
  // into Billing each time. (This screen is only ever reached by scanning.)
  const run = async (action: () => Promise<unknown>, opts?: { scanNext?: boolean }) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      if (opts?.scanNext) {
        router.replace('/scan');
        return;
      }
      await reload();
    } catch (err) {
      Alert.alert('Could not update', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  // Make sure the order is billed before we take money / hand it over. A fresh
  // takeaway order (no bill yet) is accepted whole right here — that issues the
  // bill in one step, so staff never leave this screen to confirm the order.
  const ensureBilled = async (): Promise<string> => {
    if (order.billId) return order.billId;
    const updated = await repos.orders.respond(order.id, order.lines.map((l) => l.id), myName);
    if (!updated.billId) throw new Error('Could not bill this order — open it to review.');
    return updated.billId;
  };
  const markPaid = () =>
    run(async () => {
      const billId = await ensureBilled();
      await repos.bills.setPaymentStatus(billId, 'paid', myName);
    });
  const markCollected = () =>
    run(
      async () => {
        await ensureBilled();
        await repos.orders.markDelivered(order.id, myName);
      },
      { scanNext: true },
    );
  // One tap for the common counter case: take the money and hand it over.
  const markPaidAndCollected = () =>
    run(
      async () => {
        const billId = await ensureBilled();
        await repos.bills.setPaymentStatus(billId, 'paid', myName);
        await repos.orders.markDelivered(order.id, myName);
      },
      { scanNext: true },
    );

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Fulfil order' }} />

      <Text variant="title" weight="bold">
        {order.customerName}
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        {business.name} · placed {new Date(order.createdAt).toLocaleString()}
      </Text>

      {handover ? (
        <View style={styles.stageRow}>
          <Tag
            label={`${HANDOVER_META[handover.stage].icon} ${HANDOVER_META[handover.stage].label}`}
            tone={handover.collected ? 'default' : 'brand'}
          />
        </View>
      ) : null}

      {/* What they ordered */}
      <Card style={styles.card}>
        {kept.map((l, i) => (
          <View
            key={l.id}
            style={[
              styles.lineRow,
              i < kept.length - 1 && {
                borderBottomColor: colors.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Text style={styles.lineName}>
              {l.kind === 'service' ? '🛠️' : '🛍️'} {l.name}
              {l.quantity > 1 ? ` ×${l.quantity}` : ''}
            </Text>
            <Text weight="semibold" tone="brand">
              {l.counterPrice ?? l.offerPrice ?? l.price ?? 'TBC'}
            </Text>
          </View>
        ))}
        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text weight="semibold">Total</Text>
          <Text weight="bold" tone="brand">
            {total}
          </Text>
        </View>
      </Card>

      {showMarkActions && handover ? (
        <View style={styles.actions}>
          {handover.collected ? (
            <EmptyView
              title="All done"
              subtitle={`Collected${handover.collectedByName ? ` by ${handover.collectedByName}` : ''}. Nothing left to do.`}
            />
          ) : handover.paid ? (
            // Already paid → the only thing left is to hand it over.
            <>
              <Card style={styles.paidNote}>
                <Text variant="caption" tone="muted">
                  Paid{handover.paidByName ? ` · ${handover.paidByName}` : ''}. Hand the order
                  over, then mark it collected.
                </Text>
              </Card>
              <Button
                title="✅ Mark as collected"
                onPress={markCollected}
                loading={busy}
                disabled={busy}
                style={styles.stackBtn}
              />
            </>
          ) : (
            // Fresh order → pay + hand over in one tap is the headline action,
            // with "mark paid" under it for when payment happens first. There's
            // no standalone "mark collected" here on purpose: an order can't be
            // handed over before it's paid, so collecting only becomes available
            // once it's paid (the branch above).
            <>
              <Button
                title={`💰✅ Mark as paid & collected · ${total}`}
                onPress={markPaidAndCollected}
                loading={busy}
                disabled={busy}
                style={styles.stackBtn}
              />
              <Button
                title={`💰 Mark as paid · ${total}`}
                variant="secondary"
                onPress={markPaid}
                loading={busy}
                disabled={busy}
                style={styles.stackBtn}
              />
            </>
          )}

          {order.billId ? (
            <Button
              title="🧾 View bill"
              variant="secondary"
              onPress={() => router.push(`/bill/${order.billId}`)}
              style={styles.actionBtn}
            />
          ) : null}
        </View>
      ) : !order.billId ? (
        // Not a food order and not billed yet → it needs approving first. This
        // is the expensive-item path (AC, TV…), where the business reviews the
        // order before committing. Scan again once it's accepted.
        <Card style={styles.card}>
          <Text weight="semibold">Not billed yet</Text>
          <Text variant="caption" tone="muted" style={styles.blockHint}>
            Accept this order first — that issues the bill. Then scan again to take
            payment and hand it over.
          </Text>
          <Button
            title="Open order to review"
            variant="secondary"
            onPress={() => router.push(`/order/${order.id}`)}
            style={styles.actionBtn}
          />
        </Card>
      ) : (
        <Button
          title="🧾 View bill"
          variant="secondary"
          onPress={() => router.push(`/bill/${order.billId}`)}
          style={styles.actionBtn}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.md },
  stageRow: { flexDirection: 'row', marginBottom: spacing.md },
  card: { marginBottom: spacing.md },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  lineName: { flex: 1 },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  blockHint: { marginTop: spacing.xs, marginBottom: spacing.md },
  actions: { marginTop: spacing.sm },
  paidNote: { marginBottom: spacing.md },
  stackBtn: { marginBottom: spacing.md },
  actionBtn: { marginTop: spacing.md },
});
