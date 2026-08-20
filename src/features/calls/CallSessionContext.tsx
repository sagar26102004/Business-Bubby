/**
 * The live call, hoisted OUT of the call screen.
 *
 * ⚠️ THE ARCHITECTURE HERE IS THE FIX, so read this before moving anything back
 * down. Every piece of a call — polling its state, the LiveKit room, the
 * microphone, the audio route — used to live inside `app/call/session/[callId]`.
 * That made the call a property of a ROUTE, and a route unmounts constantly:
 * press back, tap a notification, follow a deep link, and React tore the screen
 * down, which ran useCallAudio's cleanup, which disconnected the room. The
 * person on the other end heard silence while their own screen still said "On
 * call", because nothing had actually hung up — the signaling row was untouched
 * and only the audio had gone. Re-opening the screen mounted it all again,
 * which is why a call appeared to "reconnect" every time you came back to it.
 *
 * So the call lives HERE, mounted once in the root layout, above the router.
 * Screens are now views onto it: `app/call/session/[callId]` renders this state
 * and calls these actions, and `OngoingCallBar` offers the way back. Navigation
 * cannot end a call any more, because navigation can't unmount this.
 *
 * Leaving the app entirely is the other half, and it is not a JS problem —
 * Android freezes and then kills a backgrounded process. `startOngoingCall`
 * puts the app in the foreground service state for the duration, which is what
 * keeps the process (and therefore this provider) alive behind a locked screen
 * or after a swipe out of Recents. See modules/call-notification.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import type { Call } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useCallAudio, type CallAudioState } from './useCallAudio';
import { listAudioOutputs, selectAudioOutput, type AudioOutput } from './livekitNative';
import {
  startOngoingCall,
  stopOngoingCall,
  takePendingAnswer,
} from '../../../modules/call-notification';

/** How often the call's state is re-read. Matches the old in-screen poll. */
const POLL_MS = 1500;

/**
 * How often this device renews its "still here" lease while joined.
 *
 * A quarter of the server's PRESENCE_TIMEOUT_MS (45s), so three beats in a row
 * have to go missing before anyone is dropped — enough slack for a phone
 * changing cell tower, short enough that a genuinely dead device is cleared out
 * of the other person's call within a minute.
 */
const HEARTBEAT_MS = 10_000;

export interface CallSession {
  /** The call being polled, or null when there is none. */
  call: Call | null;
  /** Its id even before the first poll lands, so the UI can commit instantly. */
  callId: string | null;
  /** True while the call is ringing or active — i.e. still worth showing. */
  live: boolean;
  /** This user's own participant row, if they are on the call at all. */
  me: Call['participants'][number] | undefined;
  /** True once this user has actually joined (and so has audio). */
  joined: boolean;
  audio: CallAudioState;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** Outputs this phone can use right now. Empty on web — nothing to choose. */
  outputs: AudioOutput[];
  /** The one in use, as far as we asked for it. */
  output: AudioOutput | null;
  setOutput: (output: AudioOutput) => void;
  /** Begin tracking a call in this provider (after start(), join(), or a deep link). */
  enter: (callId: string) => void;
  /** Hang up / leave. Ends tracking either way. */
  hangUp: () => Promise<void>;
  /** Join a call that is ringing for this user. */
  join: () => Promise<void>;
  /** Forget the call without hanging up — for a call that has already ended. */
  clear: () => void;
}

const CallSessionContext = createContext<CallSession | null>(null);

export function useCallSession(): CallSession {
  const ctx = useContext(CallSessionContext);
  if (!ctx) throw new Error('useCallSession must be used inside <CallSessionProvider>');
  return ctx;
}

/** True for a call that is still worth being on screen for. */
function isLive(call: Call | null): boolean {
  return !!call && (call.status === 'ringing' || call.status === 'active');
}

