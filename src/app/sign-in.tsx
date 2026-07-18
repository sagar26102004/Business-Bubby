/**
 * Sign in / Sign up screen (presented as a modal).
 *
 * Auth is mocked: signing in with any credentials logs you in as the demo user;
 * signing up creates a fresh account. Guests are sent here when they try to do
 * something that needs an account (browsing a saved place, listing a business).
 */
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/data/DataProvider';
import { Button, Input, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

type Mode = 'signin' | 'signup';

export default function SignInScreen() {
  const router = useRouter();
  const colors = useColors();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const submit = async () => {
    if (mode === 'signup' && name.trim().length < 2) {
      Alert.alert('Name required', 'Please enter your name to sign up.');
      return;
    }
    if (email.trim().length < 3) {
      Alert.alert('Email required', 'Please enter your email.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        await signUp({ name: name.trim(), email: email.trim() });
      }
      done();
    } catch (err) {
      Alert.alert('Could not continue', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: isSignup ? 'Create account' : 'Sign in' }} />

      <View style={styles.hero}>
        <Text style={[styles.logo, { color: colors.accent }]}>◉</Text>
        <Text variant="title" weight="bold" style={styles.heading}>
          {isSignup ? 'Create your account' : 'Welcome back'}
        </Text>
        <Text tone="muted" style={styles.sub}>
          {isSignup
            ? 'Save places like Home and Work, list a business, and manage your profile.'
            : 'Sign in to browse around your saved places and list your business.'}
        </Text>
      </View>

      {isSignup ? (
        <Input label="Name" placeholder="Your name" value={name} onChangeText={setName} />
      ) : null}
      <Input
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
      />
      <Input
        label="Password"
        placeholder="••••••••"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Button
        title={isSignup ? 'Create account' : 'Sign in'}
        onPress={submit}
        loading={busy}
        style={styles.submit}
      />

      <View style={styles.switchRow}>
        <Text tone="muted" variant="label">
          {isSignup ? 'Already have an account?' : 'New to Localo?'}
        </Text>
        <Text
          tone="accent"
          weight="semibold"
          variant="label"
          onPress={() => setMode(isSignup ? 'signin' : 'signup')}
        >
          {isSignup ? 'Sign in' : 'Create account'}
        </Text>
      </View>

      <Button title="Continue as guest" variant="ghost" onPress={done} style={styles.guest} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: spacing.xl, marginTop: spacing.lg },
  logo: { fontSize: 40 },
  heading: { marginTop: spacing.sm, textAlign: 'center' },
  sub: { marginTop: spacing.sm, textAlign: 'center' },
  submit: { marginTop: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  guest: { marginTop: spacing.sm },
});
