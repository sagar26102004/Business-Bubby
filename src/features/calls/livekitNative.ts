/**
 * Base / web build: browsers ship WebRTC natively, so there's no native module
 * to load and no audio session to manage. These are no-ops; on web `livekit-client`
 * connects straight through the browser's WebRTC stack.
 *
 * Audio ROUTING is a phone concept: a browser plays through whatever output the
 * OS has selected and gives the page no say in it, so `listAudioOutputs` returns
 * nothing here and the in-call route button hides itself.
 *
 * This base file is what Metro bundles on **web** (and any non-native target).
 * The real native bootstrap lives in `livekitNative.native.ts`, which Metro
 * prefers on iOS/Android — so `@livekit/react-native` (and its native WebRTC
 * dependency) is NEVER referenced from the web bundle.
 */

/** Where the other person's voice comes out. */
export type AudioOutput = 'earpiece' | 'speaker' | 'headset' | 'bluetooth';

export async function prepareNativeAudio(): Promise<void> {}
export async function stopNativeAudio(): Promise<void> {}
export async function listAudioOutputs(): Promise<AudioOutput[]> {
  return [];
}
export async function selectAudioOutput(_output: AudioOutput): Promise<void> {}
