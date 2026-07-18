/** A clean line-style magnifier drawn from views (no icon dependency). */
import { View } from 'react-native';
import { useColors } from '@/theme/theme';

export function SearchIcon({ size = 18, color }: { size?: number; color?: string }) {
  const colors = useColors();
  const c = color ?? colors.textMuted;
  const ring = Math.round(size * 0.66);
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: 2,
          borderColor: c,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: Math.round(size * 0.36),
          height: 2,
          borderRadius: 1,
          backgroundColor: c,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}
