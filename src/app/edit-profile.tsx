/**
 * Edit profile — the parts of an account other people see: the picture, the
 * display name and the bio.
 *
 * Contact details are NOT here. Email and phone live in `profiles_private` and
 * are nobody else's business, so they get their own screen (`/contact-details`)
 * rather than sitting in the same form as the things that go on your public
 * card — the split is the reminder of which is which.
 *
 * The username is shown but not editable: it is the login handle, and the
 * credential address is derived from it (`<username>@localo.app`), so changing
 * it would change how the account signs in. That's a migration, not a text box.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useDismiss } from '@/lib/navigation';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { uploadMedia } from '@/lib/upload';
import { Avatar, Button, Icon, Input, LoadingView, Screen, Text } from '@/components/ui';
import { spacing, useColors } from '@/theme/theme';

/** Keeps a bio to something that reads as a line about you, not an essay. */
const BIO_MAX = 160;

export default function EditProfileScreen() {
  const router = useRouter();
  const dismiss = useDismiss('/account');
  const colors = useColors();
  const { currentUser, authLoading, setCurrentUser } = useAuth();
  const repos = useRepositories();

  const [name, setName] = useState(currentUser?.name ?? '');
  const [bio, setBio] = useState(currentUser?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(currentUser?.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authLoading) return <LoadingView />;
  if (!currentUser) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title: 'Edit profile' }} />
        <Text tone="muted">Sign in to edit your profile.</Text>
        <Button title="Sign in" onPress={() => router.replace('/sign-in')} style={styles.gap} />
      </Screen>
    );
  }

  /**
   * Pick a picture and put it somewhere other phones can load it.
   *
   * The picked uri is shown IMMEDIATELY and the upload runs behind it, so the
   * person isn't watching an empty circle — but `avatarUrl` is only committed
   * to the profile on Save, and by then it holds whatever `uploadMedia`
   * returned (a public URL with Supabase configured, the local uri without).
   */
  const pickPhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo access is off. Turn it on in Settings to pick a picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      // A profile picture is drawn in a circle everywhere, so crop it square
      // here rather than letting the middle of a landscape photo stand in.
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setAvatarUrl(asset.uri);
    setUploading(true);
    const uploaded = await uploadMedia(
      asset.uri,
      { kind: 'image', mimeType: asset.mimeType, fileName: asset.fileName ?? undefined },
      (message) => setError(`Couldn’t upload that picture: ${message}`),
    );
    setAvatarUrl(uploaded);
    setUploading(false);
  };

  const save = async () => {
    setError(null);
    const displayName = name.trim();
    if (!displayName) {
      setError('Your name can’t be blank — it’s what people see.');
      return;
    }
    setSaving(true);
    try {
      const updated = await repos.users.update(currentUser.id, {
        name: displayName,
        // Clearing the box removes the bio rather than storing an empty string.
        bio: bio.trim() || undefined,
        avatarUrl,
      });
      setCurrentUser(updated);
      dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Edit profile' }} />

      <View style={styles.photo}>
        <Pressable onPress={pickPhoto} disabled={uploading}>
          <Avatar name={name || currentUser.name} uri={avatarUrl} size={96} />
          <View style={[styles.badge, { backgroundColor: colors.brand, borderColor: colors.background }]}>
            <Icon name="camera" size={16} color={colors.textInverse} />
          </View>
        </Pressable>
        <Text
          variant="caption"
          tone={uploading ? 'muted' : 'brand'}
          weight="medium"
          style={styles.photoAction}
          onPress={uploading ? undefined : pickPhoto}
        >
          {uploading ? 'Uploading…' : avatarUrl ? 'Change picture' : 'Add a picture'}
        </Text>
        {avatarUrl && !uploading ? (
          <Text
            variant="caption"
            tone="muted"
            style={styles.remove}
            onPress={() => setAvatarUrl(undefined)}
          >
            Remove
          </Text>
        ) : null}
      </View>

      <Input
        label="Display name"
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        autoCapitalize="words"
      />

      <Input
        label="Bio"
        value={bio}
        onChangeText={(text) => setBio(text.slice(0, BIO_MAX))}
        placeholder="A line about you — what you do, what you sell"
        helper={`${bio.length}/${BIO_MAX}`}
        multiline
        numberOfLines={3}
        style={styles.bio}
      />

      {currentUser.username ? (
        <Input
          label="Username"
          value={`@${currentUser.username}`}
          editable={false}
          helper="This is how you sign in, so it can’t be changed here."
        />
      ) : null}

      {error ? (
        <Text tone="danger" variant="caption" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Button
        title={uploading ? 'Waiting for the picture…' : 'Save'}
        onPress={save}
        loading={saving}
        disabled={uploading}
        style={styles.gap}
      />
      <Button title="Cancel" variant="ghost" onPress={dismiss} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { alignItems: 'center', marginBottom: spacing.xl },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAction: { marginTop: spacing.md },
  remove: { marginTop: spacing.xs, textDecorationLine: 'underline' },
  // Multiline inputs collapse to one line on web without an explicit height.
  bio: Platform.OS === 'web' ? { minHeight: 84, textAlignVertical: 'top' } : { textAlignVertical: 'top' },
  error: { marginTop: spacing.sm },
  gap: { marginTop: spacing.lg },
});
