/**
 * Bottom tab navigator: Home, Subs (memberships), Orders, Chat, Account.
 * Stalls and My Business are tab ROUTES (the Explore ⇄ Stalls ⇄ My Business
 * top switcher navigates to them) but have no bottom-bar button (href: null).
 */
import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { ColorValue, Text } from 'react-native';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useColors } from '@/theme/theme';

/** Emoji tab icon — swap for a proper icon set later without touching screens. */
function TabIcon({ emoji, color }: { emoji: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{emoji}</Text>;
}

/** Polls the unread notification count for the current viewer (mock backend). */
function useUnreadCount(): number {
  const repos = useRepositories();
  const { currentUser } = useAuth();
  const recipientId = currentUser?.id ?? 'guest';
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () =>
      repos.notifications.unreadCount(recipientId).then((n) => active && setCount(n));
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
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        headerTitleAlign: 'center',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabIcon emoji="🏠" color={color} />,
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
          tabBarIcon: ({ color }) => <TabIcon emoji="🎫" color={color} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'My Orders',
          tabBarLabel: 'Orders',
          tabBarIcon: ({ color }) => <TabIcon emoji="🛒" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chat',
          tabBarLabel: 'Chat',
          tabBarIcon: ({ color }) => <TabIcon emoji="💬" color={color} />,
          tabBarBadge: unread > 0 ? unread : undefined,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <TabIcon emoji="👤" color={color} />,
        }}
      />
    </Tabs>
  );
}
