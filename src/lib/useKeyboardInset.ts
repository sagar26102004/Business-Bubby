/**
 * How much of the screen the on-screen keyboard is covering, in dp, measured
 * from the BOTTOM of the window — i.e. exactly how far a bottom-anchored bar
 * (a chat composer) has to lift to stay visible. 0 when the keyboard is closed.
 *
 * Why not `KeyboardAvoidingView`: the old "on Android just rendering one is
 * enough" advice relies on `adjustResize` shrinking the window. Since Android
 * 15 / Expo SDK 54 the app always draws edge-to-edge, and an edge-to-edge
 * window is NOT resized for the keyboard — so the composer silently ends up
 * underneath it. The keyboard EVENT is still correct, so we do the arithmetic
 * ourselves and pad the container.
 *
 * Android reports `endCoordinates.height` as the IME inset MINUS the system
 * navigation bar, so the safe-area bottom inset is added back to get the real
 * coverage from the window edge. iOS already reports the full frame down to the
 * screen edge. On the web the browser moves the page itself, so this stays 0.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useKeyboardInset(): number {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // iOS fires "will" before the animation, so the bar rides up with the
    // keyboard; Android only has the "did" events.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [
      Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates?.height ?? 0)),
      Keyboard.addListener(hideEvent, () => setHeight(0)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  if (height <= 0) return 0;
  return Platform.OS === 'android' ? height + insets.bottom : height;
}
