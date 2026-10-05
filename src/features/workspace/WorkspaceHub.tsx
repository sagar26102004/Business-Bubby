/**
 * Business workspace — the HUB (One Place redesign, docs/redesign-one-place/
 * workspace.png). Rendered by BOTH the Workspace tab (with a business switcher
 * passed in as `header`) and the `/workspace/[businessId]` route.
 *
 * Top to bottom:
 *  - open-state banner (from opening hours — there is no "accepting orders"
 *    switch in the data, so this reports, it doesn't toggle),
 *  - the driver's live-share card and the join-request banner when relevant,
 *  - "Today's pulse": a 2×2 of numbers computed from what this screen already
 *    loads (today's billing, the live order queue, open tabs, uncollected money),
 *  - the two primary actions (new bill, scan an order ticket) + quick chips,
 *  - the business's tools grouped into clusters of cards.
 *
 * Access is unchanged from before the redesign:
 *  - Owner + managers: every tool. Managers may also set who accesses what.
 *  - Other members: the tools their grants allow (`canAccessService`); the chat
 *    tile follows chat ROUTING, not a grant.
 *  - Non-members are turned away.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import type { Bill } from '@/domain/types';
import { commerceVocab, getVehicleKind } from '@/domain/catalog';
import { enabledModules } from '@/domain/modules';
import { openState } from '@/domain/hours';
import { canAccessService, isBusinessTeamMember, isManagerOrOwner, type ServiceId } from '@/domain/access';
import { liveOffers } from '@/features/businesses/offerUtils';
import { isCampaignRunning } from '@/domain/ads';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney } from '@/lib/money';
import { startBackgroundShare, stopBackgroundShare } from '@/lib/backgroundLocation';
import {
  BackgroundLocationDisclosure,
  useBackgroundLocationDisclosure,
} from '@/features/fleet/BackgroundLocationDisclosure';
import {
  Card,
  EmptyView,
  ErrorView,
  Icon,
  IconTile,
  LoadingView,
  Screen,
  SectionHeader,
  Tag,
  Text,
  type IconName,
  type TagTone,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';
import { ON_HOLD } from '@/lib/onHold';

export interface WorkspaceHubProps {
  businessId: string;
  /** Rendered above everything — the tab's business switcher. */
  header?: ReactNode;
}

