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
import * as SplashScreen from 'expo-splash-screen';
import { isRunningInExpoGo } from 'expo';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui';
import { IS_EPHEMERAL_BACKEND } from '@/data/backend';
import { DataProvider, useAuth } from '@/data/DataProvider';
import { IncomingCallGate } from '@/features/calls/IncomingCallGate';
import { PushRegistrar } from '@/features/notifications/PushRegistrar';
import { CartProvider } from '@/features/orders/CartContext';
import { spacing, useColors } from '@/theme/theme';
// Registers the driver background-location task at app start, so the OS can
// restart it after the app is killed (see lib/backgroundLocation.ts).
import '@/lib/backgroundLocation';

/**
 * Hold the splash screen up until the app knows WHO IT IS.
 *
 * Without this the splash disappears the moment the first view mounts, which is
 * before `DataProvider` has restored the session — so the app paints the guest
 * home screen, then repaints it as the signed-in one a network round trip
 * later. The splash is the natural place to spend that time.
 *
 * Called at module scope and NOT awaited, per the expo-splash-screen docs: from
 * inside a component it can run after the splash is already gone, which does
 * nothing. It rejects harmlessly if that happens anyway, and every method here
 * is a no-op on web, so nothing needs a platform guard.
 */
void SplashScreen.preventAutoHideAsync().catch(() => {});
// iOS can cross-fade instead of cutting; Android ignores this. Expo Go owns its
// own splash and cannot be customised, so asking there only logs a warning —
// skipped rather than left to clutter the dev console on every reload.
if (!isRunningInExpoGo()) SplashScreen.setOptions({ duration: 300, fade: true });

/**
 * The longest we will EVER hold it.
 *
 * `authLoading` is flipped in a `.finally()`, so a rejected session lookup still
 * releases the splash — but a request that never settles at all (a phone on a
 * captive-portal wifi is the everyday version) would leave the user staring at
 * a black screen with no way out. Better to show the app as a guest and let it
 * correct itself than to hang on the one screen with no UI.
 */
const SPLASH_MAX_MS = 5000;

/**
 * Hides the splash once auth has settled, or once the deadline above passes.
 *
 * Lives inside `DataProvider` because that is what it waits for. Deliberately
 * does NOT wait for screen data — the home screen has its own loading state and
 * a spinner in the app beats a longer splash.
 */
