/**
 * QR scanner — point the camera at a business's Localo QR code (the one from
 * /qr/[businessId]) and jump straight to its page.
 *
 * Camera barcode scanning is native-only: expo-camera has no barcode support
 * on web, so the web build (our preview) offers paste-a-link instead — same
 * outcome, no camera.
 */
import { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Button, Input, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

/**
 * Pull the business id out of any Localo QR payload. The QR encodes whatever
 * expo-linking generated where it was created (https://…/business/ID on web,
 * exp://…/--/business/ID in Expo Go, localo://business/ID in a build), so
 * match the path rather than a fixed origin.
 */
function businessIdFrom(data: string): string | undefined {
  const match = data.match(/business\/([A-Za-z0-9_-]+)/);
  return match?.[1];
}

/**
 * Localo QR codes come in two flavours: a business storefront sign
 * (…/business/ID → the business page) and an order ticket (…/fulfill/ID → the
 * staff fulfil screen, for scan-to-pay / scan-to-collect). Resolve either to
 * the route it should open, order tickets taking precedence.
 */
function routeForScan(data: string): string | undefined {
  const ticket = data.match(/fulfill\/([A-Za-z0-9_-]+)/);
  if (ticket?.[1]) return `/fulfill/${ticket[1]}`;
  const businessId = businessIdFrom(data);
  return businessId ? `/business/${businessId}` : undefined;
}

export default function ScanScreen() {
  const router = useRouter();
  const colors = useColors();

  if (Platform.OS === 'web') return <PasteFallback />;

  return <NativeScanner router={router} colors={colors} />;
}

/** Web preview: no camera scanning — paste the link a Localo QR encodes. */
function PasteFallback() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();

  const open = () => {
    const route = routeForScan(value.trim());
    if (!route) {
      setError('That doesn’t look like a Localo link.');
      return;
    }
    router.replace(route as Parameters<typeof router.replace>[0]);
  };

  return (
    <Screen scroll>
      <View style={styles.fallbackHeader}>
        <Text style={styles.fallbackIcon}>🔳</Text>
        <Text variant="subheading" weight="bold" style={styles.centerText}>
          Camera scanning works in the app
        </Text>
        <Text tone="muted" style={styles.centerText}>
          On the web there’s no QR camera — paste the link from a Localo QR code
          (a business sign or an order ticket) and we’ll open it.
        </Text>
      </View>
      <Input
        label="Localo link"
        placeholder="e.g. https://…/business/b_cafe or …/fulfill/o12"
        value={value}
        onChangeText={(t) => {
          setValue(t);
          setError(undefined);
        }}
        error={error}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button title="Open" onPress={open} disabled={!value.trim()} />
    </Screen>
  );
}

function NativeScanner({
  router,
  colors,
}: {
  router: ReturnType<typeof useRouter>;
  colors: ReturnType<typeof useColors>;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);
  const [badCode, setBadCode] = useState(false);

  if (!permission) return <LoadingView />;

  if (!permission.granted) {
    return (
      <Screen>
        <View style={styles.fallbackHeader}>
          <Text style={styles.fallbackIcon}>📷</Text>
          <Text variant="subheading" weight="bold" style={styles.centerText}>
            Camera access needed
          </Text>
          <Text tone="muted" style={styles.centerText}>
            Localo uses the camera only to scan business QR codes — point it at a
            code on a counter or flyer to open that business.
          </Text>
        </View>
        <Button title="Allow camera" onPress={requestPermission} />
      </Screen>
    );
  }

  const onScanned = ({ data }: { data: string }) => {
    if (locked.current) return;
    locked.current = true;
    const route = routeForScan(data);
    if (route) {
      router.replace(route as Parameters<typeof router.replace>[0]);
      return;
    }
    // Not a Localo code — tell them and allow another try shortly.
    setBadCode(true);
    setTimeout(() => {
      setBadCode(false);
      locked.current = false;
    }, 1600);
  };

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScanned}
      />
      {/* Viewfinder frame + hint, over the preview */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text tone="inverse" weight="semibold" style={styles.hint}>
          {badCode ? 'Not a Localo business code' : 'Point at a Localo QR code'}
        </Text>
        {badCode ? (
          <Text variant="caption" style={[styles.hint, { color: colors.star }]}>
            Look for the QR from a business’s “QR code & share link” page.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fallbackHeader: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  fallbackIcon: { fontSize: 44 },
  centerText: { textAlign: 'center', maxWidth: 320 },
  cameraWrap: { flex: 1, backgroundColor: '#000' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: radius.xl,
    backgroundColor: 'transparent',
  },
  hint: { textAlign: 'center', paddingHorizontal: spacing.xl },
});
