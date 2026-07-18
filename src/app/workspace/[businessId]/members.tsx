/**
 * Workspace › Members — recurring monthly plans (gym, batch, tuition, bus
 * seat). Only the business enrolls someone; the plan then shows in that
 * customer's Subscriptions tab. Members only.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { Membership } from '@/domain/types';
import { canAccessService } from '@/domain/access';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
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

export default function WorkspaceMembersScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, members, customers] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.memberships.listForBusiness(business.id),
      repos.customers.listForBusiness(business.id),
    ]);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = currentUser?.id === business.ownerId || !!meEmployee;
    const canAccess = canAccessService(business, meEmployee, currentUser?.id, 'members');
    return { business, isMember, canAccess, members, customers };
  }, [businessId, currentUser?.id]);

  const [memberCustomerKey, setMemberCustomerKey] = useState<string | null>(null);
  const [memberPlan, setMemberPlan] = useState('');
  const [memberPrice, setMemberPrice] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, isMember, canAccess, members, customers } = data;
  if (!isMember) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Members' }} />
        <EmptyView title="Members only" subtitle="Ask the owner to add you." />
      </Screen>
    );
  }
  if (!canAccess) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Members' }} />
        <EmptyView title="No access" subtitle="Ask the owner to grant you Members in Access & permissions." />
      </Screen>
    );
  }

  const memberSince = (iso: string) => new Date(iso).toDateString().slice(4);

  // Only customers with an app account can be enrolled — the plan has to
  // reach THEIR Subscriptions tab.
  const memberCandidates = customers.filter((c) => c.hasAccount && c.key !== 'guest');

  const addMember = async () => {
    const customer = memberCandidates.find((c) => c.key === memberCustomerKey);
    if (!customer) {
      setMemberError('Pick a customer first — they need a Localo account.');
      return;
    }
    if (!memberPlan.trim()) {
      setMemberError('Name the plan, e.g. “Monthly membership” or “Evening batch”.');
      return;
    }
    const price = parsePrice(memberPrice);
    if (price === undefined) {
      setMemberError('Enter the monthly price in ₹.');
      return;
    }
    setAddingMember(true);
    try {
      await repos.memberships.add({
        businessId: business.id,
        customerId: customer.key,
        customerName: customer.name,
        planName: memberPlan.trim(),
        pricePerMonth: price,
      });
      setMemberCustomerKey(null);
      setMemberPlan('');
      setMemberPrice('');
      setMemberError(null);
      reload();
    } finally {
      setAddingMember(false);
    }
  };
  const stopMembership = async (id: string) => {
    await repos.memberships.cancel(id);
    reload();
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Members' }} />

      <Text tone="muted" style={styles.subtitle}>
        Enroll customers into monthly plans — membership, batch, tuition, bus seat. The plan shows
        in their Subscriptions tab with its price and renewal date.
      </Text>

      {members.map((m: Membership) => (
        <Card key={m.id} style={styles.card}>
          <View style={styles.topRow}>
            <Text weight="semibold">{m.customerName}</Text>
            <Text weight="semibold" tone="brand">
              {formatMoney(m.pricePerMonth)}/mo
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            {m.planName} · since {memberSince(m.startedAt)} · renews {memberSince(m.expiresAt)}
          </Text>
          <Button
            title="Stop membership"
            variant="ghost"
            onPress={() => stopMembership(m.id)}
            style={styles.actionBtn}
          />
        </Card>
      ))}

      <Card style={styles.addCard}>
        <Text weight="semibold">➕ Add a member</Text>
        {memberCandidates.length === 0 ? (
          <Text variant="caption" tone="muted" style={styles.hintTop}>
            No enrollable customers yet — someone has to order, book, chat or call first (and have a
            Localo account).
          </Text>
        ) : (
          <>
            <Text variant="caption" tone="muted" style={styles.hintTop}>
              Who is it for?
            </Text>
            <View style={styles.chips}>
              {memberCandidates.map((c) => (
                <Tag
                  key={c.key}
                  label={c.name}
                  selected={memberCustomerKey === c.key}
                  onPress={() => setMemberCustomerKey(memberCustomerKey === c.key ? null : c.key)}
                />
              ))}
            </View>
            <Input
              label="Plan"
              placeholder="e.g. Monthly membership, Morning yoga batch"
              value={memberPlan}
              onChangeText={setMemberPlan}
            />
            <Input
              label="Price per month (₹)"
              placeholder="e.g. 1200"
              value={memberPrice}
              onChangeText={(t) => setMemberPrice(sanitizePriceInput(t))}
              keyboardType="numeric"
            />
            {memberError ? (
              <Text variant="caption" tone="danger" style={styles.error}>
                {memberError}
              </Text>
            ) : null}
            <Button title="Add member" onPress={addMember} loading={addingMember} />
          </>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.sm },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actionBtn: { marginTop: spacing.md },
  addCard: { marginTop: spacing.md },
  hintTop: { marginTop: spacing.xs, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  error: { marginBottom: spacing.sm },
});
