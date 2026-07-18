/**
 * Employee public profile. An employee is also a kind of service provider, so
 * this page shows who they are and every business they're publicly listed on.
 *
 * Access is gated: if the person has no account, or kept their profile private,
 * we show a respectful notice instead of their details.
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Avatar,
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Text,
} from '@/components/ui';
import { getType } from '@/domain/catalog';
import { spacing } from '@/theme/theme';

export default function EmployeeProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const repos = useRepositories();
  const router = useRouter();

  const { data, loading, error, reload } = useAsync(async () => {
    const employee = await repos.employees.getById(id);
    if (!employee) return { status: 'missing' as const };
    if (!employee.userId) return { status: 'no_account' as const, employee };

    const user = await repos.users.getById(employee.userId);
    if (!user || !user.isProfilePublic) {
      return { status: 'private' as const, employee };
    }
    const businesses = await repos.employees.listBusinessesForUser(user.id);
    return { status: 'public' as const, employee, user, businesses };
  }, [id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data || data.status === 'missing') {
    return <EmptyView title="Not found" subtitle="This profile isn't available." />;
  }

  if (data.status === 'no_account' || data.status === 'private') {
    return (
      <Screen>
        <Stack.Screen options={{ title: data.employee.displayName }} />
        <EmptyView
          title={data.employee.displayName}
          subtitle={
            data.status === 'private'
              ? 'This person has kept their profile private.'
              : 'This team member doesn’t have a public profile.'
          }
        />
      </Screen>
    );
  }

  const { employee, user, businesses } = data;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: user.name }} />

      <View style={styles.header}>
        <Avatar name={user.name} uri={user.avatarUrl} size={72} />
        <Text variant="heading" weight="bold" style={styles.name}>
          {user.name}
        </Text>
        {employee.role ? (
          <Text tone="muted" variant="subheading">
            {employee.role}
          </Text>
        ) : null}
      </View>

      {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}

      <Button
        title="💬 Message their business"
        onPress={() => router.push(`/chat/${employee.businessId}`)}
        style={styles.messageBtn}
      />

      <Text variant="subheading" weight="semibold" style={styles.sectionTitle}>
        Available through
      </Text>
      {businesses.map((b) => {
        const type = getType(b.type);
        return (
          <Card key={b.id} onPress={() => router.push(`/business/${b.id}`)} style={styles.bizCard}>
            <Text weight="semibold">{b.name}</Text>
            <Text variant="caption" tone="muted">
              {type ? `${type.icon} ${type.singular}` : b.type}
            </Text>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  name: { marginTop: spacing.sm },
  bio: { marginBottom: spacing.lg },
  messageBtn: { marginBottom: spacing.lg },
  sectionTitle: { marginBottom: spacing.md },
  bizCard: { marginBottom: spacing.sm },
});
