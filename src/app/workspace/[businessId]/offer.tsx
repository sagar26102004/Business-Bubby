/**
 * Workspace › Offers › Create / Edit an offer — `?offer=<id>` edits, none creates.
 *
 * Creative first: the photo / video reel is the ONE required part, so the screen
 * opens on it. Then the deal badge ("20% OFF"), then pricing (offer price + the
 * struck-through "was"), then the optional rest — headline, description, the
 * items it bundles from the business's own catalog — and how long it runs.
 *
 * Picked items pre-fill the "was" price with what they normally cost; it can be
 * typed over. A blank headline is saved as the picked items, the badge, or
 * "Special offer", because every surface that shows an offer reads its title.
 *
 * "Deal active period" writes `Offer.endsAt` (computed from now when picked);
 * an offer past it drops off every customer surface by itself (domain/offers).
 *
 * Access-gated like the list: the owner grants "Offers" per member.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View, type TextStyle, type ViewStyle } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Offer, OfferLine } from '@/domain/types';
import { canAccessService, isBusinessTeamMember } from '@/domain/access';
import { OfferMediaField } from '@/features/businesses/OfferMediaField';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
import { showAlert } from '@/lib/alert';
import {
  BottomActionBar,
  Button,
  EmptyView,
  ErrorView,
  Input,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';
import {
  isOfferLive,
  linesTotalLabel,
  offerEndsLabel,
  offerLineLabel,
  pickableOfferings,
  savingPercent,
  type PickableOffering,
} from '@/features/businesses/offerUtils';

/** Shout labels offered as one-tap chips; anything else can be typed. */
const TAG_SUGGESTIONS = ['COMBO', '20% OFF', '50% OFF', 'LIMITED', 'NEW', 'WEEKEND'];
const EMOJI_SUGGESTIONS = ['🎉', '🔥', '☕', '🍔', '🍕', '💇', '🧺', '🚗', '💰'];

type Period = 'today' | 'days3' | 'weekend' | 'always';
const PERIODS: { id: Period; label: string; hint: string }[] = [
  { id: 'today', label: 'Today Only', hint: 'Ends at midnight' },
  { id: 'days3', label: 'Next 3 Days', hint: 'Flash promo' },
  { id: 'weekend', label: 'This Weekend', hint: 'Until Sunday night' },
  { id: 'always', label: 'Always On', hint: 'Until you pause it' },
];

type Start = 'now' | 'tomorrow' | 'saturday';
const STARTS: { id: Start; label: string }[] = [
  { id: 'now', label: 'Right now' },
  { id: 'tomorrow', label: 'Tomorrow, 9 AM' },
  { id: 'saturday', label: 'Saturday, 9 AM' },
];

/** When a picked start begins. Undefined = straight away (no `startsAt`). */
function startAt(start: Start, now = new Date()): Date | undefined {
  if (start === 'now') return undefined;
  const at = new Date(now);
  if (start === 'tomorrow') at.setDate(at.getDate() + 1);
  // Next Saturday — a week ahead if today already is one.
  if (start === 'saturday') at.setDate(at.getDate() + (((6 - at.getDay() + 7) % 7) || 7));
  at.setHours(9, 0, 0, 0);
  return at;
}

/** The moment a picked period stops, counted from the day it starts. Undefined = no end. */
function periodEnd(period: Period, from = new Date()): string | undefined {
  if (period === 'always') return undefined;
  const end = new Date(from);
  if (period === 'days3') end.setDate(end.getDate() + 2);
  if (period === 'weekend') end.setDate(end.getDate() + ((7 - end.getDay()) % 7)); // → Sunday
  end.setHours(23, 59, 59, 0);
  return end.toISOString();
}

/** "150" / "4.5" → "₹150" / "₹4.50"; blank/junk → undefined. */
function toPriceLabel(raw: string): string | undefined {
  const amount = parsePrice(raw);
  return amount !== undefined ? formatMoney(amount) : undefined;
}

