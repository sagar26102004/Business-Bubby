/**
 * Contact details — the email address and phone number on an account.
 *
 * These are CONTACT DETAILS, not credentials: nothing is sent to them, neither
 * is verified, and neither can be used to take the account over. What they are
 * for is a business being able to reach a customer about an order it is filling.
 * The screen says so plainly, because a form asking for a phone number without
 * explaining why is a form people abandon.
 *
 * They are stored in `profiles_private` (migration 0007), which RLS hands over
 * only to the account itself or a platform super-admin — so they never appear
 * on the public profile card.
 *
 * Both may be left blank. Sign-in needs neither: the handle is the identity.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { assertContactDetails } from '@/data/repositories';
import { Button, Card, Icon, Input, LoadingView, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

export default function ContactDetailsScreen() {
  const router = useRouter();
  const colors = useColors();
  const { currentUser, authLoading, setCurrentUser } = useAuth();
  const repos = useRepositories();

  const [email, setEmail] = useState(currentUser?.email ?? '');
  const [phone, setPhone] = useState(currentUser?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (authLoading) return <LoadingView />;
  if (!currentUser) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title: 'Contact details' }} />
        <Text tone="muted">Sign in to manage your contact details.</Text>
        <Button title="Sign in" onPress={() => router.replace('/sign-in')} style={styles.gap} />
      </Screen>
    );
  }

  const save = async () => {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      // The same rules sign-up uses, from the same place — a number this screen
      // accepts must be one the backend would have accepted at sign-up.
      const contact = assertContactDetails({ email, phone });
      const updated = await repos.users.update(currentUser.id, {
        // Explicit undefined is what CLEARS a detail; `??` would keep the old
        // value and make an emptied box look like it saved when it didn't.
        email: contact.email,
        phone: contact.phone,
      });
      setCurrentUser(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your contact details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Contact details' }} />

      <Card style={styles.note}>
        <View style={styles.noteRow}>
          <Icon name="lock" size={18} color={colors.textMuted} />
          <Text variant="caption" tone="muted" style={styles.noteText}>
            Private to you. A business you order from can reach you on these — they never appear on
            your public profile, and you can leave them blank.
          </Text>
        </View>
      </Card>

      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Input
        label="Phone"
        value={phone}
        onChangeText={setPhone}
        placeholder="98123 40001"
        keyboardType="phone-pad"
      />

      {error ? (
        <Text tone="danger" variant="caption" style={styles.message}>
          {error}
        </Text>
      ) : null}
      {saved && !error ? (
        <Text tone="success" variant="caption" style={styles.message}>
          Saved.
        </Text>
      ) : null}

      <Button title="Save" onPress={save} loading={saving} style={styles.gap} />

      {/*
        Accounts made before usernames existed sign in with their phone number,
        so the obvious fear here is "will editing this lock me out?". It won't:
        the credential address was fixed at sign-up from the ORIGINAL number
        (`phoneToEmail`), and `resolve_login_email` additionally resolves
        whatever number is on the profile now. Both work. Say so, rather than
        leaving them to find out by being locked out.
      */}
      {!currentUser.username ? (
        <Text variant="caption" tone="muted" style={styles.warning}>
          This account signs in with a phone number rather than a username. Changing the number
          here won’t lock you out — the number you signed up with keeps working too.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { marginBottom: spacing.lg },
  noteRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  noteText: { flex: 1 },
  message: { marginTop: spacing.sm },
  gap: { marginTop: spacing.lg },
  warning: { marginTop: spacing.lg, textAlign: 'center' },
});
