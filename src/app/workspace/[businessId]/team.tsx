/**
 * Workspace › Team — the hierarchy (owner + employees) with their chat/call
 * access. Members are grouped into collapsible tiers — Owner, Managers, Staff,
 * Drivers — so a big team reads at a glance. The owner can add and remove
 * members right here, and jump to Manage for the finer call/chat-access
 * toggles. Members only.
 */
import { useState, type ReactNode } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Employee } from '@/domain/types';
import type { NewEmployeeInput } from '@/data/repositories';
import { isBusinessTeamMember } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Avatar, Button, Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { EmployeeEditor } from '@/features/businesses/EmployeeEditor';
import { radius, spacing, useColors } from '@/theme/theme';

export default function WorkspaceTeamScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();
  const colors = useColors();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, owner, vehicles] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.users.getById(business.ownerId),
      repos.tracking.listVehicles(business.id),
    ]);
    const isOwner = currentUser?.id === business.ownerId;
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
    // Anyone pinned as a vehicle's driver is grouped under Drivers.
    const driverIds = new Set(vehicles.map((v) => v.driverEmployeeId).filter(Boolean) as string[]);
    return { business, employees, owner, isOwner, isMember, driverIds };
  }, [businessId, currentUser?.id]);

  // Owner-only editing state.
  const [adding, setAdding] = useState(false);
  const [staged, setStaged] = useState<NewEmployeeInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Which tier sections are collapsed (default: all open).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees, owner, isOwner, isMember, driverIds } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Team' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }

  const chatAccessIds = new Set(business.chatRecipientIds ?? []);
  const callHandlerIdSet = new Set(business.callHandlerIds ?? []);
  const repliers = [
    owner?.name ?? 'Owner',
    ...employees.filter((e) => chatAccessIds.has(e.id)).map((e) => e.displayName),
  ];

  // Sort each employee into exactly one tier. Managers stay managers even if
  // they drive; among the rest, vehicle drivers split out from plain staff.
  const managers = employees.filter((e) => (e.level ?? 'staff') === 'manager');
  const nonManagers = employees.filter((e) => (e.level ?? 'staff') !== 'manager');
  const drivers = nonManagers.filter((e) => driverIds.has(e.id));
  const staff = nonManagers.filter((e) => !driverIds.has(e.id));

  const employeeSub = (e: Employee) =>
    `${cap(e.level ?? 'staff')}${e.role ? ` · ${e.role}` : ''}${
      chatAccessIds.has(e.id) ? ' · chat access' : ''
    }${callHandlerIdSet.has(e.id) ? ' · takes calls' : ''}`;

  const toggleSection = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  };

  const commitAdd = async () => {
    if (staged.length === 0) {
      setAdding(false);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      for (const member of staged) await repos.employees.add(business.id, member);
      setStaged([]);
      setAdding(false);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not add the member. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await repos.employees.remove(id);
      setConfirmRemoveId(null);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove the member. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const employeeRow = (e: Employee) => (
    <MemberRow
      key={e.id}
      name={e.displayName}
      sub={employeeSub(e)}
      // Only the owner can take a member off the team.
      onRemove={isOwner && !busy ? () => setConfirmRemoveId(e.id) : undefined}
      confirming={confirmRemoveId === e.id}
      onConfirmRemove={() => removeMember(e.id)}
      onCancelRemove={() => setConfirmRemoveId(null)}
      busy={busy}
    />
  );

  const section = (key: string, title: string, rows: ReactNode[]) => {
    if (rows.length === 0) return null;
    const open = !collapsed[key];
    return (
      <View key={key} style={styles.section}>
        <Pressable
          onPress={() => toggleSection(key)}
          style={[styles.sectionHeader, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${rows.length}`}
        >
          <Text tone="muted" style={styles.sectionChevron}>
            {open ? '▾' : '▸'}
          </Text>
          <Text weight="semibold" style={styles.flex}>
            {title}
          </Text>
          <Text variant="caption" tone="muted">
            {rows.length}
          </Text>
        </Pressable>
        {open ? <View style={styles.sectionBody}>{rows}</View> : null}
      </View>
    );
  };

  const ownerRow = (
    <MemberRow
      key="owner"
      name={owner?.name ?? 'Owner'}
      sub={`Owner${business.ownerHandlesCalls !== false ? ' · takes calls' : ''}`}
    />
  );

  return (
    <Screen scroll>
      <Stack.Screen
        options={{
          title: 'Team',
          headerRight:
            isOwner && !adding
              ? () => (
                  <Text
                    tone="accent"
                    weight="semibold"
                    style={styles.headerAdd}
                    onPress={() => {
                      setAdding(true);
                      setConfirmRemoveId(null);
                    }}
                  >
                    ＋ Add
                  </Text>
                )
              : undefined,
        }}
      />

      {isOwner && adding ? (
        <Card style={styles.addCard}>
          <Text weight="semibold" style={styles.addTitle}>
            Add team members
          </Text>
          <Text variant="caption" tone="muted" style={styles.hint}>
            Add by name, or link a registered user so customers can view their profile. New
            members receive chats and calls by default — fine-tune that in Manage.
          </Text>
          <EmployeeEditor value={staged} onChange={setStaged} />
          <View style={styles.addActions}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setStaged([]);
                setAdding(false);
                setActionError(null);
              }}
              style={styles.addBtn}
            />
            <Button
              title={staged.length > 0 ? `Add ${staged.length} to team` : 'Add to team'}
              onPress={commitAdd}
              loading={busy}
              style={styles.addBtnWide}
            />
          </View>
        </Card>
      ) : null}

      {section('owner', 'Owner', [ownerRow])}
      {section('managers', 'Managers', managers.map(employeeRow))}
      {section('staff', 'Staff', staff.map(employeeRow))}
      {section('drivers', 'Drivers', drivers.map(employeeRow))}

      {actionError ? (
        <Text variant="caption" tone="danger" style={styles.actionError}>
          {actionError}
        </Text>
      ) : null}

      {isOwner ? (
        <View style={styles.ownerBlock}>
          <Text variant="caption" tone="muted" style={[styles.hint, styles.repliers]}>
            Can reply to chats: {repliers.join(', ')}.
          </Text>
          <Button
            title="⚙️ Manage roles, calls & chat access"
            variant="secondary"
            onPress={() => router.push(`/manage/${business.id}`)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function MemberRow({
  name,
  sub,
  onRemove,
  confirming,
  onConfirmRemove,
  onCancelRemove,
  busy,
}: {
  name: string;
  sub: string;
  onRemove?: () => void;
  confirming?: boolean;
  onConfirmRemove?: () => void;
  onCancelRemove?: () => void;
  busy?: boolean;
}) {
  const colors = useColors();
  return (
    <Card style={styles.memberCard}>
      <View style={styles.memberRow}>
        <Avatar name={name} size={38} />
        <View style={styles.memberInfo}>
          <Text weight="medium">{name}</Text>
          <Text variant="caption" tone="muted">
            {sub}
          </Text>
        </View>
        {onRemove && !confirming ? (
          <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${name}`}>
            <Text tone="danger" weight="semibold">
              Remove
            </Text>
          </Pressable>
        ) : null}
      </View>

      {confirming ? (
        <View style={[styles.confirmRow, { borderTopColor: colors.border }]}>
          <Text variant="caption" tone="muted" style={styles.confirmText}>
            Remove {name} from the team?
          </Text>
          <Pressable onPress={onCancelRemove} hitSlop={6} disabled={busy}>
            <Text weight="semibold">Cancel</Text>
          </Pressable>
          <Pressable onPress={onConfirmRemove} hitSlop={6} disabled={busy}>
            <Text tone="danger" weight="bold">
              Remove
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerAdd: { paddingHorizontal: spacing.md, fontSize: 16 },
  section: { marginBottom: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sectionChevron: { width: 16, textAlign: 'center' },
  sectionBody: { marginTop: spacing.sm },
  memberCard: { marginBottom: spacing.sm },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  memberInfo: { flex: 1 },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  confirmText: { flex: 1 },
  actionError: { marginBottom: spacing.sm },
  ownerBlock: { marginTop: spacing.lg },
  addCard: { marginBottom: spacing.md },
  addTitle: { marginBottom: spacing.xs },
  addActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  addBtn: { flex: 1 },
  addBtnWide: { flex: 2 },
  hint: { marginBottom: spacing.md },
  repliers: { marginTop: spacing.md },
});
