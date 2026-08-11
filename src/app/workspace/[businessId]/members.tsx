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
 *
 * Putting a child on a bus is NOT done here — it lives in Fleet & tracking ›
 * Assign to a vehicle, which works the same enrolment list from the vehicle's
 * side and can fill a whole bus in one pass.
 */
import { useMemo, useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import type { Membership, User } from '@/domain/types';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
import {
  Avatar,
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

/**
 * The account a plan is billed to. `key` is a user id when they have a Localo
 * account, else the `walkin:<name>` key the rest of the app already files
 * account-less customers under (bills, favourites).
 */
interface PayingAccount {
  key: string;
  name: string;
  hasAccount: boolean;
  phone?: string;
}

/** The customer key for someone with no Localo account — matches bills. */
const walkInKey = (name: string) => `walkin:${name.trim().toLowerCase()}`;

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
    const [employees, members, cancelled, requests, customers] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.memberships.listForBusiness(business.id),
      repos.memberships.listCancelledForBusiness(business.id),
      repos.memberships.listRequests(business.id),
      repos.customers.listForBusiness(business.id),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
    const canAccess = canAccessService(business, meEmployee, currentUser, 'members');
    return { business, isMember, canAccess, members, cancelled, requests, customers };
  }, [businessId, currentUser?.id]);

  // Add-member form (revealed from the header button). The payer is found by
  // searching EVERY account by name — not just this business's existing
  // customers — and can also be a plain name with no account at all.
  const [showAdd, setShowAdd] = useState(false);
  const [payer, setPayer] = useState<PayingAccount | null>(null);
  const [payerTerm, setPayerTerm] = useState('');
  const [payerResults, setPayerResults] = useState<User[]>([]);
  const [searchingPayer, setSearchingPayer] = useState(false);
  const [enrolleeName, setEnrolleeName] = useState('');
  const [memberPlan, setMemberPlan] = useState('');
  const [memberPrice, setMemberPrice] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  // Grouped-list UI state.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyPayId, setBusyPayId] = useState<string | null>(null);
  // Which parent group is busy running a "Mark all paid" sweep (its key).
  const [busyGroupPay, setBusyGroupPay] = useState<string | null>(null);

  // Per-request accept inputs (plan name + monthly price), keyed by request id.
  const [reqPlan, setReqPlan] = useState<Record<string, string>>({});
  const [reqPrice, setReqPrice] = useState<Record<string, string>>({});
  // Whether to mark the first month paid on accept (default OFF = unpaid).
  const [reqPaid, setReqPaid] = useState<Record<string, boolean>>({});
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

  const { business, isMember, canAccess, requests, customers } = data;
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

  // People this business already deals with — a one-tap shortcut only. The
  // search below reaches every account on Localo, and a payer who has no
  // account at all can simply be typed in.
  const knownPayers: PayingAccount[] = customers
    .filter((c) => c.key !== 'guest')
    .map((c) => ({ key: c.key, name: c.name, hasAccount: c.hasAccount }));

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

  /** Look the typed name up across every Localo account. */
  const searchPayer = async (next: string) => {
    setPayerTerm(next);
    if (next.trim().length < 2) {
      setPayerResults([]);
      return;
    }
    setSearchingPayer(true);
    try {
      setPayerResults(await repos.users.search(next));
    } finally {
      setSearchingPayer(false);
    }
  };

  const pickPayer = (a: PayingAccount | null) => {
    setPayer(a);
    setPayerTerm('');
    setPayerResults([]);
    setMemberError(null);
  };

  const resetAddForm = () => {
    setPayer(null);
    setPayerTerm('');
    setPayerResults([]);
    setEnrolleeName('');
    setMemberPlan('');
    setMemberPrice('');
    setMemberError(null);
  };

  const addMember = async () => {
    if (!payer) {
      setMemberError('Find the account paying for this plan, or type their name.');
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
    // A blank "who's it for" means the payer is the member themselves — the
    // plan then has no separate enrollee, exactly like a self-enrolment. Typing
    // the payer's own name back in counts as the same thing.
    const enrollee = enrolleeName.trim();
    const forSomeoneElse = !!enrollee && enrollee.toLowerCase() !== payer.name.trim().toLowerCase();
    setAddingMember(true);
    try {
      await repos.memberships.add({
        businessId: business.id,
        customerId: payer.key,
        customerName: payer.name,
        enrolleeName: forSomeoneElse ? enrollee : undefined,
        planName: memberPlan.trim(),
        pricePerMonth: price,
      });
      resetAddForm();
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
  /**
   * Parent-level "Mark all paid": clear this month for every billed child under
   * the account in one tap, instead of opening each one. Records a cash payment
   * for the unpaid ones and approves any the customer already reported; already-
   * paid children are skipped.
   */
  const markAllPaid = async (key: string, items: Membership[]) => {
    setBusyGroupPay(key);
    try {
      for (const m of items) {
        if (m.standalone || m.status !== 'active') continue;
        const pay = m.payment;
        if (!pay || pay.status === 'paid') continue;
        if (pay.status === 'pending' && pay.pendingPaymentId) {
          await repos.memberships.approvePayment(pay.pendingPaymentId, myName);
        } else {
          await repos.memberships.recordPayment({
            membershipId: m.id,
            periodStart: pay.periodStart,
            method: 'cash',
            byName: myName,
          });
        }
      }
      reload();
    } finally {
      setBusyGroupPay(null);
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
      const enrolled = await repos.memberships.accept(m.id, { planName, pricePerMonth: price });
      // Enrolments start UNPAID; only clear the first month if the owner ticked it.
      if (reqPaid[m.id] && enrolled.payment) {
        await repos.memberships.recordPayment({
          membershipId: enrolled.id,
          periodStart: enrolled.payment.periodStart,
          method: 'cash',
          byName: myName,
        });
      }
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
      </Card>
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
    // Billed children who still owe this month — the ones "Mark all paid" clears.
    const unpaidActive = activeItems.filter(
      (i) => !i.standalone && i.payment && i.payment.status !== 'paid',
    );
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
                // Keys aren't always uuids — a `walkin:…` payer key carries
                // spaces, so it has to be encoded into the path.
                onPress={() =>
                  router.push(`/member-account/${businessId}/${encodeURIComponent(g.key)}` as Href)
                }
                hitSlop={6}
              >
                <Text variant="caption" tone="accent" weight="semibold">
                  📋 Details
                </Text>
              </Pressable>
              {unpaidActive.length > 0 ? (
                <Pressable
                  onPress={() => busyGroupPay !== g.key && markAllPaid(g.key, unpaidActive)}
                  hitSlop={6}
                  disabled={busyGroupPay === g.key}
                >
                  <Text
                    variant="caption"
                    tone={busyGroupPay === g.key ? 'muted' : 'success'}
                    weight="semibold"
                  >
                    ✓ Mark all paid
                  </Text>
                </Pressable>
              ) : null}
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
            {items.map((it) => renderLeaf(it))}
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

          {/* Who pays — any Localo account (searched by name), or a name with
              no account at all. Their children hang under this one account. */}
          <Text variant="caption" tone="muted" style={styles.hintTop}>
            Whose account is this on?
          </Text>
          {payer ? (
            <Card style={[styles.selected, { borderColor: colors.brand }]}>
              <View style={styles.selectedRow}>
                <Avatar name={payer.name} size={36} />
                <View style={styles.flex}>
                  <Text weight="semibold">{payer.name}</Text>
                  <Text variant="caption" tone="muted">
                    {payer.hasAccount
                      ? `Has a One Place account${payer.phone ? ` · ${payer.phone}` : ''} — the plan shows in their Subscriptions.`
                      : 'No One Place account — tracked and billed here by name only.'}
                  </Text>
                </View>
                <Text tone="brand" weight="semibold" onPress={() => pickPayer(null)}>
                  Change
                </Text>
              </View>
            </Card>
          ) : (
            <>
              {knownPayers.length > 0 ? (
                <View style={styles.chips}>
                  {knownPayers.map((c) => (
                    <Tag key={c.key} label={c.name} onPress={() => pickPayer(c)} />
                  ))}
                </View>
              ) : null}
              <Input
                placeholder="Search everyone by name, or type a new one"
                value={payerTerm}
                onChangeText={searchPayer}
              />
              {searchingPayer ? (
                <Text variant="caption" tone="muted" style={styles.hintTop}>
                  Searching…
                </Text>
              ) : null}
              {payerResults.length > 0 ? (
                <Card style={styles.results}>
                  {payerResults.map((u, i) => (
                    <Pressable
                      key={u.id}
                      onPress={() =>
                        pickPayer({ key: u.id, name: u.name, hasAccount: true, phone: u.phone })
                      }
                      style={[
                        styles.resultRow,
                        i < payerResults.length - 1 && {
                          borderBottomColor: colors.border,
                          borderBottomWidth: StyleSheet.hairlineWidth,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Enrol under ${u.name}`}
                    >
                      <Avatar name={u.name} size={32} />
                      <View style={styles.flex}>
                        <Text weight="medium">{u.name}</Text>
                        <Text variant="caption" tone="muted">
                          {u.phone ?? 'One Place account'}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </Card>
              ) : null}
              {payerTerm.trim().length >= 2 ? (
                <Button
                  title={`＋ Add “${payerTerm.trim()}” without an account`}
                  variant="secondary"
                  onPress={() =>
                    pickPayer({
                      key: walkInKey(payerTerm),
                      name: payerTerm.trim(),
                      hasAccount: false,
                    })
                  }
                  style={styles.walkIn}
                />
              ) : (
                <Text variant="caption" tone="muted" style={styles.hintTop}>
                  Type at least 2 letters to find an account — or add someone who isn’t on One Place yet.
                </Text>
              )}
            </>
          )}

          {/* Who actually attends — a child, or the account holder themselves. */}
          <Input
            label="Who is it for?"
            placeholder="e.g. their child’s name"
            value={enrolleeName}
            onChangeText={setEnrolleeName}
          />
          <Text variant="caption" tone="muted" style={styles.hintTop}>
            {payer
              ? `Leave blank if the plan is for ${payer.name} themselves.`
              : 'Leave blank if the plan is for the account holder themselves.'}
          </Text>

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

                {/* Enrolments are UNPAID by default; the owner can tick the
                    first month as already collected (e.g. cash on signup). */}
                <Pressable
                  onPress={() => setReqPaid((p) => ({ ...p, [m.id]: !p[m.id] }))}
                  style={styles.paidToggle}
                  hitSlop={6}
                >
                  <Text
                    variant="caption"
                    weight="semibold"
                    tone={reqPaid[m.id] ? 'success' : 'muted'}
                  >
                    {reqPaid[m.id] ? '☑' : '☐'} Mark first month as paid
                  </Text>
                </Pressable>

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
  paidToggle: { marginTop: spacing.sm, alignSelf: 'flex-start' },
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
  addCard: { marginBottom: spacing.md },
  selected: { marginBottom: spacing.sm, borderWidth: 1 },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  results: { marginBottom: spacing.sm, paddingVertical: 0 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  walkIn: { marginBottom: spacing.sm },
  hintTop: { marginTop: spacing.xs, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  error: { marginBottom: spacing.sm },
});
