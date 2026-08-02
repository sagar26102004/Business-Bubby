/** Gold star rating with an optional numeric value and review count. */
import { StyleSheet, View } from 'react-native';
import { useColors } from '@/theme/theme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface StarsProps {
  rating?: number;
  count?: number;
  size?: number;
}

export function Stars({ rating, count, size = 14 }: StarsProps) {
  const colors = useColors();
  if (typeof rating !== 'number') return null;

  const rounded = Math.round(rating);

  return (
    <View style={styles.row}>
      {/* Drawn stars rather than ★/☆ glyphs, which render at different weights
          and baselines on every platform. */}
      <View style={styles.stars}>
        {Array.from({ length: 5 }, (_, i) => (
          <Icon
            key={i}
            name="star"
            size={size}
            color={i < rounded ? colors.star : colors.border}
            filled
          />
        ))}
      </View>
      <Text variant="caption" weight="semibold" style={styles.value}>
        {rating.toFixed(1)}
      </Text>
      {typeof count === 'number' ? (
        <Text variant="caption" tone="muted">
          ({count})
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stars: { flexDirection: 'row', gap: 1 },
  value: { marginLeft: 1 },
});
