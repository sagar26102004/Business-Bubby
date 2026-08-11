/**
 * My Orders tab — every order the viewer ever placed, across all businesses,
 * split into what's still moving (requested / proposed, where a proposal needs
 * THEIR decision) and what's done (accepted / rejected / declined). Tap an
 * order to open it; each row also shows which business it was with.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Order } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { Card, EmptyView, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { FULFILLMENT_META, ORDER_STATUS_META, includedLines, isOrderOpen, totalLabel, totalOf } from '@/features/orders/orderUtils';
import { spacing } from '@/theme/theme';

export default function MyOrdersScreen() {
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser, isGuest } = useAuth();

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [businessNames, setBusinessNames] = useState<Map<string, string>>(new Map());

  const load = useCallback(() => {
    Promise.all([
      repos.orders.listForCustomer(currentUser?.id ?? 'guest'),
      repos.businesses.list(),
    ]).then(([mine, all]) => {
      setOrders(mine);
      setBusinessNames(new Map(all.map((b) => [b.id, b.name])));
    });
  }, [repos, currentUser?.id]);

  // Refresh whenever the tab regains focus (e.g. right after placing an order).
  useFocusEffect(useCallback(() => load(), [load]));

  if (orders === null) return <LoadingView label="Loading your orders…" />;

  const open = orders.filter(isOrderOpen);
  const past = orders.filter((o) => !isOrderOpen(o));

  return (
    <Screen scroll>
      {orders.length === 0 ? (
        <EmptyView
          title="No orders yet"
          subtitle={
            isGuest
              ? 'Order products or services from any business page. Guest orders last only for this session — sign in to keep your history.'
              : 'Order products or services from any business page and track them here.'
          }
        />
      ) : (
        <>
          {open.length > 0 ? (
            <>
              <Text variant="caption" weight="semibold" tone="muted" style={styles.group}>
                IN PROGRESS · {open.length}
              </Text>
              {open.map((o) => (
                <OrderRow key={o.id} order={o} businessName={businessNames.get(o.businessId)} />
              ))}
            </>
          ) : null}
          {past.length > 0 ? (
            <>
              <Text variant="caption" weight="semibold" tone="muted" style={styles.group}>
                PAST ORDERS · {past.length}
              </Text>
              {past.map((o) => (
                <OrderRow key={o.id} order={o} businessName={businessNames.get(o.businessId)} />
              ))}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function OrderRow({ order, businessName }: { order: Order; businessName?: string }) {
  const router = useRouter();
  const meta = ORDER_STATUS_META[order.status];
  const kept = includedLines(order);
  const names = kept.slice(0, 3).map((l) => l.name).join(', ');
  const more = kept.length > 3 ? ` +${kept.length - 3} more` : '';
  const handOver = order.fulfillment ? FULFILLMENT_META[order.fulfillment] : undefined;
  return (
    <Card onPress={() => router.push(`/order/${order.id}`)} style={styles.card}>
      <View style={styles.topRow}>
        <Text weight="semibold" numberOfLines={1} style={styles.flex}>
          {businessName ?? 'Business'}
        </Text>
        <Tag label={`${meta.icon} ${meta.label}`} tone={meta.tone === 'brand' ? 'brand' : 'default'} />
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1} style={styles.names}>
        {handOver ? `${handOver.icon} ${handOver.label} · ` : ''}
        {names}
        {more}
      </Text>
      {order.status === 'proposed' ? (
        <Text variant="caption" tone="brand" weight="semibold" style={styles.names}>
          The business sent a proposal — open to accept or decline.
        </Text>
      ) : null}
      {order.status === 'accepted' && !order.billId ? (
        <Text variant="caption" tone="brand" weight="semibold" style={styles.names}>
          {order.party
            ? `🎉 Party confirmed for ${order.party.when} — the bill comes after the event.`
            : "🍽️ Your tab is open — add items anytime until it's billed."}
        </Text>
      ) : null}
      <View style={styles.bottomRow}>
        <Text variant="caption" tone="muted">
          {new Date(order.createdAt).toLocaleString()}
        </Text>
        <Text weight="semibold" tone="brand">
          {kept.length > 0 ? totalLabel(totalOf(kept)) : '—'}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { letterSpacing: 1, marginTop: spacing.md, marginBottom: spacing.sm },
  card: { marginBottom: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  names: { marginTop: spacing.xs },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
});
