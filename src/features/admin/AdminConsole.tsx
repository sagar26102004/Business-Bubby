/**
 * The platform console — what a super-admin sees INSTEAD of a business list.
 *
 * A super-admin doesn't run a shop on One Place; they run One Place. So the
 * business side of the app (the "My Business" pill) shows this console for
 * them: the platform's own tools, grouped the same way a business workspace
 * groups its tools, plus the numbers worth glancing at.
 *
 * Rendered inside whatever screen mounts it (no Screen wrapper of its own), so
 * both `/admin` and the My Business tab can show exactly the same thing.
 */
import { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import type { Business } from '@/domain/types';
import { isCampaignRunning } from '@/domain/ads';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { DEV_TOOLS_ENABLED } from '@/lib/devTools';
import { Card, LoadingView, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { AdminOwnedListings } from './AdminOwnedListings';

interface Tile {
  icon: string;
  label: string;
  sub: string;
  href: Href;
  badge?: number;
}
interface TileGroup {
  title: string;
  tiles: (Tile | false)[];
}

export function AdminConsole() {
  const { currentUser } = useAuth();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();

  const { data, loading, reload } = useAsync(async () => {
    if (!currentUser) return null;
    const [listings, memberOf, campaigns, entries] = await Promise.all([
      repos.businesses.list(),
      repos.employees.listBusinessesForUser(currentUser.id),
      // Ads read through a table that may not exist yet on an un-migrated DB,
      // and the collection is optional too — neither should blank the console.
      repos.ads.listAll().catch(() => []),
      repos.catalog.listAll().catch(() => []),
    ]);
    const owned = listings.filter((b) => b.ownerId === currentUser.id);
    const byId = new Map<string, Business>(owned.map((b) => [b.id, b]));
    memberOf.forEach((b) => byId.set(b.id, b));
    return {
      listings,
      mine: Array.from(byId.values()),
      pendingAds: campaigns.filter((c) => c.status === 'pending').length,
      liveAds: campaigns.filter((c) => isCampaignRunning(c)).length,
      entries,
    };
  }, [currentUser?.id]);

  // Counts go stale the moment you approve an ad or hand a listing over, so
  // refresh on the way back — but not on the very first focus, which would
  // double-fetch what the hook has already started.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) reload();
      else focusedOnce.current = true;
    }, [reload]),
  );

  if (loading && !data) return <LoadingView />;

  const listings = data?.listings ?? [];
  const mine = data?.mine ?? [];
  const pendingAds = data?.pendingAds ?? 0;
  const liveAds = data?.liveAds ?? 0;
  const entries = data?.entries ?? [];
  const hidden = entries.filter((e) => !e.approved).length;

  const groups: TileGroup[] = [
    {
      title: 'Onboarding',
      tiles: [
        {
          icon: '🏪',
          label: 'Register a business',
          sub: 'List a shop for its owner — you pick who owns it',
          href: '/register' as Href,
        },
        {
          icon: '🔍',
          label: 'All listings',
          sub: listings.length
            ? `Browse or search all ${listings.length} · price, offers, promote`
            : 'Browse every listing, then price or promote it',
          href: '/admin/listings' as Href,
        },
      ],
    },
    {
      title: 'Revenue',
      tiles: [
        {
          icon: '📣',
          label: 'Ad requests',
          sub: pendingAds
            ? `${pendingAds} waiting for review`
            : liveAds
              ? `${liveAds} ad${liveAds === 1 ? '' : 's'} running`
              : 'Nothing waiting — approve, reject & mark paid',
          badge: pendingAds || undefined,
          href: '/ad-review' as Href,
        },
      ],
    },
    {
      title: 'The collection',
      tiles: [
        {
          icon: '🏷️',
          label: 'Tags & offerings',
          sub: entries.length
            ? `${entries.length} captured${hidden ? ` · ${hidden} hidden` : ''}`
            : 'Add tags and curate what listings contribute',
          href: '/admin/catalog' as Href,
        },
      ],
    },
    {
      title: 'Platform',
      tiles: [
        {
          icon: '🔔',
          label: 'Notification settings',
          sub: 'Mute alert families across every business',
          href: '/notification-settings' as Href,
        },
        DEV_TOOLS_ENABLED && {
          icon: '🧪',
          label: 'Dev tools',
          sub: 'Switch identity, seed data, jump links',
          href: '/dev' as Href,
        },
      ],
    },
  ];

  const visibleGroups = groups
    .map((g) => ({ ...g, tiles: g.tiles.filter(Boolean) as Tile[] }))
    .filter((g) => g.tiles.length > 0);

  return (
    <View>
      <Text variant="title" weight="bold">
        🛡️ Platform console
      </Text>
      <Text variant="caption" tone="muted" style={styles.lede}>
        Your business here is One Place itself — you list shops for their owners, keep the
        collection clean and decide which ads run.
      </Text>

      {/* At-a-glance numbers, so the console says how the platform is doing
          before you open anything. */}
      <View style={styles.stats}>
        <Stat value={listings.length} label="Listings" />
        <Stat value={pendingAds} label="Ads waiting" highlight={pendingAds > 0} />
        <Stat value={liveAds} label="Ads live" />
        <Stat value={entries.length} label="Collection" />
      </View>

      {/* An admin account that still owns shops is the thing to fix first. */}
      {mine.length ? (
        <AdminOwnedListings listings={mine} onChanged={reload} />
      ) : null}

      {visibleGroups.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text variant="caption" weight="bold" tone="muted" style={styles.groupTitle}>
            {group.title.toUpperCase()}
          </Text>
          {group.tiles.map((tile) => (
            <Card key={tile.label} onPress={() => router.push(tile.href)} style={styles.tile}>
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
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </Card>
          ))}
        </View>
      ))}
    </View>
  );
}

function Stat({
  value,
  label,
  highlight,
}: {
  value: number;
  label: string;
  highlight?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.stat,
        { backgroundColor: highlight ? colors.brandSoft : colors.surface, borderColor: colors.border },
      ]}
    >
      <Text variant="subheading" weight="bold" tone={highlight ? 'brand' : 'default'}>
        {value}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lede: { marginTop: spacing.xs, marginBottom: spacing.lg },
  stats: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  group: { marginBottom: spacing.xl },
  groupTitle: { marginBottom: spacing.sm, letterSpacing: 0.5 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
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
