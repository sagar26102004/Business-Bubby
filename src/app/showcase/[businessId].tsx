/**
 * The work showcase, as the business's team edits it.
 *
 * This screen used to be a form: paste an image URL, paste a watch link, type a
 * title, type a caption. Nobody has an image URL for the haircut they did this
 * morning — they have the photo, in their phone. So it is now a GALLERY the way
 * every gallery works: one ＋ Add button, pick from the camera roll, and what
 * you picked appears as a tile with a ✕ on it. No titles, no captions — the
 * photo is the point.
 *
 * The ＋ sits in the header once there's something to look at, and in the MIDDLE
 * of an empty screen when there isn't, because on a blank page the only thing to
 * do should be the thing in front of you.
 *
 * TWO WAYS to show work, and a business usually wants both:
 *  - UPLOADS, capped at MAX_SHOWCASE_PHOTOS + MAX_SHOWCASE_VIDEOS. A cafe's
 *    FSSAI certificate, a barber's best fade — that's all it takes, and storage
 *    is what scales with every listing that signs up.
 *  - LINKS, uncapped, for the businesses whose showcase IS the business: a
 *    wedding designer points at the Drive folder or the Instagram grid they
 *    already keep, and the business page renders it as a chip that opens it.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { PortfolioItem, ShowcaseLink } from '@/domain/types';
import {
  countPhotos,
  countVideos,
  describeShowcaseLink,
  isValidLink,
  MAX_SHOWCASE_PHOTOS,
  MAX_SHOWCASE_VIDEOS,
  MAX_SHOWCASE_VIDEO_SECONDS,
  normalizeLink,
  showcaseLinkKind,
} from '@/domain/showcase';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { uploadAll, uploadMedia } from '@/lib/upload';
import { showAlert } from '@/lib/alert';
import { Button, Card, EmptyView, ErrorView, Input, LoadingView, Screen, Text } from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

/** Square edge of one tile in the grid. */
const TILE = 150;

