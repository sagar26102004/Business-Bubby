/**
 * Workspace › Members — recurring monthly plans (gym, batch, tuition, bus
 * seat). Only the business enrolls someone; the plan then shows in that
 * customer's Subscriptions tab. Members only.
 *
 * Enrolments are grouped by the paying account: a parent who signed up three
 * children shows as ONE member you expand to see each child. Active plans and
 * cancelled ones are split across the Members and Unsubscribed sections, each
 * grouped under the same paying account — so a child who unsubscribes leaves the
 * parent's active group and reappears, still under that parent, in Unsubscribed
 * (even while their siblings stay subscribed). Every child card can be renamed
 * or split off into its own standalone member.
 */
import { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, UIManager, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import type { Membership, TrackedItem, Vehicle } from '@/domain/types';
import { canAccessService } from '@/domain/access';
import { hasModule } from '@/domain/modules';
import { getVehicleKind } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
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
import { radius, spacing, useColors } from '@/theme/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** All the enrolments filed under one paying account (or one standalone member). */
interface MemberGroup {
  key: string;
  name: string;
  standalone: boolean;
  items: Membership[];
  total: number;
}

/** Fold the flat membership list into per-account groups, alphabetical. Only
 *  active, non-standalone plans count toward the monthly total. */
function buildGroups(members: Membership[]): MemberGroup[] {
  const byKey = new Map<string, MemberGroup>();
  for (const m of members) {
    let g = byKey.get(m.customerId);
    if (!g) {
      g = { key: m.customerId, name: m.customerName, standalone: !!m.standalone, items: [], total: 0 };
      byKey.set(m.customerId, g);
    }
    g.items.push(m);
    if (!m.standalone && m.status === 'active') g.total += m.pricePerMonth;
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.items.sort((a, b) =>
      (a.enrolleeName ?? a.customerName).localeCompare(b.enrolleeName ?? b.customerName),
    );
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

/** A group is a parent-with-children (expandable) when it holds several plans
 * or any plan filed "for" someone; a lone self/standalone plan shows flat. */
const isExpandable = (g: MemberGroup) => g.items.length > 1 || g.items.some((i) => i.enrolleeName);

export default function WorkspaceMembersScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();
  const colors = useColors();
  const myName = currentUser?.name ?? 'Owner';

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    // Fleet is only relevant when this business runs live tracking (a bus
    // service). We load vehicles + assignments so each member can be put on a bus.
    const trackingOn = hasModule(business, 'tracking');
    const [employees, members, cancelled, requests, customers, vehicles, trackedItems] =
      await Promise.all([
        repos.employees.listByBusiness(business.id),
        repos.memberships.listForBusiness(business.id),
        repos.memberships.listCancelledForBusiness(business.id),
        repos.memberships.listRequests(business.id),
        repos.customers.listForBusiness(business.id),
        trackingOn ? repos.tracking.listVehicles(business.id) : Promise.resolve([] as Vehicle[]),
        trackingOn ? repos.tracking.listItems(business.id) : Promise.resolve([] as TrackedItem[]),
      ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = currentUser?.id === business.ownerId || !!meEmployee;
    const canAccess = canAccessService(business, meEmployee, currentUser?.id, 'members');
    return {
      business, isMember, canAccess, members, cancelled, requests, customers,
      trackingOn, vehicles, trackedItems,
    };
  }, [businessId, currentUser?.id]);

  // Add-member form (revealed from the header button).
  const [showAdd, setShowAdd] = useState(false);
  const [memberCustomerKey, setMemberCustomerKey] = useState<string | null>(null);
  const [memberPlan, setMemberPlan] = useState('');
  const [memberPrice, setMemberPrice] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  // Grouped-list UI state.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyPayId, setBusyPayId] = useState<string | null>(null);
  // Which member's bus-assignment picker is open (a membership id, or `group:<key>`).
  const [busPickerFor, setBusPickerFor] = useState<string | null>(null);
  const [busBusy, setBusBusy] = useState(false);

  // Per-request accept inputs (plan name + monthly price), keyed by request id.
  const [reqPlan, setReqPlan] = useState<Record<string, string>>({});
  const [reqPrice, setReqPrice] = useState<Record<string, string>>({});
  const [reqError, setReqError] = useState<Record<string, string | null>>({});
  const [busyReq, setBusyReq] = useState<string | null>(null);
  // Which requests have their plan/price inputs revealed for tweaking.
  const [adjustingReq, setAdjustingReq] = useState<Record<string, boolean>>({});

  // Active and cancelled enrolments are grouped SEPARATELY, each under the same
  // paying account. A child who unsubscribes drops out of the parent's Members
  // group and reappears — still under that parent's name — in the Unsubscribed
  // section, even while their siblings stay subscribed.
  const activeGroups = useMemo(() => buildGroups(data?.members ?? []), [data]);
  const unsubGroups = useMemo(() => buildGroups(data?.cancelled ?? []), [data]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, isMember, canAccess, requests, customers, trackingOn, vehicles, trackedItems } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Members' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }
  if (!canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Members' }} />
        <EmptyView title="No access" subtitle="Ask the owner to grant you Members in Access & permissions." />
      </Screen>
    );
  }

  const memberSince = (iso: string) => new Date(iso).toDateString().slice(4);

  // Only customers with an app account can be enrolled — the plan has to
  // reach THEIR Subscriptions tab.
  const memberCandidates = customers.filter((c) => c.hasAccount && c.key !== 'guest');

  // A subscription request should be accepted like an order: the price is
  // already set on the business's page (its services), so the owner never
  // re-types it. Look the plan's price up from the listed services — matching
  // by name, or the lone service when there's just one.
  const services = business.services ?? [];
  const planNameFor = (m: Membership): string | undefined =>
    m.requestedPlan ?? (services.length === 1 ? services[0].name : undefined);
  const priceFor = (m: Membership): number | undefined => {
    if (m.requestedPrice != null) return m.requestedPrice;
    const plan = planNameFor(m);
    const match = plan
      ? services.find((s) => s.name.trim().toLowerCase() === plan.trim().toLowerCase())
      : undefined;
    if (match) return parsePrice(match.price);
    return services.length === 1 ? parsePrice(services[0].price) : undefined;
  };

  const toggleExpand = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  };

  const addMember = async () => {
    const customer = memberCandidates.find((c) => c.key === memberCustomerKey);
    if (!customer) {
      setMemberError('Pick a customer first — they need a Localo account.');
      return;
    }
    if (!memberPlan.trim()) {
      setMemberError('Name the plan, e.g. “Monthly membership” or “Evening batch”.');
      return;
    }
    const price = parsePrice(memberPrice);
    if (price === undefined) {
      setMemberError('Enter the monthly price in ₹.');
      return;
    }
    setAddingMember(true);
    try {
      await repos.memberships.add({
        businessId: business.id,
        customerId: customer.key,
        customerName: customer.name,
        planName: memberPlan.trim(),
        pricePerMonth: price,
      });
      setMemberCustomerKey(null);
      setMemberPlan('');
      setMemberPrice('');
      setMemberError(null);
      setShowAdd(false);
      reload();
    } finally {
      setAddingMember(false);
    }
  };

  const stopMembership = async (id: string) => {
    await repos.memberships.cancel(id);
    reload();
  };
  const detachMember = async (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    await repos.memberships.detach(id);
    reload();
  };
  const reenrollMember = async (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    await repos.memberships.reenroll(id);
    reload();
  };
  /** Parent-level "Stop all": cancel every still-active plan under this account. */
  const stopAll = async (items: Membership[]) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    for (const m of items) {
      if (m.status === 'active') await repos.memberships.cancel(m.id);
    }
    reload();
  };
  /** Parent-level "Re-enroll all": revive every cancelled plan under this account. */
  const reenrollAll = async (items: Membership[]) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    for (const m of items) {
      if (m.status === 'cancelled') await repos.memberships.reenroll(m.id);
    }
    reload();
  };

  // ─── Bus assignment (tracking businesses only) ──────────────────────────
  // A member's current bus, if any: the tracked-child row we filed under their
  // membership.
  const assignedItemFor = (m: Membership): TrackedItem | undefined =>
    trackedItems.find((t) => t.membershipId === m.id);
  const vehicleName = (id?: string) => vehicles.find((v) => v.id === id)?.name;

  /** Put one member on a bus (or, tapping the bus they're already on, take them
   *  off). Upserts a tracked child filed under their membership. */
  const assignBus = async (m: Membership, vehicleId: string, toggle = true) => {
    setBusBusy(true);
    try {
      const existing = assignedItemFor(m);
      if (existing) {
        const next = toggle && existing.vehicleId === vehicleId ? undefined : vehicleId;
        await repos.tracking.updateItem(existing.id, { vehicleId: next });
      } else {
        await repos.tracking.addItem({
          businessId: business.id,
          kind: 'child',
          label: m.enrolleeName ?? m.customerName,
          customerId: m.customerId,
          customerName: m.customerName,
          vehicleId,
          membershipId: m.id,
        });
      }
      reload();
    } finally {
      setBusBusy(false);
    }
  };

  /** Put every child under one parent on the same bus in one tap. */
  const assignAll = async (items: Membership[], vehicleId: string) => {
    setBusBusy(true);
    try {
      for (const m of items) {
        if (m.standalone) continue;
        await assignBusNoReload(m, vehicleId);
      }
      reload();
    } finally {
      setBusBusy(false);
      setBusPickerFor(null);
    }
  };
  // Same as assignBus but without its own reload/busy — used inside assignAll's loop.
  const assignBusNoReload = async (m: Membership, vehicleId: string) => {
    const existing = assignedItemFor(m);
    if (existing) {
      await repos.tracking.updateItem(existing.id, { vehicleId });
    } else {
      await repos.tracking.addItem({
        businessId: business.id,
        kind: 'child',
        label: m.enrolleeName ?? m.customerName,
        customerId: m.customerId,
        customerName: m.customerName,
        vehicleId,
        membershipId: m.id,
      });
    }
  };
  const approvePay = async (paymentId: string) => {
    setBusyPayId(paymentId);
    try {
      await repos.memberships.approvePayment(paymentId, myName);
      reload();
    } finally {
      setBusyPayId(null);
    }
  };
  const rejectPay = async (paymentId: string) => {
    setBusyPayId(paymentId);
    try {
      await repos.memberships.rejectPayment(paymentId, myName);
      reload();
    } finally {
      setBusyPayId(null);
    }
  };

  // Accept a request the way orders are accepted — one tap, using the plan and
  // price the customer already chose. The owner only types anything when the
  // request came in vague (no listed plan) or they hit "Adjust".
  const acceptRequest = async (m: Membership) => {
    const planName = (reqPlan[m.id] ?? planNameFor(m) ?? '').trim();
    if (!planName) {
      setReqError((e) => ({ ...e, [m.id]: 'Name the plan before accepting.' }));
      return;
    }
    const typed = reqPrice[m.id];
    const price = typed != null && typed !== '' ? parsePrice(typed) : priceFor(m);
    if (price === undefined) {
      setReqError((e) => ({ ...e, [m.id]: 'Set the monthly price in ₹.' }));
      return;
    }
    setBusyReq(m.id);
    try {
      await repos.memberships.accept(m.id, { planName, pricePerMonth: price });
      setReqError((e) => ({ ...e, [m.id]: null }));
      reload();
    } finally {
      setBusyReq(null);
    }
  };
  const rejectRequest = async (id: string) => {
    setBusyReq(id);
    try {
      await repos.memberships.reject(id);
      reload();
    } finally {
      setBusyReq(null);
    }
  };

  /** The paid / reported / overdue strip on a member card. */
  const renderPayment = (item: Membership, pay: NonNullable<Membership['payment']>) => {
    if (pay.status === 'paid') {
      return (
        <View style={[styles.payPill, { backgroundColor: colors.successSoft }]}>
          <Text variant="caption" weight="semibold" tone="success">
            ✓ Paid this month
          </Text>
        </View>
      );
    }
    if (pay.status === 'pending') {
      const busy = busyPayId === pay.pendingPaymentId;
      return (
        <View style={styles.payBlock}>
          <View style={[styles.payPill, { backgroundColor: colors.accentSoft }]}>
            <Text variant="caption" weight="semibold" tone="accent">
              ⏳ Payment reported — approve
            </Text>
          </View>
          <View style={styles.payActions}>
            <Text
              tone={busy ? 'muted' : 'success'}
              weight="bold"
              onPress={() => !busy && pay.pendingPaymentId && approvePay(pay.pendingPaymentId)}
            >
              ✓ Approve
            </Text>
            <Text
              tone={busy ? 'muted' : 'danger'}
              weight="semibold"
              onPress={() => !busy && pay.pendingPaymentId && rejectPay(pay.pendingPaymentId)}
            >
              Reject
            </Text>
          </View>
        </View>
      );
    }
    // Unpaid — flag how overdue, since that's the number that matters at a glance.
    return (
      <View style={[styles.payPill, styles.payUnpaid, { borderColor: colors.danger, backgroundColor: colors.surfaceAlt }]}>
        <Text variant="caption" weight="semibold" tone="danger">
          ⚠ Unpaid · {pay.daysOverdue === 0 ? 'due now' : `${pay.daysOverdue} day${pay.daysOverdue === 1 ? '' : 's'} overdue`}
        </Text>
      </View>
    );
  };

  /**
   * One enrolment card. Tapping the card opens its Details screen (rename,
   * enrolment date, payments). The button strip is deliberately minimal:
   *  - a child under a parent → Stop + Make separate;
   *  - a standalone / self plan (its own "parent" card) → Details + Stop;
   *  - a cancelled plan (anywhere) → Re-enroll.
   */
  const renderLeaf = (item: Membership) => {
    const displayName = item.enrolleeName ?? item.customerName;
    const isChild = !!item.enrolleeName && !item.standalone;
    const cancelled = item.status === 'cancelled';
    return (
      <Card
        key={item.id}
        onPress={() => router.push(`/member/${item.id}`)}
        style={StyleSheet.flatten([styles.leafCard, cancelled && styles.leafCancelled])}
      >
        <View style={styles.topRow}>
          <Text weight="semibold" style={styles.flex}>
            {displayName}
          </Text>
          {cancelled ? (
            <Text variant="caption" tone="danger" weight="semibold">
              Unsubscribed
            </Text>
          ) : item.standalone ? (
            <Text variant="caption" tone="muted">
              Not billed
            </Text>
          ) : (
            <Text weight="semibold" tone="brand">
              {formatMoney(item.pricePerMonth)}/mo
            </Text>
          )}
        </View>
        <Text variant="caption" tone="muted">
          {item.planName} · since {memberSince(item.startedAt)}
          {cancelled
            ? item.endedAt
              ? ` · stopped ${memberSince(item.endedAt)}`
              : ''
            : item.standalone
              ? ''
              : ` · renews ${memberSince(item.expiresAt)}`}
        </Text>

        {item.payment ? renderPayment(item, item.payment) : null}

        <View style={styles.leafActions}>
          {cancelled ? (
            <Pressable onPress={() => reenrollMember(item.id)} hitSlop={6}>
              <Text variant="caption" tone="accent" weight="semibold">
                ♻️ Re-enroll
              </Text>
            </Pressable>
          ) : (
            <>
              {/* A standalone / self plan is its own parent card, so it keeps the
                  explicit Details button; a child opens Details by tapping. */}
              {!isChild ? (
                <Pressable onPress={() => router.push(`/member/${item.id}`)} hitSlop={6}>
                  <Text variant="caption" tone="accent" weight="semibold">
                    📋 Details
                  </Text>
                </Pressable>
              ) : null}
              {isChild ? (
                <Pressable onPress={() => detachMember(item.id)} hitSlop={6}>
                  <Text variant="caption" tone="accent" weight="semibold">
                    ⤴ Make separate
                  </Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => stopMembership(item.id)} hitSlop={6}>
                <Text variant="caption" tone="danger" weight="semibold">
                  Stop
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {trackingOn && vehicles.length > 0 && !item.standalone && !cancelled
          ? renderBusRow(item)
          : null}
      </Card>
    );
  };

  /** The "🚌 On Bus 3 ▾" assign line + inline vehicle picker on a member card. */
  const renderBusRow = (item: Membership) => {
    const assigned = assignedItemFor(item);
    const onBus = vehicleName(assigned?.vehicleId);
    const open = busPickerFor === item.id;
    return (
      <View style={[styles.busBlock, { borderTopColor: colors.border }]}>
        <Pressable
          onPress={() => setBusPickerFor(open ? null : item.id)}
          style={styles.busHeader}
          hitSlop={6}
        >
          <Text variant="caption" weight="semibold" tone={onBus ? 'brand' : 'accent'}>
            🚌 {onBus ? `On ${onBus}` : 'Assign a bus'}
          </Text>
          <Text variant="caption" tone="muted">
            {open ? '▾' : '▸'}
          </Text>
        </Pressable>
        {open ? (
          <View style={styles.chips}>
            {vehicles.map((v) => (
              <Tag
                key={v.id}
                label={v.name}
                icon={getVehicleKind(v.kind).icon}
                selected={assigned?.vehicleId === v.id}
                onPress={() => !busBusy && assignBus(item, v.id)}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const renderGroup = (g: MemberGroup) => {
    if (!isExpandable(g)) return renderLeaf(g.items[0]);
    const open = expanded[g.key];
    // Active plans first, cancelled ones dropped to the bottom of the family.
    const items = [...g.items].sort(
      (a, b) => Number(a.status === 'cancelled') - Number(b.status === 'cancelled'),
    );
    const activeItems = items.filter((i) => i.status === 'active');
    const cancelledItems = items.filter((i) => i.status === 'cancelled');
    const activeAssignable = activeItems.filter((i) => !i.standalone);
    const summary =
      activeItems.length > 0
        ? `${activeItems.length} active · ${formatMoney(g.total)}/mo${
            cancelledItems.length ? ` · ${cancelledItems.length} unsubscribed` : ''
          }`
        : `${cancelledItems.length} unsubscribed`;
    return (
      <View key={g.key} style={styles.groupBlock}>
        <Pressable
          onPress={() => toggleExpand(g.key)}
          style={[styles.groupHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={`${g.name}, ${items.length} members`}
        >
          <Text style={styles.groupChevron} tone="muted">
            {open ? '▾' : '▸'}
          </Text>
          <View style={styles.flex}>
            <Text weight="bold">{g.name}</Text>
            <Text variant="caption" tone="muted">
              {summary}
            </Text>
          </View>
        </Pressable>
        {open ? (
          <View style={styles.groupChildren}>
            {/* Parent-level actions: open the account overview, and stop /
                re-enroll the whole family at once. */}
            <View style={styles.groupActions}>
              <Pressable
                onPress={() => router.push(`/member-account/${businessId}/${g.key}` as Href)}
                hitSlop={6}
              >
                <Text variant="caption" tone="accent" weight="semibold">
                  📋 Details
                </Text>
              </Pressable>
              {activeItems.length > 0 ? (
                <Pressable onPress={() => stopAll(activeItems)} hitSlop={6}>
                  <Text variant="caption" tone="danger" weight="semibold">
                    ⏹ Stop all
                  </Text>
                </Pressable>
              ) : null}
              {cancelledItems.length > 0 ? (
                <Pressable onPress={() => reenrollAll(cancelledItems)} hitSlop={6}>
                  <Text variant="caption" tone="accent" weight="semibold">
                    ♻️ Re-enroll all
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {trackingOn && vehicles.length > 0 && activeAssignable.length > 1
              ? renderGroupBusRow(g, activeAssignable)
              : null}
            {items.map((it) => renderLeaf(it))}
          </View>
        ) : null}
      </View>
    );
  };

  /** "Put everyone under this parent on one bus" — one tap for a whole family. */
  const renderGroupBusRow = (g: MemberGroup, assignItems: Membership[]) => {
    const pickerKey = `group:${g.key}`;
    const open = busPickerFor === pickerKey;
    return (
      <View style={[styles.busBlock, styles.groupBusBlock, { borderColor: colors.border }]}>
        <Pressable
          onPress={() => setBusPickerFor(open ? null : pickerKey)}
          style={styles.busHeader}
          hitSlop={6}
        >
          <Text variant="caption" weight="semibold" tone="accent">
            🚌 Put everyone on one bus
          </Text>
          <Text variant="caption" tone="muted">
            {open ? '▾' : '▸'}
          </Text>
        </Pressable>
        {open ? (
          <View style={styles.chips}>
            {vehicles.map((v) => (
              <Tag
                key={v.id}
                label={v.name}
                icon={getVehicleKind(v.kind).icon}
                onPress={() => !busBusy && assignAll(assignItems, v.id)}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen scroll>
      <Stack.Screen
        options={{
          title: 'Members',
          headerRight: () => (
            <Text
              tone="accent"
              weight="semibold"
              style={styles.headerAdd}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setShowAdd((v) => !v);
                setMemberError(null);
              }}
            >
              {showAdd ? 'Close' : '＋ Add'}
            </Text>
          ),
        }}
      />

      {showAdd ? (
        <Card style={styles.addCard}>
          <Text weight="semibold">➕ Add a member</Text>
          {memberCandidates.length === 0 ? (
            <Text variant="caption" tone="muted" style={styles.hintTop}>
              No enrollable customers yet — someone has to order, book, chat or call first (and have a
              Localo account).
            </Text>
          ) : (
            <>
              <Text variant="caption" tone="muted" style={styles.hintTop}>
                Who is it for?
              </Text>
              <View style={styles.chips}>
                {memberCandidates.map((c) => (
                  <Tag
                    key={c.key}
                    label={c.name}
                    selected={memberCustomerKey === c.key}
                    onPress={() => setMemberCustomerKey(memberCustomerKey === c.key ? null : c.key)}
                  />
                ))}
              </View>
              <Input
                label="Plan"
                placeholder="e.g. Monthly membership, Morning yoga batch"
                value={memberPlan}
                onChangeText={setMemberPlan}
              />
              <Input
                label="Price per month (₹)"
                placeholder="e.g. 1200"
                value={memberPrice}
                onChangeText={(t) => setMemberPrice(sanitizePriceInput(t))}
                keyboardType="numeric"
              />
              {memberError ? (
                <Text variant="caption" tone="danger" style={styles.error}>
                  {memberError}
                </Text>
              ) : null}
              <Button title="Add member" onPress={addMember} loading={addingMember} />
            </>
          )}
        </Card>
      ) : null}

      {requests.length > 0 ? (
        <>
          <Text weight="semibold" style={styles.sectionHead}>
            🔔 Enrolment requests ({requests.length})
          </Text>
          {requests.map((m: Membership) => {
            // Plan + price the customer's request resolves to — falling back to
            // the price the business already set on its page (services), so a
            // known plan accepts in one tap without re-typing anything.
            const planName = planNameFor(m);
            const price = priceFor(m);
            const known = !!planName && price != null;
            const adjust = adjustingReq[m.id] ?? !known;
            return (
              <Card key={m.id} style={styles.card}>
                <Text weight="semibold">
                  {m.customerName}
                  {m.enrolleeName ? ` · for ${m.enrolleeName}` : ''}
                </Text>
                <Text variant="caption" tone="muted" style={styles.hintTop}>
                  {known
                    ? `Wants “${planName}” · ${formatMoney(price!)}/mo`
                    : planName
                      ? `Wants: “${planName}” — set the monthly price.`
                      : 'Wants to enrol — set their plan and price.'}
                </Text>

                {adjust ? (
                  <>
                    <Input
                      label="Plan"
                      placeholder="e.g. Monthly membership, Morning yoga batch"
                      value={reqPlan[m.id] ?? planName ?? ''}
                      onChangeText={(t) => setReqPlan((p) => ({ ...p, [m.id]: t }))}
                    />
                    <Input
                      label="Price per month (₹)"
                      placeholder="e.g. 1200"
                      value={reqPrice[m.id] ?? (price != null ? String(price) : '')}
                      onChangeText={(t) => setReqPrice((p) => ({ ...p, [m.id]: sanitizePriceInput(t) }))}
                      keyboardType="numeric"
                    />
                  </>
                ) : null}

                {reqError[m.id] ? (
                  <Text variant="caption" tone="danger" style={styles.error}>
                    {reqError[m.id]}
                  </Text>
                ) : null}
                <View style={styles.reqActions}>
                  <Button
                    title="Accept & enrol"
                    onPress={() => acceptRequest(m)}
                    loading={busyReq === m.id}
                    style={styles.reqBtn}
                  />
                  <Button
                    title="Decline"
                    variant="ghost"
                    onPress={() => rejectRequest(m.id)}
                    disabled={busyReq === m.id}
                    style={styles.reqBtn}
                  />
                </View>
                {known && !adjust ? (
                  <Text
                    tone="accent"
                    variant="caption"
                    weight="semibold"
                    style={styles.adjustLink}
                    onPress={() => setAdjustingReq((a) => ({ ...a, [m.id]: true }))}
                  >
                    ✎ Adjust plan or price
                  </Text>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}

      <Text weight="semibold" style={styles.sectionHead}>
        Members {activeGroups.length > 0 ? `(${activeGroups.length})` : ''}
      </Text>
      {activeGroups.length === 0 ? (
        <Text variant="caption" tone="muted" style={styles.hintTop}>
          No members yet. Tap ＋ Add above to enroll a customer into a monthly plan.
        </Text>
      ) : (
        activeGroups.map(renderGroup)
      )}

      {unsubGroups.length > 0 ? (
        <>
          <Text weight="semibold" style={styles.sectionHead}>
            Unsubscribed ({unsubGroups.length})
          </Text>
          {unsubGroups.map(renderGroup)}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerAdd: { paddingHorizontal: spacing.md, fontSize: 16 },
  sectionHead: { marginTop: spacing.md, marginBottom: spacing.sm },
  reqActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  reqBtn: { flex: 1 },
  adjustLink: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  card: { marginBottom: spacing.sm },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  groupBlock: { marginBottom: spacing.sm },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  groupChevron: { width: 16, textAlign: 'center' },
  groupChildren: { marginTop: spacing.sm, paddingLeft: spacing.md },
  groupActions: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.sm },
  leafCard: { marginBottom: spacing.sm },
  leafCancelled: { opacity: 0.6 },
  payBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  payPill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  payUnpaid: { borderWidth: 1 },
  payActions: { flexDirection: 'row', gap: spacing.lg },
  leafActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  renameBtn: { paddingHorizontal: spacing.xs },
  busBlock: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  busHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupBusBlock: {
    marginTop: 0,
    marginBottom: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 0,
    borderWidth: 1,
    borderRadius: radius.md,
    borderStyle: 'dashed',
  },
  addCard: { marginBottom: spacing.md },
  hintTop: { marginTop: spacing.xs, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  error: { marginBottom: spacing.sm },
});
