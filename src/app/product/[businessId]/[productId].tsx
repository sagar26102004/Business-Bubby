/**
 * A stall item's own page — the thing a buyer actually lands on from the
 * Stalls grid. Shopping-app shape: swipeable photos, then price, name and
 * description.
 *
 * Underneath sits the PUBLIC question thread (`ProductThreadRepository`). It is
 * deliberately not a private chat: anyone signed in can ask a question or
 * propose a price, and every other shopper reads the same thread — so the next
 * person wondering "is the bill in your name?" finds it already answered, and
 * can see what has been offered. The seller answers each message where it sits
 * (several conversations run side by side under one item) and marks the item
 * SOLD when it's gone; the listing and its thread stay readable afterwards.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ProductMessage } from '@/domain/types';
import { formatDistance, getSubcategory } from '@/domain/catalog';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Tag,
  Text,
} from '@/components/ui';
import { fontSize, radius, spacing, useColors } from '@/theme/theme';

/** "2 Jul" — enough to see whether an answer is fresh or from last month. */
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function ProductScreen() {
  const { businessId, productId } = useLocalSearchParams<{
    businessId: string;
    productId: string;
  }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser, isGuest } = useAuth();
  const { width } = useWindowDimensions();

  const [photoIndex, setPhotoIndex] = useState(0);
  const [text, setText] = useState('');
  // The composer doubles as the offer box: toggling this reveals a price field,
  // so proposing a price is the same gesture as asking a question.
  const [offering, setOffering] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [replyTo, setReplyTo] = useState<ProductMessage | null>(null);
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Bump to refetch the thread after posting without reloading the photos.
  const [threadVersion, setThreadVersion] = useState(0);

  const { data, loading, error, reload } = useAsync(
    async () => {
      const business = await repos.businesses.getById(businessId);
      const product = business?.products?.find((p) => p.id === productId) ?? null;
      return { business, product };
    },
    [businessId, productId],
  );

  const { data: messages, reload: reloadThread } = useAsync(
    () => repos.productThreads.listForProduct(businessId, productId),
    [businessId, productId, threadVersion],
  );

  const business = data?.business ?? null;
  const product = data?.product ?? null;
  const isOwner = !!currentUser && !!business && business.ownerId === currentUser.id;
  const photos = product?.images ?? [];

  const onPhotoScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)));
  };

  // Look up any message by id so a reply can quote what it answers (the
  // chat stays flat/WhatsApp-style, but a reply still shows its context).
  const byId = useMemo(() => {
    const map = new Map<string, ProductMessage>();
    for (const m of messages ?? []) map.set(m.id, m);
    return map;
  }, [messages]);

  // The biggest number anyone has put on the table — surfaced at the top so a
  // buyer instantly sees the going rate and can beat it.
  const highestOffer = useMemo(() => {
    let best: number | undefined;
    let label: string | undefined;
    for (const m of messages ?? []) {
      if (!m.offerPrice) continue;
      const amount = parsePrice(m.offerPrice);
      if (amount === undefined) continue;
      if (best === undefined || amount > best) {
        best = amount;
        label = m.offerPrice;
      }
    }
    return label ? { amount: best!, label } : null;
  }, [messages]);

  // Messages the owner pinned — kept up top so every shopper sees them first.
  const pinnedMessages = useMemo(
    () => (messages ?? []).filter((m) => m.pinned),
    [messages],
  );

  const post = useCallback(
    async (override?: { text?: string; offerPrice?: string; replyToId?: string }) => {
      if (!currentUser) {
        router.push('/sign-in');
        return;
      }
      const body = override?.text ?? text;
      const price = override?.offerPrice ?? (offering ? toPriceLabel(offerPrice) : undefined);
      if (!body.trim() && !price) {
        setFormError('Write a question, or propose a price.');
        return;
      }
      setPosting(true);
      setFormError(null);
      try {
        await repos.productThreads.post({
          businessId,
          productId,
          authorId: currentUser.id,
          authorName: currentUser.name,
          text: body,
          offerPrice: price,
          replyToId: override?.replyToId ?? replyTo?.id,
        });
        setText('');
        setOfferPrice('');
        setOffering(false);
        setReplyTo(null);
        setThreadVersion((v) => v + 1);
      } catch (e) {
        setFormError(e instanceof Error ? e.message : 'Could not post that.');
      } finally {
        setPosting(false);
      }
    },
    [currentUser, text, offering, offerPrice, replyTo, repos, businessId, productId, router],
  );

  const setSold = async (sold: boolean) => {
    if (!currentUser) return;
    await repos.businesses.setProductSold(businessId, productId, sold, currentUser.id);
    reload();
  };

  /** Owner pinning/unpinning a message to the top of the thread. */
  const setPin = async (message: ProductMessage, pinned: boolean) => {
    if (!currentUser) return;
    await repos.productThreads.setPinned(businessId, productId, message.id, pinned, currentUser.id);
    setThreadVersion((v) => v + 1);
  };

  /** Seller taking an offer: answer it in the thread AND close the item. */
  const acceptOffer = async (offer: ProductMessage) => {
    await post({
      text: `Deal — sold to ${offer.authorName} for ${offer.offerPrice}.`,
      replyToId: offer.id,
    });
    await setSold(true);
  };

  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (loading && !data) return <LoadingView label="Loading item…" />;
  if (!business || !product) {
    return <EmptyView title="Item not found" subtitle="This item is no longer listed." />;
  }

  const category = getSubcategory('item', product.subcategoryId)?.name;

  return (
    <Screen scroll padded={false}>
      <Stack.Screen options={{ title: product.name }} />

      {/* Photos — swipe through them, Amazon-style, with dots underneath. */}
      {photos.length > 0 ? (
        <View>
          <FlatList
            data={photos}
            keyExtractor={(uri, i) => `${uri}-${i}`}
            renderItem={({ item }) => (
              <Image
                source={{ uri: item }}
                style={[styles.photo, { width }, product.sold && styles.faded]}
                resizeMode="cover"
              />
            )}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onPhotoScroll}
            scrollEventThrottle={16}
          />
          {photos.length > 1 ? (
            <View style={styles.dots}>
              {photos.map((uri, i) => (
                <View
                  key={`${uri}-dot-${i}`}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: i === photoIndex ? colors.brand : colors.border,
                      width: i === photoIndex ? 18 : 6,
                    },
                  ]}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.noPhoto, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={styles.noPhotoEmoji}>🏷️</Text>
          <Text variant="caption" tone="muted">
            No photos yet
          </Text>
        </View>
      )}

      <View style={styles.body}>
        {/* Price, then name, then description. */}
        <View style={styles.priceRow}>
          {product.price ? (
            <Text variant="heading" weight="bold" tone="brand">
              {product.price}
            </Text>
          ) : (
            <Text variant="subheading" weight="semibold" tone="muted">
              Price on request
            </Text>
          )}
          {product.sold ? (
            <View style={[styles.soldPill, { backgroundColor: colors.textMuted }]}>
              <Text variant="caption" weight="bold" tone="inverse">
                SOLD
              </Text>
            </View>
          ) : null}
          {category ? <Tag label={category} /> : null}
        </View>

        <Text variant="subheading" weight="bold" style={styles.name}>
          {product.name}
        </Text>

        {product.description ? (
          <Text tone="muted" style={styles.description}>
            {product.description}
          </Text>
        ) : null}

        {/* Who's selling it */}
        <Card onPress={() => router.push(`/business/${business.id}`)} style={styles.seller}>
          <Text weight="semibold">🏷️ {business.name}</Text>
          <Text variant="caption" tone="muted">
            {[
              business.location.city,
              formatDistance(business.distanceKm) || undefined,
              `${business.products?.length ?? 0} items in this stall`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text variant="caption" tone="accent" style={styles.sellerLink}>
            View the whole stall ›
          </Text>
        </Card>

        {isOwner ? (
          <Button
            title={product.sold ? '↩️ Mark as available again' : '✅ Mark as sold'}
            variant={product.sold ? 'secondary' : 'primary'}
            onPress={() => setSold(!product.sold)}
            style={styles.soldBtn}
          />
        ) : null}

        {/* ── One public group chat: questions & offers together ── */}
        <View style={styles.chatHead}>
          <Text variant="subheading" weight="bold">
            💬 Questions & offers
          </Text>
          {highestOffer ? (
            <View style={[styles.highBid, { backgroundColor: colors.successSoft }]}>
              <Text variant="caption" weight="bold" style={{ color: colors.success }}>
                ⬆ Top offer {highestOffer.label}
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="caption" tone="muted" style={styles.threadNote}>
          A public group chat about this item — everyone can read it. Ask before you
          travel; someone may already have.
        </Text>

        <Card style={styles.chatBox} padded={false}>
          {pinnedMessages.length > 0 ? (
            <View style={[styles.pinnedBox, { backgroundColor: colors.brandSoft, borderBottomColor: colors.border }]}>
              {pinnedMessages.map((m) => (
                <View key={`pin-${m.id}`} style={styles.pinnedRow}>
                  <Text style={styles.pinIcon}>📌</Text>
                  <View style={styles.flex}>
                    <Text variant="caption" weight="semibold" numberOfLines={1}>
                      {m.fromSeller ? `${m.authorName} · Seller` : m.authorName}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={2}>
                      {m.offerPrice ? `💰 ${m.offerPrice}${m.text ? ` — ${m.text}` : ''}` : m.text}
                    </Text>
                  </View>
                  {isOwner ? (
                    <Pressable onPress={() => setPin(m, false)} hitSlop={6}>
                      <Text variant="caption" weight="semibold" tone="danger">
                        Unpin
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.messages}>
            {(messages ?? []).length === 0 ? (
              <Text tone="muted" style={styles.emptyChat}>
                No messages yet. Ask {business.name.replace(/’s Stall$/, '')} a question —
                or make an offer.
              </Text>
            ) : (
              (messages ?? []).map((m) => {
                const mine = !!currentUser && m.authorId === currentUser.id;
                const quoted = m.replyToId ? byId.get(m.replyToId) : undefined;
                const canAccept =
                  isOwner && !!m.offerPrice && !m.fromSeller && !product.sold;
                return (
                  <View
                    key={m.id}
                    style={[styles.row, mine ? styles.rowEnd : styles.rowStart]}
                  >
                    <View style={styles.bubbleWrap}>
                      {/* Group-chat style: who said it, above every incoming bubble. */}
                      {!mine ? (
                        <Text
                          variant="caption"
                          weight="semibold"
                          tone={m.fromSeller ? 'brand' : 'accent'}
                          style={styles.bubbleAuthor}
                          numberOfLines={1}
                        >
                          {m.fromSeller ? `${m.authorName} · Seller` : m.authorName}
                        </Text>
                      ) : null}

                      <View
                        style={[
                          styles.bubble,
                          mine
                            ? { backgroundColor: colors.brand, borderBottomRightRadius: 4 }
                            : { backgroundColor: colors.surfaceAlt, borderBottomLeftRadius: 4 },
                        ]}
                      >
                        {quoted ? (
                          <View
                            style={[
                              styles.quoted,
                              {
                                borderLeftColor: mine ? 'rgba(255,255,255,0.55)' : colors.accent,
                                backgroundColor: mine ? 'rgba(255,255,255,0.12)' : colors.surface,
                              },
                            ]}
                          >
                            <Text
                              variant="caption"
                              weight="semibold"
                              tone={mine ? 'inverse' : 'accent'}
                              numberOfLines={1}
                            >
                              {quoted.fromSeller
                                ? `${quoted.authorName} · Seller`
                                : quoted.authorName}
                            </Text>
                            <Text
                              variant="caption"
                              tone={mine ? 'inverse' : 'muted'}
                              numberOfLines={1}
                            >
                              {quoted.offerPrice ? `💰 ${quoted.offerPrice}` : quoted.text}
                            </Text>
                          </View>
                        ) : null}

                        {m.offerPrice ? (
                          <View
                            style={[styles.offerChip, { backgroundColor: colors.successSoft }]}
                          >
                            <Text
                              variant="label"
                              weight="bold"
                              style={{ color: colors.success }}
                            >
                              💰 Offer {m.offerPrice}
                            </Text>
                          </View>
                        ) : null}

                        {m.text ? (
                          <Text tone={mine ? 'inverse' : 'default'}>{m.text}</Text>
                        ) : null}

                        <Text
                          variant="caption"
                          style={[
                            styles.time,
                            { color: mine ? 'rgba(255,255,255,0.7)' : colors.textMuted },
                          ]}
                        >
                          {formatWhen(m.createdAt)}
                        </Text>
                      </View>

                      {!isGuest ? (
                        <View style={[styles.bubbleActions, mine && styles.actionsRight]}>
                          <Pressable onPress={() => setReplyTo(m)} hitSlop={6}>
                            <Text variant="caption" weight="semibold" tone="accent">
                              ↩︎ Reply
                            </Text>
                          </Pressable>
                          {/* The owner can pin any message to the top for all shoppers. */}
                          {isOwner ? (
                            <Pressable onPress={() => setPin(m, !m.pinned)} hitSlop={6}>
                              <Text variant="caption" weight="semibold" tone="muted">
                                {m.pinned ? '📌 Unpin' : '📌 Pin'}
                              </Text>
                            </Pressable>
                          ) : null}
                          {/* Taking an offer answers it and closes the item in one go. */}
                          {canAccept ? (
                            <Pressable onPress={() => acceptOffer(m)} hitSlop={6}>
                              <Text variant="caption" weight="semibold" tone="brand">
                                ✅ Accept {m.offerPrice} & mark sold
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* ── Composer, part of the same chat box ── */}
          {isGuest ? (
            <View style={[styles.composer, styles.composerRow, { borderTopColor: colors.border }]}>
              <Text tone="muted" style={styles.flex}>
                Sign in to ask a question or make an offer.
              </Text>
              <Button
                title="Sign in"
                variant="secondary"
                onPress={() => router.push('/sign-in')}
              />
            </View>
          ) : (
            <View style={[styles.composer, { borderTopColor: colors.border }]}>
              {replyTo ? (
                <View style={[styles.replyingTo, { backgroundColor: colors.surfaceAlt }]}>
                  <Text variant="caption" tone="muted" style={styles.flex} numberOfLines={1}>
                    Replying to {replyTo.authorName}: “{replyTo.text || replyTo.offerPrice}”
                  </Text>
                  <Pressable onPress={() => setReplyTo(null)} hitSlop={6}>
                    <Text variant="caption" weight="semibold" tone="danger">
                      ✕
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {/* The offer button reveals this. It carries its own Send button so
                  making an offer is one obvious tap — not "type, then hunt for
                  the arrow" (and never the toggle, which would just close it). */}
              {offering && !isOwner ? (
                <View style={[styles.offerInputRow, { backgroundColor: colors.successSoft }]}>
                  <Text style={styles.rupee}>₹</Text>
                  <TextInput
                    placeholder="Your offer, e.g. 25000"
                    placeholderTextColor={colors.textMuted}
                    value={offerPrice}
                    onChangeText={(t) => setOfferPrice(sanitizePriceInput(t))}
                    keyboardType="numeric"
                    onSubmitEditing={() => post()}
                    style={[styles.offerInput, { color: colors.text }]}
                  />
                  <Pressable
                    onPress={() => post()}
                    disabled={posting || !offerPrice.trim()}
                    style={[
                      styles.offerSendBtn,
                      { backgroundColor: offerPrice.trim() ? colors.success : colors.border },
                    ]}
                  >
                    <Text variant="caption" weight="bold" tone="inverse">
                      {posting ? '…' : 'Send offer'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.inputBar}>
                <TextInput
                  placeholder={isOwner ? 'Answer a buyer…' : 'Message the stall…'}
                  placeholderTextColor={colors.textMuted}
                  value={text}
                  onChangeText={(t) => {
                    setText(t);
                    if (formError) setFormError(null);
                  }}
                  multiline
                  style={[styles.chatInput, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
                />

                {/* Sellers answer; buyers get a button to OPEN the offer box
                    (the box has its own Send). When open this is a plain cancel,
                    so it can never be mistaken for "submit my offer". */}
                {!isOwner ? (
                  <Pressable
                    onPress={() => {
                      if (offering) setOfferPrice('');
                      setOffering((v) => !v);
                    }}
                    style={[
                      styles.offerBtn,
                      {
                        backgroundColor: offering ? colors.surfaceAlt : colors.successSoft,
                        borderColor: offering ? colors.border : colors.success,
                      },
                    ]}
                  >
                    <Text
                      variant="caption"
                      weight="bold"
                      style={{ color: offering ? colors.textMuted : colors.success }}
                    >
                      {offering ? '✕ Cancel' : '💰 Offer'}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={() => post()}
                  disabled={posting}
                  style={[
                    styles.sendBtn,
                    { backgroundColor: posting ? colors.surfaceAlt : colors.brand },
                  ]}
                >
                  <Text weight="bold" tone="inverse">
                    ➤
                  </Text>
                </Pressable>
              </View>

              {formError ? (
                <Text variant="caption" tone="danger" style={styles.formError}>
                  {formError}
                </Text>
              ) : null}
            </View>
          )}
        </Card>
      </View>
    </Screen>
  );

}

/** "25000" (numeric box) → "₹25,000"; blank/junk → undefined. */
function toPriceLabel(raw: string): string | undefined {
  const amount = parsePrice(raw);
  return amount !== undefined ? formatMoney(amount) : undefined;
}

const styles = StyleSheet.create({
  photo: { height: 320 },
  faded: { opacity: 0.5 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  dot: { height: 6, borderRadius: 3 },
  noPhoto: { height: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  noPhotoEmoji: { fontSize: 48 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  soldPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  name: { marginTop: spacing.sm },
  description: { marginTop: spacing.sm, lineHeight: 22 },
  seller: { marginTop: spacing.lg },
  sellerLink: { marginTop: spacing.sm },
  soldBtn: { marginTop: spacing.md },

  // ── Questions & offers group chat ──
  chatHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  highBid: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  threadNote: { marginTop: spacing.xs, marginBottom: spacing.md },
  chatBox: { marginBottom: spacing.xxl },
  pinnedBox: {
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  pinnedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pinIcon: { fontSize: 16 },
  messages: { padding: spacing.md, gap: spacing.md },
  emptyChat: { textAlign: 'center', paddingVertical: spacing.lg },
  row: { flexDirection: 'row' },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  bubbleWrap: { maxWidth: '86%' },
  bubbleAuthor: { marginLeft: spacing.sm, marginBottom: 2 },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  quoted: {
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  offerChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  time: { alignSelf: 'flex-end', marginTop: 2 },
  bubbleActions: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xs,
    marginLeft: spacing.sm,
    flexWrap: 'wrap',
  },
  actionsRight: { justifyContent: 'flex-end', marginLeft: 0, marginRight: spacing.sm },

  // ── Composer (chat input bar) ──
  composer: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  replyingTo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  offerInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  rupee: { fontSize: fontSize.md },
  offerInput: { flex: 1, minHeight: 40, fontSize: fontSize.md },
  offerSendBtn: {
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  chatInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  offerBtn: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    height: 44,
    width: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formError: {},
});
