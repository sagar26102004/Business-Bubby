/**
 * A single employee listed under a business.
 *
 * Tappable only when the employee has an app account *and* has made their
 * profile public — otherwise it's a plain, non-interactive row (a name the
 * owner added, or a registered user who kept their profile private).
 */
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Employee } from '@/domain/types';
import { Avatar, Card, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export interface EmployeeRowProps {
  employee: Employee;
  /** Whether the linked user account exists and is public. */
  isPublic: boolean;
}

export function EmployeeRow({ employee, isPublic }: EmployeeRowProps) {
  const router = useRouter();
  const tappable = isPublic && !!employee.userId;

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