const newId = (): string =>
  `offer_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export default function OfferEditorScreen() {
  const { businessId, offer: offerId } = useLocalSearchParams<{
    businessId: string;
    offer?: string;
  }>();
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

  const business = data?.business;
  const existing = useMemo(
    () => (offerId ? business?.offers?.find((o) => o.id === offerId) : undefined),
    [business?.offers, offerId],
  );

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState('');
  const [emoji, setEmoji] = useState('🎉');
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [price, setPrice] = useState('');
  // Typed "was" price. Blank = use what the picked items normally cost.
  const [wasPrice, setWasPrice] = useState('');
  const [lines, setLines] = useState<OfferLine[]>([]);
  // null = keep the edited offer's current end date untouched.
  const [period, setPeriod] = useState<Period | null>('always');
  // null = keep the edited offer's current (future) start untouched.
  const [start, setStart] = useState<Start | null>('now');
  // Shown on the business page or switched off (paused). New offers start on.
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the offer being edited into the form, once.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !existing) return;
    loaded.current = true;
    setTitle(existing.title);
    setDescription(existing.description ?? '');
    setTag(existing.tag ?? '');
    setEmoji(existing.emoji ?? '🎉');
    setImageUrl(existing.imageUrl);
    setVideoUrl(existing.videoUrl);
    const amount = parsePrice(existing.price);
    setPrice(amount === undefined ? '' : String(amount));
    // Only a "was" that differs from the items' own total was typed by hand;
    // otherwise leave it blank so it keeps following the picked items.
    const was = parsePrice(existing.wasPrice);
    setWasPrice(
      was === undefined || was === parsePrice(linesTotalLabel(existing.lines)) ? '' : String(was),
    );
    setLines(existing.lines);
    setPeriod(existing.endsAt ? null : 'always');
    setStart(existing.startsAt && new Date(existing.startsAt).getTime() > Date.now() ? null : 'now');
    setActive(existing.active);
  }, [existing]);

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

  const linesTotal = linesTotalLabel(lines);
  const wasLabel = toPriceLabel(wasPrice) ?? linesTotal;
  const priceLabel = toPriceLabel(price);
  const saved = savingPercent(wasLabel, priceLabel);
  const savedAmount =
    saved !== undefined ? (parsePrice(wasLabel) ?? 0) - (parsePrice(priceLabel) ?? 0) : undefined;

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data || !business) return <EmptyView title="Not found" />;
  if (!data.isMember || !data.canUse) {
    return (
      <Screen>
        <EmptyView
          title={data.isMember ? 'No access' : 'Members only'}
          subtitle={
            data.isMember
              ? 'Ask the owner to grant you “Offers” on the Team & access screen.'
              : `You're not part of ${business.name}.`
          }
        />
      </Screen>
    );
  }
  if (offerId && !existing) return <EmptyView title="Offer not found" />;

  const offers = business.offers ?? [];

  /** Add one of the business's offerings, or bump its quantity if already in. */
  const addLine = (item: PickableOffering) => {
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

  const persist = async (next: Offer[]) => {
    setSaving(true);
    try {
      await repos.businesses.update(business.id, { offers: next });
      router.back();
    } catch (err) {
      showAlert('Could not save', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const startsAtIso = start === null ? existing?.startsAt : startAt(start)?.toISOString();

  const submit = async () => {
    if (!imageUrl && !videoUrl) {
      setFormError('Add a photo or a video — it’s the one thing every offer needs.');
      return;
    }
    const offer: Offer = {
      id: existing?.id ?? newId(),
      title:
        title.trim() || lines.map(offerLineLabel).join(' + ') || tag.trim() || 'Special offer',
      description: description.trim() || undefined,
      tag: tag.trim() || undefined,
      emoji,
      imageUrl,
      videoUrl,
      lines,
      price: priceLabel,
      // A typed "was" wins; otherwise it's recomputed on every save so the
      // struck-through figure matches what the picked items cost right now.
      wasPrice: wasLabel,
      active,
      startsAt: startsAtIso,
      // The run is counted from the day it starts, so "Today Only" on a
      // Saturday start means that Saturday.
      endsAt:
        period === null
          ? existing?.endsAt
          : periodEnd(period, startsAtIso ? new Date(startsAtIso) : new Date()),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    await persist(
      existing ? offers.map((o) => (o.id === offer.id ? offer : o)) : [offer, ...offers],
    );
  };

  const confirmDelete = () => {
    if (!existing) return;
    showAlert('Delete offer?', `“${existing.title}” will be removed from your page.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void persist(offers.filter((o) => o.id !== existing.id)),
      },
    ]);
  };

  const sectionStyle: ViewStyle = { backgroundColor: colors.surface, borderColor: colors.border };

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: existing ? 'Edit Offer' : 'Create an Offer' }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text tone="muted" style={styles.intro}>
          Broadcast a deal to neighbours near you.
        </Text>

        {/* Editing: switch it off/on, or promote it. These used to sit on the
            list's cards; the list now keeps just views + Edit. */}
        {existing ? (
          <View style={[styles.section, sectionStyle]}>
            <View style={styles.switchRow}>
              <View style={styles.periodText}>
                <Text weight="semibold">Show on my page</Text>
                <Text variant="caption" tone="muted">
                  {active ? 'Customers can see it' : 'Paused — hidden from customers'}
                </Text>
              </View>
              <Switch value={active} onValueChange={setActive} />
            </View>
            {isOfferLive(existing) ? (
              <Button
                title="📣 Promote this offer"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/promote/[businessId]',
                    params: { businessId: business.id, offer: existing.id },
                  })
                }
              />
            ) : null}
          </View>
        ) : null}

        {/* 1 · Ad media — the one required part. */}
        <View style={[styles.section, sectionStyle]}>
          <Eyebrow>Ad media (photo or video reel)</Eyebrow>
          <Text variant="caption" tone="muted" style={styles.sectionHint}>
            Required — add at least one. An upright reel plays full-screen in Deals near you.
          </Text>
          <OfferMediaField
            imageUrl={imageUrl}
            videoUrl={videoUrl}
            onImage={(url) => {
              setFormError(null);
              setImageUrl(url);
            }}
            onVideo={(url) => {
              setFormError(null);
              setVideoUrl(url);
            }}
            emoji={emoji}
            title={title}
          />
        </View>

        {/* 2 · Deal badge */}
        <View style={[styles.section, sectionStyle]}>
          <View style={styles.sectionHead}>
            <Eyebrow>Deal badge</Eyebrow>
            <Text variant="caption" tone="muted">
              Optional · shown on the card
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
            {TAG_SUGGESTIONS.map((t) => (
              <Tag key={t} label={t} selected={tag === t} onPress={() => setTag(tag === t ? '' : t)} />
            ))}
          </ScrollView>
          <Input placeholder="Or type your own badge" value={tag} onChangeText={setTag} />
        </View>

        {/* 3 · Pricing & savings */}
        <View style={[styles.section, sectionStyle]}>
          <View style={styles.sectionHead}>
            <Eyebrow>Pricing & savings</Eyebrow>
            {saved !== undefined ? (
              <Tag label={`${saved}% SAVED`} tone="status" size="sm" />
            ) : (
              <Text variant="caption" tone="muted">
                Optional
              </Text>
            )}
          </View>
          <View style={styles.priceRow}>
            <View style={styles.priceField}>
              <Input
                label="Offer price"
                placeholder="₹ 180"
                value={price}
                onChangeText={(t) => setPrice(sanitizePriceInput(t))}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.priceField}>
              <Input
                label="Original (was)"
                placeholder={linesTotal ? `₹ ${parsePrice(linesTotal)}` : '₹ 240'}
                value={wasPrice}
                onChangeText={(t) => setWasPrice(sanitizePriceInput(t))}
                keyboardType="numeric"
                style={wasPrice ? styles.struck : undefined}
              />
            </View>
          </View>
          <Text variant="caption" tone="muted">
            {savedAmount !== undefined
              ? `Customers save ${formatMoney(savedAmount)}. The crossed-out price highlights your deal.`
              : 'Add both prices to show customers how much they save.'}
          </Text>
        </View>

        {/* 4 · Headline, description, what's included */}
        <View style={[styles.section, sectionStyle]}>
          <Eyebrow>
            Offer headline <Text variant="caption" tone="muted">(optional)</Text>
          </Eyebrow>
          <Input placeholder="Cold coffee + grilled sandwich" value={title} onChangeText={setTitle} />

          <Eyebrow style={styles.subEyebrow}>
            What’s included <Text variant="caption" tone="muted">(optional)</Text>
          </Eyebrow>
          <Input
            placeholder="1 tall iced latte + 1 paneer tikka sandwich"
            value={description}
            onChangeText={setDescription}
            multiline
          />

          {catalog.length > 0 ? (
            <>
              <Text variant="caption" weight="semibold" tone="muted" style={styles.subEyebrow}>
                Bundle items from your list — tap to add, tap again for another
              </Text>
              {lines.length > 0 ? (
                <View style={[styles.picked, { borderColor: colors.border }]}>
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
              ) : null}
              {groups.map(([group, items]) => (
                <View key={group}>
                  <Text variant="caption" weight="bold" tone="muted" style={styles.groupTitle}>
                    {group.toUpperCase()}
                  </Text>
                  <View style={styles.chipWrap}>
                    {items.map((item, i) => (
                      <Tag
                        key={`${item.kind}-${item.name}-${i}`}
                        label={item.price ? `${item.name} · ${item.price}` : item.name}
                        onPress={() => addLine(item)}
                        size="sm"
                      />
                    ))}
                  </View>
                </View>
              ))}
            </>
          ) : null}

          <Text variant="caption" weight="semibold" tone="muted" style={styles.subEyebrow}>
            Card icon
          </Text>
          <View style={styles.chipWrap}>
            {EMOJI_SUGGESTIONS.map((e) => (
              <Tag key={e} label={e} selected={emoji === e} onPress={() => setEmoji(e)} size="sm" />
            ))}
          </View>
        </View>

        {/* 5 · How long it runs */}
        <View style={[styles.section, sectionStyle]}>
          <Eyebrow>Deal active period</Eyebrow>
          <Text variant="caption" weight="semibold" tone="muted">
            Starts
          </Text>
          {start === null && existing?.startsAt ? (
            <Text variant="caption" tone="muted">
              Currently: {offerEndsLabel(existing).text}. Pick one to change it.
            </Text>
          ) : null}
          <View style={styles.chipWrap}>
            {STARTS.map((s) => (
              <Tag key={s.id} label={s.label} selected={start === s.id} onPress={() => setStart(s.id)} />
            ))}
          </View>
          {start !== null && start !== 'now' ? (
            <Text variant="caption" tone="muted">
              It waits under Scheduled until then, hidden from customers.
            </Text>
          ) : null}
          <Text variant="caption" weight="semibold" tone="muted" style={styles.subEyebrow}>
            Runs for
          </Text>
          {period === null && existing?.endsAt ? (
            <Text variant="caption" tone="muted" style={styles.sectionHint}>
              {new Date(existing.endsAt).getTime() < Date.now() ? 'Ended' : 'Currently ends'}{' '}
              {new Date(existing.endsAt).toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
              . Pick one to change it.
            </Text>
          ) : null}
          <View style={styles.periodGrid}>
            {PERIODS.map((p) => {
              const on = period === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setPeriod(p.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.period,
                    {
                      borderColor: on ? colors.brand : colors.border,
                      borderWidth: on ? 2 : 1,
                      backgroundColor: on ? colors.brandSoft : colors.surface,
                    },
                  ]}
                >
                  <View style={[styles.radio, { borderColor: on ? colors.brand : colors.textMuted }]}>
                    {on ? <View style={[styles.radioDot, { backgroundColor: colors.brand }]} /> : null}
                  </View>
                  <View style={styles.periodText}>
                    <Text variant="label" weight="semibold">
                      {p.label}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {p.hint}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {existing ? (
          <Pressable onPress={confirmDelete} style={styles.delete} accessibilityRole="button">
            <Text tone="danger" weight="semibold">
              Delete this offer
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <BottomActionBar
        backLabel="Cancel"
        onBack={() => router.back()}
        primary={{
          title: saving ? 'Saving…' : existing ? 'Save changes' : 'Publish Offer Live',
          icon: existing ? undefined : 'arrowRight',
          onPress: submit,
          loading: saving,
        }}
      >
        {formError ? (
          <Text variant="caption" tone="danger">
            {formError}
          </Text>
        ) : null}
      </BottomActionBar>
    </Screen>
  );
}

/** The small uppercase section label from the mockup ("PRICING & SAVINGS"). */
function Eyebrow({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text variant="caption" weight="bold" tone="brand" style={[styles.eyebrow, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  intro: { marginBottom: spacing.xs },
  section: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHint: { marginBottom: spacing.xs },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 1 },
  subEyebrow: { marginTop: spacing.sm },
  chipScroll: { gap: spacing.sm, paddingVertical: spacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  priceRow: { flexDirection: 'row', gap: spacing.md },
  priceField: { flex: 1 },
  struck: { textDecorationLine: 'line-through' },
  picked: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pickedName: { flex: 1 },
  groupTitle: { marginTop: spacing.sm, marginBottom: spacing.xs, letterSpacing: 0.5 },
  periodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  period: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  periodText: { flex: 1 },
  delete: { alignItems: 'center', paddingVertical: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
