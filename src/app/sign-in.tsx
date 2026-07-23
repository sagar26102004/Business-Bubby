/**
 * Sign in / Sign up screen (presented as a modal).
 *
 * Auth is mocked: signing in with any credentials logs you in as the demo user;
 * signing up creates a fresh account. Guests are sent here when they try to do
 * something that needs an account (browsing a saved place, listing a business).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/data/DataProvider';
import { Button, Input, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

type Mode = 'signin' | 'signup';

/** Count the digits in a phone number, ignoring spaces, +, dashes, etc. */
const phoneDigits = (value: string) => value.replace(/\D/g, '').length;

export default function SignInScreen() {
  const router = useRouter();
  const colors = useColors();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Inline validation message. Alert.alert is a no-op on web (our preview), so
  // errors are shown on the screen instead of a native popup.
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const submit = async () => {
    if (mode === 'signup' && name.trim().length < 2) {
      setError('Please enter your name to sign up.');
      return;
    }
    if (phoneDigits(phone) < 10) {
      setError('Please enter a valid phone number (at least 10 digits).');
      return;
    }
    if (mode === 'signin' && password.trim().length === 0) {
      setError('Please enter your password to sign in.');
      return;
    }
    if (mode === 'signup' && password.trim().length < 6) {
      setError('Please choose a password of at least 6 characters.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(phone.trim(), password);
      } else {
        await signUp({ name: name.trim(), phone: phone.trim(), password });
      }
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not continue. Try again.');
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
        <Input
          label="Name"
          placeholder="Your name"
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (error) setError(null);
          }}
        />
      ) : null}
      <Input
        label="Phone number"
        placeholder="e.g. 98765 43210"
        value={phone}
        onChangeText={(t) => {
          setPhone(t);
          if (error) setError(null);
        }}
        autoCapitalize="none"
        keyboardType="phone-pad"
        autoCorrect={false}
      />
      <Input
        label="Password"
        placeholder="••••••••"
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          if (error) setError(null);
        }}
        secureTextEntry
      />

      {error ? (
        <Text tone="danger" variant="label" style={styles.error}>
          {error}
        </Text>
      ) : null}

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
          onPress={() => {
            setMode(isSignup ? 'signin' : 'signup');
            setError(null);
          }}
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
  error: { marginTop: spacing.md, textAlign: 'center' },
  submit: { marginTop: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  guest: { marginTop: spacing.sm },
});
