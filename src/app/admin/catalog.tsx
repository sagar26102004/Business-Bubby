/**
 * Admin › Tags & offerings — the app's GROWING collection (CatalogRepository).
 *
 * Two jobs:
 *   1. Add business tags by hand — they immediately join the tag typeahead
 *      everywhere (register, Manage).
 *   2. Curate what listings have contributed automatically — hide junk/typos
 *      (they stop being suggested) or delete them outright.
 *
 * Everything an owner lists that the code catalog didn't know is captured here
 * live, so this is where the platform keeps that stream clean.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CatalogEntry, CatalogEntryKind } from '@/domain/types';
import { applyCatalogEntries } from '@/domain/catalogEntries';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  Input,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { AdminGate } from '@/features/admin/AdminGate';
import { spacing, useColors } from '@/theme/theme';

const KIND_META: Record<CatalogEntryKind, { label: string; icon: string }> = {
  tag: { label: 'Tags', icon: '🏷️' },
  dish: { label: 'Dishes', icon: '🍽️' },
  service: { label: 'Services', icon: '🛠️' },
  product: { label: 'Products', icon: '📦' },
};

type Filter = 'all' | CatalogEntryKind;

export default function AdminCatalogScreen() {
  return (
    <Screen scroll>
      <AdminGate>
        <CatalogManager />
      </AdminGate>
    </Screen>
  );
}

function CatalogManager() {
  const { currentUser } = useAuth();
  const repos = useRepositories();
  const colors = useColors();

  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const isAdmin = isSuperAdminUser(currentUser);
  const { data: entries, reload, loading } = useAsync(
    () => (isAdmin ? repos.catalog.listAll() : Promise.resolve([])),
    [isAdmin],
  );

  /** Re-pull approved entries into the in-app suggestion overlays after edits. */
  const syncOverlay = async () => {
    const approved = await repos.catalog.listApproved();
    applyCatalogEntries(approved);
  };

  const refresh = async () => {
    reload();
    await syncOverlay();
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, tag: 0, dish: 0, service: 0, product: 0 };
    for (const e of entries ?? []) {
      c.all += 1;
      c[e.kind] += 1;
    }
    return c;
  }, [entries]);

  const shown = (entries ?? []).filter((e) => filter === 'all' || e.kind === filter);

  const addTag = async () => {
    const clean = tag.trim();
    if (!clean) {
      setError('Type a tag name first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await repos.catalog.addTag(clean);
      setTag('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that tag.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (entry: CatalogEntry) => {
    await repos.catalog.setApproved(entry.id, !entry.approved);
    await refresh();
  };

  const remove = async (entry: CatalogEntry) => {
    await repos.catalog.remove(entry.id);
    await refresh();
  };

  return (
    <>
      {/* Add a business tag */}
      <Card style={styles.card}>
        <Text weight="semibold" style={styles.cardTitle}>
          Add a business tag
        </Text>
        <Input
          placeholder="e.g. Cloud Kitchen, EV Charging, Drone Service"
          value={tag}
          onChangeText={(t) => {
            setTag(t);
            if (error) setError(null);
          }}
          onSubmitEditing={addTag}
        />
        {error ? (
          <Text variant="caption" tone="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Button title="＋ Add tag" onPress={addTag} loading={busy} />
      </Card>

      {/* The collection */}
      <Text weight="semibold" style={styles.sectionTitle}>
        Collection ({counts.all})
      </Text>

      <View style={styles.filters}>
        {(['all', 'tag', 'dish', 'service', 'product'] as Filter[]).map((f) => (
          <Tag
            key={f}
            label={f === 'all' ? `All ${counts.all}` : `${KIND_META[f].icon} ${counts[f]}`}
            selected={filter === f}
            onPress={() => setFilter(f)}
            style={styles.filterChip}
          />
        ))}
      </View>

      {loading && !entries ? (
        <LoadingView />
      ) : shown.length === 0 ? (
        <EmptyView
          title="Nothing captured yet"
          subtitle="As businesses list dishes, services and products the app doesn't know, they show up here."
        />
      ) : (
        <Card>
          {shown.map((e, i) => (
            <View
              key={e.id}
              style={[
                styles.row,
                i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={styles.rowMain}>
                <Text weight="medium" style={!e.approved ? { color: colors.textMuted } : undefined}>
                  {KIND_META[e.kind].icon} {e.name}
                </Text>
                <Text variant="caption" tone="muted">
                  {KIND_META[e.kind].label.replace(/s$/, '')}
                  {e.adminAdded ? ' · added by you' : e.count ? ` · used ${e.count}×` : ''}
                  {!e.approved ? ' · hidden' : ''}
                </Text>
              </View>
              <Text tone="brand" weight="semibold" onPress={() => toggle(e)} style={styles.action}>
                {e.approved ? 'Hide' : 'Restore'}
              </Text>
              <Text tone="danger" weight="semibold" onPress={() => remove(e)} style={styles.action}>
                ✕
              </Text>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.xl },
  cardTitle: { marginBottom: spacing.xs },
  error: { marginBottom: spacing.sm },
  sectionTitle: { marginBottom: spacing.xs },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  filterChip: { marginRight: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowMain: { flex: 1 },
  action: { paddingHorizontal: spacing.xs },
});
