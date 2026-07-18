/**
 * Design tokens. All colors, spacing, radii, and type sizes live here so a
 * restyle touches one file. Components read colors through `useColors()`.
 *
 * Look & feel: light background, deep-navy primary actions, blue accents, and
 * a gold rating star — matching the reference directory design. A dark scheme
 * is kept for later; flip `FOLLOW_SYSTEM_THEME` to re-enable auto switching.
 */
import { useColorScheme } from 'react-native';

/** When false, always use the light theme regardless of OS setting. */
const FOLLOW_SYSTEM_THEME = false;

export const palette = {
  // Navy primary (buttons, selected pills, headers)
  navy: '#1B2A4A',
  navyDark: '#131F38',
  navySoft: '#EEF1F8',

  // Blue accent (links, highlights, hero)
  accent: '#2E6BE6',
  accentSoft: '#E1ECFF',

  // Light neutrals
  white: '#FFFFFF',
  bg: '#F6F7F9',
  neutral50: '#F1F3F6',
  neutral100: '#EBEEF2',
  neutral200: '#E4E7EC',
  ink: '#111827', // primary text
  inkMuted: '#6B7280', // secondary text

  // Status
  star: '#F59E0B',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#D97706',
  danger: '#DC2626',

  // Dark scheme neutrals (kept for later)
  black: '#0B1220',
  gray400: '#94A3B8',
  gray800: '#1E293B',
  gray900: '#0F172A',
} as const;

export interface ColorScheme {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textInverse: string;
  /** Primary action color (navy). */
  brand: string;
  /** Soft primary tint for chips/fills. */
  brandSoft: string;
  /** Primary color used for text on light backgrounds. */
  brandText: string;
  /** Blue accent for links and highlights. */
  accent: string;
  accentSoft: string;
  star: string;
  success: string;
  successSoft: string;
  danger: string;
}

const light: ColorScheme = {
  background: palette.bg,
  surface: palette.white,
  surfaceAlt: palette.neutral50,
  border: palette.neutral200,
  text: palette.ink,
  textMuted: palette.inkMuted,
  textInverse: palette.white,
  brand: palette.navy,
  brandSoft: palette.navySoft,
  brandText: palette.navy,
  accent: palette.accent,
  accentSoft: palette.accentSoft,
  star: palette.star,
  success: palette.success,
  successSoft: palette.successSoft,
  danger: palette.danger,
};

const dark: ColorScheme = {
  background: palette.black,
  surface: palette.gray900,
  surfaceAlt: palette.gray800,
  border: palette.gray800,
  text: '#F1F5F9',
  textMuted: palette.gray400,
  textInverse: palette.gray900,
  brand: '#60A5FA',
  brandSoft: '#1E3A8A',
  brandText: '#BFDBFE',
  accent: '#60A5FA',
  accentSoft: '#1E3A8A',
  star: palette.star,
  success: '#4ADE80',
  successSoft: '#14532D',
  danger: '#F87171',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
} as const;

/**
 * Returns the active color scheme. Locked to light unless
 * `FOLLOW_SYSTEM_THEME` is enabled.
 */
export function useColors(): ColorScheme {
  const systemScheme = useColorScheme();
  if (FOLLOW_SYSTEM_THEME && systemScheme === 'dark') return dark;
  return light;
}
