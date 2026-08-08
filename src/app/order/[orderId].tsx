/**
 * Order detail — one screen, role-aware, and always interactive (never a
 * frozen document):
 *  - Business member + 'requested': review mode. Every line starts ticked;
 *    untick what you can't provide. Keeping everything accepts the complete
 *    order (bill issued automatically); unticking some sends the rest back as
 *    a proposal; rejecting turns the whole order down with a message.
 *  - Customer + 'proposed': sees exactly what's in and what's out, with
 *    pricing, and accepts (bill issued for the included lines) or declines.
 *  - Everyone else / final states: a read-only history of what happened,
 *    with the bill one tap away once issued.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import type { Order, OrderLine } from '@/domain/types';
import {
  HANDOVER_META,
  canScanFor,
  handoverOf,
  orderTicketUrl,
  usesQrHandover,
} from '@/features/fulfillment/fulfillment';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
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
import {
  FULFILLMENT_META,
  ORDER_STATUS_META,
  effectiveUnitPrice,
  lineAmount,
  totalLabel,
  totalOf,
} from '@/features/orders/orderUtils';
import { formatMoney } from '@/lib/money';
import { radius, spacing, useColors } from '@/theme/theme';

export default function OrderDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());
  const [counters, setCounters] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
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

  // Review mode starts with every line ticked ("I can provide all of this").
  useEffect(() => {
    if (data?.order.status === 'requested') {
      setKeptIds(new Set(data.order.lines.map((l) => l.id)));
    }
  }, [data]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data || !data.business) return <EmptyView title="Order not found" />;

  const { order, business, employees, bill } = data;
  const isOwner = currentUser?.id === business.ownerId;
  const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
  const isMember = isOwner || !!meEmployee;
  const canScan = canScanFor(business, currentUser, meEmployee);
  const viewerId = currentUser?.id ?? 'guest';
  const isCustomer = order.customerId === viewerId;

  if (!isMember && !isCustomer) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Order' }} />
        <EmptyView title="Not your order" subtitle="Only the customer and the business can see this." />
      </Screen>
    );
  }

  const meta = ORDER_STATUS_META[order.status];
  const myName = currentUser?.name ?? 'Guest';
  const reviewing = isMember && order.status === 'requested';
  const deciding = isCustomer && order.status === 'proposed';
  const isDineIn = order.fulfillment === 'dine_in';
  // QR handover (takeaway today): the order carries a scannable ticket from the
  // moment it's placed; staff scan it to take payment and hand it over. Hidden
  // only once the order is dead (rejected/declined).
  const isTerminal = order.status === 'rejected' || order.status === 'declined';
  const handover = usesQrHandover(order) ? handoverOf(order, bill) : null;
  const showTicket = !!handover && !isTerminal;
  // A confirmed dine-in order without a bill is an OPEN TAB: the customer can
  // keep adding items; the business closes it by moving it to billing.
  const openTab = order.status === 'accepted' && !order.billId;
  const canAddMore = isCustomer && isDineIn && !order.billId && (order.status === 'requested' || order.status === 'accepted');

  const toggleLine = (id: string) =>
    setKeptIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setMessage('');
      reload();
    } catch (err) {
      Alert.alert('Something went wrong', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  // Draft counter-offers typed while reviewing, only on lines being kept.
  const draftCounters: Record<string, string> = {};
  if (reviewing) {
    for (const l of order.lines) {
      const value = counters[l.id]?.trim();
      if (value && keptIds.has(l.id)) draftCounters[l.id] = value;
    }
  }
  const hasCounters = Object.keys(draftCounters).length > 0;

  const respond = () =>
    run(() =>
      repos.orders.respond(
        order.id,
        Array.from(keptIds),
        myName,
        message,
        hasCounters ? draftCounters : undefined,
      ),
    );
  const rejectOrder = () => run(() => repos.orders.reject(order.id, myName, message));
  const decide = (accept: boolean) => run(() => repos.orders.decideProposal(order.id, accept));
  const moveToBilling = () => run(() => repos.orders.moveToBilling(order.id, myName));
  // QR handover, done straight from the order (the QR is just the other way in).
  const markPaid = () =>
    order.billId ? run(() => repos.bills.setPaymentStatus(order.billId!, 'paid', myName)) : undefined;
  const markCollected = () => run(() => repos.orders.markDelivered(order.id, myName));
  // One tap when both happen together — pay at the counter and take it away.
  const markPaidAndCollected = () =>
    order.billId
      ? run(async () => {
          await repos.bills.setPaymentStatus(order.billId!, 'paid', myName);
          await repos.orders.markDelivered(order.id, myName);
        })
      : undefined;

  // Which lines count towards the shown total: the review selection while
  // reviewing, otherwise whatever the order marks as included. While reviewing,
  // a typed counter price overrides the line's price in what's displayed.
  const isLineIn = (l: OrderLine) => (reviewing ? keptIds.has(l.id) : l.included);
  const priceView = (l: OrderLine): OrderLine =>
    reviewing ? { ...l, counterPrice: draftCounters[l.id] } : l;
  const linesIn = order.lines.filter(isLineIn).map(priceView);
  const total = totalOf(linesIn);
  const allKept = reviewing && keptIds.size === order.lines.length;
  const keptCount = linesIn.length;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Order' }} />

      <View style={styles.header}>
        <Text variant="title" weight="bold" style={styles.flex}>
          {isMember ? `Order from ${order.customerName}` : `Order · ${business.name}`}
        </Text>
        <Tag
          label={
            openTab
              ? order.party
                ? '🎉 Party confirmed'
                : '🍽️ Open tab'
              : `${meta.icon} ${meta.label}`
          }
          tone={openTab || meta.tone === 'brand' ? 'brand' : 'default'}
        />
      </View>
      {order.fulfillment ? (
        <View style={styles.fulfillmentRow}>
          <Tag
            label={`${FULFILLMENT_META[order.fulfillment].icon} ${FULFILLMENT_META[order.fulfillment].label}`}
            tone="brand"
          />
          {order.tableNumber != null ? (
            <Tag label={`🍽️ Table ${order.tableNumber}`} tone="brand" />
          ) : null}
        </View>
      ) : null}
      <Text variant="caption" tone="muted" style={styles.when}>
        Placed {new Date(order.createdAt).toLocaleString()}
        {order.respondedByName ? ` · handled by ${order.respondedByName}` : ''}
      </Text>
      <Text tone="muted" style={styles.hint}>
        {openTab
          ? order.party
            ? isMember
              ? 'Party confirmed — move it to billing after the event.'
              : 'Your party is confirmed — the bill comes after the event.'
            : isMember
              ? 'Confirmed — the customer can keep ordering; move the tab to billing when they’re done.'
              : 'Confirmed — add more items whenever you like; the bill comes when your tab is closed.'
          : isMember
            ? meta.businessHint
            : meta.customerHint}
      </Text>

      {/* Party requests carry the event details */}
      {order.party ? (
        <Card style={styles.noteCard}>
          <Text variant="caption" weight="semibold" tone="muted">
            🎉 PARTY REQUEST
          </Text>
          <Text style={styles.partyLine}>
            👥 {order.party.guests} guests · 🗓️ {order.party.when}
          </Text>
          {order.party.occasion ? (
            <Text variant="caption" tone="muted" style={styles.partyLine}>
              Occasion: {order.party.occasion}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Enroll/subscribe requests: who the plan is for */}
      {order.enrollees && order.enrollees.length > 0 ? (
        <Card style={styles.noteCard}>
          <Text variant="caption" weight="semibold" tone="muted">
            👥 ENROLLING {order.enrollees.length === 1 ? '' : `· ${order.enrollees.length} PEOPLE`}
          </Text>
          {order.enrollees.map((name, i) => (
            <Text key={`${name}-${i}`} style={styles.partyLine}>
              • {name}
            </Text>
          ))}
        </Card>
      ) : null}

      {order.note ? (
        <Card style={styles.noteCard}>
          <Text variant="caption" weight="semibold" tone="muted">
            CUSTOMER NOTE
          </Text>
          <Text style={styles.noteBody}>“{order.note}”</Text>
        </Card>
      ) : null}

      {/* QR handover ticket — pay & collect by scanning */}
      {showTicket && handover ? (
        <Card style={styles.ticketCard}>
          <Text variant="caption" weight="semibold" tone="muted">
            🎟️ ORDER TICKET
          </Text>
          <View style={styles.ticketQrWrap}>
            <QRCode
              value={orderTicketUrl(order.id)}
              size={168}
              backgroundColor="#FFFFFF"
              color="#000000"
            />
          </View>
          <Tag
            label={`${HANDOVER_META[handover.stage].icon} ${HANDOVER_META[handover.stage].label}`}
            tone={handover.collected ? 'default' : 'brand'}
          />
          <Text variant="caption" tone="muted" style={styles.ticketHint}>
            {handover.collected
              ? isMember
                ? `Handed over by ${handover.collectedByName ?? 'the team'}.`
                : 'Collected — thanks for ordering!'
              : canScan
                ? 'Scan the code, or just use the buttons below — the QR is only a shortcut.'
                : isMember
                  ? 'Scan this at the counter to take payment, then to hand it over.'
                  : 'Show this at the counter — staff scan it to take payment and hand over your order.'}
          </Text>

          {/* Web has no camera scanner — this link is what you paste into /scan. */}
          <Text variant="caption" tone="muted" style={styles.ticketLink} selectable>
            {orderTicketUrl(order.id)}
          </Text>

          {/* The same pay → collect actions the scan screen offers, inline.
              When neither is done there are three ways to move it forward:
              paid only, collected only, or both in one tap. */}
          {canScan && order.billId ? (
            <>
              {!handover.paid ? (
                <Button
                  title={`💰 Mark as paid · ${totalLabel(total)}`}
                  onPress={markPaid}
                  loading={busy}
                  disabled={busy}
                  style={styles.ticketBtn}
                />
              ) : null}
              {!handover.collected ? (
                <Button
                  title="✅ Mark as collected"
                  onPress={markCollected}
                  loading={busy}
                  disabled={busy}
                  style={styles.ticketBtn}
                />
              ) : null}
              {!handover.paid && !handover.collected ? (
                <Button
                  title={`💰✅ Mark as paid & collected · ${totalLabel(total)}`}
                  onPress={markPaidAndCollected}
                  loading={busy}
                  disabled={busy}
                  style={styles.ticketBtn}
                />
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {/* Lines — tappable checkboxes while reviewing, in/out afterwards */}
      <Text variant="subheading" weight="bold" style={styles.sectionTitle}>
        Items
      </Text>
      <Card>
        {order.lines.map((line, i) => {
          const included = isLineIn(line);
          const viewed = priceView(line);
          const amount = lineAmount(viewed);
          const unit = effectiveUnitPrice(viewed);
          const row = (
            <View
              style={[
                styles.lineRow,
                i < order.lines.length - 1 && {
                  borderBottomColor: colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              {reviewing ? (
                <View
                  style={[
                    styles.checkbox,
                    included
                      ? { backgroundColor: colors.brand }
                      : { borderColor: colors.border, borderWidth: 1.5 },
                  ]}
                >
                  {included ? (
                    <Text variant="caption" weight="bold" tone="inverse">
                      ✓
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.lineInfo}>
                <Text
                  weight="medium"
                  tone={included ? 'default' : 'muted'}
                  style={included ? undefined : styles.struck}
                >
                  {line.kind === 'service' ? '🛠️' : '🛍️'} {line.name}
                  {line.quantity > 1 ? ` ×${line.quantity}` : ''}
                </Text>
                {line.offerPrice ? (
                  <Text variant="caption" tone="brand">
                    💰 {isCustomer ? 'You' : order.customerName} offered {line.offerPrice}
                    {line.price ? ` (listed ${line.price})` : ''}
                  </Text>
                ) : null}
                {line.counterPrice && !reviewing ? (
                  <Text variant="caption" tone="brand" weight="semibold">
                    ↩️ {isMember ? 'You' : 'The seller'} countered at {line.counterPrice}
                  </Text>
                ) : null}
                {!included && !reviewing ? (
                  <Text variant="caption" tone="danger">
                    Not available from this business
                  </Text>
                ) : null}
              </View>
              <Text weight="semibold" tone={included ? 'brand' : 'muted'} style={included ? undefined : styles.struck}>
                {amount !== undefined ? formatMoney(amount) : (unit ?? 'TBC')}
              </Text>
            </View>
          );
          const counterInput =
            // Parties are always negotiable — the business can quote its own
            // price even when the customer didn't name a budget.
            reviewing && included && (line.offerPrice || order.party) ? (
              <Input
                label={line.offerPrice ? '↩️ Counter price (optional)' : '💬 Your quote (optional)'}
                placeholder={
                  line.offerPrice
                    ? `Leave empty to accept their ${line.offerPrice}`
                    : 'e.g. ₹9,500 for the whole party'
                }
                value={counters[line.id] ?? ''}
                onChangeText={(v) => setCounters((prev) => ({ ...prev, [line.id]: v }))}
                style={styles.counterInput}
              />
            ) : null;
          return reviewing ? (
            <View key={line.id}>
              <Pressable onPress={() => toggleLine(line.id)}>{row}</Pressable>
              {counterInput}
            </View>
          ) : (
            <View key={line.id}>{row}</View>
          );
        })}
        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text weight="semibold">
            {keptCount === order.lines.length
              ? 'Total'
              : `Total · ${keptCount} of ${order.lines.length} items`}
          </Text>
          <Text weight="bold" tone="brand">
            {keptCount > 0 ? totalLabel(total) : '—'}
          </Text>
        </View>
      </Card>

      {order.responseMessage ? (
        <Card style={styles.noteCard}>
          <Text variant="caption" weight="semibold" tone="muted">
            MESSAGE FROM {order.respondedByName?.toUpperCase() ?? 'THE BUSINESS'}
          </Text>
          <Text style={styles.noteBody}>“{order.responseMessage}”</Text>
        </Card>
      ) : null}

      {/* Business review actions */}
      {reviewing ? (
        <View style={styles.actions}>
          <Text variant="caption" tone="muted" style={styles.reviewHint}>
            {order.lines.some((l) => l.offerPrice)
              ? 'Untick anything you can’t provide. Accepting as-is agrees to the customer’s offered prices; type a counter price to bargain back — they confirm before anything is billed.'
              : 'Untick anything you can’t provide. Keeping everything accepts the whole order; unticking some sends the rest back as a proposal the customer confirms.'}
          </Text>
          <Input
            label="Message to the customer (optional)"
            placeholder="e.g. The SUV tyres are out of stock this week"
            value={message}
            onChangeText={setMessage}
            multiline
            style={styles.message}
          />
          <Button
            title={
              hasCounters
                ? `💰 Send counter-offer · ${totalLabel(total)}`
                : allKept
                  ? order.party
                    ? '✅ Accept party request'
                    : isDineIn
                      ? '✅ Accept order'
                      : '✅ Accept order & issue bill'
                  : `✏️ Send proposal (${keptCount} of ${order.lines.length} items)`
            }
            onPress={respond}
            loading={busy}
            disabled={busy || keptCount === 0}
          />
          <Button
            title="❌ Reject order"
            variant="secondary"
            onPress={rejectOrder}
            disabled={busy}
            style={styles.secondaryAction}
          />
        </View>
      ) : null}

      {/* Customer proposal decision */}
      {deciding ? (
        <View style={styles.actions}>
          <Button
            title={`✅ Accept proposal · ${keptCount > 0 ? totalLabel(total) : ''}`}
            onPress={() => decide(true)}
            loading={busy}
            disabled={busy}
          />
          <Button
            title="Decline"
            variant="secondary"
            onPress={() => decide(false)}
            disabled={busy}
            style={styles.secondaryAction}
          />
        </View>
      ) : null}

      {/* Open dine-in tab: the business closes it; the customer keeps adding */}
      {isMember && openTab ? (
        <Button
          title={`🧾 Move to billing · ${keptCount > 0 ? totalLabel(total) : ''}`}
          onPress={moveToBilling}
          loading={busy}
          disabled={busy}
          style={styles.billBtn}
        />
      ) : null}
      {canAddMore ? (
        <Button
          title="➕ Add more items"
          variant={openTab && !isMember ? 'primary' : 'secondary'}
          onPress={() => router.push(`/order/new/${business.id}`)}
          style={styles.billBtn}
        />
      ) : null}

      {/* Final-state shortcuts */}
      {order.billId ? (
        <Button
          title="🧾 View bill"
          onPress={() => router.push(`/bill/${order.billId}`)}
          variant={reviewing || deciding ? 'secondary' : 'primary'}
          style={styles.billBtn}
        />
      ) : null}
      {isCustomer && (order.status === 'rejected' || order.status === 'declined') ? (
        <Button
          title="🛒 Order again"
          variant="secondary"
          onPress={() => router.push(`/order/new/${business.id}`)}
          style={styles.billBtn}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fulfillmentRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  counterInput: { marginBottom: spacing.md },
  when: { marginTop: spacing.xs },
  hint: { marginTop: spacing.sm, marginBottom: spacing.lg },
  noteCard: { marginBottom: spacing.md },
  ticketCard: { marginBottom: spacing.md, alignItems: 'center' },
  ticketQrWrap: {
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radius.lg,
    marginVertical: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#00000022',
  },
  ticketHint: { textAlign: 'center', marginTop: spacing.sm, maxWidth: 320 },
  ticketLink: { textAlign: 'center', marginTop: spacing.sm },
  ticketBtn: { alignSelf: 'stretch', marginTop: spacing.md },
  noteBody: { marginTop: spacing.xs, fontStyle: 'italic' },
  partyLine: { marginTop: spacing.xs },
  sectionTitle: { marginBottom: spacing.md },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineInfo: { flex: 1, gap: 2 },
  struck: { textDecorationLine: 'line-through' },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actions: { marginTop: spacing.lg },
  reviewHint: { marginBottom: spacing.md },
  message: { minHeight: 64, textAlignVertical: 'top' },
  secondaryAction: { marginTop: spacing.md },
  billBtn: { marginTop: spacing.md },
});
