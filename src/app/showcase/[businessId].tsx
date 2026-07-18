/**
 * Manage a business's work showcase (members only). Add photos and videos of
 * past work — a wedding designer's decor shots, an editor's showreel — and
 * remove pieces that no longer represent the business.
 *
 * Media is linked by URL for now: photos render inline from an image link,
 * videos keep a watch link (plus an optional preview image). Real uploads
 * (camera roll → storage) arrive with the real backend behind the same shape.
 */
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { PortfolioItem } from '@/domain/types';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  Input,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function ShowcaseScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const { currentUser } = useAuth();

  const [kind, setKind] = useState<PortfolioItem['kind']>('photo');
  const [url, setUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(businessId);
    const isMember =
      currentUser?.id === business.ownerId ||
      employees.some((e) => e.userId && e.userId === currentUser?.id);
    return { business, isMember };
  }, [businessId, currentUser?.id]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
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

  const add = async () => {
    const link = url.trim();
    if (!link.startsWith('http')) {
      setFormError('Paste a full link (starting with http…).');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      const item: PortfolioItem = {
        id: `pf_${Date.now().toString(36)}`,
        kind,
        url: link,
        thumbnailUrl: kind === 'video' ? thumbnailUrl.trim() || undefined : undefined,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      await repos.businesses.update(businessId, { portfolio: [...portfolio, item] });
      setUrl('');
      setThumbnailUrl('');
      setTitle('');
      setDescription('');
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Couldn’t add this piece.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await repos.businesses.update(businessId, {
      portfolio: portfolio.filter((p) => p.id !== id),
    });
    reload();
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Work showcase' }} />

      <Text variant="subheading" weight="bold" style={styles.name}>
        {business.name}
      </Text>
      <Text tone="muted" style={styles.hint}>
        Show customers what your work looks like — decor you built, pieces you
        made, videos you edited. It all appears on your business page.
      </Text>

      {/* Current pieces */}
      {portfolio.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text tone="muted">Nothing in the showcase yet — add your first piece below.</Text>
        </Card>
      ) : (
        portfolio.map((item) => (
          <Card key={item.id} style={styles.itemCard} padded={false}>
            <View style={styles.itemRow}>
              <Image
                source={{ uri: item.thumbnailUrl ?? item.url }}
                style={[styles.itemThumb, { backgroundColor: colors.surfaceAlt }]}
                resizeMode="cover"
              />
              <View style={styles.itemInfo}>
                <Text weight="semibold" numberOfLines={1}>
                  {item.kind === 'video' ? '🎬 ' : '📷 '}
                  {item.title ?? (item.kind === 'video' ? 'Video' : 'Photo')}
                </Text>
                {item.description ? (
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => remove(item.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.title ?? item.kind}`}
              >
                <Text tone="danger" weight="semibold" style={styles.removeBtn}>
                  ✕
                </Text>
              </Pressable>
            </View>
          </Card>
        ))
      )}

      {/* Add a piece */}
      <Text variant="subheading" weight="semibold" style={styles.addTitle}>
        Add a piece
      </Text>
      <View style={styles.kindRow}>
        <Tag label="Photo" icon="📷" selected={kind === 'photo'} onPress={() => setKind('photo')} />
        <Tag label="Video" icon="🎬" selected={kind === 'video'} onPress={() => setKind('video')} />
      </View>
      <Input
        label={kind === 'photo' ? 'Photo link' : 'Video link'}
        placeholder={kind === 'photo' ? 'https://… (image URL)' : 'https://… (YouTube, Vimeo, …)'}
        value={url}
        onChangeText={(t) => {
          setUrl(t);
          setFormError(undefined);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        error={formError}
        helper="Media is added by link for now — direct uploads come with the full app."
      />
      {kind === 'video' ? (
        <Input
          label="Preview image link (optional)"
          placeholder="https://… (thumbnail shown on your page)"
          value={thumbnailUrl}
          onChangeText={setThumbnailUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
      <Input
        label="Title (optional)"
        placeholder={kind === 'photo' ? 'e.g. Rose & marigold mandap' : 'e.g. Highlight reel 2026'}
        value={title}
        onChangeText={setTitle}
      />
      <Input
        label="Description (optional)"
        placeholder="A line about this piece of work"
        value={description}
        onChangeText={setDescription}
      />
      <Button
        title={kind === 'photo' ? '➕ Add photo' : '➕ Add video'}
        onPress={add}
        disabled={!url.trim()}
        loading={saving}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { marginBottom: spacing.xs },
  hint: { marginBottom: spacing.lg },
  emptyCard: { marginBottom: spacing.lg },
  itemCard: { marginBottom: spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  itemThumb: { width: 64, height: 48, borderRadius: radius.sm },
  itemInfo: { flex: 1 },
  removeBtn: { fontSize: 16, paddingHorizontal: spacing.xs },
  addTitle: { marginTop: spacing.lg, marginBottom: spacing.md },
  kindRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
});
