/** Circular avatar. Shows the image if present, otherwise initials. */
import { Image, StyleSheet, View } from 'react-native';
import { useColors } from '@/theme/theme';
import { Text } from './Text';

export interface AvatarProps {
  name: string;
  uri?: string;
  size?: number;
}

export function Avatar({ name, uri, size = 44 }: AvatarProps) {
  const colors = useColors();
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const dimension = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} style={[dimension, styles.image]} />;
  }

  return (
    <View style={[dimension, styles.fallback, { backgroundColor: colors.brandSoft }]}>
      <Text weight="semibold" tone="brand" style={{ fontSize: size * 0.36 }}>
        {initials || '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { resizeMode: 'cover' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
