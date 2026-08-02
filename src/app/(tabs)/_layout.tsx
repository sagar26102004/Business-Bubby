/**
 * Bottom tab navigator: Home, Subs (memberships), Orders, Chat, Account.
 * Stalls and My Business are tab ROUTES (the Explore ⇄ Stalls ⇄ My Business
 * top switcher navigates to them) but have no bottom-bar button (href: null).
 */
import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { Icon, type IconName } from '@/components/ui';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useColors } from '@/theme/theme';

/**
 * Tab icon — stroked when idle, solid when active, so the current tab reads
 * without relying on color alone.
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
  // The navigator types the tint as ColorValue; ours are always plain strings.
  return <Icon name={name} size={23} color={color as string} filled={focused} />;
}

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
  const unread = useUnreadCount();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        // No top border: the white bar already separates itself from the warm
        // paper background, and the borderless edge is what makes it feel light.
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          elevation: 0,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
        headerShadowVisible: false,
        headerTitleAlign: 'center',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="stalls"
        options={{
          title: 'Stalls',
          // Reached via the top Explore ⇄ Stalls ⇄ My Business switcher.
          href: null,
        }}
      />
      <Tabs.Screen
        name="my-business"
        options={{
          title: 'My Business',
          // Reached via the top Explore ⇄ Stalls ⇄ My Business switcher.
          href: null,
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          title: 'My Subscriptions',
          tabBarLabel: 'Subs',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="ticket" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'My Orders',
          tabBarLabel: 'Orders',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="cart" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chat',
          tabBarLabel: 'Chat',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="chat" color={color} focused={focused} />
          ),
          tabBarBadge: unread > 0 ? unread : undefined,
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
    </Tabs>
  );
}
