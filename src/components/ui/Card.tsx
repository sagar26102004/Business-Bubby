/** A surface container with border + rounded corners. Optionally pressable. */
import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export function Card({ children, onPress, style, padded = true }: CardProps) {
  const colors = useColors();
  // A full 1px warm border (not hairline) on the paper background: the card
  // edge should be visible enough to read as a distinct surface, the way it
  // does in the reference design, without resorting to drop shadows.
  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: padded ? spacing.lg : 0,
    overflow: 'hidden',
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [base, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
});
