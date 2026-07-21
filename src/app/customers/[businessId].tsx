/**
 * Customers (business members only) — everyone who has ever done business
 * with this listing, aggregated from orders, bookings, bills, chats and
 * calls. The owner can star favourites, which stay pinned to the top.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { CustomerSummary } from '@/data/repositories';
import { canAccessService } from '@/domain/access';
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
  Tag,
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
  const { currentUser } = useAuth();
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, customers] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.customers.listForBusiness(business.id),
    ]);
    return { business, employees, customers };
  }, [businessId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, employees, customers } = data;
  const isOwner = currentUser?.id === business.ownerId;
  const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
  const isMember = isOwner || !!meEmployee;

  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Customers' }} />
        <EmptyView title="Members only" subtitle="Only this business's team can see its customers." />
      </Screen>
    );
  }
  if (!canAccessService(business, meEmployee, currentUser?.id, 'customers')) {
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

  const renderCustomer = (c: CustomerSummary) => (
    <Card key={c.key} style={styles.customerCard}>
      <View style={styles.customerRow}>
        <Avatar name={c.name} size={40} />
        <View style={styles.customerInfo}>
          <Text weight="medium">{c.name}</Text>
          <Text variant="caption" tone="muted">
            {activityLine(c)}
          </Text>
        </View>
        {isOwner ? (
          <Pressable
            onPress={() => toggleFavorite(c)}
            disabled={togglingKey === c.key}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={c.favorite ? `Unstar ${c.name}` : `Star ${c.name} as a favourite`}
            style={({ pressed }) => [styles.star, pressed && styles.starPressed]}
          >
            <Text style={styles.starIcon}>{c.favorite ? '⭐' : '☆'}</Text>
          </Pressable>
        ) : c.favorite ? (
          <Text style={styles.starIcon}>⭐</Text>
        ) : null}
      </View>
      <View style={styles.actionRow}>
        {!c.hasAccount ? (
          <Tag label={c.key === 'guest' ? 'Guest' : 'Walk-in'} />
        ) : null}
        {c.chatCount > 0 || c.hasAccount ? (
          <Tag
            label="💬 Chat"
            onPress={() => router.push(`/inbox/${business.id}/${c.key}`)}
          />
        ) : null}
        {c.orderCount > 0 ? (
          <Tag label="📦 Orders" onPress={() => router.push(`/orders/${business.id}`)} />
        ) : null}
        <Tag label="🧾 Bill" onPress={() => router.push(`/bill/new/${business.id}`)} />
      </View>
    </Card>
  );

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

      <Button
        title="← Back to workspace"
        variant="ghost"
        onPress={() => router.back()}
        style={styles.backBtn}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { marginTop: spacing.md, marginBottom: spacing.md },
  customerCard: { marginBottom: spacing.sm },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  customerInfo: { flex: 1 },
  star: { padding: spacing.xs },
  starPressed: { opacity: 0.6 },
  starIcon: { fontSize: fontSize.lg },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  backBtn: { marginTop: spacing.lg },
});