export default function ShowcaseScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const { currentUser } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | undefined>();
  // Local uris of files on screen but still going up. They live outside the
  // saved portfolio so a half-uploaded photo can never be written to it.
  const [pending, setPending] = useState<PortfolioItem['kind'][]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(businessId);
    const isMember =
      currentUser?.id === business.ownerId ||
      employees.some((e) => e.userId && e.userId === currentUser?.id);
    return { business, isMember };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (loadError) return <ErrorView message={loadError.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" subtitle="This listing may have been removed." />;
  if (!data.isMember) {
    return (
      <EmptyView
        title="Members only"
        subtitle="Only this business's team can manage its showcase."
      />
    );
  }

  const { business } = data;
  const portfolio = business.portfolio ?? [];
  const links = business.showcaseLinks ?? [];
  const photosLeft = MAX_SHOWCASE_PHOTOS - countPhotos(portfolio);
  const videosLeft = MAX_SHOWCASE_VIDEOS - countVideos(portfolio);
  const isEmpty = portfolio.length === 0 && links.length === 0 && pending.length === 0;

  const item = (kind: PortfolioItem['kind'], url: string): PortfolioItem => ({
    id: `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind,
    url,
    createdAt: new Date().toISOString(),
  });

  const savePortfolio = async (next: PortfolioItem[]) => {
    await repos.businesses.update(businessId, { portfolio: next });
    reload();
  };

  const saveLinks = async (next: ShowcaseLink[]) => {
    await repos.businesses.update(businessId, { showcaseLinks: next });
    reload();
  };

  /** Ask the picker for photos, show them uploading, then commit the URLs. */
  const addPhotos = async (fromCamera: boolean) => {
    setMenuOpen(false);
    setError(null);
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        fromCamera
          ? 'One Place needs camera access to take a photo. You can allow it in Settings.'
          : 'One Place needs access to your photos to pick one. You can allow it in Settings.',
      );
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: photosLeft,
          quality: 0.7,
        });
    if (result.canceled) return;

    const picked = result.assets.slice(0, photosLeft);
    if (picked.length === 0) return;
    setPending(picked.map(() => 'photo' as const));
    const urls = await uploadAll(
      picked.map((a) => a.uri),
      { kind: 'image', mimeType: picked[0]?.mimeType, fileName: picked[0]?.fileName ?? undefined },
      (message) => setError(`Couldn’t upload: ${message}. The photo is saved on this device only.`),
    );
    setPending([]);
    await savePortfolio([...portfolio, ...urls.map((u) => item('photo', u))]);
  };

  const addVideo = async (fromCamera: boolean) => {
    setMenuOpen(false);
    setError(null);
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('One Place needs permission to add a video. You can allow it in Settings.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['videos'],
          videoMaxDuration: MAX_SHOWCASE_VIDEO_SECONDS,
          quality: 0.7,
        })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 0.7 });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;
    // `duration` is milliseconds, and null when the picker couldn't read it —
    // let that through rather than refusing a perfectly good clip.
    if (asset.duration != null && asset.duration > MAX_SHOWCASE_VIDEO_SECONDS * 1000 + 500) {
      setError(
        `That video is ${Math.round(asset.duration / 1000)}s. Keep it under ${MAX_SHOWCASE_VIDEO_SECONDS}s — trim it and try again.`,
      );
      return;
    }
    setPending(['video']);
    const url = await uploadMedia(
      asset.uri,
      { kind: 'video', mimeType: asset.mimeType, fileName: asset.fileName ?? undefined },
      (message) => setError(`Couldn’t upload: ${message}. The video is saved on this device only.`),
    );
    setPending([]);
    await savePortfolio([...portfolio, item('video', url)]);
  };

  const addLink = async () => {
    const url = normalizeLink(link);
    if (!isValidLink(url)) {
      setLinkError('Paste the full link, e.g. drive.google.com/…');
      return;
    }
    setLinkOpen(false);
    setLink('');
    setLinkError(undefined);
    await saveLinks([
      ...links,
      {
        id: `sl_${Date.now().toString(36)}`,
        kind: showcaseLinkKind(url),
        url,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  /** Nothing goes off the page without being asked twice. */
  const confirmRemove = (title: string, onConfirm: () => void) =>
    showAlert(title, 'It disappears from your business page.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: onConfirm },
    ]);

  const removeItem = (piece: PortfolioItem) =>
    confirmRemove(`Remove this ${piece.kind}?`, () => {
      void savePortfolio(portfolio.filter((p) => p.id !== piece.id));
    });

  const removeLink = (target: ShowcaseLink) =>
    confirmRemove(`Remove this ${describeShowcaseLink(target.kind).label} link?`, () => {
      void saveLinks(links.filter((l) => l.id !== target.id));
    });

  const header = (
    <Stack.Screen
      options={{
        title: 'Work showcase',
        // On an empty showcase the ＋ lives in the middle of the page instead,
        // so the header stays quiet until there's something to add TO.
        headerRight: isEmpty
          ? undefined
          : () => (
              <Text
                tone="accent"
                weight="semibold"
                style={styles.headerAdd}
                onPress={() => setMenuOpen(true)}
                accessibilityRole="button"
              >
                ＋ Add
              </Text>
            ),
      }}
    />
  );

  const sheets = (
    <>
      <AddMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        photosLeft={photosLeft}
        videosLeft={videosLeft}
        onTakePhoto={() => addPhotos(true)}
        onPickPhotos={() => addPhotos(false)}
        onFilmVideo={() => addVideo(true)}
        onPickVideo={() => addVideo(false)}
        onAddLink={() => {
          setMenuOpen(false);
          setLinkOpen(true);
        }}
      />
      <LinkSheet
        visible={linkOpen}
        value={link}
        error={linkError}
        onChange={(t) => {
          setLink(t);
          setLinkError(undefined);
        }}
        onCancel={() => {
          setLinkOpen(false);
          setLink('');
          setLinkError(undefined);
        }}
        onAdd={addLink}
      />
    </>
  );

  if (isEmpty) {
    return (
      <Screen>
        {header}
        <View style={styles.blank}>
          <Text style={styles.blankIcon}>🖼️</Text>
          <Text weight="semibold" style={styles.blankTitle}>
            Show your work
          </Text>
          <Text tone="muted" style={styles.blankText}>
            Photos and videos of what you’ve done — customers see them on your page.
          </Text>
          <Button title="＋ Add" onPress={() => setMenuOpen(true)} style={styles.blankBtn} />
        </View>
        {sheets}
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {header}

      <View style={styles.grid}>
        {portfolio.map((piece) => (
          <MediaTile key={piece.id} item={piece} onRemove={() => removeItem(piece)} />
        ))}
        {pending.map((kind, i) => (
          <View key={`pending-${i}`} style={[styles.tile, styles.pendingTile]}>
            <ActivityIndicator />
            <Text variant="caption" tone="muted" style={styles.pendingLabel}>
              Uploading {kind}…
            </Text>
          </View>
        ))}
      </View>

      <Text variant="caption" tone="muted" style={styles.counts}>
        {countPhotos(portfolio)}/{MAX_SHOWCASE_PHOTOS} photos ·{' '}
        {countVideos(portfolio)}/{MAX_SHOWCASE_VIDEOS} video
      </Text>

      {links.length > 0 ? (
        <View style={styles.links}>
          {links.map((l) => {
            const style = describeShowcaseLink(l.kind);
            return (
              <Card key={l.id} style={styles.linkCard} padded={false}>
                <View style={styles.linkRow}>
                  <Text style={styles.linkIcon}>{style.icon}</Text>
                  <View style={styles.linkInfo}>
                    <Text weight="semibold">{style.label}</Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {l.url}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => removeLink(l)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${style.label} link`}
                  >
                    <Text tone="danger" weight="semibold" style={styles.linkRemove}>
                      ✕
                    </Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      ) : null}

      {error ? (
        <Text variant="caption" tone="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {sheets}
    </Screen>
  );
}

