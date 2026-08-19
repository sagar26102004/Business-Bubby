/**
 * Workspace › Access & permissions (owner only). The owner decides which
 * workspace tools each team member may open — Orders, Billing, the Logbook,
 * and so on. Writes `Employee.permissions`.
 *
 * This is the ACCESS axis. Who receives customer calls/chats/scans (contact
 * ROUTING) is a separate thing, set in Manage — a member can have chat access
 * without being able to open the Billing tool, and vice versa.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import type { Employee } from '@/domain/types';
import { isManagerOrOwner, offeredServices } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

export default function WorkspaceAccessScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const dismiss = useDismiss(`/workspace/${businessId}`);
  const colors = useColors();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(business.id);
    return { business, employees };
  }, [businessId]);

  // grants[employeeId] = set of granted OFFERED service ids.
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});
  // Any granted ids for services this business no longer offers (a module
  // turned off) are preserved untouched, so re-enabling the module restores
  // them instead of silently revoking.
  const [preserved, setPreserved] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    const offered = offeredServices(data.business);
    const offeredIds = new Set<string>(offered.map((s) => s.id));
    const g: Record<string, Set<string>> = {};
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
    setGrants(g);
    setPreserved(p);
  }, [data]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const meEmployee = data.employees.find((e) => e.userId && e.userId === currentUser?.id);
  if (!isManagerOrOwner(data.business, meEmployee, currentUser)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Access' }} />
        <EmptyView
          title="Owners & managers only"
          subtitle="Only the owner and managers can set who accesses what."
        />
      </Screen>
    );
  }

  const { business, employees } = data;
  const offered = offeredServices(business);
  const withAccounts = employees.filter((e) => e.userId);
  const withoutAccounts = employees.filter((e) => !e.userId);

  const toggle = (empId: string, serviceId: string) =>
    setGrants((prev) => {
      const next = new Set(prev[empId] ?? []);
      next.has(serviceId) ? next.delete(serviceId) : next.add(serviceId);
      return { ...prev, [empId]: next };
    });

  const setAll = (empId: string, on: boolean) =>
    setGrants((prev) => ({
      ...prev,
      [empId]: on ? new Set(offered.map((s) => s.id)) : new Set(),
    }));

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all(
        employees.map((e) => {
          const granted = Array.from(grants[e.id] ?? []);
          const permissions = [...(preserved[e.id] ?? []), ...granted];
          const patch: Partial<Employee> = { permissions };
          return repos.employees.update(e.id, patch);
        }),
      );
      showAlert('Saved', 'Team access updated.');
      dismiss();
    } catch (err) {
      showAlert('Could not save', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Access' }} />

      {withAccounts.length === 0 ? (
        <Card style={styles.card}>
          <Text weight="semibold">No team members with an app account yet</Text>
          <Text variant="caption" tone="muted" style={styles.role}>
            Access only applies to members who can sign in. Add a registered user to your team, then
            grant them tools here.
          </Text>
          <Button
            title="🧑‍🤝‍🧑 Go to Team"
            variant="secondary"
            onPress={() => router.push(`/workspace/${business.id}/team`)}
            style={styles.teamBtn}
          />
        </Card>
      ) : null}

      {withAccounts.map((emp) => {
        const set = grants[emp.id] ?? new Set<string>();
        const allOn = offered.every((s) => set.has(s.id));
        const noneOn = offered.every((s) => !set.has(s.id));
        return (
          <Card key={emp.id} style={styles.card}>
            <View style={styles.memberHead}>
              <View style={styles.memberInfo}>
                <Text weight="semibold">{emp.displayName}</Text>
                <Text variant="caption" tone="muted">
                  {cap(emp.level ?? 'staff')}
                  {emp.role ? ` · ${emp.role}` : ''}
                </Text>
              </View>
              <View style={styles.quickRow}>
                <Tag label="All" selected={allOn} onPress={() => setAll(emp.id, true)} />
                <Tag label="None" selected={noneOn} onPress={() => setAll(emp.id, false)} />
              </View>
            </View>

            {offered.map((s, i) => (
              <View
                key={s.id}
                style={[
                  styles.switchRow,
                  i === 0 && styles.firstSwitchRow,
                  { borderTopColor: colors.border },
                ]}
              >
                <View style={styles.serviceInfo}>
                  <Text>
                    {s.icon} {s.label}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {s.description}
                  </Text>
                </View>
                <Switch value={set.has(s.id)} onValueChange={() => toggle(emp.id, s.id)} />
              </View>
            ))}
          </Card>
        );
      })}

      {withoutAccounts.length > 0 ? (
        <Text variant="caption" tone="muted" style={styles.footnote}>
          {withoutAccounts.map((e) => e.displayName).join(', ')}{' '}
          {withoutAccounts.length === 1 ? 'has' : 'have'} no app account — link a registered user in
          Team to grant them access.
        </Text>
      ) : null}

      {withAccounts.length > 0 ? (
        <Button title="Save" onPress={save} loading={saving} style={styles.save} />
      ) : null}
    </Screen>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  role: { marginTop: 2 },
  teamBtn: { marginTop: spacing.md },
  memberHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  memberInfo: { flex: 1 },
  quickRow: { flexDirection: 'row', gap: spacing.xs },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  firstSwitchRow: { marginTop: spacing.md, paddingTop: spacing.md },
  serviceInfo: { flex: 1, paddingRight: spacing.md },
  footnote: { marginTop: spacing.xs, marginBottom: spacing.md },
  save: { marginTop: spacing.lg },
});
