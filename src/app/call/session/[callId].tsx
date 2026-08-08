/**
 * Live call screen, shared by both sides of a voice call:
 *  - Customer: ringing → active → ended, always seeing who is on the line.
 *  - Business member: the same view once they've picked up; if a teammate
 *    answered first they can still join here (group call) or hang up alone —
 *    the call keeps going as long as the customer and someone are on.
 *
 * The screen polls CallRepository — the mock stand-in for a realtime signaling
 * channel. Audio itself is simulated until the WebRTC backend is wired in.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Call, CallParticipant } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useCallAudio, type CallAudioState } from '@/features/calls/useCallAudio';
import { Avatar, Button, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

const POLL_MS = 1500;

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

export default function CallSessionScreen() {
  // `answer=1` means we got here from the ANSWER pill on the system call
  // notification — the user has already said yes, so joining is not something
  // to ask them a second time.
  const { callId, answer } = useLocalSearchParams<{ callId: string; answer?: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();
  const myId = currentUser?.id ?? 'guest';

  const [call, setCall] = useState<Call | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Poll the call state (mock signaling) and tick the duration timer.
  useEffect(() => {
    let active = true;
    const load = () =>
      repos.calls
        .getById(callId)
        .then((c) => active && setCall(c))
        .catch((e: unknown) => active && setLoadError(e instanceof Error ? e.message : String(e)));
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [repos, callId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Real audio (LiveKit) rides on top of the signaling: connect only while this
  // user is actually joined and the call is still live; `muted` drives the mic.
  // Hooks run before the early returns, so compute the inputs null-safely here.
  const meLive = call?.participants.find((p) => p.id === myId);
  const callLive = call ? call.status === 'ringing' || call.status === 'active' : false;
  const audio = useCallAudio(callId, meLive?.state === 'joined' && callLive, muted);

  // Answered from the notification: join as soon as the call loads. Guarded by
  // a ref rather than state so a re-render mid-request can't fire a second join.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (answer !== '1' || autoJoined.current) return;
    if (!call || !callLive || meLive?.state !== 'ringing') return;
    autoJoined.current = true;
    repos.calls
      .join(callId, myId)
      .then(setCall)
      .catch(() => {
        // Rang out or was answered by a teammate while the app was starting —
        // the polled state below already shows the truth.
      });
  }, [answer, call, callLive, meLive?.state, repos, callId, myId]);

  if (loadError) return <ErrorView message={loadError} />;
  if (!call) return <LoadingView />;

  // Dedupe defensively: older calls (created before start() deduped) can carry
  // the same person twice, which would crash the list with duplicate React keys.
  const participants = call.participants.filter(
    (p, i, arr) => arr.findIndex((q) => q.id === p.id) === i,
  );
  const me = participants.find((p) => p.id === myId);
  const iAmOn = me?.state === 'joined';
  const canJoin = me?.side === 'business' && me.state === 'ringing';
  const isOver = call.status === 'ended' || call.status === 'missed' || call.status === 'declined';
  const onCall = participants.filter((p) => p.state === 'joined');

  const act = async (fn: () => Promise<Call>) => {
    setBusy(true);
    try {
      setCall(await fn());
    } catch (err) {
      Alert.alert('Call', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const hangUp = () => act(() => repos.calls.leave(call.id, myId));
  const join = () => act(() => repos.calls.join(call.id, myId));

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
            onPress={join}
            loading={busy}
            style={[styles.actionBtn, { backgroundColor: colors.success }]}
          />
        </>
      ) : null}

      {!isOver && iAmOn ? (
        <View style={styles.controls}>
          <Button
            title={muted ? '🔇 Unmute' : '🎙 Mute'}
            variant="secondary"
            onPress={() => setMuted((m) => !m)}
            style={styles.controlBtn}
          />
          <Button
            title={me?.side === 'customer' ? '📵 End call' : '📵 Leave call'}
            onPress={hangUp}
            loading={busy}
            style={[styles.controlBtn, { backgroundColor: colors.danger }]}
          />
        </View>
      ) : null}

      {isOver ? <Button title="Close" onPress={() => router.back()} style={styles.actionBtn} /> : null}

      {!isOver && iAmOn ? <AudioStatusNote audio={audio} /> : null}
    </Screen>
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
  controls: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  controlBtn: { flex: 1 },
  demoNote: { textAlign: 'center', marginTop: spacing.lg },
  audioNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
});
