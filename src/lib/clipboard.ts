/**
 * Copy text to the clipboard. Returns whether it worked.
 *
 * `expo-clipboard` is loaded lazily and inside a try: the app ships OTA
 * updates, and a Play build made before this module was added has no native
 * `ExpoClipboard` — a top-level import would crash that build on launch.
 * On the web the browser's own clipboard is used.
 */
import { Platform } from 'react-native';

export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } })
      .navigator;
    try {
      await nav?.clipboard?.writeText(text);
      return !!nav?.clipboard;
    } catch {
      return false;
    }
  }
  try {
    const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
