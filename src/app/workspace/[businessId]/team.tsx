/**
 * Workspace › Team & access — the hierarchy (owner + employees) and which
 * workspace tools each of them may open, on one screen.
 *
 * Members are grouped into collapsible tiers — Owner, Managers, Staff, Drivers
 * — so a big team reads at a glance. Every member can see the team; the owner
 * can add and remove members; the owner and managers set ACCESS:
 *  - an "Access" button at the right end of a tier header opens a whole-group
 *    panel that grants or revokes a tool for everyone in that tier at once (a
 *    group switch reads ON only when every member of the tier has the tool);
 *  - the same button on a member's card opens just their switches.
 * Access edits are held locally and written with the Save bar that appears
 * while there are unsaved changes. They write `Employee.permissions`.
 *
 * Access only applies to members with an app account — someone added by name
 * alone can't sign in, so their card has no Access button.
 *
 * The same panels also carry two CONTACT switches — 💬 Chat and 📞 Calls. They
 * are not tools: they edit the business's routing (`chatRecipientIds` /
 * `callHandlerIds`, also set in Manage › Calls & chat), i.e. who may reply to
 * customer chats and who rings on a customer's voice call. They save with the
 * same bar, as one write to the Business.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { Employee } from '@/domain/types';
import type { NewEmployeeInput } from '@/data/repositories';
import {
  isBusinessTeamMember,
  isManagerOrOwner,
  offeredServices,
  type ServiceDef,
} from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Avatar,
  BottomActionBar,
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { EmployeeEditor } from '@/features/businesses/EmployeeEditor';
import { radius, spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';
import {
  TIER_TITLES,
  TierSection,
  animateToggle,
  splitTiers,
  type TierId,
} from '@/features/workspace/TierSection';

type Grants = Record<string, Set<string>>;

/** One row in an access panel — a workspace tool or a contact switch. */
type SwitchDef = Pick<ServiceDef, 'label' | 'icon' | 'description'> & { id: string };

/** Pseudo-ids for the two routing switches, kept apart from service ids. */
const CONTACT_CHAT = 'contact:chat';
const CONTACT_CALLS = 'contact:calls';
const CONTACT_SWITCHES: SwitchDef[] = [
  {
    id: CONTACT_CHAT,
    label: 'Chat',
    icon: '💬',
    description: 'Reply to customer chats and get notified when one comes in.',
  },
  {
    id: CONTACT_CALLS,
    label: 'Calls',
    icon: '📞',
    description: 'Ring on customer voice calls.',
  },
];
const isContactId = (id: string) => id === CONTACT_CHAT || id === CONTACT_CALLS;

