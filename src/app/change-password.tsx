/**
 * Change password.
 *
 * The current password is asked for and genuinely re-checked by the repository
 * (`AuthRepository.changePassword`) — an open session on a phone left on a
 * counter must not be enough to lock its owner out of their own account.
 *
 * There is no "forgot password" to fall back on yet, which is exactly why this
 * screen refuses to guess: every failure says which box was wrong.
 */
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { MIN_PASSWORD_LENGTH, assertPassword } from '@/data/repositories';
import { Button, Card, Input, LoadingView, Screen, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { currentUser, authLoading } = useAuth();
  const repos = useRepositories();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (authLoading) return <LoadingView />;
  if (!currentUser) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title: 'Password' }} />
        <Text tone="muted">Sign in to change your password.</Text>
        <Button title="Sign in" onPress={() => router.replace('/sign-in')} style={styles.gap} />
      </Screen>
    );
  }

  const submit = async () => {
    setError(null);
    try {
      if (!current) throw new Error('Enter your current password.');
      // The shared rule, so this screen refuses exactly what the backend does.
      assertPassword(next);
      // Checked here rather than in the repository: a mistyped confirmation is
      // a slip in THIS form, and no backend should have to know the box exists.
      if (next !== confirm) throw new Error('The new passwords don’t match.');

      setBusy(true);
      await repos.auth.changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title: 'Password' }} />
        <Card style={styles.doneCard}>
          <Text variant="subheading" weight="bold">
            Password changed
          </Text>
          <Text tone="muted" style={styles.doneText}>
            Use your new password the next time you sign in. You’re still signed in here.
          </Text>
        </Card>
        <Button title="Done" onPress={() => router.back()} style={styles.gap} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Password' }} />

      <Text tone="muted" style={styles.lede}>
        Choose something at least {MIN_PASSWORD_LENGTH} characters long. You’ll need your current
        password to make the change.
      </Text>

      <Input
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
      />
      <Input
        label="New password"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
      />
      <Input
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
      />

      {error ? (
        <Text tone="danger" variant="caption" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Button title="Change password" onPress={submit} loading={busy} style={styles.gap} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: { marginBottom: spacing.lg },
  error: { marginTop: spacing.sm },
  gap: { marginTop: spacing.lg },
  doneCard: { alignItems: 'center', paddingVertical: spacing.xl },
  doneText: { marginTop: spacing.sm, textAlign: 'center' },
});
