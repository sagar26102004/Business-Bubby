/**
 * Book an appointment. The customer picks a service (from the provider's list),
 * a preferred date/time, and an optional note. Creates a 'requested' booking
 * the provider then accepts/declines from their workspace.
 */
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import type { ServiceItem } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, EmptyView, ErrorView, Input, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

const GENERAL: ServiceItem = { name: 'General appointment' };

export default function BookScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const dismiss = useDismiss(`/business/${businessId}`);
  const { currentUser } = useAuth();

  const [serviceName, setServiceName] = useState<string>();
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: business, loading, error, reload } = useAsync(
    () => repos.businesses.getById(businessId),
    [businessId],
  );

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!business) return <EmptyView title="Not found" />;

  const services = business.services && business.services.length > 0 ? business.services : [GENERAL];
  const selected = services.find((s) => s.name === serviceName) ?? services[0];
  const canSubmit = when.trim().length > 1 && !submitting;

  const submit = async () => {
    if (!canSubmit) {
      Alert.alert('Add a time', 'Please enter your preferred date & time.');
      return;
    }
    setSubmitting(true);
    try {
      await repos.bookings.create({
        businessId: business.id,
        customerId: currentUser?.id ?? 'guest',
        customerName: currentUser?.name ?? 'Guest',
        serviceName: selected.name,
        price: selected.price,
        when: when.trim(),
        note: note.trim() || undefined,
      });
      Alert.alert('Request sent', `Your booking with ${business.name} was requested. You'll be notified when they respond.`);
      dismiss();
    } catch (err) {
      Alert.alert('Could not book', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Book' }} />

      <Text variant="title" weight="bold">
        Book with {business.name}
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        Request an appointment — the provider confirms the time.
      </Text>

      <Text variant="label" weight="semibold" style={styles.label}>
        Choose a service
      </Text>
      <View style={styles.services}>
        {services.map((s) => (
          <Tag
            key={s.name}
            label={s.price ? `${s.name} · ${s.price}` : s.name}
            selected={selected.name === s.name}
            onPress={() => setServiceName(s.name)}
          />
        ))}
      </View>

      <Input
        label="Preferred date & time"
        placeholder="e.g. Sat 12 Jul, 3:00 pm"
        value={when}
        onChangeText={setWhen}
      />
      <Input
        label="Note (optional)"
        placeholder="Anything the provider should know"
        value={note}
        onChangeText={setNote}
        multiline
        style={styles.note}
      />

      <Button title="Request booking" onPress={submit} loading={submitting} disabled={!canSubmit} style={styles.submit} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  label: { marginBottom: spacing.sm },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  note: { minHeight: 80, textAlignVertical: 'top' },
  submit: { marginTop: spacing.md },
});
