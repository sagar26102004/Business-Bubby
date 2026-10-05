/**
 * Bottom tab navigator (One Place redesign, 2026-10):
 *   Explore · Subscriptions · Chats · Workspace · Account.
 * My Orders is a tab ROUTE without a button (reached from Account); Stalls is
 * on hold (lib/onHold.ts).
 */
import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { radius, useColors } from '@/theme/theme';
import { fontFor } from '@/theme/fonts';

/**
 * Tab icon — stroked when idle, solid inside a tinted pill when active. The
 * pill is what gives the bar its color; without it a row of grey icons on
 * white reads as unfinished.
 */
function TabIcon({
  name,
  color,
  focused,
}: {
  name: IconName;
  color: ColorValue;
  focused: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.iconSlot, focused && { backgroundColor: colors.brand }]}>
      {/* Solid brand pill on the tinted bar — a soft tint would disappear into
          it. The navigator types the tint as ColorValue; ours are strings. */}
      <Icon
        name={name}
        size={22}
        color={focused ? colors.textInverse : (color as string)}
        filled={focused}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  iconSlot: {
    width: 56,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/** Polls the unread notification count for the signed-in viewer. */
function useUnreadCount(): number {
  const repos = useRepositories();
  const { currentUser } = useAuth();
  const recipientId = currentUser?.id ?? null;
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Guests have no notifications — don't poll (a placeholder id like 'guest'
    // is not a valid recipient and errors against a real backend).
    if (!recipientId) {
      setCount(0);
      return;
    }
    let active = true;
    const load = () =>
      repos.notifications
        .unreadCount(recipientId)
        .then((n) => active && setCount(n))
        .catch(() => active && setCount(0));
    load();
    const timer = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [repos, recipientId]);

  return count;
}

export default function TabsLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const unread = useUnreadCount();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        // No top border: the white bar already separates itself from the warm
        // paper background, and the borderless edge is what makes it feel light.
        // Same warm tone as the home header sheet, so the app is bookended by
        // color top and bottom with the content sitting quietly between them.
        // The taller bar has to make room for the safe area itself once a
        // height is set, otherwise it clips on phones with a home indicator.
        tabBarStyle: {
          backgroundColor: colors.headerTint,
          // The One Place bar: soft linen with a 1px stone hairline on top.
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          paddingTop: 8,
          paddingBottom: insets.bottom,
          height: 66 + insets.bottom,
        },
        // Always under the icon — beside it (React Navigation's wide-screen
        // default) the active pill runs into the label.
        tabBarLabelPosition: 'below-icon',
        // 10px so "Subscriptions" fits a fifth of a phone without truncating.
        tabBarLabelStyle: { fontSize: 10, marginTop: 2, ...fontFor('bold') },
        headerStyle: { backgroundColor: colors.surface },
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
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="explore" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          title: 'My Subscriptions',
          tabBarLabel: 'Subscriptions',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="ticket" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarLabel: 'Chats',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="chat" color={color} focused={focused} />
          ),
          tabBarBadge: unread > 0 ? unread : undefined,
        }}
      />
      <Tabs.Screen
        name="my-business"
        options={{
          title: 'Workspace',
          tabBarLabel: 'Workspace',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="grid" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="user" color={color} focused={focused} />
          ),
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
