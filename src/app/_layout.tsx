/**
 * Root layout. Wraps the whole app in the providers every screen needs:
 *  - SafeAreaProvider for insets
 *  - DataProvider for repositories + auth (swap the backend inside it)
 * and defines the top-level Stack navigator.
 */
import type React from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { Stack, useNavigation, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui';
import { DataProvider } from '@/data/DataProvider';
import { IncomingCallGate } from '@/features/calls/IncomingCallGate';
import { PushRegistrar } from '@/features/notifications/PushRegistrar';
import { CartProvider } from '@/features/orders/CartContext';
import { spacing, useColors } from '@/theme/theme';
// Registers the driver background-location task at app start, so the OS can
// restart it after the app is killed (see lib/backgroundLocation.ts).
import '@/lib/backgroundLocation';

/**
 * Explicit header back control — a rounded chevron button with margin from the
 * edge. Shown on any pushed screen (guaranteed on web and native).
 */
function HeaderBack() {
  const router = useRouter();
  const navigation = useNavigation();
  const colors = useColors();
  if (!navigation.canGoBack?.()) return null;
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={12}
      style={({ pressed }) => ({
        marginLeft: spacing.md,
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: colors.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Icon name="arrowLeft" size={20} color={colors.text} />
    </Pressable>
  );
}

/**
 * App-wide stack header, rendered in JS instead of the native header. We pad
 * the status bar inset ourselves, which avoids the Android edge-to-edge bug
 * where the native header adds a second blank inset strip, and keeps the top
 * bar identical on every screen: centered title, back chevron on the left.
 */
type HeaderRightFn = (props: { tintColor?: string; canGoBack: boolean }) => React.ReactNode;

function AppHeader({ title, headerRight }: { title: string; headerRight?: HeaderRightFn }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        paddingTop: insets.top,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ height: 56, alignItems: 'center', justifyContent: 'center' }}>
        <RNText
          numberOfLines={1}
          // Action buttons on the right eat into the centered title's room —
          // give it less width there so a long name can't slide under them.
          style={{
            color: colors.text,
            fontSize: 17,
            fontWeight: '700',
            maxWidth: headerRight ? '45%' : '65%',
          }}
        >
          {title}
        </RNText>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' }}>
          <HeaderBack />
        </View>
        {headerRight ? (
          <View
            style={{
              position: 'absolute',
              right: spacing.sm,
              top: 0,
              bottom: 0,
              justifyContent: 'center',
            }}
          >
            {headerRight({ canGoBack: false })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A full page reload / app restart re-runs the whole bundle, so the in-memory
 * mock backend and the signed-in identity reset to defaults — but the URL stays
 * put. Landing back on a deep route (e.g. a workspace) then breaks: the auth
 * guard turns you away, or a session-created business no longer exists. So on
 * the very first mount after a cold start, if we're not already on Home, bounce
 * there. The module-level flag + empty-dep effect make this fire exactly once
 * per app load; in-app navigation never remounts the root layout, so ordinary
 * browsing to these routes is untouched.
 */
let handledColdStart = false;

function ColdStartRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (handledColdStart) return;
    handledColdStart = true;
    if (pathname && pathname !== '/') router.replace('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function RootLayout() {
  const colors = useColors();

  return (
    <SafeAreaProvider>
      <DataProvider>
        {/* Menu picks survive the menu ⇄ your-order round trip. */}
        <CartProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            header: ({ options, route }) => (
              <AppHeader title={options.title ?? route.name} headerRight={options.headerRight} />
            ),
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ title: 'List a business' }} />
          <Stack.Screen name="b2b" options={{ title: 'Business chats' }} />
          <Stack.Screen name="b2b-chat" options={{ title: 'Business chat' }} />
          <Stack.Screen name="business/[id]" options={{ title: 'Business' }} />
          <Stack.Screen name="employee/[id]" options={{ title: 'Profile' }} />
          <Stack.Screen name="map" options={{ title: 'Map' }} />
          <Stack.Screen name="directions/[businessId]" options={{ title: 'Directions' }} />
          <Stack.Screen name="search" options={{ headerShown: false }} />
          <Stack.Screen name="browse/[type]" options={{ title: 'Browse' }} />
          <Stack.Screen name="qr/[businessId]" options={{ title: 'QR code' }} />
          <Stack.Screen name="scan" options={{ title: 'Scan QR code' }} />
          <Stack.Screen name="call/[businessId]" options={{ title: 'Call' }} />
          <Stack.Screen name="call/session/[callId]" options={{ title: 'Voice call' }} />
          <Stack.Screen name="book/[businessId]" options={{ title: 'Book' }} />
          <Stack.Screen name="enroll/[businessId]" options={{ title: 'Enrol' }} />
          <Stack.Screen name="party/[businessId]" options={{ title: 'Plan a party' }} />
          <Stack.Screen name="review/[businessId]" options={{ title: 'Rate' }} />
          <Stack.Screen name="showcase/[businessId]" options={{ title: 'Work showcase' }} />
          <Stack.Screen name="product/[businessId]/[productId]" options={{ title: 'Item' }} />
          <Stack.Screen name="menu/[businessId]" options={{ title: 'Menu' }} />
          <Stack.Screen name="cart/[businessId]" options={{ headerShown: false }} />
          <Stack.Screen name="order/new/[businessId]" options={{ title: 'Place an order' }} />
          <Stack.Screen name="order/[orderId]" options={{ title: 'Order' }} />
          <Stack.Screen name="fulfill/[orderId]" options={{ title: 'Fulfil order' }} />
          <Stack.Screen name="orders/[businessId]" options={{ title: 'Orders' }} />
          <Stack.Screen name="bill/new/[businessId]" options={{ title: 'New bill' }} />
          <Stack.Screen name="bill/[billId]" options={{ title: 'Bill' }} />
          <Stack.Screen name="bills/[businessId]" options={{ title: 'Bills' }} />
          <Stack.Screen name="chat/[businessId]/index" options={{ title: 'Chat' }} />
          <Stack.Screen name="customers/[businessId]" options={{ title: 'Customers' }} />
          <Stack.Screen name="manage/[businessId]" options={{ title: 'Manage' }} />
          <Stack.Screen name="stall/[businessId]" options={{ title: 'Manage stall' }} />
          <Stack.Screen name="fleet/[businessId]/vehicles" options={{ title: 'Vehicles' }} />
          <Stack.Screen name="fleet/[businessId]/journey" options={{ title: 'Journeys' }} />
          <Stack.Screen name="fleet/[businessId]/items" options={{ title: 'Tracked items' }} />
          <Stack.Screen name="fleet/[businessId]/assign" options={{ title: 'Assign to vehicle' }} />
          <Stack.Screen name="fleet/[businessId]/item/[itemId]" options={{ title: 'Tracked item' }} />
          <Stack.Screen name="track/[businessId]" options={{ title: 'Live tracking' }} />
          <Stack.Screen name="workspace/[businessId]" options={{ title: 'Workspace' }} />
          <Stack.Screen name="workspace/[businessId]/orders" options={{ title: 'Orders' }} />
          <Stack.Screen name="workspace/[businessId]/billing" options={{ title: 'Billing' }} />
          <Stack.Screen name="workspace/[businessId]/bookings" options={{ title: 'Appointments' }} />
          <Stack.Screen name="workspace/[businessId]/members" options={{ title: 'Members' }} />
          <Stack.Screen name="workspace/[businessId]/calls" options={{ title: 'Call log' }} />
          <Stack.Screen
            name="workspace/[businessId]/notifications"
            options={{ title: 'Notifications' }}
          />
          <Stack.Screen name="notification-settings" options={{ title: 'Notifications' }} />
          <Stack.Screen name="workspace/[businessId]/fleet" options={{ title: 'Fleet & tracking' }} />
          <Stack.Screen name="workspace/[businessId]/team" options={{ title: 'Team' }} />
          <Stack.Screen name="workspace/[businessId]/offers" options={{ title: 'Offers' }} />
          <Stack.Screen name="member/[membershipId]" options={{ title: 'Member' }} />
          <Stack.Screen name="member-account/[businessId]/[customerId]" options={{ title: 'Member' }} />
          <Stack.Screen name="inbox/[businessId]/index" options={{ title: 'Inbox' }} />
          <Stack.Screen name="inbox/[businessId]/[participantId]" options={{ title: 'Chat' }} />
          <Stack.Screen name="dev" options={{ title: 'Dev tools' }} />
          <Stack.Screen name="admin" options={{ title: 'Admin' }} />
          <Stack.Screen name="sign-in" options={{ presentation: 'modal', title: 'Sign in' }} />
        </Stack>
        {/* On a reload, send deep routes back to Home (mock/auth reset). */}
        <ColdStartRedirect />
        {/* Rings business members on incoming voice calls, on any screen. */}
        <IncomingCallGate />
        {/* Registers this device for push, so a CLOSED app still gets called. */}
        <PushRegistrar />
        </CartProvider>
      </DataProvider>
    </SafeAreaProvider>
  );
}
