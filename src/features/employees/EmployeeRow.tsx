/**
 * A single employee listed under a business.
 *
 * Tappable only when the employee has an app account — otherwise it's a plain,
 * non-interactive row (a name the owner typed in, with no profile behind it).
 */
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Employee } from '@/domain/types';
import { Avatar, Card, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export interface EmployeeRowProps {
  employee: Employee;
}

export function EmployeeRow({ employee }: EmployeeRowProps) {
  const router = useRouter();
  const tappable = !!employee.userId;

  return (
    <Card
      onPress={tappable ? () => router.push(`/employee/${employee.id}`) : undefined}
      style={styles.card}
    >
      <View style={styles.row}>
        <Avatar name={employee.displayName} size={40} />
        <View style={styles.info}>
          <Text weight="semibold">{employee.displayName}</Text>
          {employee.role ? (
            <Text variant="caption" tone="muted">
              {employee.role}
            </Text>
          ) : null}
        </View>
        {tappable ? (
          <Text tone="brand" variant="label" weight="medium">
            View →
          </Text>
        ) : employee.userId ? (
          <Text variant="caption" tone="muted">
            Private
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
});
