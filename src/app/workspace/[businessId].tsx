/**
 * Business workspace — the HUB. Instead of one long scroll with every tool
 * expanded, this is a tidy dashboard: the business's enabled tools grouped
 * into a few clickable tiles (Sales, Customers, Operations, Team). Each tile
 * opens its own dedicated screen scoped to this business.
 *
 * Access still depends on the viewer's place in the hierarchy:
 *  - Owner: everything.
 *  - Employee WITH chat access: the inbox + whatever their modules allow.
 *  - Employee WITHOUT chat access: the chats tile is disabled.
 *  - Non-members are turned away.
 */
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { commerceVocab, getVehicleKind } from '@/domain/catalog';
import { enabledModules } from '@/domain/modules';
import { canAccessService, isManagerOrOwner, type ServiceId } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { startBackgroundShare, stopBackgroundShare } from '@/lib/backgroundLocation';
import {
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function WorkspaceScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();
  const colors = useColors();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, bookings, orders, bills, vehicles, members, memberRequests, customers, sharing] =
      await Promise.all([
        repos.employees.listByBusiness(business.id),
        repos.bookings.listForBusiness(business.id),
        repos.orders.listForBusiness(business.id),
        repos.bills.listForBusiness(business.id),
        repos.tracking.listVehicles(business.id),
        repos.memberships.listForBusiness(business.id),
        repos.memberships.listRequests(business.id),
        repos.customers.listForBusiness(business.id),
        currentUser
          ? repos.tracking.isSharing(business.id, currentUser.id)
          : Promise.resolve(false),
      ]);
    return { business, employees, bookings, orders, bills, vehicles, members, memberRequests, customers, sharing };
  }, [businessId, currentUser?.id]);

  // Local mirror of the driver's live-share toggle so it flips instantly.
  const [sharingOn, setSharingOn] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  useEffect(() => {
    if (data) setSharingOn(data.sharing);
  }, [data]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees, bookings, orders, bills, vehicles, members, memberRequests, customers } = data;
  const mods = new Set(enabledModules(business));
  const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
  const isOwner = currentUser?.id === business.ownerId;
  const isMember = isOwner || !!meEmployee;
  // Owner + managers see every tool; managers may also set who accesses what.
  const canManageAll = isManagerOrOwner(business, meEmployee ?? undefined, currentUser?.id);

  // Not a member → no access.
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Workspace' }} />
        <EmptyView
          title="Members only"
          subtitle={`You're not part of ${business.name}. Ask the owner to add you.`}
        />
      </Screen>
    );
  }

  const chatAccessIds = new Set(business.chatRecipientIds ?? []);
  const hasChatAccess = isOwner || (meEmployee ? chatAccessIds.has(meEmployee.id) : false);
  const callHandlerIdSet = new Set(business.callHandlerIds ?? []);
  const takesCalls = isOwner
    ? business.ownerHandlesCalls !== false
    : meEmployee
      ? callHandlerIdSet.has(meEmployee.id)
      : false;
  const role = isOwner ? 'Owner' : meEmployee ? cap(meEmployee.level ?? 'staff') : 'Visitor';

  const pendingOrders = orders.filter((o) => o.status === 'requested').length;
  const openProposals = orders.filter((o) => o.status === 'proposed').length;
  const openTabs = orders.filter((o) => o.status === 'accepted' && !o.billId).length;
  const requests = bookings.filter((b) => b.status === 'requested').length;
  // A gym "enrolls", a school-bus service takes "subscriptions" — same order
  // desk, different words (derived from tags).
  const vocab = commerceVocab(business);
  const isMembershipBiz = vocab.mode === 'enroll' || vocab.mode === 'subscribe';
  const requestNoun = vocab.mode === 'subscribe' ? 'subscription' : 'enrolment';

  // Per-employee service access: the owner grants each tool on the Access
  // screen. Owner has everything; a member with no explicit grants keeps all.
  const canUse = (id: ServiceId) =>
    canAccessService(business, meEmployee ?? undefined, currentUser?.id, id);

  const base = `/workspace/${business.id}`;

  // Vehicles this member drives — for a driver the live-share toggle is the one
  // control they open the workspace for, so it's pulled up top as its own card
  // (independent of the Fleet tool's access grant).
  const myVehicles = meEmployee
    ? vehicles.filter((v) => v.driverEmployeeId === meEmployee.id)
    : [];

  const toggleSharing = async (value: boolean) => {
    if (!currentUser || sharingBusy) return;
    setSharingOn(value); // optimistic
    setSharingBusy(true);
    try {
      if (value) {
        const res = await startBackgroundShare();
        if (!res.ok) {
          setSharingOn(false);
          Alert.alert(
            'Location permission needed',
            'Allow location access to share your live position with the owner and customers.',
          );
          return;
        }
        if (res.background === false && res.reason !== 'web') {
          Alert.alert(
            'Sharing while the app is open',
            'For your vehicle to keep moving on the map when the app is closed, set location access to "Allow all the time" in Settings.',
          );
        }
      } else {
        await stopBackgroundShare();
      }
      await repos.tracking.setSharing(business.id, currentUser.id, value);
    } catch {
      setSharingOn(!value);
      Alert.alert('Could not update', 'Please try again.');
    } finally {
      setSharingBusy(false);
    }
  };

  // Each group is a heading + the tiles the business actually runs. A tile is
  // hidden unless its module is enabled (chats & team are universal).
  const groups: TileGroup[] = [
    // A personal stall's admin console — its own selling desk, above the
    // generic order/billing tiles.
    ...(business.type === 'item'
      ? [
          {
            title: 'Your stall',
            tiles: [
              {
                icon: '🏷️',
                label: 'Manage stall',
                sub: 'Offers, pins, mark sold & remove items',
                href: `/stall/${business.id}` as Href,
              },
            ],
          } as TileGroup,
        ]
      : []),
    {
      title: 'Sales & orders',
      tiles: [
        mods.has('orders') && canUse('orders') && {
          icon: vocab.mode === 'rent' ? '🔑' : vocab.mode === 'order' ? '🛒' : '🎫',
          label: vocab.requestsTitle,
          sub:
            pendingOrders > 0
              ? `${pendingOrders} new to review`
              : openTabs > 0
                ? `${openTabs} open tab${openTabs === 1 ? '' : 's'}`
                : openProposals > 0
                  ? `${openProposals} proposal${openProposals === 1 ? '' : 's'} out`
                  : `No ${vocab.requestNoun}s waiting`,
          badge: pendingOrders || undefined,
          href: `${base}/orders` as Href,
        },
        mods.has('billing') && canUse('billing') && {
          icon: '🧾',
          label: 'Billing',
          sub: bills.length ? `${bills.length} bill${bills.length === 1 ? '' : 's'} issued` : 'Bill a customer',
          href: `${base}/billing` as Href,
        },
        mods.has('bookings') && canUse('bookings') && {
          icon: '📅',
          label: 'Appointments',
          sub: requests > 0 ? `${requests} request${requests === 1 ? '' : 's'}` : 'Bookings & requests',
          badge: requests || undefined,
          href: `${base}/bookings` as Href,
        },
        // The logbook — the record book of every order (auto) plus manual
        // records. Universal, gated only by per-employee access.
        canUse('logbook') && {
          icon: '📒',
          label: 'Logbook',
          sub: 'Record book of orders & manual entries',
          href: `${base}/logbook` as Href,
        },
      ],
    },
    {
      title: 'Customers & chats',
      tiles: [
        // Chat is contact ROUTING, not a service grant: shown only to members
        // who actually answer messages (chat recipients) — plus owner/managers,
        // who always see every tool. A driver with no chat access won't see it.
        (hasChatAccess || canManageAll) && {
          icon: '💬',
          label: 'Customer chats',
          sub: hasChatAccess ? 'Read & reply to messages' : 'You can read as a manager',
          href: `/inbox/${business.id}` as Href,
        },
        // The other half of "who tried to reach us?": every voice call of the
        // last 7 days, missed ones included. Same audience as the chats tile,
        // plus the members who actually answer calls.
        (hasChatAccess || takesCalls || canManageAll) && {
          icon: '📞',
          label: 'Call log',
          sub: 'Calls & missed calls · last 7 days',
          href: `${base}/calls` as Href,
        },
        // "Customers" = everyone who ever touched the business (chats, orders,
        // calls, bills). "Members" = the subset on a paid monthly plan. For a
        // membership business the two look alike, so spell out the difference.
        mods.has('customers') && canUse('customers') && {
          icon: '👥',
          label: isMembershipBiz ? 'Contacts' : 'Customers',
          sub: customers.length
            ? isMembershipBiz
              ? `${customers.length} in total · members & enquiries`
              : `${customers.length} customer${customers.length === 1 ? '' : 's'}`
            : 'Everyone who dealt with you',
          href: `/customers/${business.id}` as Href,
        },
        mods.has('memberships') && canUse('members') && {
          icon: '🎫',
          label: isMembershipBiz ? 'Active plans' : 'Members',
          sub: members.length
            ? `${members.length} on a monthly plan`
            : 'Paid monthly plans',
          badge: memberRequests.length || undefined,
          href: `${base}/members` as Href,
        },
        // Every member's own alert switchboard — mute the families that buzz
        // too much without losing the work behind them.
        {
          icon: '🔔',
          label: 'Manage notifications',
          sub: 'Mute orders, chats, calls & more for this business',
          href: `${base}/notifications` as Href,
        },
      ],
    },
    {
      title: 'Operations',
      tiles: [
        mods.has('tracking') && canUse('fleet') && {
          icon: '🚌',
          label: 'Fleet & live location',
          sub: vehicles.length ? `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}` : 'Live tracking',
          href: `${base}/fleet` as Href,
        },
      ],
    },
    {
      title: 'Team',
      tiles: [
        {
          icon: '🧑‍🤝‍🧑',
          label: 'Team',
          sub: `${employees.length + 1} ${employees.length + 1 === 1 ? 'person' : 'people'}${isOwner ? ' · manage' : ''}`,
          href: `${base}/team` as Href,
        },
        // The owner and managers decide who can open which tool.
        canManageAll && {
          icon: '🔐',
          label: 'Access & permissions',
          sub: employees.length
            ? 'Grant each member the tools they need'
            : 'Add team members to grant access',
          href: `${base}/access` as Href,
        },
      ],
    },
  ];

  const visibleGroups = groups
    .map((g) => ({ ...g, tiles: g.tiles.filter(Boolean) as Tile[] }))
    .filter((g) => g.tiles.length > 0);

  // A staff member the owner hasn't granted anything yet: everything but the
  // Team card is hidden. Explain the blank slate instead of leaving them
  // guessing.
  const hasToolTiles = visibleGroups.some((g) => g.title !== 'Team');
  const showAccessHint =
    !canManageAll && !!meEmployee && !hasToolTiles && !hasChatAccess && myVehicles.length === 0;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Workspace' }} />

      <Text variant="title" weight="bold">
        {business.name}
      </Text>
      <View style={styles.roleRow}>
        <Tag label={`You: ${role}`} tone="brand" />
        {hasChatAccess ? <Tag label="Chat access" /> : null}
        {takesCalls ? <Tag label="📞 Takes calls" /> : null}
      </View>

      {/* A driver's headline control: share live location for the shift. Sits
          above everything — for a school-bus driver this is the whole job. */}
      {myVehicles.length > 0 ? (
        <Card
          style={StyleSheet.flatten([
            styles.shareCard,
            {
              backgroundColor: sharingOn ? colors.brandSoft : colors.surface,
              borderColor: sharingOn ? colors.brand : colors.border,
            },
          ])}
        >
          <View style={styles.shareHead}>
            <View style={styles.tileText}>
              <Text weight="bold">📡 Share my live location</Text>
              <Text variant="caption" tone="muted">
                You drive {myVehicles.map((v) => `${getVehicleKind(v.kind).icon} ${v.name}`).join(', ')}.
                {sharingOn
                  ? ' Live — owner & tracking customers can see you move, even if you close the app.'
                  : ' Turn on at the start of your shift; off when you’re done.'}
              </Text>
            </View>
            <Switch value={sharingOn} onValueChange={toggleSharing} disabled={sharingBusy} />
          </View>
          {sharingOn ? (
            <Text variant="caption" tone="brand" style={styles.liveRow}>
              ● LIVE
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* The most time-sensitive thing an owner opens the workspace for: people
          waiting to be let in. Pull it out of the Members tile into its own
          highlighted banner at the very top. */}
      {mods.has('memberships') && canUse('members') && memberRequests.length > 0 ? (
        <Card
          onPress={() => router.push(`${base}/members` as Href)}
          style={StyleSheet.flatten([
            styles.requestBanner,
            { backgroundColor: colors.brandSoft, borderColor: colors.brand },
          ])}
        >
          <View style={[styles.iconBox, { backgroundColor: colors.brand }]}>
            <Text style={styles.icon}>🔔</Text>
          </View>
          <View style={styles.tileText}>
            <Text weight="bold" tone="brand">
              {memberRequests.length} new {requestNoun} request{memberRequests.length === 1 ? '' : 's'}
            </Text>
            <Text variant="caption" tone="muted">
              {memberRequests
                .slice(0, 3)
                .map((m) => (m.enrolleeName ? `${m.customerName} (${m.enrolleeName})` : m.customerName))
                .join(', ')}
              {memberRequests.length > 3 ? ` +${memberRequests.length - 3} more` : ''} · tap to review
            </Text>
          </View>
          <Text style={[styles.chevron, { color: colors.brand }]}>›</Text>
        </Card>
      ) : null}

      {showAccessHint ? (
        <Card style={styles.hintCard}>
          <Text weight="semibold">No tools granted yet</Text>
          <Text variant="caption" tone="muted">
            Your owner or a manager decides which tools you can open. Ask them to grant you access in
            Access &amp; permissions.
          </Text>
        </Card>
      ) : null}

      {visibleGroups.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text variant="caption" weight="bold" tone="muted" style={styles.groupTitle}>
            {group.title.toUpperCase()}
          </Text>
          {group.tiles.map((tile) => (
            <Card
              key={tile.label}
              onPress={tile.disabled ? undefined : () => router.push(tile.href)}
              style={StyleSheet.flatten([styles.tile, tile.disabled && styles.tileDisabled])}
            >
              <View style={[styles.iconBox, { backgroundColor: colors.brandSoft }]}>
                <Text style={styles.icon}>{tile.icon}</Text>
              </View>
              <View style={styles.tileText}>
                <Text weight="semibold">{tile.label}</Text>
                <Text variant="caption" tone="muted">
                  {tile.sub}
                </Text>
              </View>
              {tile.badge ? (
                <View style={[styles.badge, { backgroundColor: colors.brand }]}>
                  <Text style={[styles.badgeText, { color: colors.textInverse }]}>{tile.badge}</Text>
                </View>
              ) : null}
              {!tile.disabled ? (
                <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
              ) : null}
            </Card>
          ))}
        </View>
      ))}
    </Screen>
  );
}

interface Tile {
  icon: string;
  label: string;
  sub: string;
  href: Href;
  badge?: number;
  disabled?: boolean;
}
interface TileGroup {
  title: string;
  tiles: (Tile | false)[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  roleRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl },
  shareCard: { borderWidth: 1.5, marginBottom: spacing.xl },
  shareHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  liveRow: { marginTop: spacing.sm, fontWeight: '700', letterSpacing: 0.5 },
  hintCard: { marginBottom: spacing.xl },
  requestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    marginBottom: spacing.xl,
  },
  group: { marginBottom: spacing.xl },
  groupTitle: { marginBottom: spacing.sm, letterSpacing: 0.5 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  tileDisabled: { opacity: 0.5 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 22 },
  tileText: { flex: 1 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  chevron: { fontSize: 24, fontWeight: '600', marginLeft: spacing.xs },
});
