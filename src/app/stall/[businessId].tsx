/**
 * Manage stall — the owner's admin console for their personal stall. Everything
 * a seller needs to run the stall in one place, per item:
 *  - accept the offers buyers have made (answers the offer AND marks it sold),
 *  - pin/unpin the messages worth keeping at the top of an item's public chat,
 *  - mark an item sold or available again,
 *  - remove an item from the stall for good,
 *  - and see everything already sold, kept in its own section.
 *
 * Editing item details (name, price, photos, stall name) still lives in Manage;
 * this screen is the day-to-day selling desk. Owner only — enforced here and in
 * the repositories.
 */
import { useCallback } from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ProductItem, ProductMessage } from '@/domain/types';
import { getSubcategory } from '@/domain/catalog';
import { parsePrice } from '@/lib/money';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Text,
} from '@/components/ui';
import { radius, spacing, useColors } from '@/theme/theme';

export default function StallAdminScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const repos = useRepositories();
  const router = useRouter();
  const colors = useColors();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(businessId);
    if (!business) return null;
    const messages = await repos.productThreads.listForBusiness(business.id);
    return { business, messages };
  }, [businessId, currentUser?.id]);

  const isOwner = !!currentUser && data?.business?.ownerId === currentUser.id;

  const markSold = useCallback(
    async (product: ProductItem, sold: boolean) => {
      if (!currentUser || !product.id) return;
      await repos.businesses.setProductSold(businessId, product.id, sold, currentUser.id);
      reload();
    },
    [currentUser, businessId, repos, reload],
  );

  const remove = useCallback(
    (product: ProductItem) => {
      if (!currentUser || !product.id) return;
      const doRemove = async () => {
        await repos.businesses.removeProduct(businessId, product.id!, currentUser.id);
        reload();
      };
      // Web has no native Alert buttons — confirm() is the reliable path there.
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(`Remove "${product.name}" from your stall? This can't be undone.`)) {
          void doRemove();
        }
        return;
      }
      Alert.alert('Remove item?', `"${product.name}" will be taken off your stall for good.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void doRemove() },
      ]);
    },
    [currentUser, businessId, repos, reload],
  );

  const acceptOffer = useCallback(
    async (product: ProductItem, offer: ProductMessage) => {
      if (!currentUser || !product.id) return;
      await repos.productThreads.post({
        businessId,
        productId: product.id,
        authorId: currentUser.id,
        authorName: currentUser.name,
        text: `Deal — sold to ${offer.authorName} for ${offer.offerPrice}.`,
        replyToId: offer.id,
      });
      await repos.businesses.setProductSold(businessId, product.id, true, currentUser.id);
      reload();
    },
    [currentUser, businessId, repos, reload],
  );

  const setPin = useCallback(
    async (product: ProductItem, message: ProductMessage, pinned: boolean) => {
      if (!currentUser || !product.id) return;
      await repos.productThreads.setPinned(businessId, product.id, message.id, pinned, currentUser.id);
      reload();
    },
    [currentUser, businessId, repos, reload],
  );

  if (loading && !data) return <LoadingView label="Loading your stall…" />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data?.business) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Manage stall' }} />
        <EmptyView title="Not found" subtitle="This stall may have been removed." />
      </Screen>
    );
  }
  if (data.business.type !== 'item' || !isOwner) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Manage stall' }} />
        <EmptyView title="Owners only" subtitle="Only the stall's owner can manage it." />
      </Screen>
    );
  }

  const { business, messages } = data;
  const products = business.products ?? [];
  const onSale = products.filter((p) => !p.sold);
  const sold = products.filter((p) => p.sold);

  const messagesFor = (productId?: string) =>
    productId ? messages.filter((m) => m.productId === productId) : [];

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Manage stall' }} />

      <Text variant="title" weight="bold">
        {business.name}
      </Text>
      <Text tone="muted" style={styles.subtitle}>
        Your selling desk — accept offers, pin the messages that matter, and mark
        or remove items. Edit names, prices and photos in Manage.
      </Text>

      <View style={styles.topActions}>
        <Button
          title="➕ Add an item"
          onPress={() => router.push({ pathname: '/register', params: { type: 'item' } })}
          style={styles.topBtn}
        />
        <Button
          title="✏️ Edit items"
          variant="secondary"
          onPress={() => router.push(`/manage/${business.id}`)}
          style={styles.topBtn}
        />
      </View>

      {/* ── On sale ── */}
      <Text variant="subheading" weight="bold" style={styles.section}>
        On sale ({onSale.length})
      </Text>
      {onSale.length === 0 ? (
        <Text tone="muted" style={styles.empty}>
          Nothing on sale right now. Add an item to get started.
        </Text>
      ) : (
        onSale.map((p) => (
          <ProductAdminCard
            key={p.id ?? p.name}
            product={p}
            messages={messagesFor(p.id)}
            colors={colors}
            onOpen={() => p.id && router.push(`/product/${business.id}/${p.id}`)}
            onAcceptOffer={(offer) => acceptOffer(p, offer)}
            onPin={(message, pinned) => setPin(p, message, pinned)}
            onMarkSold={() => markSold(p, true)}
            onRemove={() => remove(p)}
          />
        ))
      )}

      {/* ── Sold ── */}
      {sold.length > 0 ? (
        <>
          <Text variant="subheading" weight="bold" style={styles.section}>
            Sold ({sold.length})
          </Text>
          {sold.map((p) => (
            <ProductAdminCard
              key={p.id ?? p.name}
              product={p}
              messages={messagesFor(p.id)}
              colors={colors}
              sold
              onOpen={() => p.id && router.push(`/product/${business.id}/${p.id}`)}
              onAcceptOffer={() => {}}
              onPin={(message, pinned) => setPin(p, message, pinned)}
              onMarkSold={() => markSold(p, false)}
              onRemove={() => remove(p)}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

interface AdminCardProps {
  product: ProductItem;
  messages: ProductMessage[];
  colors: ReturnType<typeof useColors>;
  sold?: boolean;
  onOpen: () => void;
  onAcceptOffer: (offer: ProductMessage) => void;
  onPin: (message: ProductMessage, pinned: boolean) => void;
  onMarkSold: () => void;
  onRemove: () => void;
}

function ProductAdminCard({
  product,
  messages,
  colors,
  sold,
  onOpen,
  onAcceptOffer,
  onPin,
  onMarkSold,
  onRemove,
}: AdminCardProps) {
  const photo = product.images?.[0];
  const category = getSubcategory('item', product.subcategoryId);
  const offers = messages.filter((m) => m.offerPrice && !m.fromSeller);
  const pinned = messages.filter((m) => m.pinned);
  const questionCount = messages.filter((m) => !m.offerPrice && !m.fromSeller).length;

  const topOffer = offers.reduce<{ amount: number; label: string } | null>((best, m) => {
    const amount = parsePrice(m.offerPrice!);
    if (amount === undefined) return best;
    if (!best || amount > best.amount) return { amount, label: m.offerPrice! };
    return best;
  }, null);

  return (
    <Card style={styles.card}>
      {/* Item header */}
      <Pressable onPress={onOpen} style={styles.itemRow}>
        {photo ? (
          <Image source={{ uri: photo }} style={[styles.thumb, sold && styles.faded]} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={styles.thumbEmoji}>{category?.icon ?? '🏷️'}</Text>
          </View>
        )}
        <View style={styles.itemInfo}>
          <Text weight="semibold" numberOfLines={1}>
            {product.name}
          </Text>
          <Text variant="caption" tone="brand" weight="semibold">
            {product.price ?? 'Price on request'}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {[
              category?.name,
              offers.length ? `${offers.length} offer${offers.length === 1 ? '' : 's'}` : null,
              questionCount ? `${questionCount} question${questionCount === 1 ? '' : 's'}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No activity yet'}
          </Text>
        </View>
        <Text tone="muted">›</Text>
      </Pressable>

      {/* Top offer at a glance */}
      {topOffer && !sold ? (
        <View style={[styles.topOffer, { backgroundColor: colors.successSoft }]}>
          <Text variant="caption" weight="bold" style={{ color: colors.success }}>
            ⬆ Highest offer {topOffer.label}
          </Text>
        </View>
      ) : null}

      {/* Pinned messages */}
      {pinned.length > 0 ? (
        <View style={styles.subBlock}>
          <Text variant="caption" weight="bold" tone="muted" style={styles.subHead}>
            PINNED
          </Text>
          {pinned.map((m) => (
            <View key={`pin-${m.id}`} style={styles.msgRow}>
              <Text style={styles.msgIcon}>📌</Text>
              <View style={styles.flex}>
                <Text variant="caption" weight="semibold" numberOfLines={1}>
                  {m.fromSeller ? `${m.authorName} · You` : m.authorName}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {m.offerPrice ? `💰 ${m.offerPrice}${m.text ? ` — ${m.text}` : ''}` : m.text}
                </Text>
              </View>
              <Pressable onPress={() => onPin(m, false)} hitSlop={6}>
                <Text variant="caption" weight="semibold" tone="danger">
                  Unpin
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* Open offers — accept (answers + marks sold) or pin */}
      {offers.length > 0 && !sold ? (
        <View style={styles.subBlock}>
          <Text variant="caption" weight="bold" tone="muted" style={styles.subHead}>
            OFFERS
          </Text>
          {offers.map((m) => (
            <View key={`offer-${m.id}`} style={[styles.offerRow, { borderTopColor: colors.border }]}>
              <View style={styles.flex}>
                <Text weight="semibold">
                  💰 {m.offerPrice}{' '}
                  <Text variant="caption" tone="muted">
                    · {m.authorName}
                  </Text>
                </Text>
                {m.text ? (
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {m.text}
                  </Text>
                ) : null}
              </View>
              <View style={styles.offerActions}>
                {!m.pinned ? (
                  <Pressable onPress={() => onPin(m, true)} hitSlop={6}>
                    <Text variant="caption" weight="semibold" tone="muted">
                      📌 Pin
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => onAcceptOffer(m)} hitSlop={6}>
                  <Text variant="caption" weight="bold" tone="brand">
                    ✅ Accept
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Item-level actions */}
      <View style={[styles.cardActions, { borderTopColor: colors.border }]}>
        <Button
          title="💬 Chat"
          variant="secondary"
          onPress={onOpen}
          style={styles.cardBtn}
        />
        <Button
          title={sold ? '↩️ Available' : '✅ Mark sold'}
          variant="secondary"
          onPress={onMarkSold}
          style={styles.cardBtn}
        />
        <Button
          title="🗑️ Remove"
          variant="secondary"
          onPress={onRemove}
          style={styles.cardBtn}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  topActions: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  topBtn: { flex: 1 },
  section: { marginTop: spacing.md, marginBottom: spacing.md },
  empty: { marginBottom: spacing.md },
  card: { marginBottom: spacing.lg, gap: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 26 },
  faded: { opacity: 0.5 },
  itemInfo: { flex: 1, gap: 2 },
  flex: { flex: 1 },
  topOffer: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  subBlock: { gap: spacing.sm },
  subHead: { letterSpacing: 0.5 },
  msgRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  msgIcon: { fontSize: 15 },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  offerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardBtn: { flex: 1 },
});
