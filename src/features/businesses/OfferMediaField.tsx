/**
 * The "Ad media" block of the offer builder — the one REQUIRED part of an offer.
 *
 * A big preview on top (the reel when there is one, else the photo) with
 * Change / delete on it, and two tiles underneath: Add Photo and Upload Video.
 * An offer can carry both: the reel plays full-screen in the deals feed and the
 * photo is the still everywhere else (and the reel's poster), so each tile shows
 * its own state and can be removed on its own.
 *
 * Uploads go through `uploadMedia` exactly as PhotosField / VideoField do —
 * including the `isLocalUri` check, because a failed upload hands back the
 * device-only uri instead of throwing and would otherwise look like success.
 */
import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon, Text } from '@/components/ui';
import { showAlert } from '@/lib/alert';
import { isLocalUri, uploadMedia } from '@/lib/upload';
import { thumbUrl, CARD_WIDTH } from '@/lib/media';
import { MAX_SECONDS } from '@/features/media/VideoField';
import { radius, spacing, useColors } from '@/theme/theme';

type Kind = 'image' | 'video';

export interface OfferMediaFieldProps {
  imageUrl?: string;
  videoUrl?: string;
  onImage: (url: string | undefined) => void;
  onVideo: (url: string | undefined) => void;
  /** Shown big in the empty preview, e.g. the offer's emoji. */
  emoji?: string;
  /** The headline, written on the empty preview. */
  title?: string;
}

