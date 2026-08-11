/**
 * Super-admin owner picker — choose which registered user a business belongs to.
 *
 * Used on the register wizard's "owner" step (shown only to super-admins) and on
 * the business page's reassign-owner control. Search registered users by name;
 * `null` means "myself" (the acting super-admin), so a super-admin can also just
 * list something under their own account.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { User } from '@/domain/types';
import { useRepositories } from '@/data/DataProvider';
import { Avatar, Button, Card, Input, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

export interface OwnerPickerProps {
  /** The chosen owner, or null when it should belong to the acting user. */
  value: User | null;
  onChange: (user: User | null) => void;
  /** Label for the "belongs to me" option, e.g. "Me (Sagar)". */
  selfLabel: string;
  /** Hide the "belongs to me" reset (e.g. when reassigning away from yourself). */
  hideSelf?: boolean;
}

export function OwnerPicker({ value, onChange, selfLabel, hideSelf }: OwnerPickerProps) {
  const repos = useRepositories();
  const colors = useColors();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

  const runSearch = async (next: string) => {
    setTerm(next);
    if (next.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(await repos.users.search(next));
    } finally {
      setSearching(false);
    }
  };

  const pick = (user: User | null) => {
    onChange(user);
    setTerm('');
    setResults([]);
  };

  const selectedRow = (label: string, sublabel: string, name?: string) => (
    <Card style={[styles.selected, { borderColor: colors.brand }]}>
      <View style={styles.row}>
        <Avatar name={name ?? label} size={36} />
        <View style={styles.info}>
          <Text weight="semibold">{label}</Text>
          <Text variant="caption" tone="brand">
            {sublabel}
          </Text>
        </View>
        <Text tone="brand" weight="bold">
          ✓
        </Text>
      </View>
    </Card>
  );

  return (
    <View>
      {value
        ? selectedRow(value.name, 'Will own this listing', value.name)
        : !hideSelf
          ? selectedRow(selfLabel, 'You’ll own this listing')
          : null}

      {value && !hideSelf ? (
        <Button
          title={`↩︎ List it under ${selfLabel} instead`}
          variant="ghost"
          onPress={() => pick(null)}
          style={styles.reset}
        />
      ) : null}

      <Input
        label={value ? 'Choose someone else' : 'Assign to a registered user'}
        placeholder="Search by name…"
        value={term}
        onChangeText={runSearch}
        autoCorrect={false}
      />
      {searching ? (
        <Text variant="caption" tone="muted">
          Searching…
        </Text>
      ) : null}
      {term.trim().length >= 2 && !searching && results.length === 0 ? (
        <Text variant="caption" tone="muted">
          No one found. They need a public One Place account first.
        </Text>
      ) : null}
      {results.map((user) => (
        <Card key={user.id} onPress={() => pick(user)} style={styles.resultCard}>
          <View style={styles.row}>
            <Avatar name={user.name} size={36} />
            <View style={styles.info}>
              <Text weight="medium">{user.name}</Text>
              <Text variant="caption" tone="muted">
                {user.phone ? user.phone : user.isProfilePublic ? 'Public profile' : 'Private profile'}
              </Text>
            </View>
            <Text tone="brand" variant="label" weight="medium">
              Choose
            </Text>
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  selected: { marginBottom: spacing.sm, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
  reset: { marginBottom: spacing.sm, alignSelf: 'flex-start' },
  resultCard: { marginBottom: spacing.sm },
});
