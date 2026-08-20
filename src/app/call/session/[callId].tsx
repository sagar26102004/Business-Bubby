/**
 * Live call screen, shared by both sides of a voice call:
 *  - Customer: ringing → active → ended, always seeing who is on the line.
 *  - Business member: the same view once they've picked up; if a teammate
 *    answered first they can still join here (group call) or hang up alone —
 *    the call keeps going as long as the customer and someone are on.
 *
 * ⚠️ THIS SCREEN DOES NOT OWN THE CALL. It used to: it polled the signaling and
 * held the LiveKit room itself, which meant pressing back unmounted the audio
 * and left the other side talking to nobody while their screen still read "On
 * call". The call now lives in CallSessionProvider, above the router — read
 * that file first. Everything here is a view onto it, so leaving this screen is
 * exactly as harmless as leaving any other, and OngoingCallBar offers the way
 * back.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import type { Call, CallParticipant } from '@/domain/types';
import { useAuth } from '@/data/DataProvider';
import { useCallSession } from '@/features/calls/CallSessionContext';
import type { CallAudioState } from '@/features/calls/useCallAudio';
import type { AudioOutput } from '@/features/calls/livekitNative';
import { Avatar, Button, EmptyView, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

function formatDuration(fromIso: string, toMs: number): string {
  const s = Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 1000));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

const STATUS_LABEL: Record<Call['status'], string> = {
  ringing: 'Ringing…',
  active: 'On call',
  ended: 'Call ended',
  missed: 'No answer',
  declined: 'Call declined',
};

/** What each route is called, and the icon that carries it at a glance. */
const OUTPUT_LABEL: Record<AudioOutput, { label: string; emoji: string }> = {
  earpiece: { label: 'Phone', emoji: '📱' },
  speaker: { label: 'Speaker', emoji: '🔊' },
  bluetooth: { label: 'Bluetooth', emoji: '🎧' },
  headset: { label: 'Headset', emoji: '🎧' },
};

