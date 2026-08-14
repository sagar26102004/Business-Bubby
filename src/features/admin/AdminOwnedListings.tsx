/**
 * "Listings under your account" — the admin console's cleanup desk.
 *
 * The platform account is not a shop, so anything still sitting under it is
 * either a test listing or one that was registered before its real owner had
 * an account. Two ways out, both from here:
 *
 *   • Hand over — `reassignOwner`, the right move for a real business. It keeps
 *     the page, its orders and its history; only the owner changes.
 *   • Remove — for a test or duplicate listing. Irreversible and cascading, and
 *     the same `DeleteListingPanel` the owner gets in Manage, so the console
 *     and the owner are warned about exactly the same thing.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Business, User } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { DeleteListingPanel } from '@/features/businesses/DeleteListing';
import { OwnerPicker } from '@/features/businesses/OwnerPicker';
import { Button, Card, Tag, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

type Mode = 'handover' | 'remove';

export function AdminOwnedListings({
  listings,
  onChanged,
}: {
  listings: Business[];
  onChanged: () => void;
}) {
  const { currentUser } = useAuth();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();

  // Which listing is open, and for which action. One at a time — these are
  // decisions, not a batch job.
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('handover');
  const [newOwner, setNewOwner] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const open = (id: string, next: Mode) => {
    const same = openId === id && mode === next;
    setOpenId(same ? null : id);
    setMode(next);
    setNewOwner(null);
    setMessage(null);
  };

  const handOver = async (business: Business) => {
    if (!newOwner) return;
    setBusy(true);
    setMessage(null);
    try {
      await repos.businesses.reassignOwner(business.id, newOwner.id);
      setOpenId(null);
      setNewOwner(null);
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not change the owner.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={[styles.card, { borderColor: colors.accent }]}>
      <Text weight="bold">🏢 Listings under your account</Text>
      <Text variant="caption" tone="muted" style={styles.sub}>
        The platform account shouldn’t run a shop. Hand a real business to its owner, or remove a
        test listing for good.
      </Text>

      {listings.map((b) => {
        const isOwner = b.ownerId === currentUser?.id;
        const isOpen = openId === b.id;
        return (
          <View key={b.id} style={[styles.row, { borderTopColor: colors.border }]}>
            <View style={styles.head}>
              <View style={styles.name}>
                <Text weight="semibold" numberOfLines={1}>
                  {b.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {b.tagline || b.providerType || b.type}
                </Text>
              </View>
              <Tag label={isOwner ? 'Owner' : 'Team'} tone={isOwner ? 'brand' : 'default'} />
            </View>

            <View style={styles.actions}>
              <Tag label="Open" onPress={() => router.push(`/workspace/${b.id}`)} />
              {isOwner ? (
                <>
                  <Tag
                    label="Hand over"
                    selected={isOpen && mode === 'handover'}
                    onPress={() => open(b.id, 'handover')}
                  />
                  <Tag
                    label="Remove"
                    selected={isOpen && mode === 'remove'}
                    onPress={() => open(b.id, 'remove')}
                  />
                </>
              ) : (
                <Text variant="caption" tone="muted">
                  You’re on the team — ask the owner to remove you.
                </Text>
              )}
            </View>

            {isOpen && mode === 'handover' ? (
              <View style={styles.panel}>
                <OwnerPicker
                  value={newOwner}
                  onChange={setNewOwner}
                  selfLabel={currentUser?.name ?? 'me'}
                  hideSelf
                />
                <Button
                  title={newOwner ? `Hand ${b.name} to ${newOwner.name}` : 'Pick the new owner'}
                  onPress={() => handOver(b)}
                  loading={busy}
                  disabled={!newOwner}
                />
              </View>
            ) : null}

            {isOpen && mode === 'remove' ? (
              // The warning and the type-the-name rule are shared with the
              // owner's own delete in Manage, so the two can't drift apart.
              <DeleteListingPanel
                business={b}
                onDeleted={() => {
                  setOpenId(null);
                  onChanged();
                }}
              />
            ) : null}

            {isOpen && message ? (
              <Text variant="caption" tone="danger" style={styles.msg}>
                {message}
              </Text>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, marginBottom: spacing.xl },
  sub: { marginTop: spacing.xs },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, marginTop: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  panel: { marginTop: spacing.md, gap: spacing.sm },
  msg: { marginTop: spacing.sm },
});
