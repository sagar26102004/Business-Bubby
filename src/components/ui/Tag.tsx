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

  const active = selected || tone === 'brand';
  const containerStyle: ViewStyle = {
    backgroundColor: active ? colors.brandSoft : colors.surfaceAlt,
    borderColor: active ? colors.brand : colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  };

  const content = (
    <Text variant="caption" weight="medium" tone={active ? 'brand' : 'default'}>
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
});
