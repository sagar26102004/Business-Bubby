/**
 * Workspace › Logbook — the business's record book of orders, read as a
 * **report**. Every order placed through the app is in here automatically (the
 * repository derives an entry per order); members also add MANUAL records for
 * orders taken any other way (phone, cash, walk-in).
 *
 * The screen is a dated report: pick any Daily / Monthly / Yearly window from
 * the business's registration date up to today (default: today), and the
 * orders in that window list in a numbered, sortable table — serial, time,
 * a short detail, and the amount — with running totals at the bottom. Tap a
 * row to see the full entry (and jump to the order for app orders).
 *
 * Access-gated: the owner grants "Logbook" per member on the Access screen.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { LogEntry } from '@/domain/types';
import { canAccessService } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney, parsePrice } from '@/lib/money';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  Input,
  LoadingView,
  Screen,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { ReportDatePicker } from '@/features/logbook/ReportDatePicker';
import {
  canShift,
  periodLabel,
  relativeLabel,
  reportEntries,
  reportTotals,
  rowTimeLabel,
  shiftAnchor,
  startOfDay,
  truncate,
  type PeriodMode,
  type SortDir,
  type SortKey,
} from '@/features/logbook/reportUtils';

const PERIODS: { mode: PeriodMode; label: string }[] = [
  { mode: 'day', label: 'Daily' },
  { mode: 'month', label: 'Monthly' },
  { mode: 'year', label: 'Yearly' },
];

export default function WorkspaceLogbookScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, entries] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.logbook.listForBusiness(business.id),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = currentUser?.id === business.ownerId || !!meEmployee;
    const canUse = canAccessService(business, meEmployee, currentUser?.id, 'logbook');
    return { business, isMember, canUse, entries };
  }, [businessId, currentUser?.id]);

  // Report controls.
  const [mode, setMode] = useState<PeriodMode>('day');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add-record form.
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [amount, setAmount] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const entries = data?.entries ?? [];
  const rows = useMemo(
    () => reportEntries(entries, mode, anchor, sortKey, sortDir),
    [entries, mode, anchor, sortKey, sortDir],
  );
  const totals = useMemo(() => reportTotals(rows), [rows]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, isMember, canUse } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Logbook' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }
  if (!canUse) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Logbook' }} />
        <EmptyView
          title="No logbook access"
          subtitle="Ask the owner to grant you the Logbook in Access & permissions."
        />
      </Screen>
    );
  }

  const minDate = startOfDay(new Date(business.createdAt));
  const maxDate = startOfDay(new Date());

  const resetForm = () => {
    setTitle('');
    setDetails('');
    setAmount('');
    setCustomerName('');
    setFormError(null);
  };

  const addRecord = async () => {
    if (!title.trim()) {
      setFormError('Give the record a title.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await repos.logbook.addManual({
        businessId: business.id,
        title: title.trim(),
        details: details.trim() || undefined,
        amount: parsePrice(amount),
        customerName: customerName.trim() || undefined,
        recordedByName: currentUser?.name ?? 'A member',
      });
      resetForm();
      setOpen(false);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add the record. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const pickSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'price' ? 'desc' : 'asc');
    }
  };

  const rel = relativeLabel(mode, anchor);
  const dirArrow = sortDir === 'asc' ? '↑' : '↓';

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Logbook' }} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <View style={styles.headerText} />
        {!open ? (
          <Button title="➕ Add" onPress={() => setOpen(true)} style={styles.headerAddBtn} />
        ) : null}
      </View>

      {open ? (
        <Card style={styles.addCard}>
          <Text weight="semibold" style={styles.addTitle}>
            New record
          </Text>
          <Input label="What happened" placeholder="e.g. Phone order · Meena" value={title} onChangeText={setTitle} />
          <Input
            label="Details"
            placeholder="e.g. 2 cappuccinos + banana bread"
            value={details}
            onChangeText={setDetails}
            multiline
          />
          <Input label="Amount" placeholder="e.g. ₹460" value={amount} onChangeText={setAmount} />
          <Input
            label="Customer (optional)"
            placeholder="e.g. Meena"
            value={customerName}
            onChangeText={setCustomerName}
          />
          {formError ? (
            <Text variant="caption" tone="danger" style={styles.formError}>
              {formError}
            </Text>
          ) : null}
          <View style={styles.addActions}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                resetForm();
                setOpen(false);
              }}
              style={styles.addBtn}
            />
            <Button title="Add record" onPress={addRecord} loading={saving} style={styles.addBtnWide} />
          </View>
        </Card>
      ) : null}

      {/* Period toggle: Daily / Monthly / Yearly. */}
      <View style={[styles.segment, { borderColor: colors.border }]}>
        {PERIODS.map((p) => {
          const active = p.mode === mode;
          return (
            <Pressable
              key={p.mode}
              onPress={() => {
                setMode(p.mode);
                setExpandedId(null);
              }}
              style={[styles.segmentItem, active && { backgroundColor: colors.brand }]}
            >
              <Text
                variant="label"
                weight="semibold"
                style={{ color: active ? colors.textInverse : colors.textMuted }}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Date selector: ‹ [period] › — tap the label to open the calendar. */}
      <View style={styles.dateRow}>
        <Pressable
          onPress={() => setAnchor((a) => shiftAnchor(mode, a, -1))}
          disabled={!canShift(mode, anchor, -1, minDate, maxDate)}
          hitSlop={8}
          style={styles.stepBtn}
        >
          <Text variant="subheading" weight="bold" style={{ color: canShift(mode, anchor, -1, minDate, maxDate) ? colors.brand : colors.border }}>
            ‹
          </Text>
        </Pressable>

        <Pressable onPress={() => setPickerOpen(true)} style={[styles.dateLabel, { backgroundColor: colors.brandSoft }]}>
          <Text weight="semibold" tone="brand">
            📅 {periodLabel(mode, anchor)}
          </Text>
          {rel ? (
            <Text variant="caption" tone="muted">
              {rel}
            </Text>
          ) : null}
        </Pressable>

        <Pressable
          onPress={() => setAnchor((a) => shiftAnchor(mode, a, 1))}
          disabled={!canShift(mode, anchor, 1, minDate, maxDate)}
          hitSlop={8}
          style={styles.stepBtn}
        >
          <Text variant="subheading" weight="bold" style={{ color: canShift(mode, anchor, 1, minDate, maxDate) ? colors.brand : colors.border }}>
            ›
          </Text>
        </Pressable>
      </View>

      {/* Sort control. */}
      <View style={styles.sortRow}>
        <Text variant="caption" tone="muted">
          Sort by
        </Text>
        <SortChip label={`🕐 Time ${sortKey === 'time' ? dirArrow : ''}`} active={sortKey === 'time'} onPress={() => pickSort('time')} />
        <SortChip label={`💰 Price ${sortKey === 'price' ? dirArrow : ''}`} active={sortKey === 'price'} onPress={() => pickSort('price')} />
      </View>

      {/* Report table. */}
      {rows.length === 0 ? (
        <EmptyView
          title="No orders in this period"
          subtitle="Nothing was logged in the window you picked. Try another date, or add a manual record."
        />
      ) : (
        <Card style={styles.tableCard}>
          <View style={[styles.tRow, styles.tHead, { borderBottomColor: colors.border }]}>
            <Text variant="caption" weight="semibold" tone="muted" style={styles.cSerial}>
              #
            </Text>
            <Text variant="caption" weight="semibold" tone="muted" style={styles.cTime}>
              {mode === 'day' ? 'Time' : 'Date'}
            </Text>
            <Text variant="caption" weight="semibold" tone="muted" style={styles.cDetails}>
              Order
            </Text>
            <Text variant="caption" weight="semibold" tone="muted" style={styles.cAmount}>
              Amount
            </Text>
          </View>
          {rows.map((e, i) => (
            <ReportRow
              key={e.id}
              serial={i + 1}
              entry={e}
              mode={mode}
              expanded={expandedId === e.id}
              onToggle={() => setExpandedId((cur) => (cur === e.id ? null : e.id))}
              onOpenOrder={e.orderId ? () => router.push(`/order/${e.orderId}`) : undefined}
            />
          ))}
        </Card>
      )}
      </ScrollView>

      {/* Sticky summary bar — stays pinned to the bottom while the report scrolls. */}
      {rows.length > 0 ? (
        <View
          style={[
            styles.summaryBar,
            { backgroundColor: colors.brand, borderTopColor: colors.border, paddingBottom: spacing.sm + insets.bottom },
          ]}
        >
          <SummaryStat label="Orders" value={`${totals.count}`} />
          <SummaryStat label="Total" value={formatMoney(totals.total)} big />
          <SummaryStat label="Average" value={formatMoney(Math.round(totals.average))} />
        </View>
      ) : null}

      <ReportDatePicker
        visible={pickerOpen}
        mode={mode}
        anchor={anchor}
        min={minDate}
        max={maxDate}
        onSelect={(d) => {
          setAnchor(d);
          setPickerOpen(false);
          setExpandedId(null);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

function SortChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.sortChip,
        { borderColor: active ? colors.brand : colors.border, backgroundColor: active ? colors.brandSoft : 'transparent' },
      ]}
    >
      <Text variant="caption" weight="semibold" style={{ color: active ? colors.brandText : colors.textMuted }}>
        {label.trim()}
      </Text>
    </Pressable>
  );
}

function ReportRow({
  serial,
  entry,
  mode,
  expanded,
  onToggle,
  onOpenOrder,
}: {
  serial: number;
  entry: LogEntry;
  mode: PeriodMode;
  expanded: boolean;
  onToggle: () => void;
  onOpenOrder?: () => void;
}) {
  const colors = useColors();
  // The short detail = the entry's headline; its longer details fill the
  // expanded panel.
  const detail = truncate(entry.title, 40);
  return (
    <View style={[styles.rowWrap, { borderTopColor: colors.border }]}>
      <Pressable onPress={onToggle} style={styles.tRow}>
        <Text variant="label" tone="muted" style={styles.cSerial}>
          {serial}
        </Text>
        <Text variant="label" tone="muted" style={styles.cTime}>
          {rowTimeLabel(entry.createdAt, mode)}
        </Text>
        <Text variant="label" style={styles.cDetails} numberOfLines={1}>
          {detail}
        </Text>
        <Text variant="label" weight="semibold" style={styles.cAmount}>
          {entry.amount != null ? formatMoney(entry.amount) : '—'}
        </Text>
      </Pressable>

      {expanded ? (
        <View style={[styles.expand, { backgroundColor: colors.surfaceAlt }]}>
          <Text weight="semibold" style={styles.expandTitle}>
            {entry.title}
          </Text>
          {entry.details ? (
            <Text variant="label" tone="muted" style={styles.expandLine}>
              {entry.details}
            </Text>
          ) : null}
          {entry.customerName ? (
            <Text variant="caption" tone="muted" style={styles.expandLine}>
              Customer: {entry.customerName}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" style={styles.expandLine}>
            {entry.source === 'order' ? '📲 In-app order' : '✍️ Manual record'} · {formatWhen(entry.createdAt)} · by{' '}
            {entry.recordedByName}
          </Text>
          {onOpenOrder ? (
            <Button title="View full order ›" variant="secondary" onPress={onOpenOrder} style={styles.expandBtn} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SummaryStat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" tone="inverse" style={styles.statLabel}>
        {label}
      </Text>
      <Text variant={big ? 'subheading' : 'body'} weight="bold" tone="inverse">
        {value}
      </Text>
    </View>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (
    d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1 },
  headerAddBtn: { marginTop: spacing.xs },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  addCard: { marginBottom: spacing.md },
  addTitle: { marginBottom: spacing.sm },
  formError: { marginTop: spacing.xs },
  addActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  addBtn: { flex: 1 },
  addBtnWide: { flex: 2 },

  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, padding: 3, marginBottom: spacing.md },
  segmentItem: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },

  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md, gap: spacing.sm },
  stepBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  dateLabel: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md },

  sortRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  sortChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1 },

  tableCard: { padding: 0, overflow: 'hidden' },
  tRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  tHead: { borderBottomWidth: 1, paddingVertical: spacing.sm },
  rowWrap: { borderTopWidth: 1 },
  cSerial: { width: 24 },
  cTime: { width: 62 },
  cDetails: { flex: 1 },
  cAmount: { width: 76, textAlign: 'right' },

  expand: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.xs },
  expandTitle: {},
  expandLine: {},
  expandBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },

  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    marginHorizontal: -spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stat: { alignItems: 'center', flex: 1 },
  statLabel: { opacity: 0.7 },
});
