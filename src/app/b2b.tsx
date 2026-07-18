/**
 * B2B inbox — business-to-business conversations (dealer ↔ distributor,
 * shop ↔ supplier), a separate world from the customer chats in Explore.
 * Threads span every business the user owns or works at. Start a new one by
 * choosing which of your businesses speaks, then searching the other side.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Business } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  Input,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function B2BInboxScreen() {
  const { currentUser, isGuest } = useAuth();
  const repos = useRepositories();
  const router = useRouter();

  const [asBusinessId, setAsBusinessId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const { data, loading, error, reload } = useAsync(async () => {
    if (!currentUser) return null;
    const [threads, all, memberOf] = await Promise.all([
      repos.bizChat.listThreadsForUser(currentUser.id),
      repos.businesses.list(),
      repos.employees.listBusinessesForUser(currentUser.id),
    ]);
    // "My side" candidates: owned or worked-at businesses (stalls stay B2C).
    const byId = new Map<string, Business>();
    all.filter((b) => b.ownerId === currentUser.id && b.type !== 'item').forEach((b) => byId.set(b.id, b));
    memberOf.filter((b) => b.type !== 'item').forEach((b) => byId.set(b.id, b));
    return { threads, all, mine: Array.from(byId.values()) };
  }, [currentUser?.id]);

  // New messages may have arrived while we were inside a thread.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useFocusEffect(
    useCallback(() => {
      reloadRef.current();
    }, []),
  );

  const mine = data?.mine ?? [];
  const asBusiness = mine.find((b) => b.id === asBusinessId) ?? mine[0];

  // Directory search for the other side — any business that isn't mine.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return [];
    const mineIds = new Set(mine.map((b) => b.id));
    return data.all
      .filter(
        (b) =>
          !mineIds.has(b.id) &&
          b.type !== 'item' &&
          b.name.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query, data, mine]);

  if (isGuest) {
    return (
      <Screen>
        <EmptyView
          title="Sign in for business chats"
          subtitle="B2B chat connects your business with suppliers, dealers and distributors."
        />
        <Button title="Sign in / Sign up" onPress={() => router.push('/sign-in')} />
      </Screen>
    );
  }
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <LoadingView label="Loading business chats…" />;

  const openThread = (me: string, other: string) => {
    router.push({ pathname: '/b2b-chat', params: { me, other } });
  };

  return (
    <Screen scroll>
      {mine.length === 0 ? (
        <EmptyView
          title="No business yet"
          subtitle="B2B chat speaks AS one of your businesses — register one first, then talk to suppliers and partners here."
        />
      ) : (
        <>
          <Text variant="subheading" weight="bold" style={styles.heading}>
            Conversations
          </Text>
          {data.threads.length === 0 ? (
            <Text tone="muted" style={styles.emptyHint}>
              No business-to-business chats yet — find a supplier or partner below.
            </Text>
          ) : (
            data.threads.map((t) => (
              <Card
                key={`${t.threadKey}:${t.businessId}`}
                onPress={() => openThread(t.businessId, t.otherBusinessId)}
                style={styles.threadCard}
              >
                <View style={styles.threadTop}>
                  <Text weight="semibold" style={styles.threadName} numberOfLines={1}>
                    🏢 {t.otherBusinessName}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {new Date(t.lastAt).toDateString().slice(4, 10)}
                  </Text>
                </View>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {t.lastFromBusinessId === t.businessId ? 'You: ' : ''}
                  {t.lastBody}
                </Text>
                <Text variant="caption" tone="muted" style={styles.asLabel}>
                  as {t.businessName}
                </Text>
              </Card>
            ))
          )}

          <Text variant="subheading" weight="bold" style={[styles.heading, styles.newHeading]}>
            Start a new chat
          </Text>
          {mine.length > 1 ? (
            <>
              <Text variant="caption" tone="muted" style={styles.hint}>
                Chat as:
              </Text>
              <View style={styles.chipRow}>
                {mine.map((b) => (
                  <Tag
                    key={b.id}
                    label={b.name}
                    selected={asBusiness?.id === b.id}
                    onPress={() => setAsBusinessId(b.id)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Input
            label={`Find a business to talk to${asBusiness ? ` (as ${asBusiness.name})` : ''}`}
            placeholder="Search by name — supplier, dealer, distributor…"
            value={query}
            onChangeText={setQuery}
          />
          {matches.map((b) => (
            <Card
              key={b.id}
              onPress={() => asBusiness && openThread(asBusiness.id, b.id)}
              style={styles.threadCard}
            >
              <Text weight="semibold">🏢 {b.name}</Text>
              {b.tagline ? (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {b.tagline}
                </Text>
              ) : null}
            </Card>
          ))}
          {query.trim() && matches.length === 0 ? (
            <Text tone="muted">No businesses match “{query.trim()}”.</Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.md },
  newHeading: { marginTop: spacing.xl },
  emptyHint: { marginBottom: spacing.md },
  threadCard: { marginBottom: spacing.sm },
  threadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  threadName: { flex: 1 },
  asLabel: { marginTop: spacing.xs },
  hint: { marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
});
