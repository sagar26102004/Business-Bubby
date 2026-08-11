/**
 * Workspace › Offers — the business's own promotions.
 *
 * An offer bundles things the business ALREADY lists (a menu dish, a service, a
 * product, a rental) at a special price: "Cold coffee + sandwich · ₹99". You
 * pick the items from your own catalog, the screen adds up what they normally
 * cost, and you type what you want to charge instead — the difference becomes
 * the "Save 34%" a customer sees.
 *
 * Live offers show on the business page directly under the description. Pausing
 * one keeps it here but takes it off the page, so a weekend special can be
 * switched back on rather than rebuilt.
 *
 * Access-gated: the owner grants "Offers" per member on the Access screen.
 */
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Offer, OfferLine } from '@/domain/types';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { SuperAdminBanner } from '@/features/businesses/SuperAdminBanner';
import { PhotosField } from '@/features/media/PhotosField';
import { MAX_SECONDS, VideoField } from '@/features/media/VideoField';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
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
import { spacing, useColors } from '@/theme/theme';
import {
  isOfferLive,
  linesTotalLabel,
  offerLineLabel,
  offerSavingPercent,
  pickableOfferings,
  savingPercent,
  type PickableOffering,
} from '@/features/businesses/offerUtils';

/** Shout labels offered as one-tap chips; anything else can be typed. */
const TAG_SUGGESTIONS = ['COMBO', 'NEW', '20% OFF', '50% OFF', 'WEEKEND', 'LIMITED'];
const EMOJI_SUGGESTIONS = ['🎉', '🔥', '☕', '🍔', '🍕', '💇', '🧺', '🚗', '💰'];

/** "150" / "4.5" → "₹150" / "₹4.50"; blank/junk → undefined. */
function toPriceLabel(raw: string): string | undefined {
  const amount = parsePrice(raw);
  return amount !== undefined ? formatMoney(amount) : undefined;
}

