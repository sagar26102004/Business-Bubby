/**
 * My Business tab — every business the signed-in user owns or belongs to.
 * Tapping one opens its workspace. Users can own several; if they have none,
 * they're pointed at registration.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, useFocusEffect, useRouter } from 'expo-router';
import type { Business } from '@/domain/types';
import { getType } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { Button, Card, Icon, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { ModePills } from '@/features/shell/ModePills';
import { radius, spacing, useColors } from '@/theme/theme';

export default function MyBusinessScreen() {
  const { currentUser, isGuest } = useAuth();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [stall, setStall] = useState<Business | null>(null);

  const load = useCallback(() => {
    if (!currentUser) {
      setBusinesses([]);
      setStall(null);
      return;
    }
    Promise.all([
      repos.businesses.list(),
      repos.employees.listBusinessesForUser(currentUser.id),
      repos.businesses.getStallForOwner(currentUser.id),
    ]).then(([all, memberOf, myStall]) => {
      const mine = all.filter((b) => b.ownerId === currentUser.id);
      const byId = new Map(mine.map((b) => [b.id, b]));
      memberOf.forEach((b) => byId.set(b.id, b));
      setBusinesses(Array.from(byId.values()));
      setStall(myStall);
    });
  }, [repos, currentUser]);

  // Refresh whenever the tab regains focus (e.g. after registering one).
  useFocusEffect(useCallback(() => load(), [load]));

  // No navigator header — this is the business side's HOME, so it carries
  // the same header sheet + product pills as Explore.
  // The customer tab bar is hidden too: the business side is its own world.
  const headerAction = (
    <Tabs.Screen options={{ headerShown: false, tabBarStyle: { display: 'none' } }} />
  );

  const topBar = (
    <View
      style={[
        styles.sheet,
        {
          paddingTop: insets.top + spacing.md,
          backgroundColor: colors.headerTint,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <ModePills active="business" />

      {/* No "My Business" heading — the active pill above already says it. */}
      {!isGuest && (businesses?.length ?? 0) > 0 ? (
        <View style={styles.registerRow}>
          <Pressable onPress={() => router.push('/register')} style={styles.registerBtn}>
            <Icon name="plus" size={15} color={colors.brand} strokeWidth={2.5} />
            <Text tone="brand" weight="bold" variant="label">
              Register
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  /**
   * B2B chat — business ↔ business (dealer ↔ distributor), a separate world
   * from the customer (B2C) chats in Explore. It floats over the content at the
   * bottom-right so it stays reachable no matter how far the list is scrolled.
   */
  const b2bButton = isGuest ? null : (
    <Pressable
      onPress={() => router.push('/b2b')}
      style={[
        styles.b2bFab,
        { backgroundColor: colors.brand, bottom: insets.bottom + spacing.xl },
      ]}
    >
      <Icon name="chat" size={24} color={colors.textInverse} />
    </Pressable>
  );

  // Guest — must sign in to have businesses.
  if (isGuest) {
    return (
      <Screen scroll>
        {headerAction}
        {topBar}
        <View style={styles.guest}>
          <Text style={styles.guestEmoji}>🏢</Text>
          <Text variant="subheading" weight="semibold" style={styles.center}>
            Run a business? List it on Localo.
          </Text>
          <Text tone="muted" style={[styles.center, styles.guestSub]}>
            Sign in to register businesses, manage your team, and answer customer chats.
          </Text>
          <Button title="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={styles.cta} />
        </View>
      </Screen>
    );
  }

  if (businesses === null) return <LoadingView />;

  return (
    <View style={styles.root}>
      <Screen scroll>
      {headerAction}
      {topBar}
      {businesses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.guestEmoji}>🏢</Text>
          <Text variant="subheading" weight="semibold" style={styles.center}>
            You don’t have any businesses yet
          </Text>
          <Text tone="muted" style={[styles.center, styles.guestSub]}>
            List a service, shop, item for sale, or rental to reach customers near you.
          </Text>
          <Button title="➕ Register a business" onPress={() => router.push('/register')} style={styles.cta} />
        </View>
      ) : (
        <>
          {/* The personal stall is one per user and gets its own front door:
              view every item on it (and add more) from the stall page. */}
          {stall ? (
            <Card onPress={() => router.push(`/business/${stall.id}`)} style={styles.card}>
              <View style={styles.cardTop}>
                <Text weight="semibold" style={styles.name} numberOfLines={1}>
                  🏷️ {stall.name}
                </Text>
                <Tag
                  label={`${stall.products?.length ?? 0} item${(stall.products?.length ?? 0) === 1 ? '' : 's'}`}
                  tone="brand"
                />
              </View>
              <Text variant="caption" tone="muted">
                Everything you’re selling, in one stall.
              </Text>
              <Text variant="caption" tone="accent" style={styles.manageHint}>
                View your stall ›
              </Text>
            </Card>
          ) : null}

          {businesses
            .filter((b) => b.id !== stall?.id)
            .map((b) => {
          const type = getType(b.type);
          const isOwner = b.ownerId === currentUser?.id;
          return (
            <Card
              key={b.id}
              onPress={() => router.push(`/workspace/${b.id}`)}
              style={styles.card}
            >
              <View style={styles.cardTop}>
                <Text weight="semibold" style={styles.name} numberOfLines={1}>
                  {b.name}
                </Text>
                <Tag label={isOwner ? 'Owner' : 'Team'} tone={isOwner ? 'brand' : 'default'} />
              </View>
              <Text variant="caption" tone="muted">
                {type ? `${type.icon} ${type.singular}` : b.type}
                {typeof b.ratingAvg === 'number' ? ` · ⭐ ${b.ratingAvg.toFixed(1)}` : ''}
              </Text>
              <Text variant="caption" tone="accent" style={styles.manageHint}>
                Open workspace ›
              </Text>
            </Card>
          );
            })}
        </>
      )}
      </Screen>
      {b2bButton}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Bleed the header sheet to the screen edges (Screen adds lg padding on all
  // sides, including top — cancel it so the sheet starts at the very top).
  sheet: {
    marginTop: -spacing.lg,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    marginBottom: spacing.lg,
    borderBottomWidth: 1,
  },
  // Floats above the scrolling list — always one tap from a supplier chat.
  b2bFab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  b2bIcon: { fontSize: 24 },
  registerRow: { alignItems: 'flex-end', marginTop: spacing.md },
  registerBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  headerAction: { marginRight: spacing.lg },
  card: { marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.xs },
  name: { flex: 1 },
  manageHint: { marginTop: spacing.sm },
  guest: { alignItems: 'center', paddingTop: spacing.xxl },
  empty: { alignItems: 'center', paddingTop: spacing.xl },
  guestEmoji: { fontSize: 48, marginBottom: spacing.xl },
  center: { textAlign: 'center' },
  guestSub: { marginTop: spacing.sm },
  cta: { alignSelf: 'stretch', marginTop: spacing.xl },
});
