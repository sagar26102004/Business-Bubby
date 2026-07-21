/**
 * Workspace › Billing — bill a customer by hand and see every bill issued.
 * Accepted orders bill automatically; this is the manual desk. Members only.
 */
import { StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { canScanFor } from '@/features/fulfillment/fulfillment';
import { canAccessService } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function WorkspaceBillingScreen() {
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
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = currentUser?.id === business.ownerId || !!meEmployee;
    const canScan = canScanFor(business, currentUser?.id, meEmployee);
    const canAccess = canAccessService(business, meEmployee, currentUser?.id, 'billing');
    return { business, isMember, canAccess, canScan, bills };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, isMember, canAccess, canScan, bills } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Billing' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }
  if (!canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Billing' }} />
        <EmptyView title="No access" subtitle="Ask the owner to grant you Billing in Access & permissions." />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Billing' }} />


      {canScan ? (
        <Button
          title="📷 Scan order QR"
          onPress={() => router.push('/scan')}
          style={styles.scanBtn}
        />
      ) : null}
      <Button title="🧾 Bill a customer" onPress={() => router.push(`/bill/new/${business.id}`)} />
      <Button
        title={`📄 Bills issued${bills.length ? ` · ${bills.length}` : ''}`}
        variant="secondary"
        onPress={() => router.push(`/bills/${business.id}`)}
        style={styles.billsBtn}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  scanBtn: { marginBottom: spacing.md },
  billsBtn: { marginTop: spacing.md },
});
