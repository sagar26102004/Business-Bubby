/** Gold star rating with an optional numeric value and review count. */
import { StyleSheet, View } from 'react-native';
import { useColors } from '@/theme/theme';
import { Text } from './Text';

export interface StarsProps {
  rating?: number;
  count?: number;
  size?: number;
}

export function Stars({ rating, count, size = 13 }: StarsProps) {
  const colors = useColors();
  if (typeof rating !== 'number') return null;

  const rounded = Math.round(rating);
  const stars = Array.from({ length: 5 }, (_, i) => (i < rounded ? '★' : '☆'));

  return (
    <View style={styles.row}>
      <Text style={{ color: colors.star, fontSize: size, letterSpacing: 1 }}>
        {stars.join('')}
      </Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  value: { marginLeft: 2 },
});
