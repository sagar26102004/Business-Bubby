/**
 * Manage — the HUB for everything about a listing.
 *
 * This used to be ONE screen holding every field: the name, the photo, the
 * tags, the whole menu, the team's call routing and the module switches, in a
 * single scroll with a single Save at the bottom. Nobody could find anything
 * in it. It is now a dashboard of tiles, exactly like the workspace: one tile
 * per job, each opening a screen that does that job and nothing else
 * (`app/manage/[businessId]/*`, all sharing `ManageGate`).
 *
 * Every tile says what's inside it — "12 dishes", "Mon–Sat 9:00–19:00", "No
 * tables" — so the hub answers most questions without being opened.
 *
 * TWO audiences: the owner sees every tile, while a team member granted the
 * "Menu & pricing" service (domain/access.ts) sees the CATALOG tiles only —
 * enough to edit and reprice what's sold, and nothing that would let them
 * rewrite the listing, the team or the modules.
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { canAccessService } from '@/domain/access';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { offersDineIn } from '@/domain/catalog';
import { AVAILABLE_MODULES, enabledModules } from '@/domain/modules';
import { isFoodShop } from '@/domain/tags';
import { summarizeHours } from '@/domain/hours';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { manageKey } from '@/features/businesses/ManageGate';
import { SuperAdminBanner } from '@/features/businesses/SuperAdminBanner';
import { DeleteListing } from '@/features/businesses/DeleteListing';
import { Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

interface Tile {
  icon: string;
  label: string;
  /** What's inside — a count of the real data beats a static hint. */
  sub: string;
  href: Href;
}
interface TileGroup {
  title: string;
  tiles: (Tile | false)[];
}

/** "12 dishes" / "Nothing added yet" — the line under a catalog tile. */
const count = (n: number, one: string, many: string) =>
  n === 0 ? 'Nothing added yet' : `${n} ${n === 1 ? one : many}`;

