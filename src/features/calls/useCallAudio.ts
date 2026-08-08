/**
 * useCallAudio — the REAL voice layer that rides on top of the call's signaling.
 *
 * When `active` (the local user is joined and the call is live) it fetches a
 * LiveKit token from the backend, connects to the room `call_<callId>`, publishes
 * the microphone, and plays everyone else's audio. `muted` toggles the real mic.
 * Disconnects cleanly when the user leaves or the call ends.
 *
 * Degrades gracefully: in Expo Go (no native WebRTC) or when LiveKit isn't
 * configured yet, it reports `unavailable` and the screen shows the demo note
 * instead of crashing.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { RemoteTrack, Room } from 'livekit-client';
import { useRepositories } from '@/data/DataProvider';
import { prepareNativeAudio, stopNativeAudio } from './livekitNative';

export type CallAudioStatus = 'off' | 'connecting' | 'live' | 'unavailable' | 'error';

/** Audio state plus, on 'error'/'unavailable', the real reason to show the user. */
export interface CallAudioState {
  status: CallAudioStatus;
  message?: string;
}

const TOKEN_RETRIES = 4; // total attempts
const TOKEN_RETRY_BASE_MS = 700;

/**
 * Fetch the LiveKit token, retrying a transient failure (e.g. the token edge
 * function cold-starting) with a linear backoff. Bails immediately if the call
 * was torn down (`isCancelled`) and re-throws the last error once attempts run
 * out, so a genuine/permanent failure still surfaces to the user.
 */
async function getTokenWithRetry(
  fetchToken: () => Promise<{ token: string; url: string }>,
  isCancelled: () => boolean,
): Promise<{ token: string; url: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < TOKEN_RETRIES; attempt++) {
    if (isCancelled()) throw new Error('cancelled');
    try {
      return await fetchToken();
    } catch (err) {
      lastErr = err;
      if (attempt < TOKEN_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, TOKEN_RETRY_BASE_MS * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function useCallAudio(callId: string, active: boolean, muted: boolean): CallAudioState {
  const repos = useRepositories();
  const [state, setState] = useState<CallAudioState>({ status: 'off' });
  const setStatus = (status: CallAudioStatus, message?: string) => setState({ status, message });
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!active) {
      setStatus('off');
      return;
    }
    let cancelled = false;
    setStatus('connecting');

    (async () => {
      try {
        // Native needs the WebRTC globals + audio session first; web is a no-op.
        if (Platform.OS !== 'web') {
          await prepareNativeAudio();
          // Belt and braces. `livekit-client` below is the WEB SDK: on React
          // Native it only works because registerGlobals() installs WebRTC and
          // DOM shims. If that didn't happen — Expo Go, a build without the
          // native module, or an environment probe that guessed wrong — the
          // import dies deep inside the SDK with "Property 'document' doesn't
          // exist", which reads to the user like a broken call rather than a
          // missing native module. Assert the globals are really there instead
          // of trusting prepareNativeAudio to have thrown.
          if (typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection === 'undefined') {
            throw new Error(
              'Live audio needs a dev build — this app has no WebRTC native module. ' +
                'The call still connects, but audio stays simulated.',
            );
          }
        }

        const { Room: RoomCtor, RoomEvent, Track } = await import('livekit-client');
        // The token comes from an edge function that imports the LiveKit +
        // Supabase SDKs, so its FIRST invocation can COLD-START and transiently
        // return a non-2xx. The caller is almost always that first hit (they
        // request the token the instant the call starts), while the answerer
        // arrives seconds later on a warm function — which is exactly why the
        // caller would fail while the answerer connected. Retry a few times with
        // a short backoff so a cold start (or a brief network blip) recovers
        // instead of dropping the caller's audio.
        const { token, url } = await getTokenWithRetry(
          () => repos.calls.getAudioToken(callId),
          () => cancelled,
        );
        if (cancelled) return;

        const room = new RoomCtor();
        // Play remote audio. On WEB ONLY: attach() creates an <audio> element
        // (livekit-client does `document.createElement`) and starts playback.
        //
        // ⚠️ Never call attach() on native. There is no DOM, so it throws
        // "Property 'document' doesn't exist" — and because the remote track is
        // subscribed while `room.connect()` is still settling (the other party
        // is already in the room publishing), that throw surfaced as a failed
        // CONNECTION: the phone answered the call and then reported "Couldn't
        // connect the audio". react-native-webrtc already routes subscribed
        // audio through the active audio session, so attaching is both
        // impossible and unnecessary here.
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (Platform.OS === 'web' && track.kind === Track.Kind.Audio) track.attach();
        });

        await room.connect(url, token);
        if (cancelled) {
          await room.disconnect();
          return;
        }
        roomRef.current = room;
        // Connected means you can HEAR the other side — report it now.
        // Publishing the microphone is a SEPARATE step that can stall
        // indefinitely (a browser sitting on its mic-permission prompt is the
        // usual cause), and awaiting it here pinned the UI at "Connecting
        // audio…" while the call timer was already counting and the room was
        // plainly connected. A mic that fails is worth saying out loud, but it
        // must not masquerade as a dead call.
        setStatus('live');
        try {
          await room.localParticipant.setMicrophoneEnabled(!muted);
        } catch (micErr) {
          if (cancelled) return;
          const micMsg = micErr instanceof Error ? micErr.message : String(micErr);
          setState({
            status: 'live',
            message: `They can be heard, but your microphone isn’t on — ${micMsg}`,
          });
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        // A missing native module (Expo Go) or an unconfigured server isn't
        // something the user can fix mid-call — show the graceful demo state.
        // `document`/`window` land here when livekit-client (a web SDK) runs on
        // React Native without the registerGlobals() shims — a missing dev
        // build, not a fault the user can act on mid-call.
        const soft =
          /not configured|needs the|not available|rtcpeerconnection|native|expo go|cannot find|\bdocument\b|\bwindow\b/i.test(
            msg,
          );
        setStatus(soft ? 'unavailable' : 'error', msg);
      }
    })();

    return () => {
      cancelled = true;
      const room = roomRef.current;
      roomRef.current = null;
      room?.disconnect().catch(() => {});
      if (Platform.OS !== 'web') void stopNativeAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, callId, repos]);

  // Reflect the mute toggle onto the real microphone without reconnecting.
  useEffect(() => {
    roomRef.current?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
  }, [muted]);

  return state;
}