const newId = (): string =>
  `offer_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export default function WorkspaceOffersScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const employees = await repos.employees.listByBusiness(business.id);
    const meEmployee = employees.find((e) => e.userId && e.userId === currentUser?.id);
    const isMember = isBusinessTeamMember(business, meEmployee, currentUser);
    const canUse = canAccessService(business, meEmployee, currentUser, 'offers');
    return { business, isMember, canUse };
  }, [businessId, currentUser?.id]);

  // The offer being built or edited. `editingId` null = building a new one.
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState('');
  const [emoji, setEmoji] = useState('🎉');
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [price, setPrice] = useState('');
  const [lines, setLines] = useState<OfferLine[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const business = data?.business;
  const offers = useMemo(
    () => [...(business?.offers ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [business?.offers],
  );
  const catalog = useMemo(() => (business ? pickableOfferings(business) : []), [business]);
  const groups = useMemo(() => {
    const byGroup = new Map<string, PickableOffering[]>();
    catalog.forEach((item) => {
      const list = byGroup.get(item.group) ?? [];
      list.push(item);
      byGroup.set(item.group, list);
    });
    return Array.from(byGroup.entries());
  }, [catalog]);

  const wasLabel = linesTotalLabel(lines);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data || !business) return <EmptyView title="Not found" />;

  if (!data.isMember || !data.canUse) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Offers' }} />
        <EmptyView
          title={data.isMember ? 'No access' : 'Members only'}
          subtitle={
            data.isMember
              ? 'Ask the owner to grant you “Offers” on the Access & permissions screen.'
              : `You're not part of ${business.name}.`
          }
        />
      </Screen>
    );
  }

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setTag('');
    setEmoji('🎉');
    setImageUrl(undefined);
    setVideoUrl(undefined);
    setPrice('');
    setLines([]);
    setFormError(null);
  };

  const startNew = () => {
    resetForm();
    setOpen(true);
  };

  const startEdit = (offer: Offer) => {
    setEditingId(offer.id);
    setTitle(offer.title);
    setDescription(offer.description ?? '');
    setTag(offer.tag ?? '');
    setEmoji(offer.emoji ?? '🎉');
    setImageUrl(offer.imageUrl);
    setVideoUrl(offer.videoUrl);
    const amount = parsePrice(offer.price);
    setPrice(amount === undefined ? '' : String(amount));
    setLines(offer.lines);
    setFormError(null);
    setOpen(true);
  };

  /** Add one of the business's offerings, or bump its quantity if already in. */
  const addLine = (item: PickableOffering) => {
    setFormError(null);
    setLines((prev) => {
      const at = prev.findIndex((l) => l.kind === item.kind && l.name === item.name);
      if (at === -1) {
        return [...prev, { kind: item.kind, name: item.name, price: item.price, quantity: 1 }];
      }
      return prev.map((l, i) => (i === at ? { ...l, quantity: (l.quantity ?? 1) + 1 } : l));
    });
  };

  /** Step a line down, dropping it entirely at zero. */
  const removeLine = (index: number) => {
    setLines((prev) =>
      prev.flatMap((l, i) => {
        if (i !== index) return [l];
        const qty = (l.quantity ?? 1) - 1;
        return qty > 0 ? [{ ...l, quantity: qty }] : [];
      }),
    );
  };

  /** Write the whole offers list back onto the business. */
  const persist = async (next: Offer[], done?: () => void) => {
    setSaving(true);
    try {
      await repos.businesses.update(business.id, { offers: next });
      reload();
      done?.();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!title.trim()) {
      setFormError('Give the offer a name — that’s the headline customers read.');
      return;
    }
    if (lines.length === 0) {
      setFormError('Pick at least one thing from your list — an offer is what’s included.');
      return;
    }
    const existing = offers.find((o) => o.id === editingId);
    const offer: Offer = {
      id: editingId ?? newId(),
      title: title.trim(),
      description: description.trim() || undefined,
      tag: tag.trim() || undefined,
      emoji,
      imageUrl,
      videoUrl,
      lines,
      price: toPriceLabel(price),
      // Recomputed on every save so the struck-through figure always matches
      // what the picked items cost right now.
      wasPrice: wasLabel,
      active: existing?.active ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const next = existing
      ? offers.map((o) => (o.id === offer.id ? offer : o))
      : [offer, ...offers];
    await persist(next, () => {
      resetForm();
      setOpen(false);
    });
  };

  const toggleActive = (offer: Offer) =>
    persist(offers.map((o) => (o.id === offer.id ? { ...o, active: !o.active } : o)));

  const confirmDelete = (offer: Offer) =>
    Alert.alert('Delete offer?', `“${offer.title}” will be removed from your page.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => persist(offers.filter((o) => o.id !== offer.id)),
      },
    ]);

  // Live preview of the discount as the price is typed.
  const draftSaving = savingPercent(wasLabel, toPriceLabel(price));

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Offers' }} />

      {currentUser?.id !== business.ownerId && isSuperAdminUser(currentUser) ? (
        <SuperAdminBanner businessName={business.name} what="offers" />
      ) : null}

      <Text variant="title" weight="bold">
        Offers
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        Bundle what you already sell at a special price. Live offers show on your business page,
        right under your description.
      </Text>

      {catalog.length === 0 ? (
        <Card style={styles.card}>
          <Text weight="semibold">Nothing to bundle yet</Text>
          <Text variant="caption" tone="muted">
            Add your menu, products or services first (Manage › What you provide) — an offer is
            built from things you already list.
          </Text>
        </Card>
      ) : !open ? (
        <Button title="＋ Create an offer" onPress={startNew} />
      ) : null}

      {/* ── The builder ── */}
      {open ? (
        <Card style={styles.card}>
          <Text weight="semibold" style={styles.formTitle}>
            {editingId ? 'Edit offer' : 'New offer'}
          </Text>

          <Input placeholder="Cold coffee + sandwich" value={title} onChangeText={setTitle} />
          <View style={styles.field}>
            <Input
              placeholder="What's in it (optional)"
              value={description}
              onChangeText={setDescription}
              multiline
            />
          </View>

          {/* What's included, picked from the business's own lists. */}
          <Text variant="label" weight="semibold" style={styles.label}>
            What’s included
          </Text>
          {lines.length > 0 ? (
            <View style={styles.picked}>
              {lines.map((line, i) => (
                <View key={`${line.kind}-${line.name}-${i}`} style={styles.pickedRow}>
                  <Text style={styles.pickedName}>{offerLineLabel(line)}</Text>
                  {line.price ? (
                    <Text variant="caption" tone="muted">
                      {line.price}
                    </Text>
                  ) : null}
                  <Text tone="danger" weight="semibold" onPress={() => removeLine(i)}>
                    ✕
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text variant="caption" tone="muted" style={styles.label}>
              Tap anything below to add it. Tap it again for a second one.
            </Text>
          )}

          {groups.map(([group, items]) => (
            <View key={group}>
              <Text variant="caption" weight="bold" tone="muted" style={styles.groupTitle}>
                {group.toUpperCase()}
              </Text>
              <View style={styles.chipRow}>
                {items.map((item, i) => (
                  <Tag
                    key={`${item.kind}-${item.name}-${i}`}
                    label={item.price ? `${item.name} · ${item.price}` : item.name}
                    onPress={() => addLine(item)}
                    style={styles.chip}
                  />
                ))}
              </View>
            </View>
          ))}

          {/* Price — normal total is computed, offer price is typed. */}
          <Text variant="label" weight="semibold" style={styles.label}>
            Offer price
          </Text>
          <View style={styles.priceRow}>
            <View style={styles.priceField}>
              <Input
                placeholder="₹"
                value={price}
                onChangeText={(t) => setPrice(sanitizePriceInput(t))}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.priceInfo}>
              {wasLabel ? (
                <Text variant="caption" tone="muted">
                  Normally {wasLabel}
                  {draftSaving !== undefined ? ` · saves ${draftSaving}%` : ''}
                </Text>
              ) : (
                <Text variant="caption" tone="muted">
                  Add priced items to show a “was” price.
                </Text>
              )}
            </View>
          </View>

          <Text variant="label" weight="semibold" style={styles.label}>
            Badge
          </Text>
          <View style={styles.chipRow}>
            {TAG_SUGGESTIONS.map((t) => (
              <Tag
                key={t}
                label={t}
                selected={tag === t}
                onPress={() => setTag(tag === t ? '' : t)}
                style={styles.chip}
              />
            ))}
          </View>
          <Input placeholder="Or type your own badge" value={tag} onChangeText={setTag} />

          <Text variant="label" weight="semibold" style={styles.label}>
            Icon
          </Text>
          <View style={styles.chipRow}>
            {EMOJI_SUGGESTIONS.map((e) => (
              <Tag
                key={e}
                label={e}
                selected={emoji === e}
                onPress={() => setEmoji(e)}
                style={styles.chip}
              />
            ))}
          </View>

          {/* One photo, used as the background if this offer is ever promoted
              onto the Home ad slot. Without it the card falls back to the icon
              above on a colored panel. */}
          <View style={styles.field}>
            <PhotosField
              label="Photo (optional) — the picture on your ad"
              value={imageUrl ? [imageUrl] : []}
              onChange={(photos) => setImageUrl(photos[0])}
              max={1}
            />
          </View>

          {/* The reel. Same offer, better creative — it costs nothing extra and
              plays full-screen in the deals feed, where a still photo would
              just sit there. The photo above stays the poster frame. */}
          <View style={styles.field}>
            <VideoField
              label="Video ad (optional) — your reel"
              value={videoUrl}
              onChange={setVideoUrl}
              hint={`Up to ${MAX_SECONDS}s, filmed upright. It plays full-screen in Deals near you; the photo above is what shows everywhere else.`}
            />
          </View>

          {formError ? (
            <Text variant="caption" tone="danger" style={styles.label}>
              {formError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => {
                  resetForm();
                  setOpen(false);
                }}
              />
            </View>
            <View style={styles.action}>
              <Button
                title={saving ? 'Saving…' : editingId ? 'Save changes' : 'Create offer'}
                onPress={submit}
                disabled={saving}
              />
            </View>
          </View>
        </Card>
      ) : null}

      {/* ── What's running ── */}
      {offers.length > 0 ? (
        <Text variant="label" weight="semibold" style={styles.listHeading}>
          Your offers
        </Text>
      ) : null}

      {offers.map((offer) => {
        const live = isOfferLive(offer);
        const saving = offerSavingPercent(offer);
        return (
          <Card key={offer.id} style={styles.card}>
            <View style={styles.offerTop}>
              <Text variant="heading">{offer.emoji ?? '🎉'}</Text>
              <View style={styles.offerHead}>
                <Text weight="semibold">{offer.title}</Text>
                <Text variant="caption" tone={live ? 'success' : 'muted'}>
                  {live ? '● Live on your page' : '○ Paused — hidden from customers'}
                </Text>
              </View>
              {/* A reel plays full-screen in the deals feed instead of sitting
                  as a still — worth saying at a glance which offers have one. */}
              {offer.videoUrl ? <Tag label="🎬 Reel" /> : null}
              {offer.tag ? <Tag label={offer.tag} tone="brand" /> : null}
            </View>

            {offer.lines.length > 0 ? (
              <Text variant="caption" tone="muted" style={styles.offerLines}>
                {offer.lines.map(offerLineLabel).join(' + ')}
              </Text>
            ) : null}

            <View style={[styles.offerPrice, { borderTopColor: colors.border }]}>
              {offer.price ? (
                <Text weight="bold" tone="brand">
                  {offer.price}
                </Text>
              ) : null}
              {offer.wasPrice ? (
                <Text
                  variant="caption"
                  tone="muted"
                  style={{ textDecorationLine: 'line-through' }}
                >
                  {offer.wasPrice}
                </Text>
              ) : null}
              {saving !== undefined ? (
                <Text variant="caption" weight="bold" tone="success">
                  Save {saving}%
                </Text>
              ) : null}
            </View>

            <View style={[styles.switchRow, { borderTopColor: colors.border }]}>
              <Text>Show on my page</Text>
              <Switch value={offer.active} onValueChange={() => toggleActive(offer)} />
            </View>

            {/* Only a LIVE offer can be promoted — a paused one has nothing to
                show. The ad slot itself is explained on the promote screen. */}
            {live ? (
              <View style={styles.cta}>
                <Button
                  title="📣 Promote this offer"
                  variant="secondary"
                  onPress={() =>
                    router.push({
                      pathname: '/promote/[businessId]',
                      params: { businessId: business.id, offer: offer.id },
                    })
                  }
                />
              </View>
            ) : null}

            <View style={styles.actions}>
              <View style={styles.action}>
                <Button title="Edit" variant="secondary" onPress={() => startEdit(offer)} />
              </View>
              <View style={styles.action}>
                <Button title="Delete" variant="ghost" onPress={() => confirmDelete(offer)} />
              </View>
            </View>
          </Card>
        );
      })}

      {offers.length === 0 && !open && catalog.length > 0 ? (
        <Text tone="muted" style={styles.empty}>
          No offers yet. A good first one: pair two things people already buy together and knock a
          little off the total.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  formTitle: { marginBottom: spacing.md },
  field: { marginTop: spacing.sm },
  label: { marginTop: spacing.md, marginBottom: spacing.sm },
  groupTitle: { marginTop: spacing.sm, marginBottom: spacing.xs, letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { marginRight: 0 },
  picked: { gap: spacing.xs, marginBottom: spacing.sm },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pickedName: { flex: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  priceField: { width: 110 },
  priceInfo: { flex: 1 },
  cta: { marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  listHeading: { marginTop: spacing.lg, marginBottom: spacing.sm },
  offerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  offerHead: { flex: 1 },
  offerLines: { marginTop: spacing.sm },
  offerPrice: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  empty: { marginTop: spacing.md },
});