export function CallSessionProvider({ children }: { children: ReactNode }) {
  const repos = useRepositories();
  const { currentUser } = useAuth();
  const myId = currentUser?.id ?? 'guest';

  const [callId, setCallId] = useState<string | null>(null);
  const [call, setCall] = useState<Call | null>(null);
  const [muted, setMuted] = useState(false);
  const [outputs, setOutputs] = useState<AudioOutput[]>([]);
  const [output, setOutputState] = useState<AudioOutput | null>(null);

  const me = call?.participants.find((p) => p.id === myId);
  const live = isLive(call);
  const joined = me?.state === 'joined' && live;

  // The real audio room. Mounted HERE, so it outlives every screen.
  const audio = useCallAudio(callId ?? '', !!callId && joined, muted);

  const enter = useCallback((id: string) => {
    setCallId((current) => {
      if (current === id) return current;
      // A fresh call starts unmuted and on the default route; carrying the last
      // call's mute over is how someone ends up talking into a dead mic.
      setCall(null);
      setMuted(false);
      setOutputState(null);
      return id;
    });
  }, []);

  const clear = useCallback(() => {
    setCallId(null);
    setCall(null);
  }, []);

  // ------------------------------------------------------------ signaling

  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    const load = () =>
      repos.calls
        .getById(callId)
        .then((next) => {
          if (cancelled || !next) return;
          setCall(next);
        })
        .catch(() => {
          // A dropped poll is normal on a flaky connection and says nothing
          // about the call. The next tick re-asks.
        });
    load();
    const timer = setInterval(load, POLL_MS);
    // Backgrounding freezes JS timers, so the first thing to do on the way back
    // is re-read rather than wait out the remainder of a tick that was paused
    // minutes ago — otherwise a call the other side ended looks live until the
    // stale timer happens to fire.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [repos, callId]);

  // A call that has ended stops being the active one. Deliberately delayed:
  // the call screen needs a beat to show "Call ended" and its duration, and
  // dropping the state instantly would blank the screen out from under it.
  useEffect(() => {
    if (!callId || !call || isLive(call)) return;
    const timer = setTimeout(() => setCallId(null), 4000);
    return () => clearTimeout(timer);
  }, [callId, call]);

  // ------------------------------------------------------- answered while shut

  /**
   * Pick up a call the user answered from the system popup while the app was
   * closed.
   *
   * ⚠️ THIS IS WHAT MAKES THE GREEN BUTTON WORK. Answering used to be expressed
   * ONLY as a deep link (`/call/session/<id>?answer=1`), so picking up depended
   * on that URL surviving a cold start and routing correctly through expo-router.
   * When it didn't, the app opened on the home screen with the call still
   * ringing — IncomingCallGate drew its overlay over the top, and the press
   * looked like it had done nothing at all. The native side now records the
   * DECISION; this acts on it wherever the app happens to land, so the deep
   * link is an optimisation rather than the mechanism.
   *
   * Waits for `currentUser`: on a cold start the Supabase session is still being
   * restored, and joining as nobody would be refused. Re-checked on foreground
   * because the press can arrive at an app that was merely backgrounded.
   */
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    const claim = async () => {
      const pending = await takePendingAnswer();
      if (!pending || cancelled) return;
      enter(pending);
      try {
        setCall(await repos.calls.join(pending, currentUser.id));
      } catch {
        // Rang out, or a teammate got there first. The call screen below shows
        // whichever it was rather than guessing here.
      }
      if (!cancelled) router.push(`/call/session/${pending}`);
    };
    void claim();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void claim();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [currentUser, repos, enter]);

  // ---------------------------------------------------------------- liveness

  /**
   * Renew this device's lease for as long as it is on the call.
   *
   * ⚠️ This is the ONLY thing that tells the other side we're still here.
   * Hanging up is a message, and a device that is killed mid-call never sends
   * one — which is why the other person used to be left on a silent "On call"
   * for ever. Stop beating and the server-side sweep hangs us up on our behalf.
   *
   * It doubles as a poll: the reply carries the swept call, so a client whose
   * PEER died learns about it here as well as from the poll above.
   */
  useEffect(() => {
    if (!callId || !joined) return;
    let cancelled = false;
    const beat = () =>
      repos.calls
        .heartbeat(callId, myId)
        .then((next) => {
          if (cancelled) return;
          if (!next) {
            // We believe we're joined, but the server says there was no lease
            // to renew. Legitimately possible (the call ended a moment ago),
            // but it is ALSO what a blocked write looks like — RLS refusing the
            // update returns zero rows, not an error — and that failure is
            // otherwise invisible right up until every call hangs itself up at
            // the timeout. Say so here rather than spend an evening on it.
            if (__DEV__) {
              console.warn(
                `[call] heartbeat for ${callId} renewed nothing — call ended, or the update was refused.`,
              );
            }
            return;
          }
          setCall(next);
        })
        .catch((err: unknown) => {
          // Best effort, always. A dropped beat is what the timeout's slack is
          // for, and an error here must never reach a user mid-conversation.
          if (__DEV__) console.warn('[call] heartbeat failed:', err);
        });
    // Beat immediately as well as on the interval: the gap between joining and
    // the first tick is otherwise dead time counted against the lease.
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [repos, callId, joined, myId]);

  // ------------------------------------------------------- foreground service

  // Hold the process open for exactly as long as this user is on a call. Keyed
  // on `joined` rather than on the screen, which is the entire point: the
  // service must still be running when no call screen exists.
  useEffect(() => {
    if (!callId || !joined) return;
    const name = call?.businessName ?? 'Call';
    void startOngoingCall({
      callId,
      title: `On a call with ${name}`,
      text: 'Tap to return to the call',
    });
    return () => {
      void stopOngoingCall();
    };
    // `call.businessName` intentionally omitted: it arrives with the first poll
    // and re-running this would restart the service mid-call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, joined]);

  // ------------------------------------------------------------ audio routing

  // Ask the OS what it can offer, but only once audio is actually up —
  // getAudioOutputs needs a running audio session and answers with an empty
  // list before then. Re-asked on every connect, because a Bluetooth headset
  // that is paired now may be out of range on the next call.
  useEffect(() => {
    if (audio.status !== 'live') {
      setOutputs([]);
      return;
    }
    let cancelled = false;
    void listAudioOutputs().then((found) => {
      if (cancelled) return;
      setOutputs(found);
      // Report what the preference order in livekitNative will have picked, so
      // the button starts out telling the truth instead of guessing "speaker".
      setOutputState(
        (current) =>
          current ??
          (['bluetooth', 'headset', 'earpiece', 'speaker'] as AudioOutput[]).find((o) =>
            found.includes(o),
          ) ??
          null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [audio.status]);

  const setOutput = useCallback((next: AudioOutput) => {
    // Optimistic: the OS has no "route changed" event to wait for, and a button
    // that lags a second behind the sound reads as broken.
    setOutputState(next);
    void selectAudioOutput(next);
  }, []);

  // ---------------------------------------------------------------- actions

  // Actions read the id through a ref so a hang-up fired from the notification
  // bar can't act on a call that has since been replaced.
  const callIdRef = useRef<string | null>(null);
  callIdRef.current = callId;

  const hangUp = useCallback(async () => {
    const id = callIdRef.current;
    if (!id) return;
    try {
      setCall(await repos.calls.leave(id, myId));
    } finally {
      // Whether or not the server heard us, this user is off the call. Holding
      // the session open after a failed leave would keep the mic live.
      setCallId(null);
    }
  }, [repos, myId]);

  const join = useCallback(async () => {
    const id = callIdRef.current;
    if (!id) return;
    setCall(await repos.calls.join(id, myId));
  }, [repos, myId]);

  // Signing out has to end the call too — the audio token belongs to the user
  // who just left, and a room nobody can be identified in is a stuck mic.
  useEffect(() => {
    if (!currentUser && callId) setCallId(null);
  }, [currentUser, callId]);

  const value = useMemo<CallSession>(
    () => ({
      call,
      callId,
      live,
      me,
      joined,
      audio,
      muted,
      setMuted,
      outputs,
      output,
      setOutput,
      enter,
      hangUp,
      join,
      clear,
    }),
    [call, callId, live, me, joined, audio, muted, outputs, output, setOutput, enter, hangUp, join, clear],
  );

  return <CallSessionContext.Provider value={value}>{children}</CallSessionContext.Provider>;
}
