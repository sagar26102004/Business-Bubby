/** Small pill label, used for categories, listing kinds, and status chips. */
import { Pressable, StyleSheet, ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme/theme';
import { Text } from './Text';

export interface TagProps {
  label: string;
  icon?: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'default' | 'brand';
  style?: ViewStyle;
}

export function Tag({ label, icon, selected, onPress, tone = 'default', style }: TagProps) {
  const colors = useColors();

  // Selected chips go solid brand rather than tinted — filter state should be
  // unmistakable at a glance, and it gives the green somewhere to land.
  const active = selected || tone === 'brand';
  const containerStyle: ViewStyle = {
    backgroundColor: active ? colors.brand : colors.surface,
    borderColor: active ? colors.brand : colors.border,
    borderWidth: 1,
  };

  const content = (
    <Text variant="caption" weight={active ? 'bold' : 'medium'} tone={active ? 'inverse' : 'muted'}>
      {icon ? `${icon} ` : ''}
      {label}
    </Text>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.pill, containerStyle, pressed && styles.pressed, style]}
      >
        {content}
      </Pressable>
    );
  }
  return <Pressable disabled style={[styles.pill, containerStyle, style]}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.xs + 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
});
