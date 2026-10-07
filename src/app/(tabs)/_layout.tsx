/**
 * Bottom tab navigator (One Place redesign, 2026-10):
 *   Explore · Subscriptions · 🔥 Deals · Chats · Workspace.
 * Drawn by `features/navigation/BottomTabBar` — the active tab is a solid
 * brand pill; Chats carries a red badge (my unread messages) and Workspace an
 * amber one (unread messages to my businesses).
 * Deals is NOT a tab: it's the raised terracotta button in the middle, and
 * opens the full-screen deals feed (`/deals`) — the same place as "View all"
 * on Explore's deals strip.
 * Account and My Orders are tab ROUTES without a button — Account is the
 * avatar on Explore's top bar, My Orders is reached from Account; Stalls is
 * on hold (lib/onHold.ts).
 */
import { Tabs, useRouter } from 'expo-router';
import type { IconName } from '@/components/ui';
import { useColors } from '@/theme/theme';
import { fontFor } from '@/theme/fonts';
import { BottomTabBar } from '@/features/navigation/BottomTabBar';
import { useTabBadges } from '@/features/notifications/alertSides';

/** The routes that get a button, and their icons. Everything else is button-less. */
const TAB_ICONS: Record<string, IconName> = {
  index: 'explore',
  subscriptions: 'ticket',
  chats: 'chat',
  'my-business': 'grid',
};

export default function TabsLayout() {
  const colors = useColors();
  const router = useRouter();
  // Chats counts what happened to me as a CUSTOMER; Workspace counts unread
  // messages from customers of a business I answer for (features/notifications/alertSides).
  const badges = useTabBadges();

  return (
    <Tabs
      tabBar={(props) => (
        <BottomTabBar
          {...props}
          icons={TAB_ICONS}
          // After Explore and Subscriptions — the middle of five.
          action={{ after: 2, label: 'Deals', icon: 'flame', onPress: () => router.push('/deals') }}
        />
      )}
      screenOptions={{
        headerStyle: { backgroundColor: colors.headerTint },
        headerTitleStyle: { color: colors.text, ...fontFor('bold') },
        headerShadowVisible: false,
        headerTitleAlign: 'center',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Explore',
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          title: 'My Subscriptions',
          tabBarLabel: 'Subscriptions',
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarLabel: 'Chats',
          tabBarBadge: badges.chats > 0 ? badges.chats : undefined,
        }}
      />
      <Tabs.Screen
        name="my-business"
        options={{
          title: 'Workspace',
          tabBarLabel: 'Workspace',
          tabBarBadge: badges.businessChats > 0 ? badges.businessChats : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning },
        }}
      />
      {/* Account is the avatar on Explore's top bar (redesign 2026-10) — a tab
          ROUTE with no button, so the bottom bar stays visible on it. */}
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          href: null,
        }}
      />
      {/* My Orders lives under Account (redesign 2026-10) — still a tab ROUTE
          so the bottom bar stays visible on it, but with no button of its own. */}
      <Tabs.Screen
        name="orders"
        options={{
          title: 'My Orders',
          href: null,
        }}
      />
      {/* ON HOLD (redesign 2026-10): stall — the Stalls feed (lib/onHold.ts). */}
      <Tabs.Screen
        name="stalls"
        options={{
          title: 'Stalls',
          href: null,
        }}
      />
    </Tabs>
  );
}