export default function ManageScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(
    async () => {
      const business = await repos.businesses.getById(businessId);
      if (!business) return null;
      const employees = await repos.employees.listByBusiness(business.id);
      return { business, employees };
    },
    [businessId],
    { key: manageKey(businessId) },
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees } = data;
  const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
  const isOwner = !!currentUser && currentUser.id === business.ownerId;
  const canEditOfferings = canAccessService(business, meEmployee, currentUser, 'offerings');

  if (!isOwner && !canEditOfferings) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Manage' }} />
        <EmptyView
          title="No access"
          subtitle="Only the owner, or a team member granted “Menu & pricing”, can edit this."
        />
      </Screen>
    );
  }

  const isStall = business.type === 'item';
  const isRental = business.type === 'rental';
  // Cafes/restaurants/bakeries build a MENU, not a product list.
  const isFood = isFoodShop(business.tags ?? []);
  const dineIn = offersDineIn(business);
  const base = `/manage/${business.id}`;

  const products = business.products ?? [];
  const rentals = business.rentals ?? [];
  const enabled = enabledModules(business).length;
  const ringing =
    (business.ownerHandlesCalls !== false ? 1 : 0) + (business.callHandlerIds ?? []).length;

  const groups: TileGroup[] = [
    {
      title: 'Your page',
      tiles: [
        isOwner && {
          icon: '📝',
          label: isStall ? 'Stall name' : 'Name & details',
          sub: isStall ? business.name : business.tagline || business.name,
          href: `${base}/details` as Href,
        },
        isOwner &&
          !isStall && {
            icon: '🏷️',
            label: 'Tags',
            sub: (business.tags ?? []).length
              ? (business.tags ?? []).slice(0, 3).join(' · ') +
                ((business.tags ?? []).length > 3 ? ` +${(business.tags ?? []).length - 3}` : '')
              : 'Add tags so customers find you',
            href: `${base}/tags` as Href,
          },
        isOwner &&
          !isStall && {
            icon: '🕒',
            label: 'Opening hours',
            sub: summarizeHours(business.openingHours) ?? 'Not set',
            href: `${base}/hours` as Href,
          },
        isOwner &&
          isRental && {
            icon: business.rentalStatus === 'rented' ? '🔴' : '🟢',
            label: 'Availability',
            sub: business.rentalStatus === 'rented' ? 'Rented out' : 'Available now',
            href: `${base}/availability` as Href,
          },
      ],
    },
    {
      title: isStall ? 'What you’re selling' : 'What you provide',
      tiles: [
        isFood && {
          icon: '🍽️',
          label: 'Menu',
          sub: count((business.menu ?? []).length, 'dish', 'dishes'),
          href: `${base}/menu` as Href,
        },
        // A cafe that also sells packaged goods (beans, mugs) still lists them
        // as products — but a pure restaurant shouldn't be nagged for a second
        // catalog it doesn't have, so this only shows when it already has one.
        (!isFood || products.length > 0) && {
          icon: '📦',
          label: isStall ? 'Items for sale' : 'Products for sale',
          sub: count(products.length, isStall ? 'item' : 'product', isStall ? 'items' : 'products'),
          href: `${base}/products` as Href,
        },
        !isStall && {
          icon: '🛠️',
          label: 'Services offered',
          sub: count((business.services ?? []).length, 'service', 'services'),
          href: `${base}/services` as Href,
        },
        // A rental listing always; anyone else only once they rent something.
        (isRental || rentals.length > 0) && {
          icon: '🔑',
          label: 'For rent',
          sub: count(rentals.length, 'thing', 'things'),
          href: `${base}/rentals` as Href,
        },
        dineIn &&
          isOwner && {
            icon: '🪑',
            label: 'Tables',
            sub: business.tableCount ? `${business.tableCount} tables` : 'No tables',
            href: `${base}/tables` as Href,
          },
        dineIn && {
          icon: '🎉',
          label: 'Party packages',
          sub: count((business.partyPackages ?? []).length, 'package', 'packages'),
          href: `${base}/parties` as Href,
        },
      ],
    },
    {
      title: 'Setup',
      tiles: [
        isOwner && {
          icon: '📞',
          label: 'Calls & chat',
          sub: `${ringing} ${ringing === 1 ? 'person rings' : 'people ring'} · ${employees.length} in the team`,
          href: `${base}/calls` as Href,
        },
        isOwner &&
          !isStall && {
            icon: '🧰',
            label: 'Workspace tools',
            sub: `${enabled} of ${AVAILABLE_MODULES.length} on`,
            href: `${base}/tools` as Href,
          },
      ],
    },
  ];

  const visibleGroups = groups
    .map((g) => ({ ...g, tiles: g.tiles.filter(Boolean) as Tile[] }))
    .filter((g) => g.tiles.length > 0);

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Manage' }} />

      {!isOwner && isSuperAdminUser(currentUser) ? (
        <SuperAdminBanner businessName={business.name} what="menu & prices" />
      ) : null}

      {/* No title block: the header already says "Manage", and each group is
          labelled — a name and a blurb on top only pushed the tiles down. */}
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
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {tile.sub}
                </Text>
              </View>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </Card>
          ))}
        </View>
      ))}

      {/*
        The only way an owner can close a listing. It has to live somewhere they
        can find, and Manage is where everything else about the listing already
        is — but it sits behind its own disclosure and a typed confirmation,
        because it is the one control here that can't be undone.

        Owner-only: a member with "Menu & pricing" edits what's sold, and
        deleting the business is not that. The repository and RLS refuse them
        anyway; hiding it means they never get as far as a refusal.
      */}
      {isOwner ? (
        <DeleteListing
          business={business}
          // Back to the list of what they still have — `router.back()` would
          // return to the page of a business that no longer exists.
          onDeleted={() => router.replace('/my-business')}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: spacing.xl },
  groupTitle: { marginBottom: spacing.sm, letterSpacing: 0.5 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 22 },
  tileText: { flex: 1 },
  chevron: { fontSize: 24, fontWeight: '600', marginLeft: spacing.xs },
});
