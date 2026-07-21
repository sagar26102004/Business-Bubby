/**
 * Fleet & tracking › Tracked for customers (owner only).
 *
 * Register what each customer follows — a child on the school run, goods in
 * transit — pick the customer, and put it on a vehicle. That customer then
 * gets a "Track" button on the business page.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { TrackedItem, TrackedItemKind, User } from '@/domain/types';
import { getVehicleKind } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  Input,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function FleetItemsScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [vehicles, items] = await Promise.all([
      repos.tracking.listVehicles(business.id),
      repos.tracking.listItems(business.id),
    ]);
    return { business, vehicles, items };
  }, [businessId]);

  const [itemKind, setItemKind] = useState<TrackedItemKind>('child');
  const [itemLabel, setItemLabel] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<User[]>([]);
  const [customer, setCustomer] = useState<User | undefined>();
  const [itemVehicleId, setItemVehicleId] = useState<string | undefined>();
  const [working, setWorking] = useState(false);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, vehicles, items } = data;

  if (currentUser?.id !== business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Tracked items' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage tracking." />
      </Screen>
    );
  }

  const searchCustomers = async (term: string) => {
    setCustomerQuery(term);
    setCustomerResults(term.trim().length >= 2 ? await repos.users.search(term) : []);
  };

  const addItem = async () => {
    if (itemLabel.trim().length < 2 || !customer) return;
    setWorking(true);
    try {
      await repos.tracking.addItem({
        businessId: business.id,
        kind: itemKind,
        label: itemLabel,
        customerId: customer.id,
        customerName: customer.name,
        vehicleId: itemVehicleId,
      });
      setItemLabel('');
      setCustomer(undefined);
      setCustomerQuery('');
      setCustomerResults([]);
      setItemVehicleId(undefined);
      reload();
    } finally {
      setWorking(false);
    }
  };

  const setItemVehicle = async (item: TrackedItem, vehicleId: string) => {
    await repos.tracking.updateItem(item.id, {
      vehicleId: item.vehicleId === vehicleId ? undefined : vehicleId,
    });
    reload();
  };

  const removeItem = async (item: TrackedItem) => {
    await repos.tracking.removeItem(item.id);
    reload();
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Tracked items' }} />

      {vehicles.length === 0 ? (
        <Card style={styles.card}>
          <Text variant="caption" tone="muted">
            Add a vehicle first — a tracked item rides on one so the customer can watch it move.
          </Text>
        </Card>
      ) : null}

      {items.map((item) => (
        <Card key={item.id} style={styles.card}>
          <Text weight="semibold">
            {item.kind === 'child' ? '🧒' : '📦'} {item.label}
          </Text>
          <Text variant="caption" tone="muted">
            Tracked by {item.customerName}
          </Text>
          {vehicles.length > 0 ? (
            <View style={styles.pillRow}>
              {vehicles.map((v) => (
                <Tag
                  key={v.id}
                  label={v.name}
                  icon={getVehicleKind(v.kind).icon}
                  selected={item.vehicleId === v.id}
                  onPress={() => setItemVehicle(item, v.id)}
                />
              ))}
            </View>
          ) : null}
          <Button title="Remove" variant="ghost" onPress={() => removeItem(item)} />
        </Card>
      ))}

      <Card style={styles.card}>
        <Text weight="semibold" style={styles.formTitle}>
          ➕ Add a child / goods to track
        </Text>
        <View style={styles.pillRow}>
          <Tag label="Child" icon="🧒" selected={itemKind === 'child'} onPress={() => setItemKind('child')} />
          <Tag label="Goods" icon="📦" selected={itemKind === 'goods'} onPress={() => setItemKind('goods')} />
        </View>
        <Input
          label={itemKind === 'child' ? 'Child' : 'Goods'}
          placeholder={itemKind === 'child' ? 'e.g. Aarav — Grade 3' : 'e.g. Parcel #4021 — bookshelf'}
          value={itemLabel}
          onChangeText={setItemLabel}
        />
        <Input
          label="Customer (who can track it)"
          placeholder="Search registered users by name…"
          value={customerQuery}
          onChangeText={searchCustomers}
          helper={customer ? `Selected: ${customer.name}` : undefined}
        />
        {customerResults.length > 0 ? (
          <View style={styles.pillRow}>
            {customerResults.map((u) => (
              <Tag
                key={u.id}
                label={u.name}
                selected={customer?.id === u.id}
                onPress={() => setCustomer(u)}
              />
            ))}
          </View>
        ) : null}
        {vehicles.length > 0 ? (
          <>
            <Text variant="label" weight="medium" style={styles.fieldLabel}>
              Vehicle (optional)
            </Text>
            <View style={styles.pillRow}>
              {vehicles.map((v) => (
                <Tag
                  key={v.id}
                  label={v.name}
                  icon={getVehicleKind(v.kind).icon}
                  selected={itemVehicleId === v.id}
                  onPress={() => setItemVehicleId(itemVehicleId === v.id ? undefined : v.id)}
                />
              ))}
            </View>
          </>
        ) : null}
        <Button
          title="Add to tracking"
          onPress={addItem}
          loading={working}
          disabled={itemLabel.trim().length < 2 || !customer}
          style={styles.formBtn}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  formTitle: { marginBottom: spacing.md },
  fieldLabel: { marginTop: spacing.md, marginBottom: spacing.xs },
  formBtn: { marginTop: spacing.lg },
});
