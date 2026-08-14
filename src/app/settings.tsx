/**
 * Settings — everything about the account that isn't the profile itself.
 *
 * The Account tab is deliberately short: who you are, and the handful of things
 * people actually come looking for. Everything else — alerts, privacy, the
 * legal pages, the version number, and the two irreversible actions — lives
 * here, one screen deeper, where it can be a proper list instead of a pile of
 * buttons competing with the profile.
 *
 * Sign out and Delete account sit at the BOTTOM, in that order, separated from
 * the rest. Delete leads to `/delete-account`, which explains itself before
 * anything happens; Play requires that path to exist and to be findable.
 */
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { DEV_TOOLS_ENABLED } from '@/lib/devTools';
import { PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_URL, openLegalPage } from '@/lib/legal';
import { Button, ListGroup, ListRow, LoadingView, Screen, Text } from '@/components/ui';
import { spacing } from '@/theme/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { currentUser, authLoading, setCurrentUser, signOut } = useAuth();
  const repos = useRepositories();
  const [savingVisibility, setSavingVisibility] = useState(false);

  const version = Constants.expoConfig?.version ?? '1.0.0';

  if (authLoading) return <LoadingView />;

  // Guests get the parts that are theirs: what the app collected before they
  // ever signed up (location, alerts) is exactly as much their business.
  if (!currentUser) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title: 'Settings' }} />
        <ListGroup title="App">
          <ListRow icon="bell" label="Notifications" onPress={() => router.push('/notification-settings')} />
          <ListRow icon="pin" label="Saved places" sub="Sign in to save Home and Work" onPress={() => router.push('/sign-in')} />
        </ListGroup>
        <LegalGroup version={version} />
        <Button title="Sign in" onPress={() => router.push('/sign-in')} style={styles.gap} />
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
      <Stack.Screen options={{ title: 'Settings' }} />

      <ListGroup title="Account" style={styles.group}>
        <ListRow
          icon="user"
          label="Edit profile"
          sub="Picture, name and bio"
          onPress={() => router.push('/edit-profile')}
        />
        <ListRow
          icon="mail"
          label="Contact details"
          value={currentUser.email ?? currentUser.phone ?? 'Not added'}
          onPress={() => router.push('/contact-details')}
        />
        <ListRow
          icon="lock"
          label="Password"
          sub="Change the password you sign in with"
          onPress={() => router.push('/change-password')}
        />
      </ListGroup>

      <ListGroup title="Privacy" style={styles.group}>
        <ListRow
          icon="shield"
          label="Public profile"
          sub="When on, businesses can list you as an employee and customers can view your profile."
          accessory={
            <Switch
              value={currentUser.isProfilePublic}
              onValueChange={togglePublic}
              disabled={savingVisibility}
            />
          }
        />
      </ListGroup>

      <ListGroup title="App" style={styles.group}>
        <ListRow
          icon="bell"
          label="Notifications"
          sub="What you get alerted about, everywhere"
          onPress={() => router.push('/notification-settings')}
        />
        <ListRow
          icon="pin"
          label="Saved places"
          sub="Home, Work and anywhere else you browse around"
          onPress={() => router.push('/saved-places')}
        />
      </ListGroup>

      {isSuperAdminUser(currentUser) || DEV_TOOLS_ENABLED ? (
        <ListGroup title="Platform" style={styles.group}>
          {isSuperAdminUser(currentUser) ? (
            <ListRow icon="shield" label="Platform console" onPress={() => router.push('/admin')} />
          ) : null}
          {DEV_TOOLS_ENABLED ? (
            <ListRow icon="settings" label="Dev tools" onPress={() => router.push('/dev')} />
          ) : null}
        </ListGroup>
      ) : null}

      <LegalGroup version={version} />

      <ListGroup style={styles.group}>
        <ListRow icon="logout" label="Sign out" onPress={() => signOut()} />
        <ListRow
          icon="trash"
          label="Delete my account"
          danger
          onPress={() => router.push('/delete-account')}
        />
      </ListGroup>

      <View style={styles.footer}>
        <Text variant="caption" tone="muted">
          One Place · v{version}
        </Text>
      </View>
    </Screen>
  );
}

/** The legal pages plus the version — the same list whether signed in or not. */
function LegalGroup({ version }: { version: string }) {
  return (
    <ListGroup title="About" style={styles.group}>
      <ListRow icon="info" label="Privacy policy" onPress={() => openLegalPage(PRIVACY_POLICY_URL)} />
      <ListRow icon="info" label="Terms of service" onPress={() => openLegalPage(TERMS_URL)} />
      <ListRow icon="chat" label="Help & support" onPress={() => openLegalPage(SUPPORT_URL)} />
      <ListRow icon="store" label="Version" value={version} />
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: spacing.lg },
  gap: { marginTop: spacing.lg },
  footer: { alignItems: 'center', marginTop: spacing.sm },
});
