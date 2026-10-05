/**
 * The rounded sage square that fronts cards across the redesign — a building
 * block's icon, a workspace tool, a listing without a photo. Takes a line icon
 * or an emoji; `solid` flips it to a sage fill with a white glyph (the
 * "selected / active" look).
 */
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { radius, useColors } from '@/theme/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface IconTileProps {
  icon?: IconName;
  emoji?: string;
  size?: number;
  solid?: boolean;
  tone?: 'brand' | 'cta';
  style?: ViewStyle;
}

export function IconTile({ icon, emoji, size = 44, solid, tone = 'brand', style }: IconTileProps) {
  const colors = useColors();
  const fill = tone === 'cta' ? colors.cta : colors.brand;
  const soft = tone === 'cta' ? colors.ctaSoft : colors.brandSoft;
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size >= 56 ? radius.md : radius.sm + 2,
          backgroundColor: solid ? fill : soft,
        },
        style,
      ]}
    >
      {icon ? (
        <Icon name={icon} size={Math.round(size * 0.5)} color={solid ? colors.textInverse : fill} />
      ) : (
        <Text style={{ fontSize: Math.round(size * 0.5), lineHeight: Math.round(size * 0.62) }}>
          {emoji ?? '🏪'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
