/**
 * Workspace › Team — the hierarchy (owner + employees) with their chat/call
 * access. The owner can add and remove members right here, and jump to Manage
 * for the finer call/chat-access toggles. Members only.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Employee } from '@/domain/types';
import type { NewEmployeeInput } from '@/data/repositories';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Avatar, Button, Card, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { EmployeeEditor } from '@/features/businesses/EmployeeEditor';
import { spacing, useColors } from '@/theme/theme';

export default function WorkspaceTeamScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const { currentUser } = useAuth();
  const colors = useColors();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, owner] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.users.getById(business.ownerId),
    ]);
    const isOwner = currentUser?.id === business.ownerId;
    const isMember = isOwner || employees.some((e) => e.userId && e.userId === currentUser?.id);
    return { business, employees, owner, isOwner, isMember };
  }, [businessId, currentUser?.id]);

  // Owner-only editing state.
  const [adding, setAdding] = useState(false);
  const [staged, setStaged] = useState<NewEmployeeInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees, owner, isOwner, isMember } = data;
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

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Team' }} />

      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text tone="muted" style={styles.subtitle}>
            Everyone who runs {business.name}, with who can reply to chats and take calls.
          </Text>
        </View>
        {/* Adding a teammate lives right up here on the header, not buried below. */}
        {isOwner && !adding ? (
          <Button
            title="➕ Add"
            onPress={() => {
              setAdding(true);
              setConfirmRemoveId(null);
            }}
            style={styles.headerAddBtn}
          />
        ) : null}
      </View>

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

      <MemberRow
        name={owner?.name ?? 'Owner'}
        sub={`Owner${business.ownerHandlesCalls !== false ? ' · takes calls' : ''}`}
      />
      {employees.map((e: Employee) => (
        <MemberRow
          key={e.id}
          name={e.displayName}
          sub={`${cap(e.level ?? 'staff')}${e.role ? ` · ${e.role}` : ''}${
            chatAccessIds.has(e.id) ? ' · chat access' : ''
          }${callHandlerIdSet.has(e.id) ? ' · takes calls' : ''}`}
          // Only the owner can take a member off the team.
          onRemove={isOwner && !busy ? () => setConfirmRemoveId(e.id) : undefined}
          confirming={confirmRemoveId === e.id}
          onConfirmRemove={() => removeMember(e.id)}
          onCancelRemove={() => setConfirmRemoveId(null)}
          busy={busy}
        />
      ))}

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
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1 },
  headerAddBtn: { marginTop: spacing.xs },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
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
