/**
 * Fleet & tracking › Vehicles (owner only).
 *
 * Add/remove vehicles and pin a driver to each — a vehicle's live position IS
 * the driver's shared location, so "which employee drives Bus 1" is the whole
 * assignment. Each vehicle card can jump to the live map focused on it. Two
 * vehicles can't share a number plate.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Vehicle, VehicleKind } from '@/domain/types';
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

/** Number plates, normalised: only letters/digits, upper-cased (see the repo). */
const canonicalReg = (reg?: string): string => (reg ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();

export default function FleetVehiclesScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, vehicles] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.tracking.listVehicles(business.id),
    ]);
    return { business, employees, vehicles };
  }, [businessId]);

  const [vehicleReg, setVehicleReg] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [vehicleKind, setVehicleKind] = useState<VehicleKind>('bus');
  const [vehicleDriverId, setVehicleDriverId] = useState<string | undefined>();
  const [working, setWorking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees, vehicles } = data;

  if (currentUser?.id !== business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Vehicles' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage the fleet." />
      </Screen>
    );
  }

  const driverName = (v: Vehicle) =>
    employees.find((e) => e.id === v.driverEmployeeId)?.displayName;

  // A plate already on another vehicle in this fleet — caught before we call
  // the repo so the owner gets instant feedback (the repo enforces it too).
  const duplicateReg = (reg: string) => {
    const canonical = canonicalReg(reg);
    return !!canonical && vehicles.some((v) => canonicalReg(v.registrationNumber) === canonical);
  };

  const addVehicle = async () => {
    const reg = vehicleReg.trim();
    if (reg.length < 4) {
      setFormError('Enter the full vehicle number (at least 4 characters).');
      return;
    }
    if (duplicateReg(reg)) {
      setFormError(`A vehicle with number ${reg} is already in this fleet.`);
      return;
    }
    setWorking(true);
    setFormError(null);
    try {
      await repos.tracking.addVehicle({
        businessId: business.id,
        name: vehicleName.trim() || undefined,
        registrationNumber: reg,
        kind: vehicleKind,
        driverEmployeeId: vehicleDriverId,
      });
      setVehicleReg('');
      setVehicleName('');
      setVehicleDriverId(undefined);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add the vehicle. Try again.');
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

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Vehicles' }} />

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
          <Button
            title="🗺️ Track on map"
            variant="secondary"
            onPress={() => router.push(`/track/${business.id}?vehicle=${v.id}`)}
            style={styles.trackBtn}
          />
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
          onChangeText={(t) => {
            setVehicleReg(t);
            if (formError) setFormError(null);
          }}
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
                  onPress={() => setVehicleDriverId(vehicleDriverId === e.id ? undefined : e.id)}
                />
              ))}
            </View>
          </>
        ) : null}
        {formError ? (
          <Text variant="caption" tone="danger" style={styles.fieldLabel}>
            {formError}
          </Text>
        ) : null}
        <Button title="Add vehicle" onPress={addVehicle} loading={working} style={styles.formBtn} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  noteTop: { marginTop: spacing.sm },
  trackBtn: { marginTop: spacing.md },
  formTitle: { marginBottom: spacing.md },
  fieldLabel: { marginTop: spacing.md, marginBottom: spacing.xs },
  formBtn: { marginTop: spacing.lg },
});
