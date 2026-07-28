/**
 * Global incoming-call watcher, mounted once in the root layout so a business
 * member rings no matter which screen they're on:
 *  - Call still ringing → full-screen WhatsApp-style incoming overlay
 *    (who's calling, which business it's for, who else is being rung).
 *  - A teammate already picked up → a compact banner offering to join the
 *    group call (or dismiss and stay out).
 *
 * Polling CallRepository.getIncomingForUser is the mock stand-in for a VoIP
 * push notification — the real backend swaps the poll for a push + CallKeep so
 * the phone rings even when the app is closed, without touching this UI.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { Call } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { Avatar, Text } from '@/components/ui';
import { palette, radius, spacing, useColors } from '@/theme/theme';

const POLL_MS = 2000;

export function IncomingCallGate() {
  const repos = useRepositories();
  const colors = useColors();
  const { currentUser } = useAuth();
  const [call, setCall] = useState<Call | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      setCall(null);
      return;
    }
    let active = true;
    const load = () =>
      repos.calls
        .getIncomingForUser(currentUser.id)
        .then((c) => {
          if (!active) return;
          // Dev-only: surface what the receiver's poll sees, so a "no ring"
          // problem (wrong account, RLS) is diagnosable in the browser console.
          if (__DEV__ && c) console.log('[IncomingCallGate] incoming call for', currentUser.id, '→', c.id, c.status);
          setCall(c);
        })
        .catch((e) => {
          if (__DEV__) console.warn('[IncomingCallGate] poll failed for', currentUser.id, e);
        });
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [repos, currentUser?.id]);

  if (!currentUser || !call || call.id === dismissedId) return null;

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await repos.calls.join(call.id, currentUser.id);
      setCall(null);
      router.push(`/call/session/${call.id}`);
    } catch {
      setDismissedId(call.id); // call ended in the meantime
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await repos.calls.decline(call.id, currentUser.id);
    } catch {}
    setDismissedId(call.id);
    setCall(null);
    setBusy(false);
  };

  // A teammate answered first — offer to join the group call.
  if (call.status === 'active') {
    const answered = call.participants
      .filter((p) => p.side === 'business' && p.state === 'joined')
      .map((p) => p.name)
      .join(', ');
    return (
      <View style={[styles.fill, styles.bannerWrap]} pointerEvents="box-none">
        <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.bannerInfo}>
            <Text weight="semibold" numberOfLines={1}>
              📞 {answered || 'A teammate'} answered {call.customerName}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              Call for {call.businessName} — you can still join in.
            </Text>
          </View>
          <Pressable
            onPress={accept}
            style={[styles.bannerBtn, { backgroundColor: colors.success }]}
            accessibilityRole="button"
          >
            <Text variant="label" tone="inverse" weight="semibold">
              Join
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setDismissedId(call.id)}
            style={[styles.bannerBtn, { backgroundColor: colors.surfaceAlt }]}
            accessibilityRole="button"
          >
            <Text variant="label" weight="semibold">
              Dismiss
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Still ringing — full-screen incoming call.
  const alsoRinging = call.participants
    .filter((p) => p.side === 'business' && p.state === 'ringing' && p.id !== currentUser.id)
    .map((p) => p.name);

  return (
    <View style={[styles.fill, styles.overlay]}>
      <Text variant="label" style={styles.overlayMuted}>
        Incoming voice call
      </Text>
      <Text weight="semibold" style={styles.overlayBusiness}>
        for {call.businessName}
      </Text>

      <View style={styles.caller}>
        <Avatar name={call.customerName} size={96} />
        <Text variant="title" weight="bold" style={styles.callerName}>
          {call.customerName}
        </Text>
        <Text style={styles.overlayMuted}>Customer · internet call</Text>
        {alsoRinging.length > 0 ? (
          <Text variant="caption" style={[styles.overlayMuted, styles.alsoRinging]}>
            Also ringing: {alsoRinging.join(', ')}
          </Text>
        ) : null}
      </View>

      <View style={styles.answerRow}>
        <View style={styles.answerCol}>
          <Pressable
            onPress={decline}
            style={[styles.answerBtn, { backgroundColor: palette.danger }]}
            accessibilityRole="button"
            accessibilityLabel="Decline call"
          >
            <Text style={styles.answerEmoji}>📵</Text>
          </Pressable>
          <Text variant="label" style={styles.overlayMuted}>
            Decline
          </Text>
        </View>
        <View style={styles.answerCol}>
          <Pressable
            onPress={accept}
            style={[styles.answerBtn, { backgroundColor: palette.success }]}
            accessibilityRole="button"
            accessibilityLabel="Accept call"
          >
            <Text style={styles.answerEmoji}>📞</Text>
          </Pressable>
          <Text variant="label" style={styles.overlayMuted}>
            Accept
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  overlay: {
    backgroundColor: 'rgba(11, 18, 32, 0.96)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
    zIndex: 1000,
    elevation: 1000,
  },
  overlayMuted: { color: 'rgba(241, 245, 249, 0.75)' },
  overlayBusiness: { color: palette.white, marginTop: spacing.xs },
  caller: { alignItems: 'center', gap: spacing.sm },
  callerName: { color: palette.white, marginTop: spacing.sm },
  alsoRinging: { marginTop: spacing.md },
  answerRow: { flexDirection: 'row', gap: spacing.xxl * 2 },
  answerCol: { alignItems: 'center', gap: spacing.sm },
  answerBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerEmoji: { fontSize: 30 },
  bannerWrap: {
    justifyContent: 'flex-end',
    padding: spacing.lg,
    zIndex: 1000,
    elevation: 1000,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bannerInfo: { flex: 1 },
  bannerBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
});
