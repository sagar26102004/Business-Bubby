/**
 * Native (iOS/Android) WebRTC bootstrap for LiveKit.
 *
 * `@livekit/react-native` pulls in the react-native-webrtc NATIVE module, which
 * only exists in a custom dev build — NOT in Expo Go and NOT on web. So we load
 * it lazily (dynamic import) and let it throw when the module is absent; the
 * caller (useCallAudio) catches that and falls back to the demo state.
 *
 * Metro resolves THIS file (`.native.ts`) on iOS/Android only. On web it falls
 * back to the base `livekitNative.ts` (a no-op), so `@livekit/react-native` and
 * its native WebRTC dependency never reach the web bundle at all.
 */
export async function prepareNativeAudio(): Promise<void> {
  const lk = await import('@livekit/react-native');
  lk.registerGlobals();
  await lk.AudioSession.startAudioSession();
}

export async function stopNativeAudio(): Promise<void> {
  try {
    const lk = await import('@livekit/react-native');
    await lk.AudioSession.stopAudioSession();
  } catch {
    /* nothing to stop if it never started */
  }
}
