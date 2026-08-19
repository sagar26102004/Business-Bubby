/**
 * Sign in / Sign up screen (presented as a modal).
 *
 * IDENTITY: a USERNAME and a password. That is the whole requirement — nothing
 * is emailed, nothing is texted, and nothing can fail between choosing an
 * account and having one. A name, an email and a phone number are offered
 * behind a disclosure as contact details; all three may be left blank.
 *
 * Sign-in is one box. It says "Username" because that is what everyone new has,
 * and still accepts an email or a phone number so accounts made before
 * usernames existed — the seeded ten, the super-admin, Google users — get in.
 *
 * The rules (username shape, password length, contact formats) are NOT
 * re-implemented here — they come from `assertUsername` / `assertPassword` /
 * `assertContactDetails` in the repository layer, so the screen and every
 * backend refuse the same things with the same words.
 *
 * Guests are sent here when they try to do something that needs an account
 * (browsing a saved place, listing a business).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { assertContactDetails, assertPassword, assertUsername } from '@/data/repositories';
import { PRIVACY_POLICY_URL, TERMS_URL, openLegalPage } from '@/lib/legal';
import { Button, Input, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

type Mode = 'signin' | 'signup';

export default function SignInScreen() {
  const router = useRouter();
  const colors = useColors();
  const { signIn, signUp, setCurrentUser } = useAuth();
  const repos = useRepositories();

  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  /**
   * Sign-in's single box. Labelled "Username" because that is what everyone
   * new has, but it still accepts an email or a phone number so the accounts
   * created before usernames existed — the seeded ten, the super-admin, anyone
   * who signed in with Google — can still get in.
   */
  const [identifier, setIdentifier] = useState('');
  /** Contact details are folded away; almost nobody needs to open this. */
  const [showContact, setShowContact] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // Inline validation message — a sign-in error belongs next to the field that
  // caused it, not in a popup.
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  /**
   * Google. Deliberately does NOT run the identity/password rules — there is no
   * password, and Google supplies an address it has already verified, which is
   * a stronger claim than anything this form can collect.
   */
  const google = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      const user = await repos.auth.signInWithGoogle();
      setCurrentUser(user);
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in with Google.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        if (!identifier.trim()) throw new Error('Enter your username.');
        if (!password) throw new Error('Please enter your password to sign in.');
        await signIn(identifier.trim(), password);
      } else {
        // The shared rules, thrown as the same sentences every backend uses.
        // Only the username and password are required; the rest is contact
        // detail and may be left entirely blank.
        const handle = assertUsername(username);
        const contact = assertContactDetails({ email, phone });
        assertPassword(password);
        await signUp({ username: handle, name: name.trim() || undefined, ...contact, password });
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
        <>
          {/*
            The only two fields that matter. Everything else on this screen is
            optional and folded away — a sign-up that can be completed in two
            boxes is one nobody abandons halfway.
          */}
          <Input
            label="Username"
            placeholder="e.g. sagar_rathore"
            value={username}
            onChangeText={(t) => {
              // Normalised as they type, so what they see is what gets created
              // and "taken" never comes as a surprise about capitalisation.
              setUsername(t.toLowerCase().replace(/[^a-z0-9._]/g, ''));
              if (error) setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text tone="muted" variant="caption" style={styles.hint}>
            This is how you’ll sign in. Letters, numbers, dots and underscores.
          </Text>

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

          <Text
            tone="accent"
            weight="semibold"
            variant="label"
            style={styles.disclosure}
            onPress={() => setShowContact((s) => !s)}
          >
            {showContact ? '− Hide optional details' : '+ Add your name and contact details'}
          </Text>

          {showContact ? (
            <>
              <Input
                label="Full name (optional)"
                placeholder="Shown to businesses you deal with"
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  if (error) setError(null);
                }}
              />
              <Input
                label="Email address (optional)"
                placeholder="you@example.com"
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (error) setError(null);
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
              <Input
                label="Phone number (optional)"
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
              <Text tone="muted" variant="caption" style={styles.hint}>
                Only so a business can reach you about an order. You sign in
                with your username either way.
              </Text>
            </>
          ) : null}
        </>
      ) : (
        <>
          <Input
            label="Username"
            placeholder="Your username"
            value={identifier}
            onChangeText={(t) => {
              setIdentifier(t);
              if (error) setError(null);
            }}
            autoCapitalize="none"
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
        </>
      )}

      {error ? (
        <Text tone="danger" variant="label" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {/*
        Consent AT THE POINT OF COLLECTION — Play reviewers look for exactly
        this on the screen that takes the name and phone number, not only for a
        link buried in settings. Sign-up only: signing in collects nothing new.
      */}
      {isSignup ? (
        <Text tone="muted" variant="caption" style={styles.consent}>
          By creating an account you agree to our{' '}
          <Text
            tone="accent"
            variant="caption"
            weight="semibold"
            onPress={() => openLegalPage(TERMS_URL)}
          >
            Terms of Service
          </Text>{' '}
          and{' '}
          <Text
            tone="accent"
            variant="caption"
            weight="semibold"
            onPress={() => openLegalPage(PRIVACY_POLICY_URL)}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      ) : null}

      {/*
        NO "Forgot password?" LINK, and that is not an oversight.
        A username account's address is `<username>@localo.app`, which has no
        inbox, so there is nowhere to send a recovery code — offering the link
        would open a screen that can only ever fail. Continue with Google is the
        recovery route: an account with no password cannot forget one. Bringing
        reset back needs custom SMTP AND a verified address on the account.
      */}
      <Button
        title={isSignup ? 'Create account' : 'Sign in'}
        onPress={submit}
        loading={busy}
        style={styles.submit}
      />

      {/*
        Google, offered on BOTH modes because it is one button that means "sign
        in" and "sign up" at once — Google does not distinguish, and neither
        should the screen. Placed under the primary action rather than above it:
        the app's own account is the default, and this is the shortcut.
      */}
      <View style={styles.dividerRow}>
        <View style={[styles.rule, { backgroundColor: colors.border }]} />
        <Text tone="muted" variant="caption">
          or
        </Text>
        <View style={[styles.rule, { backgroundColor: colors.border }]} />
      </View>

      <Button
        title="Continue with Google"
        variant="secondary"
        onPress={() => void google()}
        loading={googleBusy}
        disabled={busy}
        style={styles.submit}
      />

      <View style={styles.switchRow}>
        <Text tone="muted" variant="label">
          {isSignup ? 'Already have an account?' : 'New to One Place?'}
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
  hint: { marginTop: spacing.xs },
  disclosure: { marginTop: spacing.lg },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  consent: { marginTop: spacing.lg, textAlign: 'center' },
  submit: { marginTop: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  guest: { marginTop: spacing.sm },
});
