/**
 * Responsive layout helper. This app is mobile-first, but on the web it also
 * runs in wide desktop browsers where a single mobile column would stretch and
 * look awkward. `useResponsive()` turns the current window width into the two
 * things screens need to adapt: how many columns a grid should show, and the
 * max width content should be centered within so it never stretches edge-to-edge.
 *
 * On native the window is always phone-sized, so this naturally returns the
 * mobile values (2 product columns, 1 card column, no visible max-width).
 */
import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';

export interface Responsive {
  width: number;
  /** Tablet-and-up. */
  isWide: boolean;
  /** Columns for the picture-first product grid (Stalls). */
  productColumns: number;
  /** Columns for the rich business-card grid (Home, Browse, Search). */
  cardColumns: number;
  /** Grid content centers within this width on large screens. */
  gridMaxWidth: number;
  /** Reading/form content centers within this narrower width. */
  readableMaxWidth: number;
  /**
   * Style that centers a block and caps its width — apply to a FlatList's
   * contentContainerStyle or a wrapper View. `null` on native / narrow screens
   * so nothing changes there.
   */
  centered: (maxWidth: number) => ViewStyle | null;
}

export function useResponsive(): Responsive {
  const { width } = useWindowDimensions();

  const productColumns =
    width >= 1500 ? 6 : width >= 1180 ? 5 : width >= 900 ? 4 : width >= 640 ? 3 : 2;
  const cardColumns = width >= 1180 ? 3 : width >= 780 ? 2 : 1;

  const centered = (maxWidth: number): ViewStyle | null =>
    Platform.OS === 'web' && width > maxWidth
      ? { width: '100%', maxWidth, alignSelf: 'center' }
      : null;

  return {
    width,
    isWide: width >= 780,
    productColumns,
    cardColumns,
    gridMaxWidth: 1800,
    readableMaxWidth: 1400,
    centered,
  };
}
