/**
 * Screen wrapper: themed background + safe-area padding. Use `scroll` for
 * scrollable content. Keeps every screen visually consistent.
 *
 * On the web, content is centered within a readable max-width (instead of
 * stretching across a wide desktop browser). The themed background still fills
 * the whole viewport; only the content column is capped. On native this is a
 * no-op — the window is phone-sized, so nothing changes.
 */
import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/lib/useResponsive';
import { spacing, useColors } from '@/theme/theme';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  contentStyle?: ViewStyle;
  /** Override the centered content width (defaults to the readable width). */
  maxWidth?: number;
}

export function Screen({ children, scroll, padded = true, contentStyle, maxWidth }: ScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { centered, readableMaxWidth } = useResponsive();

  const padding: ViewStyle = padded
    ? { paddingHorizontal: spacing.lg, paddingTop: spacing.lg }
    : {};
  const bottomPad = { paddingBottom: insets.bottom + spacing.xl };
  const center = centered(maxWidth ?? readableMaxWidth);

  if (scroll) {
    return (
      <ScrollView
        style={[styles.flex, { backgroundColor: colors.background }]}
        contentContainerStyle={[padding, bottomPad, center, contentStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.flex, padding, center, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
