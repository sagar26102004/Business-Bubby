/**
 * Root layout. Wraps the whole app in the providers every screen needs:
 *  - SafeAreaProvider for insets
 *  - DataProvider for repositories + auth (swap the backend inside it)
 * and defines the top-level Stack navigator.
 */
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DataProvider } from '@/data/DataProvider';
import { IncomingCallGate } from '@/features/calls/IncomingCallGate';
import { CartProvider } from '@/features/orders/CartContext';
import { spacing, useColors } from '@/theme/theme';

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
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <RNText style={{ color: colors.brand, fontSize: 22, fontWeight: '700', marginTop: -2 }}>
        ‹
      </RNText>
    </Pressable>
  );
}

/**
 * App-wide stack header, rendered in JS instead of the native header. We pad
 * the status bar inset ourselves, which avoids the Android edge-to-edge bug
 * where the native header adds a second blank inset strip, and keeps the top
 * bar identical on every screen: centered title, back chevron on the left.
 */
function AppHeader({ title }: { title: string }) {
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
      <View style={{ height: 52, alignItems: 'center', justifyContent: 'center' }}>
        <RNText
          numberOfLines={1}
          style={{ color: colors.text, fontSize: 17, fontWeight: '600', maxWidth: '65%' }}
        >
          {title}
        </RNText>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' }}>
          <HeaderBack />
        </View>
      </View>
    </View>
  );
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
              <AppHeader title={options.title ?? route.name} />
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
          <Stack.Screen name="search" options={{ headerShown: false }} />
          <Stack.Screen name="browse/[type]" options={{ title: 'Browse' }} />
          <Stack.Screen name="qr/[businessId]" options={{ title: 'QR code' }} />
          <Stack.Screen name="scan" options={{ title: 'Scan QR code' }} />
          <Stack.Screen name="call/[businessId]" options={{ title: 'Call' }} />
          <Stack.Screen name="call/session/[callId]" options={{ title: 'Voice call' }} />
          <Stack.Screen name="book/[businessId]" options={{ title: 'Book' }} />
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
          <Stack.Screen name="fleet/[businessId]" options={{ title: 'Fleet & tracking' }} />
          <Stack.Screen name="track/[businessId]" options={{ title: 'Live tracking' }} />
          <Stack.Screen name="workspace/[businessId]" options={{ title: 'Workspace' }} />
          <Stack.Screen name="workspace/[businessId]/orders" options={{ title: 'Orders' }} />
          <Stack.Screen name="workspace/[businessId]/billing" options={{ title: 'Billing' }} />
          <Stack.Screen name="workspace/[businessId]/bookings" options={{ title: 'Appointments' }} />
          <Stack.Screen name="workspace/[businessId]/members" options={{ title: 'Members' }} />
          <Stack.Screen name="workspace/[businessId]/fleet" options={{ title: 'Fleet & tracking' }} />
          <Stack.Screen name="workspace/[businessId]/team" options={{ title: 'Team' }} />
          <Stack.Screen name="inbox/[businessId]/index" options={{ title: 'Inbox' }} />
          <Stack.Screen name="inbox/[businessId]/[participantId]" options={{ title: 'Chat' }} />
          <Stack.Screen name="dev" options={{ title: 'Dev tools' }} />
          <Stack.Screen name="sign-in" options={{ presentation: 'modal', title: 'Sign in' }} />
        </Stack>
        {/* Rings business members on incoming voice calls, on any screen. */}
        <IncomingCallGate />
        </CartProvider>
      </DataProvider>
    </SafeAreaProvider>
  );
}
