/**
 * Order history with a business — role-aware:
 *  - business members see every order the business received;
 *  - a customer sees all the orders THEY ever placed with this business,
 *    with whatever the outcome was (accepted bill, proposal, rejection).
 * Tap an order to open it (review it, decide on it, or just read it).
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Order, PaymentStatus } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { FULFILLMENT_META, ORDER_STATUS_META, includedLines, totalLabel, totalOf } from '@/features/orders/orderUtils';
import { spacing } from '@/theme/theme';

export default function OrdersScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(business.id);
    const isMember =
      currentUser?.id === business.ownerId ||
      employees.some((e) => e.userId && e.userId === currentUser?.id);
    const orders = isMember
      ? await repos.orders.listForBusiness(business.id)
      : await repos.orders.listForCustomer(currentUser?.id ?? 'guest', business.id);
    // Whether each billed order was actually PAID lives on its bill — look them
    // up once and index by bill id rather than fetching per row.
    const bills = isMember
      ? await repos.bills.listForBusiness(business.id)
      : await repos.bills.listForCustomer(currentUser?.id ?? 'guest', business.id);
    const paidByBillId: Record<string, PaymentStatus> = {};
    for (const bill of bills) paidByBillId[bill.id] = bill.paymentStatus;
    return { business, isMember, orders, paidByBillId };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, isMember, orders, paidByBillId } = data;
  const pending = orders.filter((o) => o.status === 'requested').length;
  const hasMenu = (business.menu?.length ?? 0) > 0;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Orders' }} />

      <Text variant="title" weight="bold">
        {isMember ? `Orders · ${business.name}` : `My orders with ${business.name}`}
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        {isMember
          ? pending > 0
            ? `${pending} order${pending === 1 ? '' : 's'} waiting for a response.`
            : 'Every order this business received, newest first.'
          : 'Everything you ever ordered here and how it went.'}
      </Text>

      {orders.length === 0 ? (
        <EmptyView
          title="No orders yet"
          subtitle={
            isMember
              ? 'Orders customers place from your page show up here.'
              : 'Order products or services from the business page.'
          }
        />
      ) : (
        orders.map((order: Order) => {
          const meta = ORDER_STATUS_META[order.status];
          const kept = includedLines(order);
          const names = kept.slice(0, 3).map((l) => l.name).join(', ');
          const more = kept.length > 3 ? ` +${kept.length - 3} more` : '';
          const handOver = order.fulfillment ? FULFILLMENT_META[order.fulfillment] : undefined;
          return (
            <Card key={order.id} onPress={() => router.push(`/order/${order.id}`)} style={styles.card}>
              <View style={styles.topRow}>
                <Text weight="semibold" style={styles.flex}>
                  {isMember ? order.customerName : new Date(order.createdAt).toLocaleDateString()}
                </Text>
                <Tag label={`${meta.icon} ${meta.label}`} tone={meta.tone === 'brand' ? 'brand' : 'default'} />
              </View>
              <Text variant="caption" tone="muted" numberOfLines={1} style={styles.names}>
                {handOver ? `${handOver.icon} ${handOver.label} · ` : ''}
                {names}
                {more}
              </Text>
              <View style={styles.bottomRow}>
                <Text variant="caption" tone="muted">
                  {new Date(order.createdAt).toLocaleString()}
                </Text>
                {/* Total, and under it where the money stands. Only a billed
                    order has a payment state — an open tab isn't owed yet. */}
                <View style={styles.money}>
                  <Text weight="semibold" tone="brand">
                    {kept.length > 0 ? totalLabel(totalOf(kept)) : '—'}
                  </Text>
                  {order.billId ? (
                    <Text
                      variant="caption"
                      weight="semibold"
                      tone={paidByBillId[order.billId] === 'paid' ? 'success' : 'muted'}
                    >
                      {paidByBillId[order.billId] === 'paid' ? '✅ Paid' : '⏳ Payment pending'}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Card>
          );
        })
      )}

      {!isMember ? (
        <Button
          title={hasMenu ? '📖 Order from the menu' : '🛒 Place a new order'}
          onPress={() =>
            router.push(hasMenu ? `/menu/${business.id}` : `/order/new/${business.id}`)
          }
          style={styles.newBtn}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  names: { marginTop: spacing.xs },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  money: { alignItems: 'flex-end' },
  newBtn: { marginTop: spacing.md },
});
