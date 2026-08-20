/**
 * Native (iOS/Android) WebRTC bootstrap for LiveKit, plus audio ROUTING.
 *
 * `@livekit/react-native` pulls in the react-native-webrtc NATIVE module, which
 * only exists in a custom dev build — NOT in Expo Go and NOT on web.
 *
 * ⚠️ In Expo Go we must not even LOAD it. `@livekit/react-native-webrtc`
 * throws "WebRTC native module not found" from module scope, and a throw during
 * Metro's module evaluation is reported globally as a fatal error — it crashed
 * the app on the first call instead of being caught by the `await import`
 * below. So check the execution environment FIRST and fail with a plain,
 * catchable Error; useCallAudio turns that into the graceful `unavailable`
 * state. Metro still bundles the package (the import expression is still here),
 * it simply never evaluates it.
 *
 * Metro resolves THIS file (`.native.ts`) on iOS/Android only. On web it falls
 * back to the base `livekitNative.ts` (a no-op), so `@livekit/react-native` and
 * its native WebRTC dependency never reach the web bundle at all.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/** Where the other person's voice comes out. */
export type AudioOutput = 'earpiece' | 'speaker' | 'headset' | 'bluetooth';

/** Expo Go ships a fixed set of native modules; react-native-webrtc isn't one. */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const EXPO_GO_MESSAGE =
  'Live audio needs a dev build — Expo Go has no WebRTC native module. ' +
  'The call still connects, but audio stays simulated.';

/**
 * Route preference, HIGHEST first — and note where `speaker` sits.
 *
 * ⚠️ This list is the whole reason the setting exists. LiveKit's own default
 * order is bluetooth → headset → **speaker** → earpiece, so with nothing
 * plugged in every call came out of the loudspeaker: you had to hold the phone
 * away from your face, and the whole room heard the other side. A phone call
 * belongs at the ear unless the user says otherwise, so earpiece outranks
 * speaker here. Headsets still win, because plugging one in IS the user saying
 * otherwise.
 *
 * Ignored entirely once `selectAudioOutput` is called — a manual pick is
 * absolute, which is exactly what the in-call route button relies on.
 */
const PREFERRED_OUTPUTS: AudioOutput[] = ['bluetooth', 'headset', 'earpiece', 'speaker'];

/**
 * iOS exposes no real device list — only "route it normally" or "force the
 * loudspeaker" — so the two outputs we can honestly offer there map onto those.
 */
const IOS_OUTPUT_IDS: Partial<Record<AudioOutput, string>> = {
  earpiece: 'default',
  speaker: 'force_speaker',
};

export async function prepareNativeAudio(): Promise<void> {
  if (isExpoGo) throw new Error(EXPO_GO_MESSAGE);
  const lk = await import('@livekit/react-native');
  lk.registerGlobals();
  // MUST happen before the room connects — configureAudio is documented as
  // having no effect once a session is running, and starting the session below
  // is what locks the routing in.
  await lk.AudioSession.configureAudio({
    android: {
      preferredOutputList: PREFERRED_OUTPUTS,
      audioTypeOptions: lk.AndroidAudioTypePresets.communication,
    },
    ios: { defaultOutput: 'earpiece' },
  });
  await lk.AudioSession.startAudioSession();
}

export async function stopNativeAudio(): Promise<void> {
  // Same guard: loading the module to "stop" a session that never started is
  // what would crash the app on teardown.
  if (isExpoGo) return;
  try {
    const lk = await import('@livekit/react-native');
    await lk.AudioSession.stopAudioSession();
  } catch {
    /* nothing to stop if it never started */
  }
}

/**
 * Which outputs this phone can actually use RIGHT NOW — a live answer, not a
 * fixed list: "bluetooth" appears when a headset is paired and disappears when
 * it walks out of range, so the in-call route button must re-ask rather than
 * cache. Empty when audio isn't running, which is the signal to hide the button
 * rather than show one that does nothing.
 */
export async function listAudioOutputs(): Promise<AudioOutput[]> {
  if (isExpoGo) return [];
  try {
    const lk = await import('@livekit/react-native');
    if (Platform.OS === 'ios') return ['earpiece', 'speaker'];
    const raw = await lk.AudioSession.getAudioOutputs();
    return raw.filter((id): id is AudioOutput =>
      PREFERRED_OUTPUTS.includes(id as AudioOutput),
    );
  } catch {
    return [];
  }
}

/** Move the call's audio to `output`. Overrides the preference order for good. */
export async function selectAudioOutput(output: AudioOutput): Promise<void> {
  if (isExpoGo) return;
  try {
    const lk = await import('@livekit/react-native');
    const id = Platform.OS === 'ios' ? IOS_OUTPUT_IDS[output] : output;
    if (!id) return;
    await lk.AudioSession.selectAudioOutput(id);
  } catch {
    /* the route vanished between listing and picking — the OS keeps the old one */
  }
}
