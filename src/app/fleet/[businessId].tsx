/**
 * Fleet & tracking management (owner only).
 *
 * The owner sets up everything live tracking needs:
 *  - Vehicles: add/remove them and pin a driver — the vehicle's live position
 *    is the driver's shared location, so "which employee drives Bus 1" is the
 *    whole assignment model.
 *  - Tracked items: register what each customer follows (a child on the school
 *    run, goods in transit), pick the customer, and put it on a vehicle. That
 *    customer then gets a "Track" button on the business page.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { TrackedItem, TrackedItemKind, User, Vehicle, VehicleKind } from '@/domain/types';
import { VEHICLE_KINDS, getVehicleKind } from '@/domain/catalog';
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

export default function FleetScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, vehicles, items] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.tracking.listVehicles(business.id),
      repos.tracking.listItems(business.id),
    ]);
    return { business, employees, vehicles, items };
  }, [businessId]);

  // Add-vehicle form — the number plate is the identity; pet name optional.
  const [vehicleReg, setVehicleReg] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [vehicleKind, setVehicleKind] = useState<VehicleKind>('bus');
  const [vehicleDriverId, setVehicleDriverId] = useState<string | undefined>();

  // Add-item form
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

  const { business, employees, vehicles, items } = data;

  if (currentUser?.id !== business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Fleet & tracking' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage the fleet." />
      </Screen>
    );
  }

  const addVehicle = async () => {
    if (vehicleReg.trim().length < 4) return;
    setWorking(true);
    try {
      await repos.tracking.addVehicle({
        businessId: business.id,
        name: vehicleName.trim() || undefined,
        registrationNumber: vehicleReg,
        kind: vehicleKind,
        driverEmployeeId: vehicleDriverId,
      });
      setVehicleReg('');
      setVehicleName('');
      setVehicleDriverId(undefined);
      reload();
    } finally {
      setWorking(false);
    }
  };

  const setDriver = async (vehicle: Vehicle, employeeId: string) => {
    await repos.tracking.updateVehicle(vehicle.id, {
      driverEmployeeId: vehicle.driverEmployeeId === employeeId ? undefined : employeeId,
    });
    reload();
  };

  const removeVehicle = async (vehicle: Vehicle) => {
    await repos.tracking.removeVehicle(vehicle.id);
    reload();
  };

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

  const driverName = (v: Vehicle) =>
    employees.find((e) => e.id === v.driverEmployeeId)?.displayName;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Fleet & tracking' }} />

      <Text variant="title" weight="bold">
        Fleet & tracking
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        Pin a driver to each vehicle — when they share their location, the vehicle goes live.
        Then add what each customer follows (their child, their goods) and put it on a vehicle.
      </Text>

      <Button title="🗺️ Open live map" onPress={() => router.push(`/track/${business.id}`)} />

      {/* ── Vehicles ── */}
      <Section title={`Vehicles · ${vehicles.length}`}>
        {vehicles.map((v) => (
          <Card key={v.id} style={styles.card}>
            <Text weight="semibold">
              {getVehicleKind(v.kind).icon} {v.name}
            </Text>
            {v.registrationNumber && v.registrationNumber !== v.name ? (
              <Text variant="caption" tone="muted">
                {v.registrationNumber}
              </Text>
            ) : null}
            <Text variant="caption" tone="muted">
              {driverName(v) ? `Driver: ${driverName(v)}` : 'No driver — assign one below'}
            </Text>
            {employees.length > 0 ? (
              <View style={styles.pillRow}>
                {employees.map((e) => (
                  <Tag
                    key={e.id}
                    label={`${e.displayName}${e.userId ? '' : ' (no account)'}`}
                    selected={v.driverEmployeeId === e.id}
                    onPress={() => setDriver(v, e.id)}
                  />
                ))}
              </View>
            ) : (
              <Text variant="caption" tone="muted" style={styles.noteTop}>
                No employees yet — add them when editing the business.
              </Text>
            )}
            {v.driverEmployeeId && !employees.find((e) => e.id === v.driverEmployeeId)?.userId ? (
              <Text variant="caption" tone="danger" style={styles.noteTop}>
                ⚠️ This driver has no app account, so they can’t share a live location.
              </Text>
            ) : null}
            <Button title="Remove vehicle" variant="ghost" onPress={() => removeVehicle(v)} />
          </Card>
        ))}

        <Card style={styles.card}>
          <Text weight="semibold" style={styles.formTitle}>
            ➕ Add a vehicle
          </Text>
          <Input
            label="Vehicle number"
            placeholder="e.g. MP09 AB 1234"
            value={vehicleReg}
            onChangeText={setVehicleReg}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Input
            label="Pet name (optional)"
            placeholder="e.g. Bus 3 — afternoon route"
            value={vehicleName}
            onChangeText={setVehicleName}
          />
          <Text variant="label" weight="medium" style={styles.fieldLabel}>
            Kind
          </Text>
          <View style={styles.pillRow}>
            {VEHICLE_KINDS.map((k) => (
              <Tag
                key={k.id}
                label={k.name}
                icon={k.icon}
                selected={vehicleKind === k.id}
                onPress={() => setVehicleKind(k.id)}
              />
            ))}
          </View>
          {employees.length > 0 ? (
            <>
              <Text variant="label" weight="medium" style={styles.fieldLabel}>
                Driver (optional)
              </Text>
              <View style={styles.pillRow}>
                {employees.map((e) => (
                  <Tag
                    key={e.id}
                    label={e.displayName}
                    selected={vehicleDriverId === e.id}
                    onPress={() =>
                      setVehicleDriverId(vehicleDriverId === e.id ? undefined : e.id)
                    }
                  />
                ))}
              </View>
            </>
          ) : null}
          <Button
            title="Add vehicle"
            onPress={addVehicle}
            loading={working}
            disabled={vehicleReg.trim().length < 4}
            style={styles.formBtn}
          />
        </Card>
      </Section>

      {/* ── Tracked for customers ── */}
      <Section title={`Tracked for customers · ${items.length}`}>
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
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="subheading" weight="bold" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  section: { marginTop: spacing.xl },
  sectionTitle: { marginBottom: spacing.md },
  card: { marginBottom: spacing.md },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  noteTop: { marginTop: spacing.sm },
  formTitle: { marginBottom: spacing.md },
  fieldLabel: { marginTop: spacing.md, marginBottom: spacing.xs },
  formBtn: { marginTop: spacing.lg },
});
