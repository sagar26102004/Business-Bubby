/**
 * Bill detail — the invoice itself. Reached from an accepted order, a chat
 * bill card, an alert, or the workspace billing list. Anyone on the bill can
 * share it out through any app (system share sheet; clipboard fallback on
 * web); business members can additionally drop it straight into the
 * customer's chat.
 */
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { billRef, billToText } from '@/features/billing/billText';
import { formatMoney } from '@/lib/money';
import { shareText } from '@/lib/share';
import { spacing, useColors } from '@/theme/theme';

export default function BillDetailScreen() {
  const { billId } = useLocalSearchParams<{ billId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [marking, setMarking] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const bill = await repos.bills.getById(billId);
    if (!bill) return null;
    const employees = await repos.employees.listByBusiness(bill.businessId);
    const business = await repos.businesses.getById(bill.businessId);
    return { bill, employees, business };
  }, [billId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Bill not found" />;

  const { bill, employees, business } = data;
  const isMember =
    currentUser?.id === business?.ownerId ||
    employees.some((e) => e.userId && e.userId === currentUser?.id);

  const paid = bill.paymentStatus === 'paid';

  // Only the business can say the money arrived — cash/UPI/card all land on
  // their side of the counter, not in the app.
  const togglePaid = async () => {
    if (marking) return;
    setMarking(true);
    try {
      await repos.bills.setPaymentStatus(
        bill.id,
        paid ? 'pending' : 'paid',
        currentUser?.name ?? 'Owner',
      );
      setFeedback(paid ? 'Marked as unpaid' : '✓ Marked as paid');
      reload();
    } catch (err) {
      Alert.alert('Could not update', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setMarking(false);
    }
  };

  const share = async () => {
    const outcome = await shareText(billToText(bill), `Bill from ${bill.businessName}`);
    setFeedback(
      outcome === 'copied'
        ? '✓ Copied to clipboard — paste it anywhere'
        : outcome === 'shared'
          ? '✓ Shared'
          : outcome === 'failed'
            ? 'Sharing isn’t available here'
            : null,
    );
  };

  const sendInChat = async () => {
    if (sending) return;
    setSending(true);
    try {
      await repos.bills.sendToChat(bill.id, currentUser?.name ?? 'Owner');
      setFeedback('✓ Sent in the customer’s chat');
    } catch (err) {
      Alert.alert('Could not send', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Bill' }} />

      {/* The invoice */}
      <Card style={styles.invoice}>
        <View style={styles.head}>
          <View style={styles.flex}>
            <Text variant="subheading" weight="bold">
              {bill.businessName}
            </Text>
            <Text variant="caption" tone="muted">
              Bill {billRef(bill)} · {new Date(bill.createdAt).toLocaleDateString()}
            </Text>
          </View>
          <Text style={styles.billEmoji}>🧾</Text>
        </View>

        <View style={[styles.parties, { borderColor: colors.border }]}>
          <Text variant="caption" tone="muted">
            Billed to
          </Text>
          <Text weight="semibold">{bill.customerName}</Text>
          <Text variant="caption" tone="muted" style={styles.issuedBy}>
            Issued by {bill.issuedByName}
          </Text>
        </View>

        {bill.lines.map((line, i) => (
          <View
            key={`${line.name}-${i}`}
            style={[
              styles.lineRow,
              i < bill.lines.length - 1 && {
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
            <Text weight="semibold">
              {line.amount !== undefined ? formatMoney(line.amount) : 'TBC'}
            </Text>
          </View>
        ))}

        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text variant="subheading" weight="bold">
            Total
          </Text>
          <Text variant="subheading" weight="bold" tone="brand">
            {formatMoney(bill.total)}
          </Text>
        </View>
        {bill.lines.some((l) => l.amount === undefined) ? (
          <Text variant="caption" tone="muted">
            Some items have no listed price yet — the total covers priced items only.
          </Text>
        ) : null}
        {bill.note ? (
          <Text variant="caption" tone="muted" style={styles.note}>
            Note: {bill.note}
          </Text>
        ) : null}
      </Card>

      {/* Payment state, plain as day on both sides of the counter. */}
      <Card
        style={{
          ...styles.payment,
          backgroundColor: paid ? colors.successSoft : colors.surfaceAlt,
        }}
      >
        <Text weight="bold" tone={paid ? 'success' : 'default'}>
          {paid ? '✅ Paid' : '⏳ Payment pending'}
        </Text>
        <Text variant="caption" tone="muted">
          {paid
            ? `Marked paid by ${bill.paidByName ?? 'the business'}.`
            : isMember
              ? 'Mark it paid once the money reaches you.'
              : `Pay ${bill.businessName} directly — they’ll mark it paid here.`}
        </Text>
      </Card>

      {feedback ? (
        <Text weight="semibold" tone="accent" style={styles.feedback}>
          {feedback}
        </Text>
      ) : null}

      {isMember ? (
        <Button
          title={paid ? '↩️ Mark as unpaid' : '✅ Mark as paid'}
          variant={paid ? 'ghost' : 'primary'}
          onPress={togglePaid}
          loading={marking}
          style={styles.action}
        />
      ) : null}

      {/* Share it however you want */}
      <Button title="📤 Share bill" onPress={share} variant="secondary" style={styles.action} />
      {isMember && bill.customerId ? (
        <Button
          title="💬 Send in customer’s chat"
          variant="secondary"
          onPress={sendInChat}
          loading={sending}
          style={styles.action}
        />
      ) : null}
      {bill.orderId ? (
        <Button
          title="📦 View the order"
          variant="ghost"
          onPress={() => router.push(`/order/${bill.orderId}`)}
          style={styles.action}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  invoice: { marginBottom: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  billEmoji: { fontSize: 34 },
  parties: {
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  issuedBy: { marginTop: spacing.xs },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
  },
  note: { marginTop: spacing.sm, fontStyle: 'italic' },
  payment: { marginBottom: spacing.lg },
  feedback: { textAlign: 'center', marginBottom: spacing.md },
  action: { marginBottom: spacing.md },
});
