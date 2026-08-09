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
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Vibration, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { router } from 'expo-router';
import type { Call } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { Avatar, Text } from '@/components/ui';
import { dismissIncomingCall } from '../../../modules/call-notification';
import { dismissCallNotifications } from '../notifications/push';
import { palette, radius, spacing, useColors } from '@/theme/theme';

const POLL_MS = 2000;

/** A 4s loop of the classic 440+480 Hz ring cadence (see assets/ringtone.wav). */
const RINGTONE = require('../../../assets/ringtone.wav');

/**
 * Android vibration cadence, roughly in step with the ringtone:
 * [wait, buzz, wait, buzz, wait]. Repeated until the call is answered.
 * (iOS ignores the durations and just pulses on each entry.)
 */
const VIBRATION_PATTERN = [0, 700, 550, 700, 2050];

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
        .then((c) => active && setCall(c))
        .catch((err: unknown) => {
          // A failing poll used to be swallowed in total silence, so a phone
          // that never rang looked identical to one with nothing to ring for.
          // Say so in dev; still never surface it to a user mid-browse.
          if (__DEV__) {
            console.warn('[IncomingCallGate] incoming-call poll failed:', err);
          }
        });
    load();
    const timer = setInterval(load, POLL_MS);
    // The JS timer is frozen while the app is backgrounded (and on a locked
    // phone), so a call that starts while you're in another app is only noticed
    // once you come back. Poll the instant we're foregrounded again, rather
    // than waiting out the rest of the tick — the ring window is only 30s.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      active = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [repos, currentUser?.id]);

  // Ring out loud while a call is genuinely waiting to be answered. Only the
  // full-screen `ringing` state does this — the "a teammate answered, join?"
  // banner is a soft nudge and stays silent.
  const isRinging = !!call && call.status === 'ringing' && call.id !== dismissedId;
  const player = useAudioPlayer(RINGTONE);

  // Clear whatever announced this call while the app was closed, as soon as it
  // stops ringing — answered here, answered by a teammate, cancelled, or rang
  // out. Without this the phone keeps showing "incoming call" for a call that
  // no longer exists. Keyed on the id so it fires on the transition, not on
  // every poll.
  //
  // BOTH paths are cleared because either could have drawn it: the native
  // service posts the call popup, and if it didn't run, expo-notifications
  // posted its own from the push. Whichever isn't there is a no-op.
  const poppedId = useRef<string | null>(null);
  useEffect(() => {
    if (isRinging && call) {
      poppedId.current = call.id;
      // This screen IS the call now, so clear anything the notification layer
      // put up for it. The push fires unconditionally — deciding not to post
      // because the app "looked open" is how a call ends up silent — so the
      // tidying happens here, where being on screen is a fact rather than a
      // guess.
      if (AppState.currentState === 'active') {
        void dismissIncomingCall(call.id);
        void dismissCallNotifications(call.id);
      }
    } else if (poppedId.current) {
      const id = poppedId.current;
      void dismissIncomingCall(id);
      void dismissCallNotifications(id);
      poppedId.current = null;
    }
  }, [isRinging, call?.id]);

  useEffect(() => {
    if (!isRinging) return;
    let stopped = false;
    // Vibration is the alert that still lands with the phone face-down or on
    // silent; the ringtone is what you actually notice across the room.
    if (Platform.OS !== 'web') Vibration.vibrate(VIBRATION_PATTERN, true);
    (async () => {
      try {
        // A call must ring THROUGH the silent switch and take audio focus from
        // whatever is playing — that's the whole point of a ring.
        await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' });
        if (stopped) return;
        player.loop = true;
        player.volume = 1;
        player.play();
      } catch {
        // A browser blocking autoplay before any user gesture is the common
        // case. The vibration and the full-screen overlay still do their job.
      }
    })();
    return () => {
      stopped = true;
      if (Platform.OS !== 'web') Vibration.cancel();
      try {
        player.pause();
        // Rewind so the NEXT call starts at the beginning of the cadence
        // instead of halfway through a silent gap.
        void player.seekTo(0);
      } catch {
        /* player already released */
      }
    };
  }, [isRinging, player]);

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