function SplashGate() {
  const { authLoading } = useAuth();

  useEffect(() => {
    // Hiding twice is harmless — the second call no-ops (or rejects, caught).
    const hide = () => void SplashScreen.hideAsync().catch(() => {});
    if (!authLoading) {
      hide();
      return;
    }
    const timer = setTimeout(hide, SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, [authLoading]);

  return null;
}

/**
 * Explicit header back control — a rounded chevron button with margin from the
 * edge. Shown on any pushed screen (guaranteed on web and native).
 *
 * With NOTHING to go back to it becomes a HOME button instead of disappearing.
 * That case is real now that deep links survive a cold start (see
 * `ColdStartRedirect`): a printed QR code or a push notification opens a stack
 * screen as the very first route, where there is no back stack AND no tab bar —
 * so without this the person who scanned the code would have no way out of it.
 */
function HeaderBack() {
  const router = useRouter();
  const navigation = useNavigation();
  const colors = useColors();
  const canGoBack = navigation.canGoBack?.() ?? false;
  return (
    <Pressable
      onPress={() => (canGoBack ? router.back() : router.replace('/'))}
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
      accessibilityLabel={canGoBack ? 'Go back' : 'Go to home'}
    >
      <Icon name={canGoBack ? 'arrowLeft' : 'home'} size={20} color={colors.text} />
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
 * MOCK BACKEND ONLY — bounce a cold start off a deep route back to Home.
 *
 * On the mock, a full reload re-runs the bundle, so the in-memory data and the
 * signed-in identity reset to defaults while the URL stays put. Landing back on
 * a deep route (e.g. a workspace) then breaks: the auth guard turns you away, or
 * a session-created business no longer exists.
 *
 * ⚠️ It must NOT run on a real backend. There the session and the data both
 * survive, and bouncing to Home would break every deep link the app itself
 * hands out — the printed business QR code (`/business/[id]`), a push
 * notification opening an order, an Android App Link. Those all arrive as a
 * COLD start, which is exactly the case this would have swallowed.
 *
 * The module-level flag + empty-dep effect make it fire once per app load;
 * in-app navigation never remounts the root layout.
 */
let handledColdStart = false;

function ColdStartRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!IS_EPHEMERAL_BACKEND || handledColdStart) return;
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
          {/* The deals feed is dark and full-bleed — it owns its own top bar,
              the way /search does. */}
          <Stack.Screen name="deals" options={{ headerShown: false }} />
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
          <Stack.Screen name="manage/[businessId]/details" options={{ title: 'Name & details' }} />
          <Stack.Screen name="manage/[businessId]/tags" options={{ title: 'Tags' }} />
          <Stack.Screen name="manage/[businessId]/hours" options={{ title: 'Opening hours' }} />
          <Stack.Screen name="manage/[businessId]/availability" options={{ title: 'Availability' }} />
          <Stack.Screen name="manage/[businessId]/menu" options={{ title: 'Menu' }} />
          <Stack.Screen name="manage/[businessId]/products" options={{ title: 'Products' }} />
          <Stack.Screen name="manage/[businessId]/services" options={{ title: 'Services' }} />
          <Stack.Screen name="manage/[businessId]/rentals" options={{ title: 'For rent' }} />
          <Stack.Screen name="manage/[businessId]/tables" options={{ title: 'Tables' }} />
          <Stack.Screen name="manage/[businessId]/parties" options={{ title: 'Party packages' }} />
          <Stack.Screen name="manage/[businessId]/calls" options={{ title: 'Calls & chat' }} />
          <Stack.Screen name="manage/[businessId]/tools" options={{ title: 'Workspace tools' }} />
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
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="edit-profile" options={{ title: 'Edit profile' }} />
          <Stack.Screen name="contact-details" options={{ title: 'Contact details' }} />
          <Stack.Screen name="change-password" options={{ title: 'Password' }} />
          <Stack.Screen name="saved-places" options={{ title: 'Saved places' }} />
          <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
          <Stack.Screen name="workspace/[businessId]/fleet" options={{ title: 'Fleet & tracking' }} />
          <Stack.Screen name="workspace/[businessId]/team" options={{ title: 'Team' }} />
          <Stack.Screen name="workspace/[businessId]/offers" options={{ title: 'Offers' }} />
          <Stack.Screen name="promote/[businessId]" options={{ title: 'Promote' }} />
          <Stack.Screen name="member/[membershipId]" options={{ title: 'Member' }} />
          <Stack.Screen name="member-account/[businessId]/[customerId]" options={{ title: 'Member' }} />
          <Stack.Screen name="inbox/[businessId]/index" options={{ title: 'Inbox' }} />
          <Stack.Screen name="inbox/[businessId]/[participantId]" options={{ title: 'Chat' }} />
          <Stack.Screen name="dev" options={{ title: 'Dev tools' }} />
          <Stack.Screen name="admin/index" options={{ title: 'Platform console' }} />
          <Stack.Screen name="admin/listings" options={{ title: 'Listings' }} />
          <Stack.Screen name="admin/catalog" options={{ title: 'Tags & offerings' }} />
          <Stack.Screen name="ad-review" options={{ title: 'Ad review' }} />
          <Stack.Screen name="sign-in" options={{ presentation: 'modal', title: 'Sign in' }} />
          <Stack.Screen name="auth-callback" options={{ title: 'Signing in' }} />
        </Stack>
        {/* Keeps the splash up until the session is restored. */}
        <SplashGate />
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
