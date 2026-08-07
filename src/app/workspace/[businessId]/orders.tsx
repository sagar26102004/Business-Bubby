/**
 * Workspace › Orders — the orders desk for one business.
 * New orders to review, live proposals awaiting the customer, open dine-in
 * tabs to move to billing, and a link to the full order history.
 * Members only.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Order } from '@/domain/types';
import type { TableSeat } from '@/data/repositories';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { commerceVocab } from '@/domain/catalog';
import { canAccessService } from '@/domain/access';
import {
  FULFILLMENT_META,
  ORDER_STATUS_META,
  includedLines,
  isToday,
  totalLabel,
  totalOf,
} from '@/features/orders/orderUtils';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function WorkspaceOrdersScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, orders, seats] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.orders.listForBusiness(business.id),
      repos.orders.tableStatus(business.id),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = currentUser?.id === business.ownerId || !!meEmployee;
    const canAccess = canAccessService(business, meEmployee, currentUser?.id, 'orders');
    return { business, isMember, canAccess, orders, seats };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, isMember, canAccess, orders, seats } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Orders' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }
  if (!canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Orders' }} />
        <EmptyView title="No access" subtitle="Ask the owner to grant you Orders in Access & permissions." />
      </Screen>
    );
  }

  const vocab = commerceVocab(business);
  const pendingOrders = orders.filter((o) => o.status === 'requested');
  const openProposals = orders.filter((o) => o.status === 'proposed');
  const openTabs = orders.filter((o) => o.status === 'accepted' && !o.billId);
  // The desk cares about the shift it's working, so the history link below is
  // scoped to today — the full history is one tap further, on that screen.
  const todaysOrders = orders.filter((o) => isToday(o.createdAt));

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: vocab.requestsTitle }} />

      {/* Members can take an order at the counter, on a customer's behalf. */}
      <Button
        title={`➕ Take a ${vocab.requestNoun}`}
        onPress={() => router.push(`/order/new/${business.id}`)}
        style={styles.takeBtn}
      />

      {seats.length > 0 ? (
        <Section
          title={`Tables · ${seats.filter((s) => s.order).length} of ${seats.length} occupied`}
        >
          <View style={styles.tableFloor}>
            {seats.map((seat) => (
              <TableCell
                key={seat.number}
                seat={seat}
                onPress={seat.order ? () => router.push(`/order/${seat.order!.id}`) : undefined}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {pendingOrders.length > 0 ? (
        <Section title={`New ${vocab.requestNoun}s · ${pendingOrders.length}`}>
          {pendingOrders.map((o: Order) => {
            const kept = includedLines(o);
            return (
              <Card key={o.id} style={styles.card} onPress={() => router.push(`/order/${o.id}`)}>
                <View style={styles.topRow}>
                  <Text weight="semibold">
                    {ORDER_STATUS_META[o.status].icon} {o.customerName}
                  </Text>
                  <Text weight="semibold" tone="brand">
                    {totalLabel(totalOf(kept))}
                  </Text>
                </View>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {o.fulfillment
                    ? `${FULFILLMENT_META[o.fulfillment].icon} ${FULFILLMENT_META[o.fulfillment].label}${o.tableNumber != null ? ` · Table ${o.tableNumber}` : ''} · `
                    : ''}
                  {kept.map((l) => (l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name)).join(', ')}
                </Text>
                <Button
                  title={`Review ${vocab.requestNoun}`}
                  onPress={() => router.push(`/order/${o.id}`)}
                  style={styles.actionBtn}
                />
              </Card>
            );
          })}
        </Section>
      ) : null}

      {openTabs.length > 0 ? (
        <Section title={`Open tabs · ${openTabs.length}`}>
          {openTabs.map((o: Order) => {
            const kept = includedLines(o);
            return (
              <Card key={o.id} style={styles.card} onPress={() => router.push(`/order/${o.id}`)}>
                <View style={styles.topRow}>
                  <Text weight="semibold">
                    {o.party
                      ? `🎉 ${o.customerName} · party · ${o.party.guests} guests`
                      : `🍽️ ${o.customerName}${o.tableNumber != null ? ` · Table ${o.tableNumber}` : ''} · open tab`}
                  </Text>
                  <Text weight="semibold" tone="brand">
                    {totalLabel(totalOf(kept))}
                  </Text>
                </View>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {kept.map((l) => (l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name)).join(', ')}
                </Text>
                <Button
                  title="🧾 Move to billing"
                  variant="secondary"
                  onPress={() => router.push(`/order/${o.id}`)}
                  style={styles.actionBtn}
                />
              </Card>
            );
          })}
        </Section>
      ) : null}

      {orders.length === 0 ? (
        <EmptyView
          title={`No ${vocab.requestNoun}s yet`}
          subtitle={`${vocab.requestsTitle} customers send from your page show up here.`}
        />
      ) : (
        <Button
          title={`📦 All ${vocab.requestNoun}s today · ${todaysOrders.length}`}
          variant="secondary"
          onPress={() => router.push(`/orders/${business.id}?range=today`)}
          style={styles.allBtn}
        />
      )}
    </Screen>
  );
}

function TableCell({ seat, onPress }: { seat: TableSeat; onPress?: () => void }) {
  const colors = useColors();
  const occupied = !!seat.order;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={
        occupied ? `Table ${seat.number}, ${seat.order?.customerName}` : `Table ${seat.number}, free`
      }
      style={({ pressed }) => [
        styles.tableCell,
        {
          backgroundColor: occupied ? colors.brandSoft : colors.surface,
          borderColor: occupied ? colors.brand : colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text weight="bold" tone={occupied ? 'brand' : 'muted'}>
        {seat.number}
      </Text>
      <Text variant="caption" tone={occupied ? 'default' : 'muted'} numberOfLines={1}>
        {occupied ? seat.order?.customerName : 'Free'}
      </Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="subheading" weight="bold" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  takeBtn: { marginBottom: spacing.xl },
  tableFloor: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tableCell: {
    width: 76,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: 2,
  },
  section: { marginBottom: spacing.xl },
  sectionTitle: { marginBottom: spacing.md },
  card: { marginBottom: spacing.sm },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actionBtn: { marginTop: spacing.md },
  allBtn: { marginTop: spacing.md },
});
