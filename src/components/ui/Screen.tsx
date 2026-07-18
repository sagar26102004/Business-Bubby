/**
 * Screen wrapper: themed background + safe-area padding. Use `scroll` for
 * scrollable content. Keeps every screen visually consistent.
 */
import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, useColors } from '@/theme/theme';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  contentStyle?: ViewStyle;
}

export function Screen({ children, scroll, padded = true, contentStyle }: ScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const padding: ViewStyle = padded
    ? { paddingHorizontal: spacing.lg, paddingTop: spacing.lg }
    : {};
  const bottomPad = { paddingBottom: insets.bottom + spacing.xl };

  if (scroll) {
    return (
      <ScrollView
        style={[styles.flex, { backgroundColor: colors.background }]}
        contentContainerStyle={[padding, bottomPad, contentStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }, padding, contentStyle]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
