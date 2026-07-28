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
        if (Platform.OS !== 'web') await prepareNativeAudio();

        const { Room: RoomCtor, RoomEvent, Track } = await import('livekit-client');
        const { token, url } = await repos.calls.getAudioToken(callId);
        if (cancelled) return;

        const room = new RoomCtor();
        // Play remote audio: on web attach() creates an <audio> element and
        // starts playback; on native react-native-webrtc routes it through the
        // active audio session automatically.
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) track.attach();
        });

        await room.connect(url, token);
        if (cancelled) {
          await room.disconnect();
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(!muted);
        roomRef.current = room;
        setStatus('live');
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        // A missing native module (Expo Go) or an unconfigured server isn't
        // something the user can fix mid-call — show the graceful demo state.
        const soft =
          /not configured|needs the|not available|rtcpeerconnection|native|expo go|cannot find/i.test(
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
