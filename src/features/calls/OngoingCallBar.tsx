/**
 * The green strip that says "you are still on a call".
 *
 * Pressing back on the call screen no longer hangs up — the call lives in
 * CallSessionProvider now, above the router — which leaves one honest problem:
 * a call you can't see is a call you can forget you're on, with an open
 * microphone. So the moment the call screen isn't the screen you're looking at,
 * this takes its place: who you're talking to, how long it's been, and a tap
 * back into the call.
 *
 * Rendered ABOVE the navigator rather than floating over it, so it pushes the
 * app down by its own height instead of covering the header's back button —
 * the same thing WhatsApp does, and the reason it never hides anything you were
 * about to tap.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui';
import { palette, spacing } from '@/theme/theme';
import { useCallSession } from './CallSessionContext';

function formatDuration(fromIso: string, toMs: number): string {
  const s = Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 1000));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function OngoingCallBar() {
  const { call, callId, live, joined } = useCallSession();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => Date.now());

  // Only tick while the bar is actually up. A once-a-second re-render of the
  // whole app for a bar nobody is looking at is a real cost on a mid-range
  // phone, and the call screen has its own timer.
  const onCallScreen = !!callId && pathname === `/call/session/${callId}`;
  const visible = !!callId && live && joined && !onCallScreen;

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  const name = call?.businessName ?? 'Call';
  const elapsed = call?.answeredAt ? formatDuration(call.answeredAt, now) : null;

  return (
    <Pressable
      onPress={() => router.push(`/call/session/${callId}`)}
      accessibilityRole="button"
      accessibilityLabel={`Return to your call with ${name}`}
      style={[styles.bar, { paddingTop: insets.top + spacing.xs }]}
    >
      <View style={styles.row}>
        <Text style={styles.emoji}>📞</Text>
        <Text variant="label" weight="semibold" style={styles.label} numberOfLines={1}>
          {elapsed ? `${elapsed} · ${name}` : `On a call with ${name}`}
        </Text>
        <Text variant="label" weight="semibold" style={styles.action}>
          Tap to return
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Hardcoded green rather than a theme token on purpose: this is the one
  // surface that must read as "live call" in both light and dark, exactly as
  // the system's own call bar does.
  bar: { backgroundColor: palette.success, paddingBottom: spacing.xs, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emoji: { fontSize: 13 },
  label: { flex: 1, color: palette.white },
  action: { color: 'rgba(255, 255, 255, 0.85)' },
});
