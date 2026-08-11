/**
 * Fleet & tracking › Vehicles (owner only).
 *
 * The fleet as a compact list: one collapsed row per vehicle showing the only
 * things you scan for — is it live, who's driving, which route it's on — and a
 * dropdown holding the rest (driver, sharing, journeys, map, remove). Adding a
 * vehicle is a header action rather than a permanent card at the bottom, so a
 * ten-vehicle fleet reads as ten lines instead of eleven cards.
 *
 * A vehicle's live position IS the driver's shared location, so "which employee
 * drives Bus 1" is the whole assignment. Two vehicles can't share a plate.
 *
 * "🏁 End all journeys" is the end-of-day sweep: it clears every active route
 * and stops the drivers broadcasting, in one tap instead of one per bus.
 */
import { useState } from 'react';
import { Alert, LayoutAnimation, Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
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
import { radius, spacing, useColors } from '@/theme/theme';

/** Number plates, normalised: only letters/digits, upper-cased (see the repo). */
const canonicalReg = (reg?: string): string => (reg ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();

export default function FleetVehiclesScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, vehicles, live] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.tracking.listVehicles(business.id),
      repos.tracking.getLiveVehicles(business.id),
    ]);
    // Whether each vehicle is currently broadcasting its live location.
    const sharing = new Map(live.map((lv) => [lv.vehicle.id, lv.sharing]));
    return { business, employees, vehicles, sharing };
  }, [businessId]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [endingAll, setEndingAll] = useState(false);
  const [confirmEndAll, setConfirmEndAll] = useState(false);

  const [vehicleReg, setVehicleReg] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [vehicleKind, setVehicleKind] = useState<VehicleKind>('bus');
  const [vehicleDriverId, setVehicleDriverId] = useState<string | undefined>();
  const [working, setWorking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees, vehicles, sharing } = data;

  if (currentUser?.id !== business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Vehicles' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage the fleet." />
      </Screen>
    );
  }

  const driverOf = (v: Vehicle) => employees.find((e) => e.id === v.driverEmployeeId);
  const driverName = (v: Vehicle) => driverOf(v)?.displayName;
  const activeJourneyName = (v: Vehicle) =>
    v.journeys?.find((j) => j.id === v.activeJourneyId)?.name;

  // What the end-of-day sweep would actually touch.
  const running = vehicles.filter((v) => v.activeJourneyId || sharing.get(v.id));

  const toggleRow = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  };

  /** Owner turns a bus's live sharing on/off for customers, on the driver's
   *  behalf (a vehicle's position IS its driver's share). */
  const toggleShare = async (v: Vehicle, on: boolean) => {
    const driver = driverOf(v);
    if (!driver?.userId) {
      Alert.alert(
        'No driver account',
        'Assign a driver who has a One Place account first — the live location comes from their phone.',
      );
      return;
    }
    await repos.tracking.setSharing(business.id, driver.userId, on);
    reload();
  };

  /**
   * End-of-day: clear the active route on every vehicle running one and stop
   * its driver broadcasting, so no bus keeps "moving" for customers overnight.
   */
  const endAllJourneys = async () => {
    setConfirmEndAll(false);
    setEndingAll(true);
    try {
      for (const v of running) {
        if (v.activeJourneyId) {
          await repos.tracking.updateVehicle(v.id, { activeJourneyId: undefined });
        }
        const driver = driverOf(v);
        if (driver?.userId && sharing.get(v.id)) {
          await repos.tracking.setSharing(business.id, driver.userId, false);
        }
      }
      reload();
    } finally {
      setEndingAll(false);
    }
  };

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
      setShowAdd(false);
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

  /** The one-line summary on a collapsed row: live state, driver, route. */
  const summaryOf = (v: Vehicle) => {
    const bits: string[] = [];
    const journey = activeJourneyName(v);
    if (journey) bits.push(journey);
    bits.push(driverName(v) ? `Driver: ${driverName(v)}` : 'No driver');
    if (v.registrationNumber && v.registrationNumber !== v.name) bits.push(v.registrationNumber);
    return bits.join(' · ');
  };

  return (
    <Screen scroll>
      <Stack.Screen
        options={{
          title: 'Vehicles',
          headerRight: () => (
            <Text
              tone="accent"
              weight="semibold"
              style={styles.headerAdd}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setShowAdd((v) => !v);
                setFormError(null);
              }}
            >
              {showAdd ? 'Close' : '＋ Add'}
            </Text>
          ),
        }}
      />

      {showAdd ? (
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
      ) : null}

      {/* End-of-day sweep — only offered when something is actually running. */}
      {running.length > 0 ? (
        <Button
          title={`🏁 End all journeys (${running.length})`}
          variant="secondary"
          onPress={() => setConfirmEndAll(true)}
          loading={endingAll}
          style={styles.endAll}
        />
      ) : null}

      {vehicles.length === 0 ? (
        <EmptyView
          title="No vehicles yet"
          subtitle="Tap ＋ Add above to put your first bus, van or truck on the fleet."
        />
      ) : null}

      {vehicles.map((v) => {
        const open = expanded[v.id];
        const live = !!sharing.get(v.id);
        const driver = driverOf(v);
        return (
          <Card key={v.id} style={styles.row}>
            <Pressable
              onPress={() => toggleRow(v.id)}
              style={styles.rowHead}
              accessibilityRole="button"
              accessibilityLabel={`${v.name}, ${live ? 'live' : 'not sharing'}`}
            >
              <Text style={styles.rowIcon}>{getVehicleKind(v.kind).icon}</Text>
              <View style={styles.flex}>
                <View style={styles.titleRow}>
                  <Text weight="semibold" numberOfLines={1} style={styles.flex}>
                    {v.name}
                  </Text>
                  {live ? (
                    <Text variant="caption" weight="semibold" tone="success">
                      ● Live
                    </Text>
                  ) : null}
                </View>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {summaryOf(v)}
                </Text>
              </View>
              <Text tone="muted" style={styles.rowChev}>
                {open ? '▾' : '▸'}
              </Text>
            </Pressable>

            {open ? (
              <View style={[styles.rowBody, { borderTopColor: colors.border }]}>
                {employees.length > 0 ? (
                  <>
                    <Text variant="label" weight="medium">
                      Driver
                    </Text>
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
                  </>
                ) : (
                  <Text variant="caption" tone="muted">
                    No employees yet — add them when editing the business.
                  </Text>
                )}
                {v.driverEmployeeId && !driver?.userId ? (
                  <Text variant="caption" tone="danger" style={styles.noteTop}>
                    ⚠️ This driver has no app account, so they can’t share a live location.
                  </Text>
                ) : null}

                {/* Owner can broadcast this bus to its customers — the same live
                    share the driver toggles, flipped here on their behalf. */}
                <View style={[styles.shareRow, { borderColor: colors.border }]}>
                  <View style={styles.flex}>
                    <Text weight="semibold">📡 Share location with customers</Text>
                    <Text variant="caption" tone="muted">
                      {live
                        ? '● Live — customers with a child/goods on this vehicle can see it move.'
                        : 'Off — turn on to let its customers track this vehicle live.'}
                    </Text>
                  </View>
                  <Switch
                    value={live}
                    onValueChange={(on) => toggleShare(v, on)}
                    disabled={!driver?.userId}
                  />
                </View>

                <Button
                  title="🧭 Journeys & stops"
                  variant="secondary"
                  onPress={() => router.push(`/fleet/${business.id}/journey?vehicle=${v.id}`)}
                  style={styles.actionBtn}
                />
                <Button
                  title="🗺️ Track on map"
                  variant="secondary"
                  onPress={() => router.push(`/track/${business.id}?vehicle=${v.id}`)}
                  style={styles.actionBtn}
                />
                <Button title="Remove vehicle" variant="ghost" onPress={() => removeVehicle(v)} />
              </View>
            ) : null}
          </Card>
        );
      })}

      {/* Ending every run at once is worth one confirmation — it takes customers
          off the map mid-view if it's tapped by mistake. */}
      <Modal
        visible={confirmEndAll}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmEndAll(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setConfirmEndAll(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text weight="semibold" variant="subheading">
              End all journeys?
            </Text>
            <Text tone="muted" style={styles.sheetBody}>
              Clears the active route on {running.length} vehicle
              {running.length === 1 ? '' : 's'} and stops their drivers sharing live location.
              Customers stop seeing them move until the next run starts.
            </Text>
            <Button title="End all journeys" onPress={endAllJourneys} />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setConfirmEndAll(false)}
              style={styles.sheetCancel}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerAdd: { paddingHorizontal: spacing.md, fontSize: 16 },
  card: { marginBottom: spacing.md },
  endAll: { marginBottom: spacing.md },
  row: { marginBottom: spacing.sm, paddingVertical: 0 },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowIcon: { fontSize: 22 },
  rowChev: { fontSize: 20 },
  rowBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  noteTop: { marginTop: spacing.sm },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: { marginTop: spacing.md },
  formTitle: { marginBottom: spacing.md },
  fieldLabel: { marginTop: spacing.md, marginBottom: spacing.xs },
  formBtn: { marginTop: spacing.lg },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    maxWidth: 380,
    width: '100%',
    alignSelf: 'center',
  },
  sheetBody: { marginTop: spacing.sm, marginBottom: spacing.lg },
  sheetCancel: { marginTop: spacing.sm },
});
