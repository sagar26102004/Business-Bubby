/** Standard loading / error / empty states so screens don't reinvent them. */
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { spacing, useColors } from '@/theme/theme';
import { Text } from './Text';
import { Button } from './Button';

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.brand} />
      <Text tone="muted" style={styles.gap}>
        {label}
      </Text>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text variant="subheading" weight="semibold">
        Something went wrong
      </Text>
      <Text tone="muted" style={styles.gap}>
        {message ?? 'Please try again.'}
      </Text>
      {onRetry ? <Button title="Retry" variant="secondary" onPress={onRetry} style={styles.retry} /> : null}
    </View>
  );
}

export function EmptyView({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.center}>
      <Text variant="subheading" weight="semibold">
        {title}
      </Text>
      {subtitle ? (
        <Text tone="muted" style={[styles.gap, styles.centerText]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    minHeight: 200,
  },
  gap: { marginTop: spacing.sm },
  centerText: { textAlign: 'center' },
  retry: { marginTop: spacing.lg, alignSelf: 'stretch' },
});
