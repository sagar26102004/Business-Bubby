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
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
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
    const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
    const canAccess = canAccessService(business, meEmployee, currentUser, 'orders');
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
  // A finished order is off the desk. Billing it is what closes it (`billId`),
  // and a handed-over ticket (`deliveredAt`) or a refusal ends it too — all of
  // them still live in "All orders today", which is where you go to look back.
  // The desk itself only ever shows work that is still open.
  const isDone = (o: Order) =>
    !!o.billId || !!o.deliveredAt || o.status === 'rejected' || o.status === 'declined';
  const live = orders.filter((o) => !isDone(o));

  const pendingOrders = live.filter((o) => o.status === 'requested');
  const openProposals = live.filter((o) => o.status === 'proposed');
  const openTabs = live.filter((o) => o.status === 'accepted');
  // The desk cares about the shift it's working, so the history link below is
  // scoped to today — the full history is one tap further, on that screen.
  const todaysOrders = orders.filter((o) => isToday(o.createdAt));

  // Dine-in and takeaway are two different jobs on the floor — a table being
  // served vs a bag waiting at the counter — so the desk keeps them in separate
  // queues instead of one mixed list you have to read line by line. A party
  // books the room, so it counts as dine-in. Orders with no fulfillment at all
  // (services, stalls, enrolments) keep the plain heading, which is exactly how
  // a non-food business still sees this screen.
  const isDineIn = (o: Order) => o.fulfillment === 'dine_in' || !!o.party;
  const isTakeaway = (o: Order) => o.fulfillment === 'takeaway' && !o.party;
  const isPlain = (o: Order) => !isDineIn(o) && !isTakeaway(o);

  const group = (list: Order[], dineInTitle: string, takeawayTitle: string, plainTitle: string) =>
    [
      { key: 'dine_in', title: dineInTitle, orders: list.filter(isDineIn) },
      { key: 'takeaway', title: takeawayTitle, orders: list.filter(isTakeaway) },
      { key: 'plain', title: plainTitle, orders: list.filter(isPlain) },
    ].filter((g) => g.orders.length > 0);

  const pendingGroups = group(
    pendingOrders,
    `${FULFILLMENT_META.dine_in.icon} New dine-in`,
    `${FULFILLMENT_META.takeaway.icon} New takeaway`,
    `New ${vocab.requestNoun}s`,
  );
  // An open tab is dine-in by nature; a takeaway lands here only when the
  // customer accepted a proposal, so it's simply waiting to be billed.
  const tabGroups = group(
    openTabs,
    `${FULFILLMENT_META.dine_in.icon} Open tabs`,
    `${FULFILLMENT_META.takeaway.icon} Takeaway to bill`,
    'Awaiting billing',
  );

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: vocab.requestsTitle }} />

      {/* No "take an order at the counter" button here: a walk-in is billed
          directly from Billing › Bill a customer, which is the same job in one
          step instead of two (order → accept → bill). Orders on this desk are
          the ones customers placed themselves. */}

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

      {pendingGroups.map((g) => (
        <Section key={g.key} title={`${g.title} · ${g.orders.length}`}>
          {g.orders.map((o: Order) => {
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
                  {/* The heading already says dine-in or takeaway, so the line
                      below only adds what THIS order needs: its table. */}
                  {o.tableNumber != null ? `Table ${o.tableNumber} · ` : ''}
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
      ))}

      {tabGroups.map((g) => (
        <Section key={g.key} title={`${g.title} · ${g.orders.length}`}>
          {g.orders.map((o: Order) => {
            const kept = includedLines(o);
            return (
              <Card key={o.id} style={styles.card} onPress={() => router.push(`/order/${o.id}`)}>
                <View style={styles.topRow}>
                  <Text weight="semibold">
                    {o.party
                      ? `🎉 ${o.customerName} · party · ${o.party.guests} guests`
                      : o.fulfillment === 'takeaway'
                        ? `${FULFILLMENT_META.takeaway.icon} ${o.customerName} · to bill`
                        : `${FULFILLMENT_META.dine_in.icon} ${o.customerName}${o.tableNumber != null ? ` · Table ${o.tableNumber}` : ''} · open tab`}
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
      ))}

      {orders.length === 0 ? (
        <EmptyView
          title={`No ${vocab.requestNoun}s yet`}
          subtitle={`${vocab.requestsTitle} customers send from your page show up here.`}
        />
      ) : null}

      {/* Everything dealt with: say so, rather than leaving a blank screen that
          looks like the orders went missing. */}
      {orders.length > 0 && live.length === 0 ? (
        <EmptyView
          title="All caught up"
          subtitle={`Nothing open right now. Finished ${vocab.requestNoun}s are in the day's list below.`}
        />
      ) : null}

      {orders.length > 0 ? (
        <Button
          title={`📦 All ${vocab.requestNoun}s today · ${todaysOrders.length}`}
          variant="secondary"
          onPress={() => router.push(`/orders/${business.id}?range=today`)}
          style={styles.allBtn}
        />
      ) : null}
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
