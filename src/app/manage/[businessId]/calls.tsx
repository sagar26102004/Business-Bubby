/**
 * Who the business reaches customers through: who rings on a voice call, who
 * may reply to chats, who can scan an order QR — and, since it's the same list
 * of people, each member's rank and whether customers see them on the page.
 *
 * Two writes on one Save: the routing lives on the Business, the rank and the
 * "show on page" flag live on each Employee row. The employee rows go first so
 * a failure there stops before the listing is touched.
 */
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import type { Employee, EmployeeLevel } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { ManageGate, type ManageFormProps } from '@/features/businesses/ManageGate';
import { Button, Card, Tag, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

export default function ManageCallsScreen() {
  return (
    <ManageGate
      title="Calls & chat"
      need="owner"
      Form={CallsForm}
    />
  );
}

function CallsForm({ business, employees, save, saving }: ManageFormProps) {
  const repos = useRepositories();
  const { currentUser } = useAuth();
  const colors = useColors();

  const [levels, setLevels] = useState<Record<string, EmployeeLevel>>(() =>
    Object.fromEntries(employees.map((e) => [e.id, e.level ?? 'staff'])),
  );
  const [callSet, setCallSet] = useState(new Set(business.callHandlerIds ?? []));
  const [chatSet, setChatSet] = useState(new Set(business.chatRecipientIds ?? []));
  const [scanSet, setScanSet] = useState(new Set(business.scanHandlerIds ?? []));
  const [showSet, setShowSet] = useState(
    () => new Set(employees.filter((e) => e.showOnPage).map((e) => e.id)),
  );
  const [ownerOnCalls, setOwnerOnCalls] = useState(business.ownerHandlesCalls !== false);
  const [busy, setBusy] = useState(false);

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  };

  // Only registered members actually ring — warn when nobody would.
  const noCallReceivers = !ownerOnCalls && !employees.some((e) => callSet.has(e.id) && e.userId);

  const submit = async () => {
    setBusy(true);
    try {
      await Promise.all(
        employees.flatMap((e) => {
          const patch: Partial<Employee> = {};
          if (levels[e.id] && levels[e.id] !== (e.level ?? 'staff')) patch.level = levels[e.id];
          if (showSet.has(e.id) !== !!e.showOnPage) patch.showOnPage = showSet.has(e.id);
          return Object.keys(patch).length > 0 ? [repos.employees.update(e.id, patch)] : [];
        }),
      );
    } catch (err) {
      showAlert('Could not save', err instanceof Error ? err.message : 'Try again.');
      setBusy(false);
      return;
    }
    setBusy(false);
    await save({
      callHandlerIds: Array.from(callSet),
      ownerHandlesCalls: ownerOnCalls,
      chatRecipientIds: Array.from(chatSet),
      scanHandlerIds: Array.from(scanSet),
    });
  };

  return (
    <>
      {/* Owner row — chats always on, calls opt-in/out */}
      <Card style={styles.card}>
        <Text weight="semibold">{currentUser?.name ?? 'You'} · Owner</Text>
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

      {employees.length === 0 ? (
        <Text tone="muted" style={styles.empty}>
          No employees yet. Add them from your workspace’s Team screen.
        </Text>
      ) : (
        employees.map((emp) => (
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

      <Button title="Save" onPress={submit} loading={saving || busy} style={styles.save} />
    </>
  );
}

const styles = StyleSheet.create({
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
  save: { marginTop: spacing.lg },
});
