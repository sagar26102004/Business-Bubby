/**
 * Pick the VIDEO for an offer — the reel a business films to advertise itself,
 * the way it would post one on Instagram.
 *
 * One video, not a gallery: a reel is a single piece of creative, and the
 * /deals feed shows exactly one per offer. Recording is offered on a phone
 * (that's where the camera is); on web the browser gives one file dialog, so
 * only "Choose a video" appears there.
 *
 * Length is capped at MAX_SECONDS. A neighborhood ad that runs a minute doesn't
 * get watched, and the bucket's 50 MB ceiling (migration 0015) is a hard wall a
 * long clip walks straight into. The picker enforces it while RECORDING; a clip
 * chosen from the gallery is checked here afterwards, because the picker can't
 * filter the library by duration.
 *
 * Like PhotosField, the picked file goes through `uploadMedia` on its way out,
 * so what gets stored is a public URL other phones can load — not a file:// uri
 * that only exists on the device that filmed it.
 */
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Text } from '@/components/ui';
import { uploadMedia } from '@/lib/upload';
import { radius, spacing, useColors } from '@/theme/theme';

/** Longest reel we accept, in seconds. */
export const MAX_SECONDS = 60;

export interface VideoFieldProps {
  label?: string;
  /** The stored video URL, or undefined when there isn't one yet. */
  value?: string;
  onChange: (videoUrl: string | undefined) => void;
  /** One line under the buttons explaining what the video is for. */
  hint?: string;
}

export function VideoField({ label = 'Video ad (optional)', value, onChange, hint }: VideoFieldProps) {
  const colors = useColors();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  // The preview plays the uploaded video, or the local file while it uploads —
  // either way the business sees what it just filmed straight away.
  const preview = uploading ?? value;
  const player = useVideoPlayer(preview ?? null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  const showCamera = Platform.OS !== 'web';

  const accept = async (asset: ImagePicker.ImagePickerAsset) => {
    // `duration` is milliseconds, and null when the picker couldn't read it —
    // in which case let it through rather than rejecting a valid clip.
    if (asset.duration != null && asset.duration > MAX_SECONDS * 1000 + 500) {
      setError(
        `That video is ${Math.round(asset.duration / 1000)}s. Keep an ad under ${MAX_SECONDS}s — trim it and try again.`,
      );
      return;
    }
    setError(null);
    setUploading(asset.uri);
    const url = await uploadMedia(
      asset.uri,
      { kind: 'video', mimeType: asset.mimeType, fileName: asset.fileName ?? undefined },
      (message) => setError(`Couldn’t upload: ${message}. The video is saved on this device only.`),
    );
    setUploading(null);
    onChange(url);
  };

  const record = async () => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Localo needs camera access to film your ad. You can allow it in Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: MAX_SECONDS,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) await accept(result.assets[0]);
  };

  const pick = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Localo needs access to your videos to pick one. You can allow it in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: false,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) await accept(result.assets[0]);
  };

  const busy = uploading !== null;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" weight="medium" style={styles.label}>
          {label}
        </Text>
      ) : null}

      {preview ? (
        <View style={styles.previewRow}>
          <View style={styles.frame}>
            {/* Muted, looping, no controls — this is a thumbnail that moves, not
                a player. The real viewing happens in the /deals feed. */}
            <VideoView
              player={player}
              style={styles.video}
              contentFit="cover"
              nativeControls={false}
            />
            {busy ? (
              <View style={styles.scrim}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null}
          </View>

          <View style={styles.previewActions}>
            <Text variant="caption" tone="muted">
              {busy ? 'Uploading…' : 'This plays in the deals feed.'}
            </Text>
            {!busy ? (
              <>
                <Pressable onPress={showCamera ? record : pick} hitSlop={6}>
                  <Text variant="label" weight="semibold" tone="accent">
                    Replace
                  </Text>
                </Pressable>
                <Pressable onPress={() => onChange(undefined)} hitSlop={6}>
                  <Text variant="label" weight="semibold" tone="danger">
                    Remove
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.buttons}>
          {showCamera ? (
            <Pressable
              onPress={record}
              style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <Text variant="label" weight="semibold">
                🎥 Film an ad
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={pick}
            style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Text variant="label" weight="semibold">
              🎬 {showCamera ? 'From gallery' : 'Choose a video'}
            </Text>
          </Pressable>
        </View>
      )}

      {hint && !error ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          {hint}
        </Text>
      ) : null}

      {error ? (
        <Text variant="caption" tone="danger" style={styles.hint}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { marginBottom: spacing.sm },
  previewRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  // 9:16 — the shape a phone films in and the shape the feed plays in.
  frame: { width: 90, height: 160, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' },
  video: { width: '100%', height: '100%' },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  previewActions: { flex: 1, gap: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  hint: { marginTop: spacing.sm },
});
