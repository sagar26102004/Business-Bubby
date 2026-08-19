/**
 * Book an appointment. The customer picks a service (from the provider's list),
 * a preferred date/time, and an optional note. Creates a 'requested' booking
 * the provider then accepts/declines from their workspace.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import type { ServiceItem } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { Button, EmptyView, ErrorView, Input, LoadingView, Screen, Tag, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';
import { showAlert } from '@/lib/alert';

const GENERAL: ServiceItem = { name: 'General appointment' };

export default function BookScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const dismiss = useDismiss(`/business/${businessId}`);
  const { currentUser, signInGuest } = useAuth();

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
      showAlert('Add a time', 'Please enter your preferred date & time.');
      return;
    }
    setSubmitting(true);
    try {
      // A logged-out customer acts as a real (anonymous) identity, the same way
      // guest chat and guest calls do — see `signInGuest`. Without it the row
      // carries no customer_id and RLS (`customer_id = auth.uid()`) refuses it.
      const me = currentUser ?? (await signInGuest());
      await repos.bookings.create({
        businessId: business.id,
        customerId: me.id,
        customerName: me.name || 'Guest',
        serviceName: selected.name,
        price: selected.price,
        when: when.trim(),
        note: note.trim() || undefined,
      });
      showAlert('Request sent', `Your booking with ${business.name} was requested. You'll be notified when they respond.`);
      dismiss();
    } catch (err) {
      showAlert('Could not book', err instanceof Error ? err.message : 'Try again.');
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
  label: { marginBottom: spacing.sm },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  note: { minHeight: 80, textAlignVertical: 'top' },
  submit: { marginTop: spacing.md },
});
