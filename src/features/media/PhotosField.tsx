/**
 * Pick the photos for something you're selling — take one with the camera, or
 * choose several from the gallery. The first photo is the COVER (the one the
 * Stalls grid shows); the rest are what buyers swipe through on the product
 * page, so order matters and a picked photo can be removed or promoted.
 *
 * The picker hands back LOCAL uris (file:// on a phone, blob: on web), which
 * only exist on the device that picked them. Every pick therefore goes through
 * `uploadMedia` (lib/upload.ts) on its way out: on the Supabase backend that
 * returns a public URL other phones can actually load, and with no backend
 * configured it hands the local uri straight back — the old session-only
 * behaviour, unchanged, with no branch here.
 *
 * Picked photos show IMMEDIATELY from their local uri while the upload runs, so
 * the seller is never watching a blank box.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '@/components/ui';
import { uploadAll } from '@/lib/upload';
import { radius, spacing, useColors } from '@/theme/theme';

export interface PhotosFieldProps {
  label?: string;
  value: string[];
  onChange: (photos: string[]) => void;
  /** Stop the seller from adding an unswipeable pile of photos. */
  max?: number;
}

export function PhotosField({
  label = 'Photos (optional)',
  value,
  onChange,
  max = 6,
}: PhotosFieldProps) {
  const colors = useColors();
  const [error, setError] = useState<string | null>(null);
  // Local uris of photos that are on screen but still uploading. They live here
  // rather than in `value` so a half-uploaded photo can never be saved onto the
  // domain object by a seller who taps Save quickly.
  const [pending, setPending] = useState<string[]>([]);

  // The web preview has no camera roll — the browser gives us one file dialog,
  // so don't offer a camera button there.
  const showCamera = Platform.OS !== 'web';
  const remaining = max - value.length - pending.length;
  const full = remaining <= 0;

  /** Show the picked photos at once, upload them, then commit the real URLs. */
  const addPhotos = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const picked = assets.slice(0, Math.max(remaining, 0));
    if (picked.length === 0) return;
    setPending(picked.map((a) => a.uri));
    const urls = await uploadAll(
      picked.map((a) => a.uri),
      { kind: 'image', mimeType: picked[0]?.mimeType, fileName: picked[0]?.fileName ?? undefined },
      (message) => setError(`Couldn’t upload: ${message}. The photo is saved on this device only.`),
    );
    setPending([]);
    onChange([...value, ...urls].slice(0, max));
  };

  const takePhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('One Place needs camera access to take a photo. You can allow it in Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) await addPhotos(result.assets);
  };

  const pickFromGallery = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('One Place needs access to your photos to pick one. You can allow it in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.7,
    });
    if (!result.canceled) await addPhotos(result.assets);
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  /** Promote a photo to first — that's the one buyers see in the grid. */
  const makeCover = (index: number) => {
    const next = [...value];
    const [photo] = next.splice(index, 1);
    onChange([photo, ...next]);
  };

  return (
    <View style={styles.wrap}>
      {/* An empty label means the caller already wrote its own heading. */}
      {label ? (
        <Text variant="label" weight="medium" style={styles.label}>
          {label}
        </Text>
      ) : null}

      {value.length > 0 || pending.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
          <View style={styles.stripRow}>
            {value.map((uri, i) => (
              <View key={`${uri}-${i}`}>
                <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                <Pressable
                  onPress={() => remove(i)}
                  hitSlop={6}
                  style={[styles.remove, { backgroundColor: colors.surface }]}
                >
                  <Text variant="caption" weight="semibold" tone="danger">
                    ✕
                  </Text>
                </Pressable>
                {i === 0 ? (
                  <View style={[styles.coverTag, { backgroundColor: colors.brand }]}>
                    <Text variant="caption" weight="semibold" tone="inverse">
                      Cover
                    </Text>
                  </View>
                ) : (
                  <Pressable onPress={() => makeCover(i)} style={styles.coverAction}>
                    <Text variant="caption" tone="accent" weight="semibold">
                      Make cover
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}

            {/* Already picked, still going up. Dimmed with a spinner over it so
                it reads as "on its way" rather than as a finished photo. */}
            {pending.map((uri, i) => (
              <View key={`pending-${uri}-${i}`}>
                <Image source={{ uri }} style={[styles.thumb, styles.thumbPending]} resizeMode="cover" />
                <View style={styles.spinner}>
                  <ActivityIndicator color={colors.brand} />
                </View>
                <Text variant="caption" tone="muted" style={styles.coverAction}>
                  Uploading…
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {full ? (
        <Text variant="caption" tone="muted">
          That’s the maximum of {max} photo{max === 1 ? '' : 's'}. Remove{' '}
          {max === 1 ? 'it' : 'one'} to {max === 1 ? 'change' : 'add another'}.
        </Text>
      ) : (
        // One upload at a time: the picker returning mid-upload would strand the
        // batch already in `pending`.
        <View style={[styles.buttons, pending.length > 0 && styles.busy]} pointerEvents={pending.length > 0 ? 'none' : 'auto'}>
          {showCamera ? (
            <Pressable
              onPress={takePhoto}
              style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <Text variant="label" weight="semibold">
                📷 Take photo
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={pickFromGallery}
            style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Text variant="label" weight="semibold">
              🖼️ {showCamera ? 'From gallery' : 'Choose photos'}
            </Text>
          </Pressable>
        </View>
      )}

      {error ? (
        <Text variant="caption" tone="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { marginBottom: spacing.sm },
  strip: { marginBottom: spacing.sm },
  stripRow: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 110, height: 110, borderRadius: radius.md },
  thumbPending: { opacity: 0.45 },
  spinner: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverTag: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  coverAction: { marginTop: spacing.xs },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  busy: { opacity: 0.5 },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  error: { marginTop: spacing.sm },
});
