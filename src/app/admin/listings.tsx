/**
 * Admin › Find & set up a listing — the onboarding desk.
 *
 * List a shop for someone who isn't going to do it themselves, then open the
 * owner-facing screens and finish the job: price the menu, put the first offer
 * up, sort the team. A super-admin passes every access check (domain/access.ts
 * + the RLS policies), so these are the REAL screens, not admin copies of them.
 *
 * It opens on EVERY listing rather than an empty search box: the platform
 * operator's most common question is "what's on here?", not "where is this one
 * shop?". Typing narrows the same list.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { Button, Card, Input, Screen, Tag, Text } from '@/components/ui';
import { AdminGate } from '@/features/admin/AdminGate';
import { spacing, useColors } from '@/theme/theme';

export default function AdminListingsScreen() {
  return (
    <Screen scroll>
      <AdminGate>
        <ListingDesk />
      </AdminGate>
    </Screen>
  );
}

function ListingDesk() {
  const { currentUser } = useAuth();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();

  const isAdmin = isSuperAdminUser(currentUser);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 300);
  const term = debounced.trim();

  // No term = the whole platform. Sorted by name so browsing is stable and a
  // listing stays where you last saw it; search results keep the repo's order.
  const { data: results, loading } = useAsync(
    async () => {
      if (!isAdmin) return [];
      if (term.length > 1) return repos.businesses.list({ search: term });
      const all = await repos.businesses.list();
      return [...all].sort((a, b) => a.name.localeCompare(b.name));
    },
    [isAdmin, term],
  );

  const rows = results ?? [];
  const searching = term.length > 1;
  const mine = rows.filter((b) => b.ownerId === currentUser?.id).length;

  return (
    <>
      <Card style={styles.card}>
        <Text weight="semibold" style={styles.cardTitle}>
          Register a business for someone
        </Text>
        <Button title="＋ Register a business" onPress={() => router.push('/register')} />
      </Card>

      <Text weight="semibold" style={styles.sectionTitle}>
        Every listing
      </Text>
      <Input placeholder="Search by name…" value={query} onChangeText={setQuery} autoCorrect={false} />

      {loading ? (
        <Text variant="caption" tone="muted" style={styles.count}>
          {searching ? 'Searching…' : 'Loading listings…'}
        </Text>
      ) : (
        <Text variant="caption" tone="muted" style={styles.count}>
          {searching
            ? `${rows.length} match${rows.length === 1 ? '' : 'es'} for “${term}”`
            : `${rows.length} listing${rows.length === 1 ? '' : 's'} on the platform`}
          {mine ? ` · ${mine} under your account` : ''}
        </Text>
      )}

      {rows.map((b) => (
        <Card key={b.id} style={styles.result}>
          <View style={styles.head}>
            <View style={styles.name}>
              <Text weight="semibold" numberOfLines={1}>
                {b.name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {b.tagline || b.providerType || b.type}
              </Text>
            </View>
            {b.ownerId === currentUser?.id ? <Tag label="Yours" tone="brand" /> : null}
          </View>
          <View style={styles.actions}>
            <Tag label="Page" onPress={() => router.push(`/business/${b.id}`)} />
            <Tag label="Workspace" onPress={() => router.push(`/workspace/${b.id}`)} />
            <Tag label="Menu & pricing" onPress={() => router.push(`/manage/${b.id}`)} />
            <Tag label="Offers" onPress={() => router.push(`/workspace/${b.id}/offers`)} />
            <Tag label="Promote" onPress={() => router.push(`/promote/${b.id}`)} />
          </View>
        </Card>
      ))}

      {!loading && rows.length === 0 ? (
        <Text variant="caption" tone="muted" style={[styles.empty, { color: colors.textMuted }]}>
          {searching ? `No business matches “${term}”.` : 'No listings on the platform yet.'}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.xl },
  cardTitle: { marginBottom: spacing.xs },
  sectionTitle: { marginBottom: spacing.xs },
  count: { marginTop: spacing.sm, marginBottom: spacing.sm },
  result: { marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  empty: { marginTop: spacing.sm },
});
