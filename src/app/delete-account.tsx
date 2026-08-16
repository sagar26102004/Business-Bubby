/**
 * Delete account — the in-app deletion path Google Play requires of any app
 * that lets people sign up.
 *
 * WHY IT IS A SCREEN AND NOT A DIALOG
 * The honest answer to "what happens to my data" does not fit in an alert, and
 * `Alert.alert` / `window.confirm` cannot show it: they are one line of text and
 * two buttons, they look identical to a "are you sure?" nobody reads, and on
 * web the JS `confirm` blocks the whole page. What is deleted, what is kept and
 * why is exactly what someone deserves to read BEFORE this, so it gets a page.
 *
 * THE GATE
 * Typing the username, not re-entering the password: an account created with
 * Google has no password to re-enter, so a password gate would lock those
 * people out of deleting their own account. Typing the handle proves the same
 * intent, works for every account, and matches the type-the-name confirm the
 * admin console already uses for taking a listing down.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import type { AccountDeletionBlocker } from '@/data/repositories';
import { useAuth } from '@/data/DataProvider';
import { ACCOUNT_DELETION_URL, openLegalPage } from '@/lib/legal';
import { Button, Card, Input, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

/** What goes, in the person's own terms. */
const REMOVED = [
  'Your name, username, phone number and email',
  'Your saved places (Home, Work) and this device’s alerts',
  'Your conversations with businesses',
  'Anything you had tracked — a child on a bus, a parcel in transit',
  'Any listing of yours that nobody has used yet',
];

/** What survives, and why — the part people are owed an explanation for. */
const KEPT = [
  'Orders, bills and bookings — the business’s own financial records',
  'Ratings and reviews you left, so businesses keep their honest score',
  'Questions and offers on public stall items, so the answers stay useful',
];

export default function DeleteAccountScreen() {
  const { currentUser, authLoading, deleteAccount } = useAuth();
  const router = useRouter();
  const dismiss = useDismiss('/account');
  const colors = useColors();

  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<AccountDeletionBlocker[] | null>(null);

  if (authLoading) return <LoadingView />;

  // Reachable directly by URL on web, and the session can expire underneath a
  // screen that was already open.
  if (!currentUser) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title: 'Delete account' }} />
        <Text variant="subheading" weight="bold">
          You’re not signed in
        </Text>
        <Text tone="muted" style={styles.lead}>
          There’s no account here to delete. Sign in first if you meant to close one.
        </Text>
        <Button title="Sign in" onPress={() => router.replace('/sign-in')} style={styles.action} />
      </Screen>
    );
  }

  // The handle to type. Accounts that predate usernames (the seeded ten) and
  // Google accounts don't have one, so fall back to the display name — the
  // point is proving deliberate intent, not the particular string.
  const confirmWord = currentUser.username ?? currentUser.name;
  const matches = typed.trim().toLowerCase() === confirmWord.trim().toLowerCase();

  const submit = async () => {
    setBusy(true);
    setError(null);
    setBlockers(null);
    try {
      const result = await deleteAccount();
      if (!result.deleted) {
        setBlockers(result.blockers);
        return;
      }
      // The session is already cleared by the provider. Land on Home as a
      // guest, replacing history so Back can't return to a dead account screen.
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Delete account' }} />

      <Text variant="heading" weight="bold">
        Delete your account
      </Text>
      <Text tone="muted" style={styles.lead}>
        This is permanent. It happens straight away, and it can’t be undone — there’s no grace
        period and no way for us to bring the account back.
      </Text>

      <Card style={styles.card}>
        <Text weight="bold">What’s deleted</Text>
        {REMOVED.map((line) => (
          <Text key={line} variant="caption" tone="muted" style={styles.bullet}>
            •  {line}
          </Text>
        ))}
      </Card>

      <Card style={styles.card}>
        <Text weight="bold">What stays</Text>
        <Text variant="caption" tone="muted" style={styles.bullet}>
          These belong to the businesses you dealt with, not only to you — so they’re kept, with
          your name replaced by “Deleted user”.
        </Text>
        {KEPT.map((line) => (
          <Text key={line} variant="caption" tone="muted" style={styles.bullet}>
            •  {line}
          </Text>
        ))}
      </Card>

      {/* The refusal, when a real business is still in the way. Shown in place
          of a generic error because every line of it is actionable. */}
      {blockers && blockers.length > 0 ? (
        <Card style={[styles.card, { borderColor: colors.danger, borderWidth: 1 }]}>
          <Text weight="bold" style={{ color: colors.danger }}>
            Hand these over first
          </Text>
          <Text variant="caption" tone="muted" style={styles.bullet}>
            A business with staff or customers can’t be deleted along with your account — other
            people’s orders, bills and jobs are attached to it. Transfer it to its real owner, or
            take the listing down yourself, then come back.
          </Text>
          {blockers.map((b) => (
            <View key={b.businessId} style={[styles.blocker, { borderTopColor: colors.border }]}>
              <Text weight="medium">{b.name}</Text>
              <Text variant="caption" tone="muted">
                {b.reasons.join(' · ')}
              </Text>
              <Button
                title="Open its workspace"
                variant="secondary"
                onPress={() => router.push(`/workspace/${b.businessId}`)}
                style={styles.blockerBtn}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {error ? (
        <Text variant="caption" style={[styles.error, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}

      <Input
        label={`Type “${confirmWord}” to confirm`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={confirmWord}
      />

      <Button
        title="Delete my account"
        onPress={submit}
        disabled={!matches || busy}
        loading={busy}
        style={styles.action}
      />
      <Button
        title="Keep my account"
        variant="ghost"
        onPress={dismiss}
        style={styles.cancel}
      />

      <Text
        tone="muted"
        variant="caption"
        style={styles.web}
        onPress={() => openLegalPage(ACCOUNT_DELETION_URL)}
      >
        You can also request deletion on the web
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: spacing.sm, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  bullet: { marginTop: spacing.xs },
  blocker: { borderTopWidth: 1, marginTop: spacing.md, paddingTop: spacing.md },
  blockerBtn: { marginTop: spacing.sm, borderRadius: radius.pill },
  error: { marginBottom: spacing.md },
  action: { marginTop: spacing.lg },
  cancel: { marginTop: spacing.sm },
  web: { marginTop: spacing.xl, textAlign: 'center', textDecorationLine: 'underline' },
});