/**
 * One uploaded piece. A photo shows itself; a video shows its first frame with
 * a play badge and plays on tap, so the owner can check what they uploaded
 * without leaving the screen.
 */
function MediaTile({ item, onRemove }: { item: PortfolioItem; onRemove: () => void }) {
  const colors = useColors();
  const [playing, setPlaying] = useState(false);
  const player = useVideoPlayer(item.kind === 'video' ? item.url : null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  const toggle = () => {
    if (playing) player.pause();
    else player.play();
    setPlaying(!playing);
  };

  return (
    <View style={styles.tileWrap}>
      {item.kind === 'video' ? (
        <Pressable onPress={toggle} style={styles.tile}>
          <VideoView
            player={player}
            style={styles.tileMedia}
            nativeControls={false}
            contentFit="cover"
          />
          {!playing ? (
            <View style={styles.playBadge}>
              <Text style={styles.playIcon}>▶</Text>
            </View>
          ) : null}
        </Pressable>
      ) : (
        <Image
          source={{ uri: item.url }}
          style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}
          resizeMode="cover"
        />
      )}
      <Pressable
        onPress={onRemove}
        hitSlop={6}
        style={[styles.remove, { backgroundColor: colors.surface }]}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.kind}`}
      >
        <Text variant="caption" weight="semibold" tone="danger">
          ✕
        </Text>
      </Pressable>
    </View>
  );
}

/** What ＋ Add opens: the ways to put something in the showcase. */
function AddMenu({
  visible,
  onClose,
  photosLeft,
  videosLeft,
  onTakePhoto,
  onPickPhotos,
  onFilmVideo,
  onPickVideo,
  onAddLink,
}: {
  visible: boolean;
  onClose: () => void;
  photosLeft: number;
  videosLeft: number;
  onTakePhoto: () => void;
  onPickPhotos: () => void;
  onFilmVideo: () => void;
  onPickVideo: () => void;
  onAddLink: () => void;
}) {
  const colors = useColors();
  // The web preview has no camera roll — the browser gives one file dialog, so
  // the camera entries only make sense on a phone.
  const onPhone = Platform.OS !== 'web';

  const rows: { icon: string; label: string; hint: string; disabled?: boolean; onPress: () => void }[] = [
    ...(onPhone
      ? [
          {
            icon: '📷',
            label: 'Take a photo',
            hint: photosLeft > 0 ? `${photosLeft} left` : 'Limit reached',
            disabled: photosLeft <= 0,
            onPress: onTakePhoto,
          },
        ]
      : []),
    {
      icon: '🖼️',
      label: onPhone ? 'Choose photos' : 'Upload photos',
      hint: photosLeft > 0 ? `${photosLeft} of ${MAX_SHOWCASE_PHOTOS} left` : 'Limit reached',
      disabled: photosLeft <= 0,
      onPress: onPickPhotos,
    },
    ...(onPhone
      ? [
          {
            icon: '🎥',
            label: 'Film a video',
            hint: videosLeft > 0 ? `Up to ${MAX_SHOWCASE_VIDEO_SECONDS}s` : 'Limit reached',
            disabled: videosLeft <= 0,
            onPress: onFilmVideo,
          },
        ]
      : []),
    {
      icon: '🎬',
      label: onPhone ? 'Choose a video' : 'Upload a video',
      hint: videosLeft > 0 ? `${videosLeft} of ${MAX_SHOWCASE_VIDEOS}, up to ${MAX_SHOWCASE_VIDEO_SECONDS}s` : 'Limit reached',
      disabled: videosLeft <= 0,
      onPress: onPickVideo,
    },
    {
      icon: '🔗',
      label: 'Add a link',
      hint: 'Google Drive, Instagram, YouTube — as much as you like',
      onPress: onAddLink,
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallow taps on the sheet itself so it doesn't close under a choice. */}
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
          <Text weight="bold" style={styles.sheetTitle}>
            Add to your showcase
          </Text>
          {rows.map((row) => (
            <Pressable
              key={row.label}
              onPress={row.disabled ? undefined : row.onPress}
              style={[styles.option, { borderColor: colors.border }, row.disabled && styles.optionOff]}
              accessibilityRole="button"
              accessibilityState={{ disabled: row.disabled }}
            >
              <Text style={styles.optionIcon}>{row.icon}</Text>
              <View style={styles.optionText}>
                <Text weight="semibold">{row.label}</Text>
                <Text variant="caption" tone="muted">
                  {row.hint}
                </Text>
              </View>
            </Pressable>
          ))}
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Paste the gallery you already keep somewhere else. */
function LinkSheet({
  visible,
  value,
  error,
  onChange,
  onCancel,
  onAdd,
}: {
  visible: boolean;
  value: string;
  error?: string;
  onChange: (text: string) => void;
  onCancel: () => void;
  onAdd: () => void;
}) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
          <Text weight="bold" style={styles.sheetTitle}>
            Add a link
          </Text>
          <Input
            label="Link"
            placeholder="drive.google.com/… or instagram.com/…"
            value={value}
            onChangeText={onChange}
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
          />
          <Button title="Add link" onPress={onAdd} disabled={!value.trim()} />
          <Button title="Cancel" variant="ghost" onPress={onCancel} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  headerAdd: { paddingHorizontal: spacing.sm, fontSize: 16 },

  blank: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  blankIcon: { fontSize: 44 },
  blankTitle: { marginTop: spacing.sm },
  blankText: { textAlign: 'center', maxWidth: 280 },
  blankBtn: { marginTop: spacing.md, minWidth: 160 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tileWrap: { width: TILE },
  tile: { width: TILE, height: TILE, borderRadius: radius.md, overflow: 'hidden' },
  tileMedia: { width: TILE, height: TILE },
  pendingTile: { alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  pendingLabel: { marginTop: spacing.xs },
  playBadge: {
    position: 'absolute',
    top: TILE / 2 - 18,
    alignSelf: 'center',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#FFFFFF', fontSize: 14, marginLeft: 2 },
  remove: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counts: { marginTop: spacing.md },

  links: { marginTop: spacing.lg },
  linkCard: { marginBottom: spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  linkIcon: { fontSize: 22 },
  linkInfo: { flex: 1 },
  linkRemove: { fontSize: 16, paddingHorizontal: spacing.xs },

  error: { marginTop: spacing.md },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetTitle: { marginBottom: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  optionOff: { opacity: 0.4 },
  optionIcon: { fontSize: 22 },
  optionText: { flex: 1 },
});
