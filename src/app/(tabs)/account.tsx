/**
 * Account screen — who you are, and the way in to everything about your
 * account. Businesses live in the "My Business" tab.
 *
 * Deliberately SHORT. The profile card is the subject of the screen, then the
 * handful of rows people actually open a settings area to find; the long tail
 * (privacy, alerts, legal, version, sign out, delete) is one tap away in
 * `/settings` rather than crowding the page it sits under.
 */
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { useAuth } from '@/data/DataProvider';
import { DEV_TOOLS_ENABLED } from '@/lib/devTools';
import { PRIVACY_POLICY_URL, openLegalPage } from '@/lib/legal';
import { Avatar, Button, ListGroup, ListRow, LoadingView, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

/**
 * The privacy-policy link, shown to guests and signed-in users alike.
 *
 * Google Play requires a reachable in-app link to the policy, not only the URL
 * in the store listing — and a guest browsing the directory has already had
 * their location read, so they are exactly as entitled to read it as anyone.
 */
function PrivacyLink() {
  return (
    <Text
      tone="muted"
      variant="caption"
      style={styles.privacy}
      onPress={() => openLegalPage(PRIVACY_POLICY_URL)}
    >
      Privacy Policy
    </Text>
  );
}

export default function AccountScreen() {
  const { currentUser, authLoading } = useAuth();
  const router = useRouter();
  const colors = useColors();

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
          {/* Guests still have alerts and a location, so settings are theirs too. */}
          <Button
            title="Settings"
            variant="ghost"
            onPress={() => router.push('/settings')}
            style={styles.guestBtn}
          />
          {DEV_TOOLS_ENABLED ? (
            <Button
              title="🧪 Dev tools"
              variant="ghost"
              onPress={() => router.push('/dev')}
              style={styles.guestBtn}
            />
          ) : null}
          <PrivacyLink />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Avatar name={currentUser.name} uri={currentUser.avatarUrl} size={88} />
        <Text variant="heading" weight="bold" style={styles.name}>
          {currentUser.name}
        </Text>
        {currentUser.username ? <Text tone="muted">@{currentUser.username}</Text> : null}
        {currentUser.bio ? (
          <Text tone="muted" variant="caption" style={styles.bio}>
            {currentUser.bio}
          </Text>
        ) : null}
        <Button
          title="Edit profile"
          variant="secondary"
          onPress={() => router.push('/edit-profile')}
          style={styles.editBtn}
        />
      </View>

      <ListGroup style={styles.group}>
        <ListRow
          icon="mail"
          label="Contact details"
          // Shows what's actually there, so "Not added" is itself the prompt.
          value={currentUser.email ?? currentUser.phone ?? 'Not added'}
          onPress={() => router.push('/contact-details')}
        />
        <ListRow icon="bell" label="Notifications" onPress={() => router.push('/notification-settings')} />
        <ListRow icon="pin" label="Saved places" onPress={() => router.push('/saved-places')} />
        <ListRow icon="lock" label="Password" onPress={() => router.push('/change-password')} />
        <ListRow icon="settings" label="Settings" onPress={() => router.push('/settings')} />
      </ListGroup>

      {isSuperAdminUser(currentUser) ? (
        <ListGroup style={styles.group}>
          <ListRow icon="shield" label="Platform console" onPress={() => router.push('/admin')} />
        </ListGroup>
      ) : null}

      {DEV_TOOLS_ENABLED ? (
        <Button
          title="🧪 Dev tools"
          variant="ghost"
          onPress={() => router.push('/dev')}
          style={styles.devBtn}
        />
      ) : null}

      <PrivacyLink />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xl },
  name: { marginTop: spacing.sm },
  bio: { textAlign: 'center', marginTop: spacing.xs },
  editBtn: { marginTop: spacing.md, minWidth: 160 },
  group: { marginBottom: spacing.lg },
  devBtn: { marginTop: spacing.sm },
  guest: { alignItems: 'center', paddingTop: spacing.xxl },
  guestLogo: { fontSize: 44 },
  guestTitle: { marginTop: spacing.md, textAlign: 'center' },
  guestSub: { marginTop: spacing.sm, textAlign: 'center' },
  guestBtn: { alignSelf: 'stretch', marginTop: spacing.md },
  privacy: { marginTop: spacing.xl, textAlign: 'center', textDecorationLine: 'underline' },
});
