/**
 * Customers — "Contacts" in the workspace of a membership business (business
 * members only). Everyone who has ever done business with this listing,
 * aggregated from orders, bookings, bills, chats and calls. The owner can star
 * favourites, which stay pinned to the top; the search box cuts a long list
 * down to one name.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import type { CustomerSummary } from '@/data/repositories';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney } from '@/lib/money';
import {
  Avatar,
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  SearchField,
  Text,
} from '@/components/ui';
import { fontSize, spacing } from '@/theme/theme';

/** "3 orders · 2 bills · $120 billed · chat" — only the parts that apply. */
function activityLine(c: CustomerSummary): string {
  const parts: string[] = [];
  const count = (n: number, word: string) =>
    n > 0 && parts.push(`${n} ${word}${n === 1 ? '' : 's'}`);
  count(c.orderCount, 'order');
  count(c.bookingCount, 'booking');
  count(c.billCount, 'bill');
  count(c.callCount, 'call');
  if (c.chatCount > 0) parts.push('chat');
  if (c.totalBilled > 0) parts.push(`${formatMoney(c.totalBilled)} billed`);
  return parts.join(' · ');
}

export default function CustomersScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const dismiss = useDismiss(`/workspace/${businessId}`);
  const { currentUser } = useAuth();
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, customers] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.customers.listForBusiness(business.id),
    ]);
    return { business, employees, customers };
  }, [businessId]);

  const term = query.trim().toLowerCase();
  // A long-standing business has hundreds of these; searching by name beats
  // scrolling. Walk-ins are findable by "walk-in" too, since that's often all
  // the member remembers about them.
  const matches = useMemo(() => {
    if (!term) return [];
    return (data?.customers ?? []).filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (!c.hasAccount && (c.key === 'guest' ? 'guest' : 'walk-in').includes(term)),
    );
  }, [data?.customers, term]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees, customers } = data;
  const isOwner = currentUser?.id === business.ownerId;
  const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
  const isMember = isBusinessTeamMember(business, meEmployee, currentUser);

  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Customers' }} />
        <EmptyView title="Members only" subtitle="Only this business's team can see its customers." />
      </Screen>
    );
  }
  if (!canAccessService(business, meEmployee, currentUser, 'customers')) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Customers' }} />
        <EmptyView title="No access" subtitle="Ask the owner to grant you Customers in Access & permissions." />
      </Screen>
    );
  }

  const toggleFavorite = async (c: CustomerSummary) => {
    setTogglingKey(c.key);
    try {
      await repos.customers.setFavorite(business.id, c.key, !c.favorite);
      reload();
    } finally {
      setTogglingKey(null);
    }
  };

  const favorites = customers.filter((c) => c.favorite);
  const others = customers.filter((c) => !c.favorite);

  /** A compact icon action sitting on the name row. */
  const iconAction = (icon: string, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
    >
      <Text style={styles.icon}>{icon}</Text>
    </Pressable>
  );

  /**
   * One contact on ONE row: who they are on the left, the actions on the right.
   * The walk-in/guest marker folds into the activity caption rather than taking
   * a chip row of its own, so the card is two lines tall however many actions
   * apply.
   */
  const renderCustomer = (c: CustomerSummary) => {
    const marker = c.hasAccount ? '' : c.key === 'guest' ? 'Guest' : 'Walk-in';
    const activity = activityLine(c);
    return (
      <Card key={c.key} style={styles.customerCard}>
        <View style={styles.customerRow}>
          <Avatar name={c.name} size={40} />
          <View style={styles.customerInfo}>
            <Text weight="medium" numberOfLines={1}>
              {c.name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {[marker, activity].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {c.chatCount > 0 || c.hasAccount
            ? iconAction('💬', `Chat with ${c.name}`, () =>
                router.push(`/inbox/${business.id}/${c.key}`),
              )
            : null}
          {c.orderCount > 0
            ? iconAction('📦', `Orders from ${c.name}`, () =>
                router.push(`/orders/${business.id}`),
              )
            : null}
          {iconAction('🧾', `Bill ${c.name}`, () => router.push(`/bill/new/${business.id}`))}
          {isOwner ? (
            <Pressable
              onPress={() => toggleFavorite(c)}
              disabled={togglingKey === c.key}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={c.favorite ? `Unstar ${c.name}` : `Star ${c.name} as a favourite`}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            >
              <Text style={styles.icon}>{c.favorite ? '⭐' : '☆'}</Text>
            </Pressable>
          ) : c.favorite ? (
            <Text style={styles.icon}>⭐</Text>
          ) : null}
        </View>
      </Card>
    );
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Customers' }} />

      {customers.length === 0 ? (
        <EmptyView
          title="No customers yet"
          subtitle="As people order, book, chat or get billed, they'll show up here."
        />
      ) : (
        <>
          <SearchField
            placeholder="Search by name…"
            value={query}
            onChangeText={setQuery}
            accessibilityLabel="Search contacts by name"
          />

          {/* Searching collapses the favourites/all split — one flat result list
              is what you want when you're hunting one person. */}
          {term ? (
            <>
              <Text variant="subheading" weight="bold" style={styles.sectionTitle}>
                {matches.length === 0
                  ? `No one matches “${query.trim()}”`
                  : `${matches.length} match${matches.length === 1 ? '' : 'es'}`}
              </Text>
              {matches.map(renderCustomer)}
            </>
          ) : (
            <>
              {favorites.length > 0 ? (
                <>
                  <Text variant="subheading" weight="bold" style={styles.sectionTitle}>
                    ⭐ Favourites · {favorites.length}
                  </Text>
                  {favorites.map(renderCustomer)}
                </>
              ) : null}
              <Text variant="subheading" weight="bold" style={styles.sectionTitle}>
                {favorites.length > 0 ? `All customers · ${customers.length}` : `${customers.length} customer${customers.length === 1 ? '' : 's'}`}
              </Text>
              {others.map(renderCustomer)}
              {others.length === 0 ? (
                <Text tone="muted">Every customer is a favourite. Nice problem to have.</Text>
              ) : null}
            </>
          )}
        </>
      )}

      <Button
        title="← Back to workspace"
        variant="ghost"
        onPress={dismiss}
        style={styles.backBtn}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { marginTop: spacing.md, marginBottom: spacing.md },
  customerCard: { marginBottom: spacing.sm },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  customerInfo: { flex: 1, marginRight: spacing.xs },
  iconBtn: { padding: spacing.xs },
  pressed: { opacity: 0.6 },
  icon: { fontSize: fontSize.lg },
  backBtn: { marginTop: spacing.lg },
});
