/**
 * Base / web build: browsers ship WebRTC natively, so there's no native module
 * to load and no audio session to manage. These are no-ops; on web `livekit-client`
 * connects straight through the browser's WebRTC stack.
 *
 * This base file is what Metro bundles on **web** (and any non-native target).
 * The real native bootstrap lives in `livekitNative.native.ts`, which Metro
 * prefers on iOS/Android — so `@livekit/react-native` (and its native WebRTC
 * dependency) is NEVER referenced from the web bundle.
 */
export async function prepareNativeAudio(): Promise<void> {}
export async function stopNativeAudio(): Promise<void> {}
