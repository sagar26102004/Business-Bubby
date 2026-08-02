/**
 * Design tokens. All colors, spacing, radii, and type sizes live here so a
 * restyle touches one file. Components read colors through `useColors()`.
 *
 * TWO looks live side by side, picked by `DESIGN` below:
 *  - 'neighborhood' (current) — Nextdoor-inspired: warm paper background, one
 *    deep forest-green brand color, near-black text, soft rounded surfaces.
 *  - 'classic' — the original deep-navy + blue-accent directory look.
 *
 * To go back to the old colors, change ONE word: DESIGN = 'classic'.
 * (The full pre-redesign UI, including layouts, is the git tag
 * `design-before-nextdoor` — see the redesign notes in docs/.)
 *
 * A dark scheme is kept for later; flip `FOLLOW_SYSTEM_THEME` to re-enable it.
 */
import { useColorScheme } from 'react-native';

export type DesignName = 'neighborhood' | 'classic';

/** Which visual identity the app wears. Flip to 'classic' to revert colors. */
export const DESIGN = 'neighborhood' as DesignName;

/** When false, always use the light theme regardless of OS setting. */
const FOLLOW_SYSTEM_THEME = false;

export const palette = {
  // — Neighborhood (current): warm orange on warm paper —
  orange: '#F2681F', // brand: buttons, active states, links
  orangeDark: '#C2490F', // text weight on light backgrounds, pressed states
  orangeSoft: '#FDE7D8', // tinted chips and fills
  peachWash: '#FFE2CC', // header sheet + tab bar — orange's companion tone
  paper: '#F7F4F0', // app background (warm, not blue-gray)
  line: '#E7E2DA', // hairline borders on paper
  sand: '#F0ECE4', // secondary button / chip fill
  charcoal: '#1F1B18', // primary text
  stone: '#6E6862', // secondary text

  // — Classic (previous look) —
  navy: '#1B2A4A',
  navyDark: '#131F38',
  navySoft: '#EEF1F8',
  accent: '#2E6BE6',
  accentSoft: '#E1ECFF',
  bg: '#F6F7F9',
  neutral50: '#F1F3F6',
  neutral100: '#EBEEF2',
  neutral200: '#E4E7EC',
  ink: '#111827',
  inkMuted: '#6B7280',

  // Shared
  white: '#FFFFFF',

  // Status
  star: '#F0A500',
  success: '#16A34A',
  successDark: '#15803D', // readable green text on successSoft
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
  /** Background for the home screens' top sheet — colored, not white. */
  headerTint: string;
  star: string;
  success: string;
  successSoft: string;
  danger: string;
}

/** Nextdoor-inspired structure, warm orange identity, near-black ink. */
const neighborhood: ColorScheme = {
  background: palette.paper,
  surface: palette.white,
  surfaceAlt: palette.sand,
  border: palette.line,
  text: palette.charcoal,
  textMuted: palette.stone,
  textInverse: palette.white,
  brand: palette.orange,
  brandSoft: palette.orangeSoft,
  brandText: palette.orangeDark,
  // One brand color does the work of the old navy+blue pair, so links and
  // highlights read as the same family rather than a second identity.
  accent: palette.orange,
  accentSoft: palette.orangeSoft,
  headerTint: palette.peachWash,
  star: palette.star,
  success: palette.success,
  successSoft: palette.successSoft,
  danger: palette.danger,
};

/** The original navy/blue directory look. */
const classic: ColorScheme = {
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
  headerTint: palette.navySoft,
  star: palette.star,
  success: palette.success,
  successSoft: palette.successSoft,
  danger: palette.danger,
};

const light: ColorScheme = DESIGN === 'classic' ? classic : neighborhood;

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
  headerTint: palette.gray800,
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

/** Softer, rounder surfaces than the classic look — the neighborhood feel. */
export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
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