const sameSet = (a: Set<string> | undefined, b: Set<string> | undefined) =>
  (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every((x) => b?.has(x));

export default function WorkspaceTeamScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const { currentUser } = useAuth();

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
    const canSetAccess = isManagerOrOwner(business, meEmployee, currentUser);
    // Anyone pinned as a vehicle's driver is grouped under Drivers.
    const driverIds = new Set(vehicles.map((v) => v.driverEmployeeId).filter(Boolean) as string[]);
    return { business, employees, owner, isOwner, isMember, canSetAccess, driverIds };
  }, [businessId, currentUser?.id]);

  // Owner-only team editing state.
  const [adding, setAdding] = useState(false);
  const [staged, setStaged] = useState<NewEmployeeInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Which tier sections are collapsed (default: all open).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Access editing state. grants[employeeId] = granted OFFERED service ids;
  // `baseline` is what's saved, so the difference is what's unsaved.
  const [grants, setGrants] = useState<Grants>({});
  const baseline = useRef<Grants>({});
  // Granted ids for services this business no longer offers (a module turned
  // off) are preserved untouched, so re-enabling the module restores them
  // instead of silently revoking.
  const [preserved, setPreserved] = useState<Record<string, string[]>>({});
  // Contact routing per member: which of CONTACT_CHAT / CONTACT_CALLS they're
  // on. Same baseline/unsaved pattern as `grants`, saved onto the Business.
  const [contact, setContact] = useState<Grants>({});
  const contactBaseline = useRef<Grants>({});
  const [saving, setSaving] = useState(false);
  const [openMembers, setOpenMembers] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!data) return;
    const offered = offeredServices(data.business);
    const offeredIds = new Set<string>(offered.map((s) => s.id));
    const g: Grants = {};
    const p: Record<string, string[]> = {};
    data.employees.forEach((e) => {
      if (!e.permissions) {
        // No explicit list → the rank-based default: managers keep every tool,
        // staff start with none (mirrors canAccessService).
        const all = (e.level ?? 'staff') === 'manager';
        g[e.id] = all ? new Set(offered.map((s) => s.id)) : new Set();
        p[e.id] = [];
      } else {
        g[e.id] = new Set(e.permissions.filter((id) => offeredIds.has(id)));
        p[e.id] = e.permissions.filter((id) => !offeredIds.has(id));
      }
    });
    // A refetch (focus, add/remove) must not wipe switches the owner has
    // flipped but not saved yet — keep those, take everything else fresh.
    const before = baseline.current;
    baseline.current = g;
    setGrants((prev) => {
      const next = { ...g };
      for (const id of Object.keys(g)) {
        if (prev[id] && !sameSet(prev[id], before[id])) next[id] = prev[id];
      }
      return next;
    });
    setPreserved(p);

    const chatIds = new Set(data.business.chatRecipientIds ?? []);
    const callIds = new Set(data.business.callHandlerIds ?? []);
    const c: Grants = {};
    data.employees.forEach((e) => {
      c[e.id] = new Set();
      if (chatIds.has(e.id)) c[e.id].add(CONTACT_CHAT);
      if (callIds.has(e.id)) c[e.id].add(CONTACT_CALLS);
    });
    const contactBefore = contactBaseline.current;
    contactBaseline.current = c;
    setContact((prev) => {
      const next = { ...c };
      for (const id of Object.keys(c)) {
        if (prev[id] && !sameSet(prev[id], contactBefore[id])) next[id] = prev[id];
      }
      return next;
    });
  }, [data]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees, owner, isOwner, isMember, canSetAccess, driverIds } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Team & access' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }

  const offered = offeredServices(business);
  const switches: SwitchDef[] = [...CONTACT_SWITCHES, ...offered];
  const allIds = switches.map((s) => s.id);
  const tiers = splitTiers(employees, driverIds);

  const has = (empId: string, id: string) =>
    (isContactId(id) ? contact[empId] : grants[empId])?.has(id) ?? false;
  const grantDirtyIds = employees
    .filter((e) => !sameSet(grants[e.id], baseline.current[e.id]))
    .map((e) => e.id);
  const contactDirtyIds = employees
    .filter((e) => !sameSet(contact[e.id], contactBaseline.current[e.id]))
    .map((e) => e.id);
  const dirtyIds = Array.from(new Set([...grantDirtyIds, ...contactDirtyIds]));

  const employeeSub = (e: Employee) =>
    `${cap(e.level ?? 'staff')}${e.role ? ` · ${e.role}` : ''}${
      has(e.id, CONTACT_CHAT) ? ' · chat access' : ''
    }${has(e.id, CONTACT_CALLS) ? ' · takes calls' : ''}${
      canSetAccess
        ? e.userId
          ? ` · ${offered.filter((s) => has(e.id, s.id)).length} of ${offered.length} tools`
          : ' · no app account'
        : ''
    }`;

  const toggleSection = (key: string) => {
    animateToggle();
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  };
  const toggleMember = (id: string) => {
    animateToggle();
    setOpenMembers((o) => ({ ...o, [id]: !o[id] }));
  };
  const toggleGroup = (t: TierId) => {
    animateToggle();
    setOpenGroups((o) => ({ ...o, [t]: !o[t] }));
    // Opening the group's switches also opens the tier, so they're visible.
    setCollapsed((c) => ({ ...c, [t]: false }));
  };

  /** Grant or revoke tools / contact switches for a set of members in one go. */
  const apply = (members: Employee[], ids: string[], on: boolean) => {
    const flip = (setter: typeof setGrants, which: string[]) => {
      if (which.length === 0) return;
      setter((prev) => {
        const next = { ...prev };
        for (const m of members) {
          const set = new Set(prev[m.id] ?? []);
          for (const id of which) (on ? set.add(id) : set.delete(id));
          next[m.id] = set;
        }
        return next;
      });
    };
    flip(setGrants, ids.filter((id) => !isContactId(id)));
    flip(setContact, ids.filter(isContactId));
  };

  const saveAccess = async () => {
    setSaving(true);
    try {
      await Promise.all(
        grantDirtyIds.map((id) =>
          repos.employees.update(id, {
            permissions: [...(preserved[id] ?? []), ...Array.from(grants[id] ?? [])],
          }),
        ),
      );
      if (contactDirtyIds.length > 0) {
        const routedTo = (which: string) =>
          employees.filter((e) => contact[e.id]?.has(which)).map((e) => e.id);
        await repos.businesses.update(business.id, {
          chatRecipientIds: routedTo(CONTACT_CHAT),
          callHandlerIds: routedTo(CONTACT_CALLS),
        });
      }
      baseline.current = { ...baseline.current, ...grants };
      contactBaseline.current = { ...contactBaseline.current, ...contact };
      setGrants((g) => ({ ...g }));
      showAlert('Saved', 'Team access updated.');
      await reload();
    } catch (err) {
      showAlert('Could not save', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const discardAccess = () => {
    setGrants({ ...baseline.current });
    setContact({ ...contactBaseline.current });
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

  const employeeRow = (e: Employee) => {
    const canGrant = canSetAccess && !!e.userId;
    const open = canGrant && !!openMembers[e.id];
    return (
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
        access={
          canGrant ? (
            <AccessButton open={open} label={`${e.displayName} access`} onPress={() => toggleMember(e.id)} />
          ) : null
        }
      >
        {open ? (
          <AccessSwitches
            services={switches}
            isOn={(id) => has(e.id, id)}
            onToggle={(id, on) => apply([e], [id], on)}
            onAll={(on) => apply([e], allIds, on)}
          />
        ) : null}
      </MemberRow>
    );
  };

  const tierSection = (t: TierId) => {
    const title = TIER_TITLES[t];
    const members = tiers[t];
    // Group access only reaches the members who can sign in.
    const grantable = members.filter((m) => m.userId);
    const groupOpen = canSetAccess && grantable.length > 0 && !!openGroups[t];
    const everyone = (id: string) => grantable.every((m) => has(m.id, id));
    const someone = (id: string) => grantable.some((m) => has(m.id, id));
    return (
      <TierSection
        key={t}
        title={title}
        count={members.length}
        open={!collapsed[t]}
        onToggle={() => toggleSection(t)}
        right={
          canSetAccess && grantable.length > 0 ? (
            <AccessButton open={groupOpen} label={`${title} access`} onPress={() => toggleGroup(t)} />
          ) : null
        }
      >
        {groupOpen ? (
          <GroupAccessCard
            title={`All ${title.toLowerCase()}`}
            sub={`Applies to ${grantable.length} ${grantable.length === 1 ? 'member' : 'members'}${
              grantable.length < members.length ? ' with an app account' : ''
            }`}
          >
            <AccessSwitches
              services={switches}
              isOn={everyone}
              isMixed={(id) => someone(id) && !everyone(id)}
              onToggle={(id, on) => apply(grantable, [id], on)}
              onAll={(on) => apply(grantable, allIds, on)}
            />
          </GroupAccessCard>
        ) : null}
        {members.map(employeeRow)}
      </TierSection>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Team & access',
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
      <Screen scroll>
        {isOwner && adding ? (
          <Card style={styles.addCard}>
            <Text weight="semibold" style={styles.addTitle}>
              Add team members
            </Text>
            <Text variant="caption" tone="muted" style={styles.hint}>
              Add by name, or link a registered user so customers can view their profile and you
              can grant them tools here. New members receive chats and calls by default — switch
              that off per member under Access.
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

        <TierSection
          title="Owner"
          count={1}
          open={!collapsed.owner}
          onToggle={() => toggleSection('owner')}
        >
          <MemberRow
            name={owner?.name ?? 'Owner'}
            sub={`Owner${business.ownerHandlesCalls !== false ? ' · takes calls' : ''}${
              canSetAccess ? ' · every tool' : ''
            }`}
          />
        </TierSection>
        {(Object.keys(TIER_TITLES) as TierId[]).map(tierSection)}

        {actionError ? (
          <Text variant="caption" tone="danger" style={styles.actionError}>
            {actionError}
          </Text>
        ) : null}
      </Screen>

      {dirtyIds.length > 0 ? (
        <BottomActionBar
          backLabel="Discard"
          onBack={discardAccess}
          primary={{ title: 'Save access', onPress: saveAccess, loading: saving }}
        >
          <Text variant="caption" tone="muted">
            Unsaved access changes for {dirtyIds.length}{' '}
            {dirtyIds.length === 1 ? 'member' : 'members'}.
          </Text>
        </BottomActionBar>
      ) : null}
    </View>
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
  access,
  children,
}: {
  name: string;
  sub: string;
  onRemove?: () => void;
  confirming?: boolean;
  onConfirmRemove?: () => void;
  onCancelRemove?: () => void;
  busy?: boolean;
  /** The Access button, at the row's right end. */
  access?: ReactNode;
  /** The member's access switches, when open. */
  children?: ReactNode;
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
        {access}
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

      {children}
    </Card>
  );
}

/** The right-hand button that shows or hides a set of access switches. */
function AccessButton({ open, label, onPress }: { open: boolean; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${open ? 'Hide' : 'Show'} ${label}`}
      style={({ pressed }) => [
        styles.accessBtn,
        open
          ? { backgroundColor: colors.brand, borderColor: colors.brand }
          : { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text variant="caption" weight="bold" tone={open ? 'inverse' : 'brand'}>
        {open ? 'Access ▴' : 'Access ▾'}
      </Text>
    </Pressable>
  );
}

/** The tinted card a tier's whole-group switches sit in. */
function GroupAccessCard({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <Card style={[styles.memberCard, { backgroundColor: colors.brandSoft, borderColor: colors.brand }]}>
      <Text weight="semibold">{title}</Text>
      <Text variant="caption" tone="muted">
        {sub}
      </Text>
      {children}
    </Card>
  );
}

/** All / None, then one switch per tool. */
function AccessSwitches({
  services,
  isOn,
  isMixed,
  onToggle,
  onAll,
}: {
  services: SwitchDef[];
  isOn: (serviceId: string) => boolean;
  isMixed?: (serviceId: string) => boolean;
  onToggle: (serviceId: string, on: boolean) => void;
  onAll: (on: boolean) => void;
}) {
  const colors = useColors();
  const allOn = services.every((s) => isOn(s.id));
  const noneOn = services.every((s) => !isOn(s.id) && !isMixed?.(s.id));
  return (
    <>
      <View style={styles.quickRow}>
        <Tag label="All" selected={allOn} onPress={() => onAll(true)} />
        <Tag label="None" selected={noneOn} onPress={() => onAll(false)} />
      </View>
      {services.map((s, i) => (
        <View key={s.id}>
          {i === 0 || isContactId(services[i - 1].id) !== isContactId(s.id) ? (
            <Text variant="caption" tone="muted" weight="bold" style={styles.switchGroup}>
              {isContactId(s.id) ? 'Customer contact' : 'Workspace tools'}
            </Text>
          ) : null}
          <View style={[styles.switchRow, { borderTopColor: colors.border }]}>
            <View style={styles.serviceInfo}>
              <Text>
                {s.icon} {s.label}
              </Text>
              <Text variant="caption" tone="muted">
                {isMixed?.(s.id) ? 'Some members have this' : s.description}
              </Text>
            </View>
            <Switch value={isOn(s.id)} onValueChange={(v) => onToggle(s.id, v)} />
          </View>
        </View>
      ))}
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerAdd: { paddingHorizontal: spacing.md, fontSize: 16 },
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
  addCard: { marginBottom: spacing.md },
  addTitle: { marginBottom: spacing.xs },
  addActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  addBtn: { flex: 1 },
  addBtnWide: { flex: 2 },
  hint: { marginBottom: spacing.md },
  accessBtn: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  quickRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  serviceInfo: { flex: 1, paddingRight: spacing.md },
  switchGroup: { marginTop: spacing.lg },
});