export function WorkspaceHub({ businessId, header }: WorkspaceHubProps) {
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();
  const colors = useColors();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, bookings, orders, bills, vehicles, members, memberRequests, customers, sharing, campaigns] =
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
        repos.ads.listForBusiness(business.id),
      ]);
    return {
      business,
      employees,
      bookings,
      orders,
      bills,
      vehicles,
      members,
      memberRequests,
      customers,
      sharing,
      campaigns,
    };
  }, [businessId, currentUser?.id]);

  // Local mirror of the driver's live-share toggle so it flips instantly.
  const [sharingOn, setSharingOn] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  useEffect(() => {
    if (data) setSharingOn(data.sharing);
  }, [data]);

  // Above the early returns — hooks cannot run conditionally.
  const { confirm, disclosureProps } = useBackgroundLocationDisclosure();

  const wrap = (children: ReactNode) => (
    <Screen scroll>
      {header}
      {children}
    </Screen>
  );

  if (loading && !data) return wrap(<LoadingView />);
  if (error) return wrap(<ErrorView message={error.message} onRetry={reload} />);
  if (!data) return wrap(<EmptyView title="Not found" />);

  const { business, employees, bookings, orders, bills, vehicles, members, memberRequests, customers } = data;
  const mods = new Set(enabledModules(business));
  const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
  const isOwner = currentUser?.id === business.ownerId;
  const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
  const canManageAll = isManagerOrOwner(business, meEmployee ?? undefined, currentUser);

  if (!isMember) {
    return wrap(
      <EmptyView
        title="Members only"
        subtitle={`You're not part of ${business.name}. Ask the owner to add you.`}
      />,
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

  // Same rule the orders desk uses: a billed, handed-over or refused order is
  // finished and stops counting here, so the badge matches the queue you land in.
  const live = orders.filter(
    (o) => !o.billId && !o.deliveredAt && o.status !== 'rejected' && o.status !== 'declined',
  );
  const pendingOrders = live.filter((o) => o.status === 'requested').length;
  const openProposals = live.filter((o) => o.status === 'proposed').length;
  const openTabs = live.filter((o) => o.status === 'accepted').length;
  const requests = bookings.filter((b) => b.status === 'requested').length;
  const vocab = commerceVocab(business);
  const isMembershipBiz = vocab.mode === 'enroll' || vocab.mode === 'subscribe';
  const requestNoun = vocab.mode === 'subscribe' ? 'subscription' : 'enrolment';

  const canUse = (id: ServiceId) =>
    canAccessService(business, meEmployee ?? undefined, currentUser, id);

  const base = `/workspace/${business.id}`;
  const liveOfferCount = liveOffers(business).length;

  const showcase = business.portfolio ?? [];
  const showcasePhotos = showcase.filter((p) => p.kind === 'photo').length;
  const showcaseVideos = showcase.length - showcasePhotos;
  const showcaseLinkCount = business.showcaseLinks?.length ?? 0;
  const showcaseSummary = showcase.length
    ? [
        showcasePhotos ? `${showcasePhotos} photo${showcasePhotos === 1 ? '' : 's'}` : '',
        showcaseVideos ? `${showcaseVideos} video${showcaseVideos === 1 ? '' : 's'}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : showcaseLinkCount
      ? `${showcaseLinkCount} link${showcaseLinkCount === 1 ? '' : 's'} to your work`
      : 'Show customers your past work';

  const runningAds = data.campaigns.filter((c) => isCampaignRunning(c));
  const waitingAds = data.campaigns.filter((c) => c.status === 'pending');
  const adSummary = runningAds.length
    ? `${runningAds.length} ad${runningAds.length === 1 ? '' : 's'} live · ${runningAds.reduce(
        (sum, c) => sum + c.impressions,
        0,
      )} views`
    : waitingAds.length
      ? `${waitingAds.length} waiting for review`
      : 'Put an offer on the Home screen';

  const myVehicles = meEmployee
    ? vehicles.filter((v) => v.driverEmployeeId === meEmployee.id)
    : [];

  // ── Today's pulse ────────────────────────────────────────────────────────
  const pulse = todaysPulse(bills);
  const unpaidMembers = members.filter(
    (m) => m.status === 'active' && !m.standalone && !!m.payment && m.payment.status !== 'paid',
  ).length;
  const seesMoney = mods.has('billing') && canUse('billing');
  const seesOrders = mods.has('orders') && canUse('orders');
  const seesMembers = mods.has('memberships') && canUse('members');

  const stats: Stat[] = [
    seesMoney && {
      label: "Today's revenue",
      icon: 'rupee' as IconName,
      value: formatMoney(pulse.today),
      note:
        pulse.yesterday > 0
          ? `${pulse.today >= pulse.yesterday ? '▲' : '▼'} ${Math.abs(
              Math.round(((pulse.today - pulse.yesterday) / pulse.yesterday) * 100),
            )}% vs yesterday`
          : `${pulse.todayCount} bill${pulse.todayCount === 1 ? '' : 's'} today`,
      noteTone: pulse.yesterday > 0 && pulse.today < pulse.yesterday ? 'danger' : 'success',
      href: `${base}/billing` as Href,
    },
    seesOrders && {
      label: 'Live queue',
      icon: 'bolt' as IconName,
      value: `${live.length} active`,
      note: pendingOrders ? `${pendingOrders} new to review` : `${vocab.requestNoun}s in flight`,
      noteTone: pendingOrders ? 'danger' : 'muted',
      href: `${base}/orders` as Href,
    },
    seesOrders && {
      label: 'Open tabs',
      icon: 'receipt' as IconName,
      value: `${openTabs} running`,
      note: openProposals ? `${openProposals} proposal${openProposals === 1 ? '' : 's'} out` : 'Billed when they leave',
      noteTone: 'muted',
      href: `${base}/orders` as Href,
    },
    (seesMoney || seesMembers) && {
      label: 'Dues / pending',
      icon: 'clock' as IconName,
      value: seesMoney ? formatMoney(pulse.unpaidTotal) : `${unpaidMembers}`,
      note: seesMoney
        ? `${pulse.unpaidCount} uncollected bill${pulse.unpaidCount === 1 ? '' : 's'}`
        : `member${unpaidMembers === 1 ? '' : 's'} yet to pay`,
      noteTone: (seesMoney ? pulse.unpaidCount : unpaidMembers) > 0 ? 'warning' : 'muted',
      href: (seesMoney ? `${base}/billing` : `${base}/dues`) as Href,
    },
  ].filter(Boolean) as Stat[];

  const toggleSharing = async (value: boolean) => {
    if (!currentUser || sharingBusy) return;
    setSharingOn(value); // optimistic
    setSharingBusy(true);
    try {
      if (value) {
        const res = await startBackgroundShare(confirm);
        if (!res.ok) {
          setSharingOn(false);
          showAlert(
            'Location permission needed',
            'Allow location access to share your live position with the owner and customers.',
          );
          return;
        }
        if (res.background === false && res.reason !== 'web' && res.reason !== 'declined') {
          showAlert(
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
      showAlert('Could not update', 'Please try again.');
    } finally {
      setSharingBusy(false);
    }
  };

  // ── Tool clusters ────────────────────────────────────────────────────────
  const groups: ToolGroup[] = [
    // ON HOLD (redesign 2026-10): stall — the "Your stall" tile group.
    ...(business.type === 'item' && !ON_HOLD.stalls
      ? [
          {
            title: 'Your stall',
            subtitle: 'Your personal selling desk',
            tools: [
              {
                icon: 'store' as IconName,
                label: 'Manage stall',
                sub: 'Offers, pins, mark sold & remove items',
                cta: 'Open stall',
                href: `/stall/${business.id}` as Href,
              },
            ],
          },
        ]
      : []),
    {
      title: 'Live operations & desk',
      subtitle: 'Front-of-house, requests & conversations',
      tools: [
        seesOrders && {
          icon: 'bag',
          label: vocab.requestsTitle,
          sub:
            openTabs > 0
              ? `${openTabs} open tab${openTabs === 1 ? '' : 's'} · ${live.length} in the queue`
              : `Every ${vocab.requestNoun} that comes in, in one queue`,
          badge: pendingOrders ? `${pendingOrders} new` : undefined,
          badgeTone: 'danger',
          cta: `Open queue (${live.length})`,
          href: `${base}/orders` as Href,
        },
        seesMoney && {
          icon: 'receipt',
          label: 'Billing',
          sub: 'Bill a walk-in or a finished order; mark bills paid',
          badge: bills.length ? `${bills.length} issued` : undefined,
          cta: 'Open billing',
          href: `${base}/billing` as Href,
        },
        mods.has('bookings') && canUse('bookings') && {
          icon: 'calendar',
          label: 'Appointments',
          sub: 'Booking requests, visits and slots',
          badge: requests ? `${requests} request${requests === 1 ? '' : 's'}` : undefined,
          badgeTone: 'warning',
          cta: 'Open diary',
          href: `${base}/bookings` as Href,
        },
        (hasChatAccess || canManageAll) && {
          icon: 'chat',
          label: 'Customer chats',
          sub: hasChatAccess ? 'Read & reply to messages' : 'You can read as a manager',
          cta: 'Open inbox',
          href: `/inbox/${business.id}` as Href,
        },
        (hasChatAccess || takesCalls || canManageAll) && {
          icon: 'phone',
          label: 'Call log',
          sub: 'Calls & missed calls · last 7 days',
          cta: 'View calls',
          href: `${base}/calls` as Href,
        },
      ],
    },
    {
      title: 'Catalog & offerings',
      subtitle: 'What you sell, and how it reaches people',
      action: canUse('offerings')
        ? { label: 'Edit catalog', href: `/manage/${business.id}` as Href }
        : undefined,
      tools: [
        canUse('offerings') && {
          icon: 'box',
          label: 'Menu, products & pricing',
          sub: 'Edit what you sell, and what it costs',
          cta: 'Edit catalog',
          href: `/manage/${business.id}` as Href,
        },
        canUse('offers') && {
          icon: 'ticket',
          label: 'Offers & deals',
          sub: 'Bundle what you sell at a deal price',
          badge: liveOfferCount ? `${liveOfferCount} live` : undefined,
          badgeTone: 'status',
          cta: 'Manage offers',
          href: `${base}/offers` as Href,
        },
        canUse('offers') && {
          icon: 'megaphone',
          label: 'Promote',
          sub: adSummary,
          badge: runningAds.length ? 'Live' : undefined,
          badgeTone: 'status',
          cta: 'Promote',
          href: `/promote/${business.id}` as Href,
        },
        {
          icon: 'image',
          label: 'Work showcase',
          sub: showcaseSummary,
          cta: 'Open showcase',
          href: `/showcase/${business.id}` as Href,
        },
      ],
    },
    {
      title: 'Plans & subscriptions',
      subtitle: 'Predictable, renewing neighborhood revenue',
      tools: [
        seesMembers && {
          icon: 'refresh',
          label: isMembershipBiz ? 'Active plans' : 'Members',
          sub: members.length ? `${members.length} on a plan` : 'People on a renewing plan',
          badge: memberRequests.length ? `${memberRequests.length} waiting` : undefined,
          badgeTone: 'warning',
          cta: 'Open members',
          href: `${base}/members` as Href,
        },
        seesMembers && {
          icon: 'clock',
          label: 'Dues',
          sub: 'Who hasn’t paid for this cycle yet',
          badge: unpaidMembers ? `${unpaidMembers} unpaid` : undefined,
          badgeTone: 'warning',
          cta: 'See dues',
          href: `${base}/dues` as Href,
        },
      ],
    },
    {
      title: 'Customers & records',
      subtitle: 'Everyone you deal with, and the book of it',
      tools: [
        mods.has('customers') && canUse('customers') && {
          icon: 'users',
          label: isMembershipBiz ? 'Contacts' : 'Customers',
          sub: customers.length
            ? isMembershipBiz
              ? `${customers.length} in total · members & enquiries`
              : `${customers.length} customer${customers.length === 1 ? '' : 's'}`
            : 'Everyone who dealt with you',
          cta: 'Open customers',
          href: `/customers/${business.id}` as Href,
        },
        canUse('logbook') && {
          icon: 'edit',
          label: 'Logbook',
          sub: 'Record book of orders & manual entries',
          cta: 'Open logbook',
          href: `${base}/logbook` as Href,
        },
      ],
    },
    {
      title: 'Team, fleet & controls',
      subtitle: 'People, permissions and alerts',
      tools: [
        {
          icon: 'users',
          label: 'Team',
          sub: `${employees.length + 1} ${employees.length + 1 === 1 ? 'person' : 'people'}${isOwner ? ' · manage' : ''}`,
          cta: isOwner ? 'Manage team' : 'View team',
          href: `${base}/team` as Href,
        },
        canManageAll && {
          icon: 'shield',
          label: 'Access & permissions',
          sub: employees.length
            ? 'Grant each member the tools they need'
            : 'Add team members to grant access',
          cta: 'Set access',
          href: `${base}/access` as Href,
        },
        mods.has('tracking') && canUse('fleet') && {
          icon: 'truck',
          label: 'Fleet & live location',
          sub: vehicles.length ? `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}` : 'Live tracking',
          cta: 'Open fleet',
          href: `${base}/fleet` as Href,
        },
        {
          icon: 'bell',
          label: 'Notifications',
          sub: 'Mute orders, chats, calls & more for this business',
          cta: 'Manage alerts',
          href: `${base}/notifications` as Href,
        },
      ],
    },
  ];

  const visibleGroups = groups
    .map((g) => ({ ...g, tools: g.tools.filter(Boolean) as Tool[] }))
    .filter((g) => g.tools.length > 0);

  const hasToolTiles = visibleGroups.some((g) => !g.title.startsWith('Team'));
  const showAccessHint =
    !canManageAll && !!meEmployee && !hasToolTiles && !hasChatAccess && myVehicles.length === 0;

  const { open, todayLabel } = openState(business);

  // Quick entries — shortcuts to the commonest "do it now" jobs this member can do.
  const quick = [
    canUse('offers') && { icon: 'plus' as IconName, label: 'New offer', href: `${base}/offers` as Href },
    canUse('offerings') && { icon: 'edit' as IconName, label: 'Edit catalog', href: `/manage/${business.id}` as Href },
    canUse('logbook') && { icon: 'receipt' as IconName, label: 'Record an entry', href: `${base}/logbook` as Href },
    isOwner && { icon: 'users' as IconName, label: 'Add team member', href: `${base}/team` as Href },
  ].filter(Boolean) as { icon: IconName; label: string; href: Href }[];

  return wrap(
    <>
      <BackgroundLocationDisclosure {...disclosureProps} />

      {/* Open-state banner */}
      <View
        style={[
          styles.statusBar,
          {
            backgroundColor: open ? colors.successSoft : colors.surfaceAlt,
            borderColor: open ? colors.successSoft : colors.border,
          },
        ]}
      >
        <View style={[styles.statusDot, { backgroundColor: open ? colors.success : colors.textMuted }]} />
        <View style={styles.flex}>
          <Text variant="label" weight="bold" style={{ color: open ? colors.successText : colors.text }}>
            {open === undefined ? 'No opening hours set' : open ? 'Open now' : 'Closed right now'}
          </Text>
          <Text variant="caption" tone="muted">
            {todayLabel ? `Today: ${todayLabel}` : 'Add hours so customers know when to come'}
          </Text>
        </View>
        <Tag label={`You: ${role}`} tone="soft" size="sm" />
      </View>
      <View style={styles.roleRow}>
        {hasChatAccess ? <Tag label="Chat access" lineIcon="chat" size="sm" /> : null}
        {takesCalls ? <Tag label="Takes calls" lineIcon="phone" size="sm" /> : null}
      </View>

      {/* A driver's headline control: share live location for the shift. */}
      {myVehicles.length > 0 ? (
        <Card
          style={StyleSheet.flatten([
            styles.block,
            {
              backgroundColor: sharingOn ? colors.brandSoft : colors.surface,
              borderColor: sharingOn ? colors.brand : colors.border,
              borderWidth: 1.5,
            },
          ])}
        >
          <View style={styles.shareHead}>
            <IconTile icon="truck" solid={sharingOn} />
            <View style={styles.flex}>
              <Text weight="bold">Share my live location</Text>
              <Text variant="caption" tone="muted">
                You drive {myVehicles.map((v) => `${getVehicleKind(v.kind).icon} ${v.name}`).join(', ')}.
                {sharingOn
                  ? ' Live — owner & tracking customers can see you move, even if you close the app.'
                  : ' Turn on at the start of your shift; off when you’re done.'}
              </Text>
            </View>
            <Switch
              value={sharingOn}
              onValueChange={toggleSharing}
              disabled={sharingBusy}
              trackColor={{ true: colors.brand, false: colors.border }}
              thumbColor={colors.surface}
            />
          </View>
          {sharingOn ? <Tag label="LIVE" tone="status" dot size="sm" style={styles.liveTag} /> : null}
        </Card>
      ) : null}

      {/* People waiting to be let in — the most time-sensitive thing here. */}
      {seesMembers && memberRequests.length > 0 ? (
        <Card
          onPress={() => router.push(`${base}/members` as Href)}
          style={StyleSheet.flatten([
            styles.block,
            styles.bannerRow,
            { backgroundColor: colors.brandSoft, borderColor: colors.brand, borderWidth: 1.5 },
          ])}
        >
          <IconTile icon="bell" solid />
          <View style={styles.flex}>
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
          <Icon name="chevronRight" size={20} color={colors.brand} />
        </Card>
      ) : null}

      {showAccessHint ? (
        <Card style={styles.block}>
          <Text weight="semibold">No tools granted yet</Text>
          <Text variant="caption" tone="muted">
            Your owner or a manager decides which tools you can open. Ask them to grant you access in
            Access &amp; permissions.
          </Text>
        </Card>
      ) : null}

      {/* Today's pulse */}
      {stats.length > 0 ? (
        <>
          <SectionHeader
            title="Today’s pulse"
            icon="trending"
            style={styles.firstSection}
            right={
              <Text variant="caption" tone="muted">
                Updated just now
              </Text>
            }
          />
          <View style={styles.statGrid}>
            {stats.map((s) => (
              <Card key={s.label} onPress={() => router.push(s.href)} style={styles.statCard}>
                <View style={styles.statTop}>
                  <Text variant="caption" tone="muted" weight="medium" style={styles.flex} numberOfLines={1}>
                    {s.label}
                  </Text>
                  <Icon name={s.icon} size={16} color={colors.textMuted} />
                </View>
                <Text variant="heading" weight="bold" numberOfLines={1}>
                  {s.value}
                </Text>
                <Text
                  variant="caption"
                  weight="bold"
                  numberOfLines={1}
                  style={{ color: noteColor(s.noteTone, colors) }}
                >
                  {s.note}
                </Text>
              </Card>
            ))}
          </View>
        </>
      ) : null}

      {/* Primary actions */}
      {seesMoney || seesOrders ? (
        <View style={styles.actions}>
          {seesMoney ? (
            <BigAction
              icon="receipt"
              title="New bill"
              sub="Walk-in, custom rate, takeaway or dine-in"
              color={colors.brand}
              onPress={() => router.push(`/bill/new/${business.id}`)}
            />
          ) : null}
          <BigAction
            icon="scan"
            title="Scan order QR"
            sub="Take payment or hand over a customer’s order"
            color={colors.cta}
            onPress={() => router.push('/scan')}
          />
        </View>
      ) : null}

      {quick.length > 0 ? (
        <View style={styles.quickRow}>
          <Text variant="caption" weight="bold" tone="muted">
            Quick entries:
          </Text>
          {quick.map((q) => (
            <Tag key={q.label} label={q.label} lineIcon={q.icon} onPress={() => router.push(q.href)} />
          ))}
        </View>
      ) : null}

      {/* Tool clusters */}
      {visibleGroups.map((group) => (
        <View key={group.title}>
          <SectionHeader
            title={group.title}
            subtitle={group.subtitle}
            actionLabel={group.action?.label}
            onAction={group.action ? () => router.push(group.action!.href) : undefined}
          />
          <View style={styles.toolList}>
            {group.tools.map((tool) => (
              <ToolCard key={tool.label} tool={tool} onPress={() => router.push(tool.href)} />
            ))}
          </View>
        </View>
      ))}
    </>,
  );
}

/** One tool in a cluster: icon tile, title, status badge, description, footer link. */
function ToolCard({ tool, onPress }: { tool: Tool; onPress: () => void }) {
  const colors = useColors();
  return (
    <Card onPress={onPress} padded={false} accessibilityLabel={tool.label}>
      <View style={styles.toolTop}>
        <IconTile icon={tool.icon} size={40} />
        <View style={styles.flex}>
          <View style={styles.toolTitleRow}>
            <Text variant="body" weight="bold" style={styles.flex} numberOfLines={1}>
              {tool.label}
            </Text>
            {tool.badge ? <Tag label={tool.badge} tone={tool.badgeTone ?? 'soft'} size="sm" /> : null}
          </View>
          <Text variant="caption" tone="muted">
            {tool.sub}
          </Text>
        </View>
      </View>
      <View style={[styles.toolFoot, { borderTopColor: colors.border }]}>
        <Text variant="label" weight="bold" tone="brand">
          {tool.cta}
        </Text>
        <Icon name="chevronRight" size={16} color={colors.brandText} />
      </View>
    </Card>
  );
}

function BigAction({
  icon,
  title,
  sub,
  color,
  onPress,
}: {
  icon: IconName;
  title: string;
  sub: string;
  color: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.bigAction, { backgroundColor: color }, pressed && styles.pressed]}
    >
      <View style={styles.bigIcon}>
        <Icon name={icon} size={22} color={colors.textInverse} />
      </View>
      <View style={styles.flex}>
        <Text variant="body" weight="bold" tone="inverse">
          {title}
        </Text>
        <Text variant="caption" style={styles.bigSub}>
          {sub}
        </Text>
      </View>
      <Icon name="arrowRight" size={20} color={colors.textInverse} />
    </Pressable>
  );
}

interface Tool {
  icon: IconName;
  label: string;
  sub: string;
  cta: string;
  href: Href;
  badge?: string;
  badgeTone?: TagTone;
}
interface ToolGroup {
  title: string;
  subtitle?: string;
  action?: { label: string; href: Href };
  tools: (Tool | false)[];
}
interface Stat {
  label: string;
  icon: IconName;
  value: string;
  note: string;
  noteTone: 'success' | 'danger' | 'warning' | 'muted';
  href: Href;
}

const noteColor = (tone: Stat['noteTone'], c: ReturnType<typeof useColors>) =>
  tone === 'success' ? c.successText : tone === 'danger' ? c.danger : tone === 'warning' ? c.warning : c.textMuted;

/** Billing totals for today vs yesterday, plus what's still uncollected. */
function todaysPulse(bills: Bill[], now: Date = new Date()) {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  let today = 0;
  let todayCount = 0;
  let yesterday = 0;
  let unpaidTotal = 0;
  let unpaidCount = 0;
  for (const b of bills) {
    const t = new Date(b.createdAt).getTime();
    if (t >= startToday) {
      today += b.total;
      todayCount += 1;
    } else if (t >= startYesterday) {
      yesterday += b.total;
    }
    if (b.paymentStatus !== 'paid') {
      unpaidTotal += b.total;
      unpaidCount += 1;
    }
  }
  return { today, todayCount, yesterday, unpaidTotal, unpaidCount };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  block: { marginTop: spacing.lg },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shareHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  liveTag: { marginTop: spacing.sm },
  firstSection: { marginTop: spacing.xl },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCard: { flexGrow: 1, flexBasis: '45%', gap: 4, padding: spacing.md },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actions: { gap: spacing.md, marginTop: spacing.xl },
  bigAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  bigIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigSub: { color: 'rgba(255,255,255,0.85)' },
  pressed: { opacity: 0.8 },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  toolList: { gap: spacing.md },
  toolTop: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.md },
  toolTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 2 },
  toolFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