export default function CallSessionScreen() {
  // `answer=1` means we got here from the ANSWER pill on the system call
  // notification — the user has already said yes, so joining is not something
  // to ask them a second time.
  const { callId, answer } = useLocalSearchParams<{ callId: string; answer?: string }>();
  const { currentUser } = useAuth();
  const myId = currentUser?.id ?? 'guest';
  // A push notification can make the live call the app's FIRST screen.
  const dismiss = useDismiss('/');
  const colors = useColors();

  const session = useCallSession();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Tell the provider which call this screen is about. Idempotent, so the
  // common case — opening the screen for the call already in progress — does
  // nothing at all.
  useEffect(() => {
    if (callId) session.enter(callId);
    // `session` is a new object on every state change; entering on each of
    // those would reset the call it is meant to be tracking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  /**
   * The last state we saw for THIS call.
   *
   * The provider drops a finished call a few seconds after it ends, so that a
   * hung-up call stops holding the microphone and the ongoing-call bar. This
   * screen still has to show "Call ended" and the final duration after that, so
   * it keeps its own copy rather than blanking out mid-sentence.
   */
  const [shown, setShown] = useState<Call | null>(null);
  useEffect(() => {
    if (session.call && session.call.id === callId) setShown(session.call);
  }, [session.call, callId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  /**
   * Give up waiting eventually.
   *
   * The provider swallows a failed poll on purpose — one dropped request says
   * nothing about a call — but that leaves a genuinely unloadable call spinning
   * forever, which is exactly what a notification for a call that has since
   * been cleaned up produces. A real call resolves in about a second, so ten is
   * long enough that this can't fire on a slow connection.
   */
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (session.call?.id === callId) return;
    const timer = setTimeout(() => setGaveUp(true), 10000);
    return () => clearTimeout(timer);
  }, [session.call?.id, callId]);

  const call = shown;
  const isOver =
    !!call && (call.status === 'ended' || call.status === 'missed' || call.status === 'declined');
  const meLive = call?.participants.find((p) => p.id === myId);

  // Answered from the notification: join as soon as the call loads. Guarded by
  // a ref rather than state so a re-render mid-request can't fire a second join.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (answer !== '1' || autoJoined.current) return;
    if (!call || isOver || meLive?.state !== 'ringing') return;
    autoJoined.current = true;
    session.join().catch(() => {
      // Rang out or was answered by a teammate while the app was starting —
      // the polled state below already shows the truth.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, call, isOver, meLive?.state]);

  if (!call) {
    return gaveUp ? (
      <EmptyView
        title="Call not available"
        subtitle="This call has ended, or it isn’t one this account can join."
      />
    ) : (
      <LoadingView />
    );
  }

  // Dedupe defensively: older calls (created before start() deduped) can carry
  // the same person twice, which would crash the list with duplicate React keys.
  const participants = call.participants.filter(
    (p, i, arr) => arr.findIndex((q) => q.id === p.id) === i,
  );
  const me = participants.find((p) => p.id === myId);
  const iAmOn = me?.state === 'joined';
  const canJoin = me?.side === 'business' && me.state === 'ringing';
  const onCall = participants.filter((p) => p.state === 'joined');

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      showAlert('Call', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Voice call' }} />

      <View style={styles.header}>
        <View style={[styles.ring, { backgroundColor: colors.brandSoft }]}>
          <Text style={styles.ringEmoji}>{isOver ? '📵' : '📞'}</Text>
        </View>
        <Text variant="heading" weight="bold" style={styles.name}>
          {call.businessName}
        </Text>
        <Text
          weight="semibold"
          tone={call.status === 'active' ? 'accent' : isOver ? 'muted' : 'brand'}
          style={styles.status}
        >
          {STATUS_LABEL[call.status]}
          {call.answeredAt
            ? ` · ${formatDuration(call.answeredAt, isOver && call.endedAt ? new Date(call.endedAt).getTime() : now)}`
            : ''}
        </Text>
      </View>

      <Text variant="caption" weight="semibold" tone="muted" style={styles.group}>
        {call.status === 'ringing' ? 'RINGING' : `ON THE CALL · ${onCall.length}`}
      </Text>
      <View style={styles.people}>
        {participants.map((p) => (
          <ParticipantRow key={p.id} participant={p} isMe={p.id === myId} />
        ))}
      </View>

      {!isOver && canJoin ? (
        <>
          <Text tone="muted" style={styles.joinHint}>
            {onCall
              .filter((p) => p.side === 'business')
              .map((p) => p.name)
              .join(', ') || 'A teammate'}{' '}
            is on this call. You can join in or stay out.
          </Text>
          <Button
            title="📞 Join call"
            onPress={() => act(session.join)}
            loading={busy}
            style={[styles.actionBtn, { backgroundColor: colors.success }]}
          />
        </>
      ) : null}

      {!isOver && iAmOn ? (
        <>
          <AudioRoutePicker
            outputs={session.outputs}
            selected={session.output}
            onSelect={session.setOutput}
          />
          <View style={styles.controls}>
            <Button
              title={session.muted ? '🔇 Unmute' : '🎙 Mute'}
              variant="secondary"
              onPress={() => session.setMuted(!session.muted)}
              style={styles.controlBtn}
            />
            <Button
              title={me?.side === 'customer' ? '📵 End call' : '📵 Leave call'}
              onPress={() => act(session.hangUp)}
              loading={busy}
              style={[styles.controlBtn, { backgroundColor: colors.danger }]}
            />
          </View>
          {/* Back no longer hangs up, which is not something a user will guess. */}
          <Text variant="caption" tone="muted" style={styles.backHint}>
            You can leave this screen and use the app — the call keeps going, and the green bar at
            the top brings you back.
          </Text>
        </>
      ) : null}

      {isOver ? <Button title="Close" onPress={dismiss} style={styles.actionBtn} /> : null}

      {!isOver && iAmOn ? <AudioStatusNote audio={session.audio} /> : null}
    </Screen>
  );
}

/**
 * Where the sound comes out.
 *
 * Hidden when the OS gives us nothing to choose between — a browser, or a
 * phone whose audio session isn't up yet — because a route button that changes
 * nothing is worse than no button. Bluetooth and wired headsets appear only
 * while they're actually connected, so the row is as long as reality is.
 */
function AudioRoutePicker({
  outputs,
  selected,
  onSelect,
}: {
  outputs: AudioOutput[];
  selected: AudioOutput | null;
  onSelect: (output: AudioOutput) => void;
}) {
  const colors = useColors();
  if (outputs.length < 2) return null;
  return (
    <View style={styles.routeRow}>
      {outputs.map((output) => {
        const { label, emoji } = OUTPUT_LABEL[output];
        const active = output === selected;
        return (
          <Pressable
            key={output}
            onPress={() => onSelect(output)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Play the call through the ${label.toLowerCase()}`}
            style={[
              styles.routeBtn,
              {
                backgroundColor: active ? colors.brand : colors.surfaceAlt,
                borderColor: active ? colors.brand : colors.border,
              },
            ]}
          >
            <Text style={styles.routeEmoji}>{emoji}</Text>
            <Text variant="label" weight="semibold" tone={active ? 'inverse' : 'default'}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small footer that tells the user whether real audio is connected. */
function AudioStatusNote({ audio }: { audio: CallAudioState }) {
  const colors = useColors();
  const { status, message } = audio;
  if (status === 'live') {
    return (
      <View>
        <View style={styles.audioNote}>
          <View style={[styles.stateDot, { backgroundColor: colors.success }]} />
          <Text variant="caption" weight="semibold" style={{ color: colors.success }}>
            Live audio connected
          </Text>
        </View>
        {/* Connected, but the mic didn't publish — say so, or the user talks
            into a call nobody can hear. */}
        {message ? (
          <Text variant="caption" style={[styles.demoNote, { color: colors.danger }]}>
            {message}
          </Text>
        ) : null}
      </View>
    );
  }
  if (status === 'connecting') {
    return (
      <Text variant="caption" tone="muted" style={styles.demoNote}>
        Connecting audio…
      </Text>
    );
  }
  if (status === 'error') {
    return (
      <Text variant="caption" style={[styles.demoNote, { color: colors.danger }]}>
        Couldn’t connect the audio{message ? ` — ${message}` : '. Please try again.'}
      </Text>
    );
  }
  // 'unavailable' (Expo Go / not configured) or 'off'.
  return (
    <Text variant="caption" tone="muted" style={styles.demoNote}>
      Live audio needs the app’s dev build (or the web app) with LiveKit configured. On Expo Go the
      call connects but audio stays simulated.
    </Text>
  );
}

function ParticipantRow({ participant, isMe }: { participant: CallParticipant; isMe: boolean }) {
  const colors = useColors();
  const stateLabel = {
    joined: 'In call',
    ringing: 'Ringing…',
    left: 'Left',
    declined: 'Declined',
  }[participant.state];
  const stateColor =
    participant.state === 'joined'
      ? colors.success
      : participant.state === 'ringing'
        ? colors.accent
        : colors.textMuted;

  return (
    <View style={[styles.personRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Avatar name={participant.name} size={40} />
      <View style={styles.personInfo}>
        <Text weight="medium">
          {participant.name}
          {isMe ? ' (you)' : ''}
        </Text>
        <Text variant="caption" tone="muted">
          {participant.side === 'customer' ? 'Customer' : participant.roleLabel ?? 'Team'}
        </Text>
      </View>
      <View style={styles.stateWrap}>
        <View style={[styles.stateDot, { backgroundColor: stateColor }]} />
        <Text variant="caption" style={{ color: stateColor }}>
          {stateLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl },
  ring: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  ringEmoji: { fontSize: 40 },
  name: { marginTop: spacing.md },
  status: { marginTop: spacing.xs },
  group: { letterSpacing: 1, marginBottom: spacing.sm },
  people: { marginBottom: spacing.lg },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  personInfo: { flex: 1 },
  stateWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stateDot: { width: 8, height: 8, borderRadius: 4 },
  joinHint: { textAlign: 'center', marginBottom: spacing.md },
  actionBtn: { marginBottom: spacing.sm },
  routeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  routeBtn: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  routeEmoji: { fontSize: 18 },
  controls: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  controlBtn: { flex: 1 },
  backHint: { textAlign: 'center', marginBottom: spacing.sm },
  demoNote: { textAlign: 'center', marginTop: spacing.lg },
  audioNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
});
