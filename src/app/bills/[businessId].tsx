/**
 * Bills issued by a business (members only) — every bill, whether it came
 * from an accepted order or was written by hand. Tap one to view/share it.
 */
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Bill } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { billRef } from '@/features/billing/billText';
import { formatMoney } from '@/lib/money';
import { spacing } from '@/theme/theme';

export default function BillsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, bills] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.bills.listForBusiness(business.id),
    ]);
    const isMember =
      currentUser?.id === business.ownerId ||
      employees.some((e) => e.userId && e.userId === currentUser?.id);
    return { business, bills, isMember };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, bills, isMember } = data;

  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Bills' }} />
        <EmptyView title="Members only" subtitle="Only this business's team can see its bills." />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Bills' }} />

      <Text variant="title" weight="bold">
        Bills · {business.name}
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        Every bill your team issued — from accepted orders and by hand.
      </Text>

      {bills.length === 0 ? (
        <EmptyView
          title="No bills yet"
          subtitle="Bill a customer directly, or accept an order to issue one automatically."
        />
      ) : (
        bills.map((bill: Bill) => (
          <Card key={bill.id} onPress={() => router.push(`/bill/${bill.id}`)} style={styles.card}>
            <View style={styles.topRow}>
              <Text weight="semibold" style={styles.flex}>
                🧾 {bill.customerName}
              </Text>
              <Text weight="bold" tone="brand">
                {formatMoney(bill.total)}
              </Text>
            </View>
            <Text variant="caption" tone="muted">
              {billRef(bill)} · {new Date(bill.createdAt).toLocaleString()} · by {bill.issuedByName}
              {bill.orderId ? ' · from an order' : ''}
            </Text>
          </Card>
        ))
      )}

      <Button title="🧾 New bill" onPress={() => router.push(`/bill/new/${business.id}`)} style={styles.newBtn} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  newBtn: { marginTop: spacing.md },
});
