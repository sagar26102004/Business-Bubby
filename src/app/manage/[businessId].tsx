/**
 * Manage screen (owner only). The owner sets each employee's hierarchy level
 * and chooses who attends calls and who customer chats are forwarded to. The
 * owner is always included, so the toggles here cover the employees.
 */
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type {
  Employee,
  EmployeeLevel,
  MenuItem,
  PartyPackage,
  ProductItem,
  RentalBasis,
  RentalStatus,
  ServiceItem,
} from '@/domain/types';
import { RENTAL_BASES, offersDineIn } from '@/domain/catalog';
import { AVAILABLE_MODULES, COMING_SOON_MODULES, enabledModules } from '@/domain/modules';
import { isFoodShop } from '@/domain/tags';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { FoodMenuEditor } from '@/features/businesses/FoodMenuEditor';
import { OfferingsEditor } from '@/features/businesses/OfferingsEditor';
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
import { spacing, useColors } from '@/theme/theme';

export default function ManageScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(business.id);
    return { business, employees };
  }, [businessId]);

  // Local editable state, initialised from the loaded business.
  const [levels, setLevels] = useState<Record<string, EmployeeLevel>>({});
  const [callSet, setCallSet] = useState<Set<string>>(new Set());
  const [chatSet, setChatSet] = useState<Set<string>>(new Set());
  const [scanSet, setScanSet] = useState<Set<string>>(new Set());
  const [showSet, setShowSet] = useState<Set<string>>(new Set());
  const [ownerOnCalls, setOwnerOnCalls] = useState(true);
  const [moduleSet, setModuleSet] = useState<Set<string>>(new Set());
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [partyPackages, setPartyPackages] = useState<PartyPackage[]>([]);
  const [tableCount, setTableCount] = useState('');
  const [stallName, setStallName] = useState('');
  const [rentalStatus, setRentalStatus] = useState<RentalStatus>('available');
  const [rentalBasis, setRentalBasis] = useState<RentalBasis | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    const lv: Record<string, EmployeeLevel> = {};
    data.employees.forEach((e) => (lv[e.id] = e.level ?? 'staff'));
    setLevels(lv);
    setCallSet(new Set(data.business.callHandlerIds ?? []));
    setChatSet(new Set(data.business.chatRecipientIds ?? []));
    setScanSet(new Set(data.business.scanHandlerIds ?? []));
    setShowSet(new Set(data.employees.filter((e) => e.showOnPage).map((e) => e.id)));
    setOwnerOnCalls(data.business.ownerHandlesCalls !== false);
    setModuleSet(new Set(enabledModules(data.business)));
    setProducts(data.business.products ?? []);
    setMenu(data.business.menu ?? []);
    setServices(data.business.services ?? []);
    setPartyPackages(data.business.partyPackages ?? []);
    setTableCount(data.business.tableCount != null ? String(data.business.tableCount) : '');
    setStallName(data.business.name);
    setRentalStatus(data.business.rentalStatus ?? 'available');
    setRentalBasis(data.business.rentalBasis);
  }, [data]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  if (currentUser?.id !== data.business.ownerId) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Manage' }} />
        <EmptyView title="Owners only" subtitle="Only the business owner can manage this." />
      </Screen>
    );
  }

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  };

  // Only registered members actually ring — warn when nobody would.
  const noCallReceivers =
    !ownerOnCalls && !data.employees.some((e) => callSet.has(e.id) && e.userId);

  const isStall = data.business.type === 'item';
  const isRental = data.business.type === 'rental';
  // Blank / 0 / junk → no tables (undefined clears it on save).
  const parsedTableCount = (() => {
    const n = parseInt(tableCount, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();
  // Cafes/restaurants/bakeries edit a MENU (prebuilt sections), not a product list.
  const isFood = isFoodShop(data.business.tags ?? []);

  const save = async () => {
    setSaving(true);
    try {
      await repos.businesses.update(data.business.id, {
        callHandlerIds: Array.from(callSet),
        ownerHandlesCalls: ownerOnCalls,
        chatRecipientIds: Array.from(chatSet),
        scanHandlerIds: Array.from(scanSet),
        // Saving always writes the explicit module list — a legacy business
        // (no list = everything on) becomes explicit on its first save.
        modules: Array.from(moduleSet),
        products: products.length > 0 ? products : undefined,
        menu: menu.length > 0 ? menu : undefined,
        services: services.length > 0 ? services : undefined,
        partyPackages: partyPackages.length > 0 ? partyPackages : undefined,
        // Dine-in seating: how many tables to seat orders at (blank = no tables).
        ...(offersDineIn(data.business) ? { tableCount: parsedTableCount } : {}),
        // Stalls start out named after the owner — let them pick a real name.
        ...(isStall && stallName.trim() ? { name: stallName.trim() } : {}),
        // Rentals: flip Available/Rented instead of re-listing.
        ...(isRental ? { rentalStatus, rentalBasis } : {}),
      });
      await Promise.all(
        data.employees.flatMap((e) => {
          const patch: Partial<Employee> = {};
          if (levels[e.id] && levels[e.id] !== (e.level ?? 'staff')) patch.level = levels[e.id];
          if (showSet.has(e.id) !== !!e.showOnPage) patch.showOnPage = showSet.has(e.id);
          return Object.keys(patch).length > 0 ? [repos.employees.update(e.id, patch)] : [];
        }),
      );
      Alert.alert('Saved', 'Catalog, call and chat settings updated.');
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Manage' }} />

      <Text variant="title" weight="bold">
        Calls & chat
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        Choose who rings on voice calls and who can reply to customer chats — spread the load
        across your team. Chats always reach you; calls are up to you. Customers only see you and
        your managers on the page — feature a staff member with “Show on business page”.
      </Text>

      {/* Owner row — chats always on, calls opt-in/out */}
      <Card style={styles.card}>
        <Text weight="semibold">{currentUser.name} · Owner</Text>
        <Text variant="caption" tone="muted">
          Always receives chats. Turn calls off to route them to your team only.
        </Text>
        <View style={[styles.switchRow, { borderTopColor: colors.border }]}>
          <Text>📞 Rings on voice calls</Text>
          <Switch value={ownerOnCalls} onValueChange={setOwnerOnCalls} />
        </View>
        {noCallReceivers ? (
          <Text variant="caption" tone="danger" style={styles.warning}>
            ⚠️ No one will ring — customers can’t voice-call this business until you turn yourself
            back on or add a team member with an app account.
          </Text>
        ) : null}
      </Card>

      {data.employees.length === 0 ? (
        <Text tone="muted" style={styles.empty}>
          No employees yet. Add them when editing the business.
        </Text>
      ) : (
        data.employees.map((emp: Employee) => (
          <Card key={emp.id} style={styles.card}>
            <Text weight="semibold">{emp.displayName}</Text>
            {emp.role ? (
              <Text variant="caption" tone="muted" style={styles.role}>
                {emp.role}
              </Text>
            ) : null}

            {/* Hierarchy level */}
            <View style={styles.levelRow}>
              {(['manager', 'staff'] as EmployeeLevel[]).map((lv) => (
                <Tag
                  key={lv}
                  label={lv === 'manager' ? 'Manager' : 'Staff'}
                  selected={(levels[emp.id] ?? 'staff') === lv}
                  onPress={() => setLevels((prev) => ({ ...prev, [emp.id]: lv }))}
                />
              ))}
            </View>

            {/* Routing switches */}
            <View style={[styles.switchRow, { borderTopColor: colors.border }]}>
              <Text>📞 Rings on voice calls</Text>
              <Switch
                value={callSet.has(emp.id)}
                onValueChange={() => setCallSet((s) => toggle(s, emp.id))}
              />
            </View>
            {callSet.has(emp.id) && !emp.userId ? (
              <Text variant="caption" tone="muted" style={styles.noAccount}>
                No app account yet — voice calls only ring registered members.
              </Text>
            ) : null}
            <View style={styles.switchRow}>
              <Text>💬 Can reply to chats</Text>
              <Switch
                value={chatSet.has(emp.id)}
                onValueChange={() => setChatSet((s) => toggle(s, emp.id))}
              />
            </View>
            <View style={styles.switchRow}>
              <Text>📷 Can scan order QR</Text>
              <Switch
                value={scanSet.has(emp.id)}
                onValueChange={() => setScanSet((s) => toggle(s, emp.id))}
              />
            </View>
            {scanSet.has(emp.id) && !emp.userId ? (
              <Text variant="caption" tone="muted" style={styles.noAccount}>
                No app account yet — scanning needs a registered member.
              </Text>
            ) : null}
            {/* Customers see only owner + managers — staff are featured one by one */}
            {(levels[emp.id] ?? 'staff') === 'manager' ? (
              <Text variant="caption" tone="muted" style={styles.noAccount}>
                Managers always appear on your business page.
              </Text>
            ) : (
              <>
                <View style={styles.switchRow}>
                  <Text>👁️ Show on business page</Text>
                  <Switch
                    value={showSet.has(emp.id)}
                    onValueChange={() => setShowSet((s) => toggle(s, emp.id))}
                  />
                </View>
                {showSet.has(emp.id) ? (
                  <Text variant="caption" tone="muted" style={styles.noAccount}>
                    Customers will see {emp.displayName} listed under “{emp.role ?? 'Staff'}”.
                  </Text>
                ) : null}
              </>
            )}
          </Card>
        ))
      )}

      {/* Workspace tools — the opt-in modules picked at registration */}
      {!isStall ? (
        <>
          <Text variant="title" weight="bold" style={styles.catalogTitle}>
            Workspace tools
          </Text>
          <Text tone="muted" style={styles.subtitle}>
            Turn the tools you run the business with on or off — your workspace shows only what’s
            on. Chat and calls are always included. Turning a tool off hides it; nothing is
            deleted.
          </Text>
          <Card style={styles.card}>
            {AVAILABLE_MODULES.map((m, i) => (
              <View
                key={m.id}
                style={[styles.switchRow, i === 0 && styles.firstSwitchRow, { borderTopColor: colors.border }]}
              >
                <View style={styles.moduleInfo}>
                  <Text>
                    {m.icon} {m.label}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {m.description}
                  </Text>
                </View>
                <Switch
                  value={moduleSet.has(m.id)}
                  onValueChange={() => setModuleSet((s) => toggle(s, m.id))}
                />
              </View>
            ))}
            <Text variant="caption" tone="muted" style={styles.comingSoon}>
              Coming soon: {COMING_SOON_MODULES.map((m) => m.label).join(', ')}.
            </Text>
          </Card>
        </>
      ) : null}

      {/* Rental availability — flip the status instead of re-listing */}
      {isRental ? (
        <>
          <Text variant="title" weight="bold" style={styles.catalogTitle}>
            Availability
          </Text>
          <Text tone="muted" style={styles.subtitle}>
            When a tenant moves in, mark it Rented — the listing stays up and you flip it back to
            Available when it frees up. No need to list it again.
          </Text>
          <Card style={styles.card}>
            <View style={styles.levelRow}>
              {(
                [
                  { id: 'available', label: '🟢 Available' },
                  { id: 'rented', label: '🔴 Rented' },
                ] as { id: RentalStatus; label: string }[]
              ).map((s) => (
                <Tag
                  key={s.id}
                  label={s.label}
                  selected={rentalStatus === s.id}
                  onPress={() => setRentalStatus(s.id)}
                />
              ))}
            </View>
            <Text variant="label" weight="semibold" style={styles.catalogLabel}>
              Rented out per day or per month?
            </Text>
            <View style={styles.levelRow}>
              {RENTAL_BASES.map((b) => (
                <Tag
                  key={b.id}
                  label={b.label}
                  icon={b.icon}
                  selected={rentalBasis === b.id}
                  onPress={() => setRentalBasis(b.id)}
                />
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {/* Catalog — what customers can order (and get billed for) */}
      <Text variant="title" weight="bold" style={styles.catalogTitle}>
        {isStall ? 'What you’re selling' : 'What you provide'}
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        {isStall
          ? 'Every item in your stall — buyers browse these and send you a purchase request.'
          : 'List every product you sell and every service you offer — customers pick from these when they place an order, and your team quick-adds them onto bills.'}
      </Text>

      {isStall ? (
        <Input
          label="Stall name"
          helper="Named after you by default — give your stall its own name if you like."
          value={stallName}
          onChangeText={setStallName}
        />
      ) : null}

      {isFood ? (
        <>
          <Text variant="label" weight="semibold" style={styles.catalogLabel}>
            Menu
          </Text>
          <FoodMenuEditor value={menu} onChange={setMenu} />
        </>
      ) : null}

      {/* A cafe that also sells packaged goods (beans, mugs) still lists them
          as products — but a pure restaurant shouldn't be nagged for a second
          catalog it doesn't have, so this only shows when it already has one. */}
      {!isFood || products.length > 0 ? (
        <>
          <Text variant="label" weight="semibold" style={styles.catalogLabel}>
            {isStall ? 'Items for sale' : 'Products for sale'}
          </Text>
          <OfferingsEditor
            value={products}
            onChange={setProducts}
            namePlaceholder={isStall ? 'Item (e.g. iPhone 15 Pro)' : 'Product (e.g. Touring tyre 205/55 R16)'}
            addLabel={isStall ? 'Add item' : 'Add product'}
            // Buyers browse stalls picture-first, so items sell on their photo.
            withImage
          />
        </>
      ) : null}

      {!isStall ? (
        <>
          <Text variant="label" weight="semibold" style={styles.catalogLabel}>
            Services offered
          </Text>
          <OfferingsEditor
            value={services}
            onChange={setServices}
            namePlaceholder="Service (e.g. Wheel alignment)"
            addLabel="Add service"
            withGroups
            categoryPlaceholder="e.g. Repairs, Installation"
            subcategoryPlaceholder="e.g. AC, Fridge"
            withDescription
            descriptionPlaceholder="What's included (optional)"
          />
        </>
      ) : null}

      {offersDineIn(data.business) ? (
        <>
          <Text variant="label" weight="semibold" style={styles.catalogLabel}>
            🍽️ Tables
          </Text>
          <Text variant="caption" tone="muted" style={styles.subtitle}>
            How many tables you seat. Dine-in orders are seated at a numbered
            table automatically — the lowest free one, or a customer’s existing
            table if they’re already sitting down. Leave blank if you don’t run
            tables.
          </Text>
          <Input
            placeholder="e.g. 12"
            value={tableCount}
            onChangeText={setTableCount}
            keyboardType="number-pad"
            style={styles.tableInput}
          />

          <Text variant="label" weight="semibold" style={styles.catalogLabel}>
            🎉 Party packages
          </Text>
          <Text variant="caption" tone="muted" style={styles.subtitle}>
            Birthday, kitty party, family function… customers pick one when they
            plan a party with you. Put guest limits and inclusions in the name,
            e.g. “Birthday Buffet (min 15)”.
          </Text>
          <OfferingsEditor
            value={partyPackages}
            onChange={setPartyPackages}
            namePlaceholder="Package (e.g. Birthday Buffet, min 15)"
            addLabel="Add package"
          />
        </>
      ) : null}

      <Button title="Save" onPress={save} loading={saving} style={styles.save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  role: { marginTop: 2 },
  empty: { marginBottom: spacing.md },
  levelRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  warning: { marginTop: spacing.sm },
  noAccount: { marginTop: spacing.xs },
  firstSwitchRow: { marginTop: 0, paddingTop: 0, borderTopWidth: 0 },
  moduleInfo: { flex: 1, paddingRight: spacing.md },
  comingSoon: { marginTop: spacing.md },
  catalogTitle: { marginTop: spacing.xl },
  catalogLabel: { marginTop: spacing.md, marginBottom: spacing.sm },
  tableInput: { maxWidth: 160 },
  save: { marginTop: spacing.lg },
});
