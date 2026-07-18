import { Link, Stack } from 'expo-router';
import { EmptyView, Screen } from '@/components/ui';
import { Text } from '@/components/ui';
import { StyleSheet } from 'react-native';
import { spacing } from '@/theme/theme';

export default function NotFound() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Not found' }} />
      <EmptyView title="This page doesn’t exist" />
      <Link href="/" style={styles.link}>
        <Text tone="brand" weight="semibold">
          Go to Browse
        </Text>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'center', marginTop: spacing.lg },
});
