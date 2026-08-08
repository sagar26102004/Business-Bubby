/**
 * Native (iOS/Android) WebRTC bootstrap for LiveKit.
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

/** Expo Go ships a fixed set of native modules; react-native-webrtc isn't one. */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const EXPO_GO_MESSAGE =
  'Live audio needs a dev build — Expo Go has no WebRTC native module. ' +
  'The call still connects, but audio stays simulated.';

export async function prepareNativeAudio(): Promise<void> {
  if (isExpoGo) throw new Error(EXPO_GO_MESSAGE);
  const lk = await import('@livekit/react-native');
  lk.registerGlobals();
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
