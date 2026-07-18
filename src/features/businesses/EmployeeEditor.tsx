/**
 * Editor for a business's team while registering.
 *
 * Supports the two cases the product calls for:
 *  - Add a registered user by searching — links their account (userId) so their
 *    public profile is reachable from the listing. Picking one stages them and
 *    asks their role/designation before they join the list.
 *  - Add a plain name (+ role) for someone without an account.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NewEmployeeInput } from '@/data/repositories';
import { useRepositories } from '@/data/DataProvider';
import { Avatar, AutocompleteInput, Button, Card, Input, Tag, Text } from '@/components/ui';
import type { User } from '@/domain/types';
import { ROLE_SUGGESTIONS } from '@/domain/roles';
import { spacing } from '@/theme/theme';

export interface EmployeeEditorProps {
  value: NewEmployeeInput[];
  onChange: (next: NewEmployeeInput[]) => void;
}

export function EmployeeEditor({ value, onChange }: EmployeeEditorProps) {
  const repos = useRepositories();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  // A tapped search result waits here while we ask their role/designation.
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [pendingRole, setPendingRole] = useState('');
  // Why: a silently disabled Add button reads as broken — keep it tappable
  // and explain what's missing instead.
  const [error, setError] = useState<string | null>(null);

  const addPlain = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Type the team member’s name in the box above first.');
      return;
    }
    onChange([...value, { displayName: trimmed, role: role.trim() || undefined }]);
    setName('');
    setRole('');
    setError(null);
  };

  // A name typed but never "Add"ed would silently vanish when the user moves
  // on (e.g. taps Next in the register wizard). Commit it on unmount instead —
  // and a staged registered user the same way, keeping whatever role they got.
  const latest = useRef({ name, role, pendingUser, pendingRole, value, onChange });
  latest.current = { name, role, pendingUser, pendingRole, value, onChange };
  useEffect(
    () => () => {
      const pending = latest.current;
      const next = [...pending.value];
      const trimmed = pending.name.trim();
      if (trimmed) next.push({ displayName: trimmed, role: pending.role.trim() || undefined });
      if (pendingUserAddable(pending.pendingUser, next)) {
        next.push({
          displayName: pending.pendingUser!.name,
          userId: pending.pendingUser!.id,
          role: pending.pendingRole.trim() || undefined,
        });
      }
      if (next.length !== pending.value.length) pending.onChange(next);
    },
    [],
  );

  const stageRegistered = (user: User) => {
    if (value.some((e) => e.userId === user.id)) return; // avoid duplicates
    setPendingUser(user);
    setPendingRole('');
    setSearchTerm('');
    setResults([]);
  };

  const confirmRegistered = () => {
    if (!pendingUser) return;
    onChange([
      ...value,
      {
        displayName: pendingUser.name,
        userId: pendingUser.id,
        role: pendingRole.trim() || undefined,
      },
    ]);
    setPendingUser(null);
    setPendingRole('');
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const runSearch = async (term: string) => {
    setSearchTerm(term);
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(await repos.users.search(term));
    } finally {
      setSearching(false);
    }
  };

  return (
    <View>
      {value.length > 0 ? (
        <View style={styles.chips}>
          {value.map((emp, i) => (
            <Tag
              key={`${emp.displayName}-${i}`}
              label={`${emp.displayName}${emp.role ? ` · ${emp.role}` : ''}${emp.userId ? ' ✓' : ''}`}
              onPress={() => remove(i)}
              style={styles.chip}
            />
          ))}
        </View>
      ) : null}
      {value.length > 0 ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          Tap a member to remove. ✓ means a linked account (their profile will be reachable).
        </Text>
      ) : null}

      <Input
        label="Add by name"
        placeholder="Team member's name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          if (error) setError(null);
        }}
        onSubmitEditing={addPlain}
        returnKeyType="done"
      />
      <AutocompleteInput
        label="Their role / designation"
        placeholder="Type a few letters — e.g. Man…, Driv…"
        helper="Pick from the list or type your own. Leave blank for Staff."
        value={role}
        onChangeText={setRole}
        options={ROLE_SUGGESTIONS}
      />
      {error ? (
        <Text variant="caption" tone="danger" style={styles.hint}>
          {error}
        </Text>
      ) : null}
      <Button title="Add name" variant="secondary" onPress={addPlain} />

      <Input
        label="Or link a registered user"
        placeholder="Search by name…"
        value={searchTerm}
        onChangeText={runSearch}
        autoCorrect={false}
        style={styles.searchSpacing}
      />
      {searching ? <Text variant="caption" tone="muted">Searching…</Text> : null}
      {!pendingUser
        ? results.map((user) => (
            <Card key={user.id} onPress={() => stageRegistered(user)} style={styles.resultCard}>
              <View style={styles.resultRow}>
                <Avatar name={user.name} size={36} />
                <View style={styles.resultInfo}>
                  <Text weight="medium">{user.name}</Text>
                  <Text variant="caption" tone="muted">
                    {user.isProfilePublic ? 'Public profile' : 'Private profile'}
                  </Text>
                </View>
                <Text tone="brand" variant="label" weight="medium">
                  Add
                </Text>
              </View>
            </Card>
          ))
        : null}

      {pendingUser ? (
        <Card style={styles.resultCard}>
          <View style={styles.resultRow}>
            <Avatar name={pendingUser.name} size={36} />
            <View style={styles.resultInfo}>
              <Text weight="medium">{pendingUser.name}</Text>
              <Text variant="caption" tone="muted">
                Linked account — what do they do here?
              </Text>
            </View>
          </View>
          <View style={styles.pendingRole}>
            <AutocompleteInput
              label="Their role / designation"
              placeholder="Type a few letters — e.g. Man…, Chef…"
              helper="Pick from the list or type your own. Leave blank for Staff."
              value={pendingRole}
              onChangeText={setPendingRole}
              options={ROLE_SUGGESTIONS}
            />
          </View>
          <View style={styles.pendingButtons}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setPendingUser(null)}
              style={styles.pendingBtn}
            />
            <Button
              title={`Add ${pendingUser.name}`}
              variant="secondary"
              onPress={confirmRegistered}
              style={styles.pendingBtnWide}
            />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

/** Staged user still valid to auto-commit (set, and not already in the list). */
function pendingUserAddable(user: User | null, list: NewEmployeeInput[]): boolean {
  return !!user && !list.some((e) => e.userId === user.id);
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { marginRight: 0 },
  hint: { marginBottom: spacing.md },
  searchSpacing: { marginTop: spacing.sm },
  resultCard: { marginBottom: spacing.sm },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resultInfo: { flex: 1 },
  pendingRole: { marginTop: spacing.md },
  pendingButtons: { flexDirection: 'row', gap: spacing.sm },
  pendingBtn: { flex: 1 },
  pendingBtnWide: { flex: 2 },
});
