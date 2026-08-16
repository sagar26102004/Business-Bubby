/**
 * Pre-call screen. Voice calls are in-app internet calls (WhatsApp-style) —
 * no phone numbers are exchanged, which is the whole point: businesses stay
 * reachable without publishing a number. Shows who will ring (per the owner's
 * routing settings) and starts the call.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Avatar, Button, EmptyView, ErrorView, LoadingView, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

export default function CallScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const dismiss = useDismiss(`/business/${businessId}`);
  const { currentUser, signInGuest } = useAuth();
  const [starting, setStarting] = useState(false);
  // Shown inline rather than through Alert.alert — Alert is a no-op on web, so
  // a failed start (e.g. guest access switched off) would look like a dead button.
  const [startError, setStartError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const [employees, owner] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.users.getById(business.ownerId),
    ]);
    const handlerIds = new Set(business.callHandlerIds ?? []);
    const handlers = employees.filter((e) => handlerIds.has(e.id));
    const ownerAnswers = business.ownerHandlesCalls !== false;
    // Only people with an app account can actually ring.
    const reachable = ownerAnswers || handlers.some((h) => h.userId);
    return { business, owner, handlers, ownerAnswers, reachable };
  }, [businessId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" />;

  const { business, owner, handlers, ownerAnswers, reachable } = data;

  const startCall = async () => {
    setStarting(true);
    setStartError(null);
    try {
      // A guest needs a real identity (auth uid + JWT) so the call insert and the
      // audio-token function accept them — an anonymous sign-in provides it
      // without a sign-up form, while they stay a guest everywhere else.
      const me = currentUser ?? (await signInGuest());
      const call = await repos.calls.start(business.id, { id: me.id, name: me.name });
      router.replace(`/call/session/${call.id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Could not start the call. Try again.');
      setStarting(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Call' }} />

      <View style={styles.header}>
        <View style={[styles.ring, { backgroundColor: colors.brandSoft }]}>
          <Text style={styles.ringEmoji}>📞</Text>
        </View>
        <Text variant="heading" weight="bold" style={styles.name}>
          {business.name}
        </Text>
        <Text tone="muted" style={styles.hint}>
          Free voice call over the internet — no phone numbers are shared.
        </Text>
      </View>

      <Text variant="caption" weight="semibold" tone="muted" style={styles.group}>
        WHO WILL RING
      </Text>
      <View style={styles.people}>
        {ownerAnswers ? <PersonRow name={owner?.name ?? 'Owner'} role="Owner" /> : null}
        {handlers.map((h) => (
          <PersonRow
            key={h.id}
            name={h.displayName}
            role={h.userId ? h.role ?? 'Attends calls' : `${h.role ?? 'Attends calls'} · not on the app yet`}
          />
        ))}
        {!ownerAnswers && handlers.length === 0 ? (
          <Text tone="muted">This business hasn’t set anyone to take calls.</Text>
        ) : null}
      </View>

      <Button
        title={reachable ? '📞 Start voice call' : 'Voice calls unavailable'}
        disabled={!reachable}
        loading={starting}
        onPress={startCall}
        style={styles.callBtn}
      />
      {!reachable ? (
        <Text variant="caption" tone="muted" style={styles.unreachable}>
          No one at this business can take voice calls right now. Try the chat instead.
        </Text>
      ) : null}
      {startError ? (
        <Text variant="caption" tone="danger" style={styles.unreachable}>
          {startError}
        </Text>
      ) : null}
      <Button title="Cancel" variant="ghost" onPress={dismiss} />
    </Screen>
  );
}

function PersonRow({ name, role }: { name: string; role: string }) {
  return (
    <View style={styles.personRow}>
      <Avatar name={name} size={38} />
      <View style={styles.personInfo}>
        <Text weight="medium">{name}</Text>
        <Text variant="caption" tone="muted">
          {role}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl },
  ring: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  ringEmoji: { fontSize: 40 },
  name: { marginTop: spacing.md },
  hint: { marginTop: spacing.xs, textAlign: 'center' },
  group: { letterSpacing: 1, marginBottom: spacing.sm },
  people: { marginBottom: spacing.xl },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  personInfo: { flex: 1 },
  callBtn: { marginBottom: spacing.sm },
  unreachable: { textAlign: 'center', marginBottom: spacing.sm },
});
