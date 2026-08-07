/**
 * Fleet & tracking › Assign to a vehicle (owner only).
 *
 * The job the register screen shouldn't have to do: putting people and parcels
 * ON a bus, fast, at the start of a term. Pick the vehicle once, then search
 * and tap names — each tap assigns and the list stays put, so filling a 40-seat
 * bus is 40 taps and no back-navigation.
 *
 * The pool is everyone the business already knows: children enrolled through
 * Members (even ones never registered for tracking — their tracked row is
 * created on the spot, filed under their enrolment) plus every child/consignment
 * already on the fleet. Anyone genuinely new can be registered here too.
 *
 * Assigning someone who is already on another vehicle asks first — moving a
 * child off a bus silently is exactly the mistake that loses a child.
 */
import { useMemo, useState } from 'react';
import { LayoutAnimation, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { Membership, TrackedItem, TrackedItemKind, User, Vehicle } from '@/domain/types';
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
  SearchField,
  Tag,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

/** Vehicle label: the pet name, falling back to the number plate. */
const vehicleLabel = (v: Vehicle) => v.name || v.registrationNumber || 'Vehicle';

/**
 * Someone who can ride a vehicle. Either an already-tracked child/parcel, or an
 * enrolled member who has no tracked row yet (created the moment they're
 * assigned, filed under their enrolment so Members and Fleet stay in step).
 */
interface Candidate {
  key: string;
  name: string;
  /** The customer who follows them — the parent, or the goods' owner. */
  parentName: string;
  customerId: string;
  kind: TrackedItemKind;
  item?: TrackedItem;
  membership?: Membership;
  /** Vehicle they're on right now, if any. */
  vehicleId?: string;
}

export default function FleetAssignScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [vehicles, items, members] = await Promise.all([
      repos.tracking.listVehicles(business.id),
      repos.tracking.listItems(business.id),
      repos.memberships.listForBusiness(business.id),
    ]);
    return { business, vehicles, items, members };
  }, [businessId]);

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // The already-on-another-vehicle question, held until Overwrite or Cancel.
  const [confirming, setConfirming] = useState<Candidate | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // Last thing assigned, echoed back so rapid tapping is visibly landing.
  const [justAssigned, setJustAssigned] = useState<string | null>(null);

  // Register-someone-new form (for a parcel or a child who isn't enrolled).
  const [showNew, setShowNew] = useState(false);
  const [newKind, setNewKind] = useState<TrackedItemKind>('child');
  const [newLabel, setNewLabel] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<User[]>([]);
  const [customer, setCustomer] = useState<User | undefined>();
  const [savingNew, setSavingNew] = useState(false);

  /** Everyone assignable, tracked rows first so enrolments never duplicate. */
  const candidates = useMemo((): Candidate[] => {
    if (!data) return [];
    const { items, members } = data;
    const out: Candidate[] = items.map((it) => ({
      key: `item:${it.id}`,
      name: it.label,
      parentName: it.customerName,
      customerId: it.customerId,
      kind: it.kind,
      item: it,
      membership: it.membershipId ? members.find((m) => m.id === it.membershipId) : undefined,
      vehicleId: it.vehicleId,
    }));
    const tracked = new Set(items.map((i) => i.membershipId).filter(Boolean));
    for (const m of members) {
      // A standalone member has no account behind them, so nobody could follow
      // the vehicle anyway — they're assigned from the Members screen instead.
      if (m.standalone || tracked.has(m.id)) continue;
      out.push({
        key: `member:${m.id}`,
        name: m.enrolleeName ?? m.customerName,
        parentName: m.customerName,
        customerId: m.customerId,
        kind: 'child',
        membership: m,
      });
    }
    // Unassigned first — that's the backlog the owner is here to clear.
    return out.sort(
      (a, b) => Number(!!a.vehicleId) - Number(!!b.vehicleId) || a.name.localeCompare(b.name),
    );
  }, [data]);

  const term = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      term
        ? candidates.filter(
            (c) =>
              c.name.toLowerCase().includes(term) || c.parentName.toLowerCase().includes(term),
          )
        : candidates,
    [candidates, term],
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, vehicles, items } = data;

  if (currentUser?.id !== business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Assign to vehicle' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage tracking." />
      </Screen>
    );
  }

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const nameOfVehicle = (id?: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? vehicleLabel(v) : undefined;
  };
  const aboardCount = (id: string) => items.filter((i) => i.vehicleId === id).length;

  /** Put a candidate on the chosen vehicle, creating their tracked row if the
   *  enrolment never had one. */
  const doAssign = async (c: Candidate) => {
    if (!vehicle) return;
    setBusyKey(c.key);
    try {
      if (c.item) {
        await repos.tracking.updateItem(c.item.id, { vehicleId: vehicle.id });
      } else {
        await repos.tracking.addItem({
          businessId: business.id,
          kind: c.kind,
          label: c.name,
          customerId: c.customerId,
          customerName: c.parentName,
          vehicleId: vehicle.id,
          membershipId: c.membership?.id,
        });
      }
      setJustAssigned(`${c.name} → ${vehicleLabel(vehicle)}`);
      reload();
    } finally {
      setBusyKey(null);
    }
  };

  /** Tapping a name: straight on if they're free, ask first if they're not. */
  const onPick = (c: Candidate) => {
    if (!vehicle || c.vehicleId === vehicle.id) return;
    if (c.vehicleId) {
      setConfirming(c);
      return;
    }
    doAssign(c);
  };

  const confirmOverwrite = async () => {
    const c = confirming;
    setConfirming(null);
    if (c) await doAssign(c);
  };

  const takeOff = async (c: Candidate) => {
    if (!c.item) return;
    setBusyKey(c.key);
    try {
      await repos.tracking.updateItem(c.item.id, { vehicleId: undefined });
      setJustAssigned(null);
      reload();
    } finally {
      setBusyKey(null);
    }
  };

  const searchCustomers = async (next: string) => {
    setCustomerQuery(next);
    setCustomerResults(next.trim().length >= 2 ? await repos.users.search(next) : []);
  };

  const addNew = async () => {
    if (newLabel.trim().length < 2 || !customer) return;
    setSavingNew(true);
    try {
      await repos.tracking.addItem({
        businessId: business.id,
        kind: newKind,
        label: newLabel.trim(),
        customerId: customer.id,
        customerName: customer.name,
        vehicleId: vehicle?.id,
      });
      setJustAssigned(
        vehicle ? `${newLabel.trim()} → ${vehicleLabel(vehicle)}` : `${newLabel.trim()} registered`,
      );
      setNewLabel('');
      setCustomer(undefined);
      setCustomerQuery('');
      setCustomerResults([]);
      setShowNew(false);
      reload();
    } finally {
      setSavingNew(false);
    }
  };

  // ─── Step 1: which vehicle ───────────────────────────────────────────────
  if (!vehicle) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title: 'Assign to vehicle' }} />
        <Text weight="semibold">Which vehicle are you filling?</Text>
        <Text variant="caption" tone="muted" style={styles.hint}>
          Pick one, then tap names to put them aboard.
        </Text>
        {vehicles.length === 0 ? (
          <EmptyView
            title="No vehicles yet"
            subtitle="Add a vehicle in Vehicles first — people ride on one so customers can follow it."
          />
        ) : (
          vehicles.map((v) => (
            <Card key={v.id} onPress={() => setVehicleId(v.id)} style={styles.pickCard}>
              <View style={styles.row}>
                <Text style={styles.rowIcon}>{getVehicleKind(v.kind).icon}</Text>
                <View style={styles.flex}>
                  <Text weight="semibold">{vehicleLabel(v)}</Text>
                  <Text variant="caption" tone="muted">
                    {aboardCount(v.id)} aboard
                    {v.registrationNumber && v.registrationNumber !== v.name
                      ? ` · ${v.registrationNumber}`
                      : ''}
                  </Text>
                </View>
                <Text tone="muted" style={styles.rowChev}>
                  ›
                </Text>
              </View>
            </Card>
          ))
        )}
      </Screen>
    );
  }

  // ─── Step 2: who rides it ────────────────────────────────────────────────
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: `Assign · ${vehicleLabel(vehicle)}` }} />

      <Card style={[styles.pickCard, { borderColor: colors.brand, borderWidth: 1 }]}>
        <View style={styles.row}>
          <Text style={styles.rowIcon}>{getVehicleKind(vehicle.kind).icon}</Text>
          <View style={styles.flex}>
            <Text weight="semibold">{vehicleLabel(vehicle)}</Text>
            <Text variant="caption" tone="muted">
              {aboardCount(vehicle.id)} aboard
            </Text>
          </View>
          <Text
            tone="brand"
            weight="semibold"
            onPress={() => {
              setVehicleId(null);
              setJustAssigned(null);
            }}
          >
            Change
          </Text>
        </View>
      </Card>

      {justAssigned ? (
        <View style={[styles.toast, { backgroundColor: colors.successSoft }]}>
          <Text variant="caption" weight="semibold" tone="success">
            ✓ {justAssigned}
          </Text>
        </View>
      ) : null}

      <SearchField
        placeholder="Search a student, parcel or parent…"
        value={query}
        onChangeText={setQuery}
        accessibilityLabel="Search students, parcels and parents"
      />

      {shown.length === 0 ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          {term
            ? `Nobody matches “${query.trim()}”. Register them below.`
            : 'Nobody to assign yet — enrol members, or register someone below.'}
        </Text>
      ) : (
        <Card style={styles.list}>
          {shown.map((c, i) => {
            const here = c.vehicleId === vehicle.id;
            const elsewhere = !!c.vehicleId && !here;
            return (
              <Pressable
                key={c.key}
                onPress={() => onPick(c)}
                disabled={here || busyKey === c.key}
                style={[
                  styles.row,
                  styles.listRow,
                  i < shown.length - 1 && {
                    borderBottomColor: colors.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  here ? `${c.name} already aboard` : `Assign ${c.name} to ${vehicleLabel(vehicle)}`
                }
              >
                <Text style={styles.rowIcon}>{c.kind === 'child' ? '🧒' : '📦'}</Text>
                <View style={styles.flex}>
                  <Text weight="medium" numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {c.parentName}
                    {c.membership ? ` · ${c.membership.planName}` : ''}
                  </Text>
                </View>
                {here ? (
                  <Pressable onPress={() => takeOff(c)} hitSlop={8}>
                    <Text variant="caption" tone="danger" weight="semibold">
                      Take off
                    </Text>
                  </Pressable>
                ) : (
                  <Text
                    variant="caption"
                    weight="semibold"
                    tone={elsewhere ? 'accent' : 'brand'}
                  >
                    {elsewhere ? `on ${nameOfVehicle(c.vehicleId)}` : '＋ Add'}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </Card>
      )}

      {/* Someone the business has never tracked — a parcel, a non-enrolled child. */}
      {showNew ? (
        <Card style={styles.pickCard}>
          <Text weight="semibold" style={styles.formTitle}>
            ➕ Register someone new
          </Text>
          <View style={styles.pillRow}>
            <Tag label="Child" icon="🧒" selected={newKind === 'child'} onPress={() => setNewKind('child')} />
            <Tag label="Goods" icon="📦" selected={newKind === 'goods'} onPress={() => setNewKind('goods')} />
          </View>
          <Input
            label={newKind === 'child' ? 'Child' : 'Goods'}
            placeholder={newKind === 'child' ? 'e.g. Aarav — Grade 3' : 'e.g. Parcel #4021 — bookshelf'}
            value={newLabel}
            onChangeText={setNewLabel}
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
          <Button
            title={`Add to ${vehicleLabel(vehicle)}`}
            onPress={addNew}
            loading={savingNew}
            disabled={newLabel.trim().length < 2 || !customer}
            style={styles.formBtn}
          />
          <Button title="Cancel" variant="ghost" onPress={() => setShowNew(false)} />
        </Card>
      ) : (
        <Button
          title="➕ Register someone new"
          variant="secondary"
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setShowNew(true);
          }}
          style={styles.newBtn}
        />
      )}

      {/* Already on another vehicle — overwrite, or leave them where they are. */}
      <Modal
        visible={!!confirming}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirming(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setConfirming(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text weight="semibold" variant="subheading">
              Already assigned
            </Text>
            <Text tone="muted" style={styles.sheetBody}>
              {confirming?.name} is already on {nameOfVehicle(confirming?.vehicleId)}. Move them to{' '}
              {vehicleLabel(vehicle)}?
            </Text>
            <Button title="Overwrite" onPress={confirmOverwrite} />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setConfirming(null)}
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
  hint: { marginTop: spacing.xs, marginBottom: spacing.md },
  pickCard: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowIcon: { fontSize: 22 },
  rowChev: { fontSize: 20 },
  list: { marginBottom: spacing.md, paddingVertical: 0 },
  listRow: { paddingVertical: spacing.md },
  toast: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  formTitle: { marginBottom: spacing.md },
  formBtn: { marginTop: spacing.lg },
  newBtn: { marginBottom: spacing.md },
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
