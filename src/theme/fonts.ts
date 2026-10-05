/**
 * The app typeface — Plus Jakarta Sans (the "One Place" redesign, 2026-10).
 *
 * Each weight is its OWN family on native: Android does not synthesize a bold
 * from a regular custom font, it silently falls back to the system font. So
 * text picks a family by weight via `fontFor()` and never sets `fontWeight`
 * alongside it once the fonts are in.
 *
 * Loading is best-effort: if the font files fail to load, `fontsReady` stays
 * false and `fontFor()` returns plain `fontWeight` styles on the system font,
 * so text never renders invisible or blank.
 */
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useEffect, useState } from 'react';
import type { TextStyle } from 'react-native';

/** Never hold the first paint longer than this for a font that won't load. */
const FONT_MAX_WAIT_MS = 3000;

export type FontWeight = 'regular' | 'medium' | 'semibold' | 'bold';

const FAMILY: Record<FontWeight, string> = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
};

const WEIGHT: Record<FontWeight, TextStyle['fontWeight']> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

let fontsReady = false;

/** The style that renders `weight` — the brand family, or a system fallback. */
export function fontFor(weight: FontWeight): TextStyle {
  return fontsReady ? { fontFamily: FAMILY[weight] } : { fontWeight: WEIGHT[weight] };
}

/**
 * Loads the typeface. Returns true once loading has SETTLED (loaded or failed),
 * which is when the app may render — before that, text would flash in the
 * system font and then jump.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), FONT_MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  fontsReady = loaded && !error;
  return loaded || !!error || timedOut;
}