export function OfferMediaField({
  imageUrl,
  videoUrl,
  onImage,
  onVideo,
  emoji,
  title,
}: OfferMediaFieldProps) {
  const colors = useColors();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Kind | null>(null);
  const [localVideo, setLocalVideo] = useState<string | null>(null);

  const videoSrc = localVideo ?? videoUrl;
  const player = useVideoPlayer(videoSrc ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const accept = async (kind: Kind, asset: ImagePicker.ImagePickerAsset) => {
    if (kind === 'video' && asset.duration != null && asset.duration > MAX_SECONDS * 1000 + 500) {
      setError(
        `That video is ${Math.round(asset.duration / 1000)}s. Keep an ad under ${MAX_SECONDS}s — trim it and try again.`,
      );
      return;
    }
    setError(null);
    setUploading(kind);
    if (kind === 'video') setLocalVideo(asset.uri);
    const url = await uploadMedia(
      asset.uri,
      {
        kind,
        mimeType: asset.mimeType,
        fileName: asset.fileName ?? undefined,
        bytes: asset.fileSize,
      },
      (message) => setError(`Couldn’t upload: ${message}. It’s saved on this device only.`),
    );
    setUploading(null);
    setLocalVideo(null);
    (kind === 'video' ? onVideo : onImage)(url);
    if (isLocalUri(url)) {
      setError(
        (existing) =>
          existing ??
          `That ${kind === 'video' ? 'video' : 'photo'} couldn’t be uploaded and is on this phone only — nobody else will see it. Try again on a better connection.`,
      );
    }
  };

  const fromGallery = async (kind: Kind) => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('One Place needs access to your photos and videos. You can allow it in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: [kind === 'video' ? 'videos' : 'images'],
      allowsMultipleSelection: false,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) await accept(kind, result.assets[0]);
  };

  const fromCamera = async (kind: Kind) => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('One Place needs camera access. You can allow it in Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: [kind === 'video' ? 'videos' : 'images'],
      videoMaxDuration: MAX_SECONDS,
      allowsEditing: kind === 'image',
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) await accept(kind, result.assets[0]);
  };

  /** Phone: camera or gallery. Web has no camera roll — straight to the file dialog. */
  const pick = (kind: Kind) => {
    if (uploading) return;
    if (Platform.OS === 'web') {
      void fromGallery(kind);
      return;
    }
    showAlert(kind === 'video' ? 'Add a video reel' : 'Add a photo', undefined, [
      { text: kind === 'video' ? 'Film one' : 'Take photo', onPress: () => void fromCamera(kind) },
      { text: 'Choose from gallery', onPress: () => void fromGallery(kind) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // The big preview shows the reel when there is one — that's the ad people
  // watch — and otherwise the photo.
  const showing: Kind | null = videoSrc ? 'video' : imageUrl ? 'image' : null;
  const stranded = showing === 'video' ? isLocalUri(videoUrl) : isLocalUri(imageUrl);

  return (
    <View>
      <View style={[styles.preview, { backgroundColor: '#1B231E' }]}>
        {showing === 'video' ? (
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        ) : showing === 'image' && imageUrl ? (
          <Image
            source={{ uri: thumbUrl(imageUrl, CARD_WIDTH) }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.emptyPreview}>
            <Text style={styles.emptyEmoji}>{emoji ?? '🎉'}</Text>
            <Text weight="bold" style={styles.onDark} numberOfLines={1}>
              {title?.trim() || 'Your ad shows here'}
            </Text>
            <Text variant="caption" style={styles.onDarkMuted}>
              Add a photo or a video reel below
            </Text>
          </View>
        )}

        {showing ? (
          <View style={styles.previewBar}>
            <View style={[styles.pill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
              <View
                style={[
                  styles.recDot,
                  { backgroundColor: showing === 'video' ? colors.danger : colors.success },
                ]}
              />
              <Text variant="caption" weight="semibold" style={styles.onDark}>
                {uploading === showing
                  ? 'Uploading…'
                  : stranded
                    ? 'On this phone only'
                    : showing === 'video'
                      ? 'Video reel'
                      : 'Photo ad'}
              </Text>
            </View>
            <View style={styles.previewActions}>
              <Pressable
                onPress={() => pick(showing)}
                style={[styles.pill, { backgroundColor: 'rgba(255,255,255,0.9)' }]}
                accessibilityRole="button"
              >
                <Icon name="refresh" size={14} color={colors.text} />
                <Text variant="caption" weight="semibold">
                  Change
                </Text>
              </Pressable>
              <Pressable
                onPress={() => (showing === 'video' ? onVideo(undefined) : onImage(undefined))}
                style={[styles.iconPill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
                accessibilityRole="button"
                accessibilityLabel={showing === 'video' ? 'Remove video' : 'Remove photo'}
              >
                <Icon name="trash" size={15} color="#fff" />
              </Pressable>
            </View>
          </View>
        ) : null}

        {uploading ? (
          <View style={styles.scrim}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </View>

      <View style={styles.tiles}>
        <MediaTile
          icon="camera"
          title={imageUrl ? 'Photo added' : 'Add Photo'}
          subtitle={imageUrl ? 'Tap to change' : 'JPEG or PNG'}
          thumb={imageUrl ? thumbUrl(imageUrl) : undefined}
          onPress={() => pick('image')}
          onRemove={imageUrl ? () => onImage(undefined) : undefined}
          busy={uploading === 'image'}
        />
        <MediaTile
          icon="play"
          title={videoUrl ? 'Reel added' : 'Upload Video'}
          subtitle={videoUrl ? 'Tap to change' : `Up to ${MAX_SECONDS}s, upright`}
          badge="Reel"
          onPress={() => pick('video')}
          onRemove={videoUrl ? () => onVideo(undefined) : undefined}
          busy={uploading === 'video'}
        />
      </View>

      {error ? (
        <Text variant="caption" tone="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function MediaTile({
  icon,
  title,
  subtitle,
  badge,
  thumb,
  onPress,
  onRemove,
  busy,
}: {
  icon: 'camera' | 'play';
  title: string;
  subtitle: string;
  badge?: string;
  thumb?: string;
  onPress: () => void;
  onRemove?: () => void;
  busy?: boolean;
}) {
  const colors = useColors();
  const filled = !!onRemove;
  return (
    <View style={styles.tileWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={[
          styles.tile,
          {
            borderColor: filled ? colors.brand : colors.border,
            borderStyle: filled ? 'solid' : 'dashed',
            backgroundColor: filled ? colors.brandSoft : colors.surface,
          },
        ]}
      >
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.successSoft }]}>
            <Text variant="caption" weight="bold" style={{ color: colors.successText, fontSize: 10 }}>
              {badge}
            </Text>
          </View>
        ) : null}
        {busy ? (
          <ActivityIndicator color={colors.brand} />
        ) : thumb ? (
          <Image source={{ uri: thumb }} style={styles.tileThumb} resizeMode="cover" />
        ) : icon === 'play' ? (
          <Text style={styles.tileEmoji}>🎥</Text>
        ) : (
          <Icon name="camera" size={24} color={colors.text} />
        )}
        <Text variant="label" weight="semibold" style={styles.tileTitle}>
          {title}
        </Text>
        <Text variant="caption" tone="muted">
          {subtitle}
        </Text>
      </Pressable>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={6} style={styles.tileRemove} accessibilityRole="button">
          <Text variant="caption" weight="semibold" tone="danger">
            Remove
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    height: 200,
    borderRadius: radius.md,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  emptyPreview: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, padding: spacing.md },
  emptyEmoji: { fontSize: 36, lineHeight: 44 },
  onDark: { color: '#fff' },
  onDarkMuted: { color: 'rgba(255,255,255,0.75)' },
  previewBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.sm,
  },
  previewActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  iconPill: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 8, height: 8, borderRadius: 4 },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tiles: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  tileWrap: { flex: 1, alignItems: 'center' },
  tile: {
    width: '100%',
    minHeight: 104,
    borderWidth: 1.5,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    gap: 2,
  },
  tileThumb: { width: 36, height: 36, borderRadius: 8 },
  tileEmoji: { fontSize: 24, lineHeight: 30 },
  tileTitle: { marginTop: 4 },
  tileRemove: { marginTop: spacing.xs },
  badge: { position: 'absolute', top: 6, right: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
  error: { marginTop: spacing.sm },
});
