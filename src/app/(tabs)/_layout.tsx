/**
 * Bottom tab navigator: Home, Subs (memberships), Orders, Chat, Account.
 * Stalls and My Business are tab ROUTES (the Explore ⇄ Stalls ⇄ My Business
 * top switcher navigates to them) but have no bottom-bar button (href: null).
 */
import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/ui';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { radius, useColors } from '@/theme/theme';

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
    <View style={[styles.iconSlot, focused && { backgroundColor: colors.brandSoft }]}>
      {/* The navigator types the tint as ColorValue; ours are plain strings. */}
      <Icon name={name} size={22} color={color as string} filled={focused} />
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
        // The taller bar has to make room for the safe area itself once a
        // height is set, otherwise it clips on phones with a home indicator.
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          elevation: 0,
          paddingTop: 8,
          paddingBottom: insets.bottom,
          height: 66 + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
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
