/**
 * The pinned footer of a flow screen: an optional ghost "← Back" on the left
 * and the primary pill filling the rest. Sits on the linen header tint with a
 * hairline above, and pads itself for the home indicator.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/lib/useResponsive';
import { spacing, useColors } from '@/theme/theme';
import { Button, type ButtonProps } from './Button';

export interface BottomActionBarProps {
  primary: ButtonProps;
  backLabel?: string;
  onBack?: () => void;
  /** Extra content above the buttons (an error line, a total). */
  children?: ReactNode;
}

export function BottomActionBar({ primary, backLabel = 'Back', onBack, children }: BottomActionBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { centered, readableMaxWidth } = useResponsive();
  return (
    <View
      style={{
        backgroundColor: colors.headerTint,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingBottom: insets.bottom + spacing.md,
        paddingTop: spacing.md,
        paddingHorizontal: spacing.lg,
      }}
    >
      <View style={[styles.inner, centered(readableMaxWidth)]}>
        {children}
        <View style={styles.row}>
          {onBack ? (
            <Button title={`← ${backLabel}`} variant="outline" onPress={onBack} style={styles.back} />
          ) : null}
          <Button {...primary} style={[styles.primary, primary.style]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { width: '100%', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  back: { paddingHorizontal: spacing.lg },
  primary: { flex: 1 },
});
