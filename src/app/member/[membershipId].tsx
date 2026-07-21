/**
 * Member detail (business side) — one enrolment's full payment standing:
 * whether this cycle is paid, how overdue it is, month-by-month history, and
 * the running total collected. The owner can approve a payment the customer
 * reported, record one taken in person (cash at the counter), and reach the
 * customer over chat. Members only.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Membership, MembershipPayment } from '@/domain/types';
import { canAccessService } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney } from '@/lib/money';
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
import { spacing, useColors } from '@/theme/theme';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const addMonths = (iso: string | Date, n: number) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + n);
  return d;
};
const sameCycle = (a: string, b: string) => {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
};
const cycleLabel = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'online', label: 'Online' },
  { key: 'other', label: 'Other' },
];

export default function MemberDetailScreen() {
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();
  const myName = currentUser?.name ?? 'Owner';

  const { data, loading, error, reload } = useAsync(async () => {
    const membership = await repos.memberships.getById(membershipId);
    if (!membership) return null;
    const business = await repos.businesses.getById(membership.businessId);
    if (!business) return null;
    const [employees, payments] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.memberships.listPayments(membership.id),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = currentUser?.id === business.ownerId || !!meEmployee;
    const canAccess = canAccessService(business, meEmployee, currentUser?.id, 'members');
    return { membership, business, payments, isMember, canAccess };
  }, [membershipId, currentUser?.id]);

  const [method, setMethod] = useState('cash');
  const [paidTo, setPaidTo] = useState('');
  const [note, setNote] = useState('');
  const [recordOpen, setRecordOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  // Editing the enrolment (start) date — billing cycles recompute from it.
  const [editDate, setEditDate] = useState(false);
  const [dateValue, setDateValue] = useState('');
  const [dateErr, setDateErr] = useState<string | null>(null);
  const [savingDate, setSavingDate] = useState(false);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { membership, business, payments, isMember, canAccess } = data;
  if (!isMember || !canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Member' }} />
        <EmptyView title="No access" subtitle="Only this business's team can open member details." />
      </Screen>
    );
  }

  const m: Membership = membership;
  const pay = m.payment;
  const displayName = m.enrolleeName ?? m.customerName;

  // The start date as a YYYY-MM-DD value the text field can hold and the repo
  // can parse.
  const toDateInput = (iso: string) => {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  };
  const openDateEdit = () => {
    setDateValue(toDateInput(m.startedAt));
    setDateErr(null);
    setEditDate(true);
  };
  const saveDate = async () => {
    setSavingDate(true);
    setDateErr(null);
    try {
      await repos.memberships.setStartDate(m.id, dateValue.trim());
      setEditDate(false);
      reload();
    } catch (e) {
      setDateErr(e instanceof Error ? e.message : 'Could not update the date.');
    } finally {
      setSavingDate(false);
    }
  };

  const recordPayment = async () => {
    if (!pay) return;
    setRecording(true);
    try {
      await repos.memberships.recordPayment({
        membershipId: m.id,
        periodStart: pay.periodStart,
        method,
        paidToName: paidTo,
        note,
        byName: myName,
      });
      setPaidTo('');
      setNote('');
      setRecordOpen(false);
      reload();
    } finally {
      setRecording(false);
    }
  };
  const decide = async (paymentId: string, approve: boolean) => {
    setBusy(true);
    try {
      if (approve) await repos.memberships.approvePayment(paymentId, myName);
      else await repos.memberships.rejectPayment(paymentId, myName);
      reload();
    } finally {
      setBusy(false);
    }
  };

  // Every billing cycle from the start to now, newest first, with its payment.
  const cycles: { periodStart: string; payment?: MembershipPayment }[] = [];
  let cursor = new Date(m.startedAt);
  const now = new Date();
  while (cursor <= now) {
    const iso = cursor.toISOString();
    const forCycle = payments
      .filter((p) => sameCycle(p.periodStart, iso) && p.status !== 'rejected')
      .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
    cycles.push({ periodStart: iso, payment: forCycle[0] });
    cursor = addMonths(cursor, 1);
  }
  cycles.reverse();

  const statusTone = pay?.status === 'paid' ? 'success' : pay?.status === 'pending' ? 'accent' : 'danger';
  const statusText =
    pay?.status === 'paid'
      ? '✓ Paid this month'
      : pay?.status === 'pending'
        ? '⏳ Payment reported — awaiting your approval'
        : `⚠ Unpaid · ${pay && pay.daysOverdue > 0 ? `${pay.daysOverdue} day${pay.daysOverdue === 1 ? '' : 's'} overdue` : 'due now'}`;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: displayName }} />

      {/* Who + plan */}
      <Text variant="title" weight="bold">
        {displayName}
      </Text>
      <Text tone="muted" style={styles.sub}>
        {m.enrolleeName ? `Under ${m.customerName} · ` : ''}
        {m.planName} · {formatMoney(m.pricePerMonth)}/mo
      </Text>

      {/* Contact — chat only (the app has no business→customer calling). */}
      {!m.standalone ? (
        <View style={styles.contactRow}>
          <Button
            title="💬 Chat with customer"
            variant="secondary"
            onPress={() => router.push(`/inbox/${business.id}/${m.customerId}`)}
            style={styles.flex}
          />
        </View>
      ) : (
        <Text variant="caption" tone="muted" style={styles.sub}>
          Standalone member — no linked account to chat or bill.
        </Text>
      )}

      {/* Enrolment date — editable; billing cycles recompute from it. */}
      <Card style={styles.card}>
        {!editDate ? (
          <View style={styles.dateRow}>
            <View style={styles.flex}>
              <Text variant="caption" tone="muted">
                Enrolled
              </Text>
              <Text weight="semibold">{dayLabel(m.startedAt)}</Text>
            </View>
            <Text tone="accent" weight="semibold" onPress={openDateEdit}>
              ✎ Edit
            </Text>
          </View>
        ) : (
          <>
            <Text weight="semibold">Enrolment date</Text>
            <Text variant="caption" tone="muted" style={styles.hint}>
              When this plan started — its billing cycles recompute from here.
            </Text>
            <Input
              label="Date (YYYY-MM-DD)"
              placeholder="2026-03-15"
              value={dateValue}
              onChangeText={setDateValue}
              autoCapitalize="none"
            />
            {dateErr ? (
              <Text variant="caption" tone="danger" style={styles.hint}>
                {dateErr}
              </Text>
            ) : null}
            <View style={styles.rowBtns}>
              <Button title="Cancel" variant="ghost" onPress={() => setEditDate(false)} style={styles.flex} />
              <Button title="Save date" onPress={saveDate} loading={savingDate} style={styles.flex} />
            </View>
          </>
        )}
      </Card>

      {/* Headline status */}
      <Card style={styles.statusCard}>
        <Text weight="bold" tone={statusTone}>
          {statusText}
        </Text>
        <View style={styles.statRow}>
          <Stat label="Months paid" value={`${pay?.monthsPaid ?? 0}`} />
          <Stat label="Total collected" value={formatMoney(pay?.totalPaid ?? 0)} />
          <Stat
            label="This cycle"
            value={pay ? cycleLabel(pay.periodStart) : '—'}
          />
        </View>
      </Card>

      {/* Approve a reported payment */}
      {pay?.status === 'pending' && pay.pendingPaymentId ? (
        <Card style={[styles.card, { borderColor: colors.accent, borderWidth: 1 }]}>
          <Text weight="semibold">Approve reported payment</Text>
          {(() => {
            const p = payments.find((x) => x.id === pay.pendingPaymentId);
            return (
              <Text variant="caption" tone="muted" style={styles.hint}>
                {m.customerName} reported paying {formatMoney(p?.amount ?? m.pricePerMonth)}
                {p?.method ? ` by ${p.method}` : ''}
                {p?.paidToName ? ` to ${p.paidToName}` : ''}.
                {p?.note ? ` “${p.note}”` : ''}
              </Text>
            );
          })()}
          <View style={styles.rowBtns}>
            <Button title="✓ Approve" onPress={() => decide(pay.pendingPaymentId!, true)} loading={busy} style={styles.flex} />
            <Button title="Reject" variant="ghost" onPress={() => decide(pay.pendingPaymentId!, false)} disabled={busy} style={styles.flex} />
          </View>
        </Card>
      ) : null}

      {/* Record a payment taken in person */}
      {pay && pay.status !== 'paid' ? (
        <Card style={styles.card}>
          {!recordOpen ? (
            <Button title="＋ Record a payment" variant="secondary" onPress={() => setRecordOpen(true)} />
          ) : (
            <>
              <Text weight="semibold">Record {cycleLabel(pay.periodStart)} payment</Text>
              <Text variant="caption" tone="muted" style={styles.hint}>
                {formatMoney(m.pricePerMonth)} · confirms this cycle straight away.
              </Text>
              <View style={styles.chips}>
                {METHODS.map((mm) => (
                  <Tag key={mm.key} label={mm.label} selected={method === mm.key} onPress={() => setMethod(mm.key)} />
                ))}
              </View>
              {method === 'cash' ? (
                <Input label="Received by (optional)" placeholder="Which team member took it" value={paidTo} onChangeText={setPaidTo} />
              ) : null}
              <Input label="Note (optional)" placeholder="Anything to remember" value={note} onChangeText={setNote} />
              <View style={styles.rowBtns}>
                <Button title="Cancel" variant="ghost" onPress={() => setRecordOpen(false)} style={styles.flex} />
                <Button title="Record payment" onPress={recordPayment} loading={recording} style={styles.flex} />
              </View>
            </>
          )}
        </Card>
      ) : null}

      {/* History */}
      <Text weight="semibold" style={styles.sectionHead}>
        Payment history
      </Text>
      {cycles.map((c) => {
        const p = c.payment;
        const paid = p?.status === 'approved';
        const pending = p?.status === 'pending';
        return (
          <Card key={c.periodStart} style={styles.historyCard}>
            <View style={styles.historyRow}>
              <View style={styles.flex}>
                <Text weight="medium">{cycleLabel(c.periodStart)}</Text>
                {p ? (
                  <Text variant="caption" tone="muted">
                    {p.reportedBy === 'business' ? 'Recorded' : 'Reported'} by {p.reportedByName}
                    {p.method ? ` · ${p.method}` : ''}
                    {p.paidToName ? ` · to ${p.paidToName}` : ''} · {dayLabel(p.reportedAt)}
                    {p.note ? `\n“${p.note}”` : ''}
                  </Text>
                ) : (
                  <Text variant="caption" tone="muted">
                    No payment
                  </Text>
                )}
              </View>
              <Text weight="semibold" tone={paid ? 'success' : pending ? 'accent' : 'danger'}>
                {paid ? `✓ ${formatMoney(p!.amount)}` : pending ? '⏳ Pending' : 'Unpaid'}
              </Text>
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text weight="bold">{value}</Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sub: { marginTop: spacing.xs, marginBottom: spacing.md },
  contactRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statusCard: { marginBottom: spacing.md },
  statRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  stat: { flex: 1 },
  card: { marginBottom: spacing.md },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  hint: { marginTop: spacing.xs, marginBottom: spacing.sm },
  rowBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm },
  sectionHead: { marginTop: spacing.sm, marginBottom: spacing.sm },
  historyCard: { marginBottom: spacing.sm },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
});
