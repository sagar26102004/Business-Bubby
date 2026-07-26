/**
 * Account screen — the signed-in user's profile and settings. Businesses live
 * in the "My Business" tab.
 */
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { Avatar, Button, Card, LoadingView, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

export default function AccountScreen() {
  const { currentUser, authLoading, setCurrentUser, signOut } = useAuth();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const [savingVisibility, setSavingVisibility] = useState(false);

  if (authLoading) return <LoadingView />;

  // Guest state — prompt to sign in / sign up.
  if (!currentUser) {
    return (
      <Screen scroll>
        <View style={styles.guest}>
          <Text style={[styles.guestLogo, { color: colors.accent }]}>◉</Text>
          <Text variant="heading" weight="bold" style={styles.guestTitle}>
            You’re browsing as a guest
          </Text>
          <Text tone="muted" style={styles.guestSub}>
            Sign in to save places like Home and Work, list your business, and make your profile
            public.
          </Text>
          <Button title="Sign in" onPress={() => router.push('/sign-in')} style={styles.guestBtn} />
          <Button
            title="Create account"
            variant="secondary"
            onPress={() => router.push('/sign-in')}
            style={styles.guestBtn}
          />
          <Button
            title="🧪 Dev tools"
            variant="ghost"
            onPress={() => router.push('/dev')}
            style={styles.guestBtn}
          />
        </View>
      </Screen>
    );
  }

  const togglePublic = async (value: boolean) => {
    setSavingVisibility(true);
    try {
      const updated = await repos.users.update(currentUser.id, { isProfilePublic: value });
      setCurrentUser(updated);
    } finally {
      setSavingVisibility(false);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Avatar name={currentUser.name} uri={currentUser.avatarUrl} size={72} />
        <Text variant="heading" weight="bold" style={styles.name}>
          {currentUser.name}
        </Text>
        {currentUser.email ? <Text tone="muted">{currentUser.email}</Text> : null}
      </View>

      {currentUser.bio ? <Text style={styles.bio}>{currentUser.bio}</Text> : null}

      <Card style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchLabel}>
            <Text weight="medium">Public profile</Text>
            <Text variant="caption" tone="muted">
              When on, businesses can list you as an employee and customers can view your profile.
            </Text>
          </View>
          <Switch
            value={currentUser.isProfilePublic}
            onValueChange={togglePublic}
            disabled={savingVisibility}
          />
        </View>
      </Card>

      {isSuperAdminUser(currentUser) ? (
        <Button
          title="🛡️ Admin"
          variant="secondary"
          onPress={() => router.push('/admin')}
          style={styles.signOut}
        />
      ) : null}

      <Button
        title="🧪 Dev tools"
        variant="secondary"
        onPress={() => router.push('/dev')}
        style={isSuperAdminUser(currentUser) ? styles.signOutGhost : styles.signOut}
      />
      <Button title="Sign out" variant="ghost" onPress={() => signOut()} style={styles.signOutGhost} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg },
  name: { marginTop: spacing.sm },
  bio: { marginBottom: spacing.lg },
  card: { marginBottom: spacing.lg },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  switchLabel: { flex: 1 },
  signOut: { marginTop: spacing.xl },
  signOutGhost: { marginTop: spacing.sm },
  guest: { alignItems: 'center', paddingTop: spacing.xxl },
  guestLogo: { fontSize: 44 },
  guestTitle: { marginTop: spacing.md, textAlign: 'center' },
  guestSub: { marginTop: spacing.sm, textAlign: 'center' },
  guestBtn: { alignSelf: 'stretch', marginTop: spacing.md },
});
