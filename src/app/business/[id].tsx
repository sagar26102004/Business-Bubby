/**
 * Business detail (One Place redesign — docs/redesign-one-place/business.html),
 * organised as four sections, top to bottom:
 *
 *  1. WHO THEY ARE — cover, name, rating, #tags, address + "Get directions",
 *     and the action row (Call · Chat · their own door · Route).
 *  2. WHAT THEY OFFER — menu, services, rentals and products side by side, all
 *     four built from the one offering model (`domain/offerings.ts`) so they
 *     open, fold and read identically, with the action buttons (order, book,
 *     enrol…) at the foot of the section.
 *  3. SHOWCASE — an auto-rotating slider of their work, full-screen on tap.
 *  4. RATINGS & REVIEWS — the star breakdown, filterable, over a rotating
 *     slider of what customers wrote.
 *
 * Under the hero a strip of TABS — one per offering block, plus Reviews —
 * scrolls the page to that section. Rows can be added to the cart in place
 * (the same cart as the full catalog), and a sticky order bar appears once
 * something is picked. The page closes with the owner and the member-only tools.
 */
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Business, TrackedItem, User } from '@/domain/types';
import { commerceVocab, getSubcategory, offersDineIn, rentalBasisLabel } from '@/domain/catalog';
import { offeringBuckets } from '@/domain/offerings';
import { hasModule } from '@/domain/modules';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { isBusinessTeamMember } from '@/domain/access';
import { haversineKm } from '@/lib/geo';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  Icon,
  IconTile,
  LoadingView,
  Screen,
  SectionHeader,
  Tag,
  Text,
  type IconName,
} from '@/components/ui';
import { BusinessHero, type HeroAction } from '@/features/businesses/BusinessHero';
import { useCart } from '@/features/orders/CartContext';
import { totalLabel, totalOf } from '@/features/orders/orderUtils';
import { OfferingsSection, type OfferingGroup } from '@/features/businesses/OfferingsSection';
import { catalogLink } from '@/features/offerings/links';
import { OffersSection } from '@/features/businesses/OffersSection';
import { liveOffers } from '@/features/businesses/offerUtils';
import { ProductTile } from '@/features/businesses/ProductTile';
import { PortfolioGallery } from '@/features/businesses/PortfolioGallery';
import { ShowcaseLinks } from '@/features/businesses/ShowcaseLinks';
import { ReviewsSection } from '@/features/businesses/ReviewsSection';
import { OwnerPicker } from '@/features/businesses/OwnerPicker';
import { radius, spacing, useColors } from '@/theme/theme';
import { ON_HOLD } from '@/lib/onHold';

export default function BusinessDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  // `isGuest` covers both a logged-out viewer and one browsing on a throwaway
  // anonymous identity (gained by calling or chatting) — neither can own a
  // rating or a membership, so both are sent to sign-in for those.
  const { currentUser, isGuest } = useAuth();
  const insets = useSafeAreaInsets();
  // The tab strip scrolls the page to a section: where each one sits.
  const scrollRef = useRef<ScrollView>(null);
  const offsetsRef = useRef<Record<string, number>>({});
  const offeringsTopRef = useRef(0);
  // The shared cart (the catalog screen's) — rows on this page add to it too.
  const cart = useCart(id);

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(id);
    if (!business) return null;
    const [employees, owner] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.users.getById(business.ownerId),
    ]);
    // Children/goods this business tracks for the viewer — enables live tracking.
    const myTrackedItems = currentUser
      ? await repos.tracking.listItemsForCustomer(currentUser.id, business.id)
      : [];
    // The viewer's order history with this business — powers "My orders".
    const myOrders = await repos.orders.listForCustomer(currentUser?.id ?? 'guest', business.id);
    // Current/Home/Work — the hero shows how far the listing is from you, and
    // a rental additionally lists its distance from each saved place.
    const places = await repos.places.listPlaces();
    // Verified-customer reviews + whether the viewer already left one.
    const reviews = await repos.reviews.listForBusiness(business.id);
    const myReview = currentUser
      ? await repos.reviews.getMine(business.id, currentUser.id)
      : null;
    return { business, employees, owner, myTrackedItems, myOrders, places, reviews, myReview };
  }, [id, currentUser?.id]);

  // Super-admin: reassign-owner panel state.
  const [reassignOpen, setReassignOpen] = useState(false);
  const [newOwner, setNewOwner] = useState<User | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [reassignMsg, setReassignMsg] = useState<string | null>(null);

  const doReassign = useCallback(async () => {
    if (!newOwner || !data) return;
    setReassigning(true);
    setReassignMsg(null);
    try {
      await repos.businesses.reassignOwner(data.business.id, newOwner.id);
      setReassignMsg(`✓ Owner changed to ${newOwner.name}.`);
      setReassignOpen(false);
      setNewOwner(null);
      reload();
    } catch (err) {
      setReassignMsg(err instanceof Error ? err.message : 'Could not change the owner.');
    } finally {
      setReassigning(false);
    }
  }, [newOwner, data, repos, reload]);

  if (loading && data === undefined) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  if (!data) return <EmptyView title="Not found" subtitle="This listing may have been removed." />;

  const { business, employees, owner, myTrackedItems, myOrders, places, reviews, myReview } = data;
  const isOwner = currentUser?.id === business.ownerId;
  const isSuper = isSuperAdminUser(currentUser);
  // A super-admin stands in for the owner (they onboard businesses on their
  // behalf), so they reach the same tools — see domain/access.ts.
  const isMember = isBusinessTeamMember(
    business,
    employees.find((e) => e.userId && e.userId === currentUser?.id),
    currentUser,
  );
  // ON HOLD (redesign 2026-10): stall — a stall renders as a plain listing.
  const isStall = !ON_HOLD.stalls && business.type === 'item';
  // The page is what CUSTOMERS see, members included — a paused offer stays off
  // it. Status lives in Workspace › Offers, where it can be explained.
  const offers = liveOffers(business);

  const hasMenu = (business.menu?.length ?? 0) > 0;
  // Every offering list now carries its OWN button (see the blocks below), so
  // there is no single "what do I call taking custom here" question left to
  // answer. The vocab survives for the request counts, and for one fallback:
  // a business people JOIN (gym, classes, tiffin, bus) that hasn't listed any
  // plans yet still needs a way in.
  const vocab = commerceVocab(business);
  const isMembershipMode = vocab.mode === 'enroll' || vocab.mode === 'subscribe';
  const membershipAction = vocab.customerAction; // "🎟️ Enroll" / "🔁 Subscribe"
  // A confirmed-but-unbilled dine-in order — the customer can still add rounds.
  const openTab = myOrders.find(
    (o) => o.fulfillment === 'dine_in' && !o.billId && (o.status === 'requested' || o.status === 'accepted'),
  );

  // How far the listing is from where the viewer is right now.
  const currentPoint = places.find((p) => p.kind === 'current')?.point ?? places[0]?.point;
  const distanceKm =
    currentPoint && business.location.point
      ? haversineKm(business.location.point, currentPoint)
      : business.distanceKm;

  /* ——— Section 2: everything the business offers, block by block ——— */
  // Menu, services, rentals and products are one model with four names
  // (`domain/offerings.ts`), so each block is built the same way and links out
  // to the same full-catalog screen. A stall's products are the exception —
  // they're shown picture-first below instead of as a list.
  const groups: OfferingGroup[] = offeringBuckets(business)
    .filter((view) => !(isStall && view.bucket === 'products'))
    .map((view) => ({
      key: view.bucket,
      // Picked in place, on the shared cart — only when the request can land.
      addable: view.bucket !== 'plans' && hasModule(business, view.module),
      onEnroll:
        view.bucket === 'plans' && hasModule(business, 'memberships')
          ? (item: { name: string }) =>
              isGuest
                ? router.push('/sign-in')
                : router.push(
                    `/enroll/${business.id}?plan=${encodeURIComponent(item.name)}`,
                  )
          : undefined,
      title: view.title,
      subtitle:
        view.bucket === 'rentals'
          ? [view.subtitle, rentalBasisLabel(business.rentalBasis)?.toLowerCase()]
              .filter(Boolean)
              .join(' · ')
          : view.subtitle,
      icon: view.icon,
      entries: view.items.map((item) => ({
        name: item.name,
        price: item.price,
        description: item.description,
        category: item.category,
        subcategory: item.detail,
        path: item.path,
        imageUrl: item.imageUrl,
        badge: item.badge,
        item,
      })),
      seeAll: {
        label: view.seeAllLabel,
        onPress: () => router.push(catalogLink(business.id, view.bucket)),
      },
      // Each block's own way in: Order a menu, Buy a product, Request a
      // service, Enroll in a plan. Shown only when the workspace module that
      // RECEIVES it is switched on — otherwise the request lands nowhere.
      // Ordering opens the same full catalog the "Full menu ›" link does; the
      // button exists because that link is a heading nobody reads as a way to
      // buy. Enrolling is its own flow and never becomes an order.
      action: hasModule(business, view.module)
        ? {
            label: view.actionLabel,
            onPress: () => {
              if (view.bucket !== 'plans') {
                router.push(catalogLink(business.id, view.bucket));
              } else if (isGuest) {
                router.push('/sign-in');
              } else {
                router.push(`/enroll/${business.id}`);
              }
            },
          }
        : undefined,
    }));
  // The Plans block carries the Enrol button itself when there is one.
  const hasPlansBlock = groups.some((g) => g.key === 'plans');

  if ((business.partyPackages?.length ?? 0) > 0) {
    groups.push({
      key: 'party',
      title: 'Party packages',
      subtitle: `${business.partyPackages!.length} package${business.partyPackages!.length === 1 ? '' : 's'}`,
      icon: '🎉',
      entries: business.partyPackages!.map((pkg) => ({
        name: pkg.name,
        price: pkg.price,
        description: pkg.description,
      })),
    });
  }

  const hasOfferings = groups.length > 0 || (isStall && (business.products?.length ?? 0) > 0);
  const showcase = business.portfolio ?? [];
  const showcaseLinks = business.showcaseLinks ?? [];

  // The hero's action row: Call · Chat · the lead block's own door · Route.
  const lead = groups.find((g) => g.action);
  const heroActions: HeroAction[] = [
    { icon: 'phone', label: 'Call', onPress: () => router.push(`/call/${business.id}`) },
    { icon: 'chat', label: 'Chat', onPress: () => router.push(`/chat/${business.id}`) },
    ...(lead?.action
      ? [
          {
            icon: doorIcon(lead.key),
            // "🛒 Order" → "Order": the tile carries its own icon.
            label: lead.action.label.replace(/^\S+\s/, ''),
            onPress: lead.action.onPress,
            primary: true,
          },
        ]
      : []),
    { icon: 'directions', label: 'Route', onPress: () => router.push(`/directions/${business.id}`) },
  ];

  // The tab strip: every block with something in it, then Reviews.
  const tabs = [
    ...groups
      .filter((g) => g.entries.length > 0)
      .map((g) => ({ key: g.key, label: `${g.title} (${g.entries.length})` })),
    ...(showcase.length > 0 || showcaseLinks.length > 0
      ? [{ key: 'showcase', label: 'Showcase' }]
      : []),
    { key: 'reviews', label: 'Reviews' },
  ];
  const jumpTo = (key: string) => {
    const y = offsetsRef.current[key];
    if (typeof y === 'number') scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
  };
  const markSection = (key: string) => (e: { nativeEvent: { layout: { y: number } } }) => {
    offsetsRef.current[key] = e.nativeEvent.layout.y;
  };

  const cartTotal = totalOf(cart.lines.map((l) => ({ price: l.item.price, quantity: l.quantity })));

  return (
    <View style={styles.root}>
    <Screen scroll scrollRef={scrollRef} contentStyle={cart.itemCount > 0 ? styles.roomForBar : undefined}>
      <Stack.Screen
        options={{
          title: business.name,
          // ON HOLD (redesign 2026-10): business-qr — the QR/share button. Call
          // and Chat moved into the hero's action row.
          headerRight: !ON_HOLD.businessQr
            ? () => (
                <View style={styles.headerActions}>
                  <HeaderAction
                    icon="scan"
                    label="QR code and share link"
                    onPress={() => router.push(`/qr/${business.id}`)}
                  />
                </View>
              )
            : undefined,
        }}
      />

      {/* ——— 1. Who they are ——— */}
      <BusinessHero
        business={business}
        distanceKm={distanceKm}
        places={places}
        onDirections={() => router.push(`/directions/${business.id}`)}
        onEditCover={
          isOwner && !isStall ? () => router.push(`/manage/${business.id}`) : undefined
        }
        actions={heroActions}
      />

      {/* Tabs — jump to a section. */}
      {tabs.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsBleed}
          contentContainerStyle={styles.tabs}
        >
          {tabs.map((t, i) => (
            <Tag key={t.key} label={t.label} selected={i === 0} onPress={() => jumpTo(t.key)} />
          ))}
        </ScrollView>
      ) : null}

      {/* Offers — the business's own promotions, straight under the
          description so they're the first thing read after the intro. Tapping
          one opens the order screen with that bundle already picked. */}
      <OffersSection
        offers={offers}
        onPress={(offer) =>
          router.push({
            pathname: '/order/new/[businessId]',
            params: { businessId: business.id, offer: offer.id },
          })
        }
      />

      {/* ——— 2. What they offer ——— */}
      {hasOfferings ? (
        <SectionHeader
          title="What we offer"
          subtitle={
            groups.some((g) => g.addable) ? 'Add items here, then place one order' : undefined
          }
        />
      ) : null}

      <View
        onLayout={(e) => {
          offeringsTopRef.current = e.nativeEvent.layout.y;
        }}
      >
        <OfferingsSection
          groups={groups}
          businessId={business.id}
          onLayoutGroup={(key, y) => {
            offsetsRef.current[key] = offeringsTopRef.current + y;
          }}
        />
      </View>

      {/* A personal stall shows its items picture-first, exactly like the
          Stalls feed — every tile opens that item's own page (photos + the
          public questions/offers thread). */}
      {isStall && (business.products?.length ?? 0) > 0 ? (
        <View style={styles.stallGrid}>
          {business.products!.map((p) => (
            <View key={p.id ?? p.name} style={styles.stallCell}>
              <ProductTile
                item={{
                  key: p.id ?? p.name,
                  name: p.name,
                  price: p.price,
                  description: p.description,
                  imageUrl: p.images?.[0],
                  sold: p.sold,
                  emoji: getSubcategory('item', p.subcategoryId)?.icon ?? '🏷️',
                  sellerName: getSubcategory('item', p.subcategoryId)?.name ?? 'Tap to view',
                  onPress: () => (p.id ? router.push(`/product/${business.id}/${p.id}`) : undefined),
                }}
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* Everything the viewer ever ordered here, paid or not. */}
      {myOrders.length > 0 ? (
        <Card onPress={() => router.push(`/orders/${business.id}`)} style={styles.ordersCard}>
          <View style={styles.rowCard}>
            <IconTile icon="bag" size={40} />
            <View style={styles.rowInfo}>
              <Text weight="semibold">My {vocab.requestNoun}s</Text>
              <Text variant="caption" tone="muted">
                {myOrders.length} past {vocab.requestNoun}
                {myOrders.length === 1 ? '' : 's'}
                {openTab ? ' · 1 open now' : ''}
              </Text>
            </View>
            <Icon name="chevronRight" size={18} color={colors.textMuted} />
          </View>
        </Card>
      ) : null}

      {/* The section's actions: everything a customer can start from here. */}
      <View style={styles.actions}>
        {myTrackedItems.length > 0 && hasModule(business, 'tracking') ? (
          <Button
            title={trackLabel(myTrackedItems)}
            onPress={() => router.push(`/track/${business.id}`)}
            style={styles.actionBtn}
          />
        ) : null}
        {/* Enrol/Subscribe for a joinable business that has listed no plans:
            the Plans block would normally carry this button, and does the
            moment there is one. Without it the page would have no way in at
            all — the request still lands in the workspace Members section for
            the business to accept and set the plan + price. */}
        {isMembershipMode && hasModule(business, 'memberships') && !hasPlansBlock ? (
          <Button
            title={membershipAction}
            onPress={() =>
              isGuest ? router.push('/sign-in') : router.push(`/enroll/${business.id}`)
            }
            style={styles.actionBtn}
          />
        ) : null}
        {/* A confirmed dine-in tab is still open — go straight back to the menu
            to add another round to it. */}
        {openTab && hasMenu ? (
          <Button
            title="🍽️ Continue my order"
            variant="secondary"
            onPress={() => router.push(`/menu/${business.id}`)}
            style={styles.actionBtn}
          />
        ) : null}
        {hasModule(business, 'orders') &&
        (offersDineIn(business) || (business.partyPackages?.length ?? 0) > 0) ? (
          <Button
            title="🎉 Plan a party"
            variant="secondary"
            onPress={() => router.push(`/party/${business.id}`)}
            style={styles.actionBtn}
          />
        ) : null}
        {/* Bookable when it's a service provider OR lists services (a tyre shop
            that fits tyres) — and runs the bookings module. */}
        {(business.type === 'service' || (business.services?.length ?? 0) > 0) &&
        hasModule(business, 'bookings') ? (
          <Button
            title="📅 Book an appointment"
            onPress={() => router.push(`/book/${business.id}`)}
            style={styles.actionBtn}
          />
        ) : null}
      </View>

      {/* ——— 3. Showcase ——— */}
      {showcase.length > 0 || showcaseLinks.length > 0 || isMember ? (
        <View onLayout={markSection('showcase')}>
          <SectionHeader
            emoji="📸"
            title="Work showcase"
            subtitle="Past work, photos & reels"
            badge={showcase.length ? `${showcase.length} item${showcase.length === 1 ? '' : 's'}` : undefined}
          />
          {showcase.length > 0 ? (
            <PortfolioGallery items={showcase} />
          ) : showcaseLinks.length === 0 ? (
            <Text variant="label" tone="muted">
              Show customers your past work — photos and videos appear here.
            </Text>
          ) : null}
          {/* Where the rest of the work lives — a Drive folder, an Instagram grid. */}
          <ShowcaseLinks links={showcaseLinks} />
          {isMember ? (
            <Button
              title="🖼️ Manage showcase"
              variant="secondary"
              onPress={() => router.push(`/showcase/${business.id}`)}
              style={styles.showcaseBtn}
            />
          ) : null}
        </View>
      ) : null}

      {/* ——— 4. Ratings & reviews ——— */}
      <View onLayout={markSection('reviews')}>
        <SectionHeader emoji="⭐" title="Ratings & reviews" />
      </View>
      <ReviewsSection
        ratingAvg={business.ratingAvg}
        ratingCount={business.ratingCount}
        reviews={reviews}
        canRate={!isOwner}
        hasMine={!!myReview}
        onRate={() => (isGuest ? router.push('/sign-in') : router.push(`/review/${business.id}`))}
      />

      {/* The owner, plainly — no team dropdown. Managers and staff belong to the
          workspace, not the customer-facing page. */}
      <Card style={styles.ownerCard}>
        <View style={styles.rowCard}>
          <IconTile icon="user" size={40} />
          <View style={styles.rowInfo}>
            <Text variant="caption" weight="semibold" tone="muted" style={styles.ownerLabel}>
              OWNER
            </Text>
            <Text weight="semibold">{owner?.name ?? 'Owner'}</Text>
          </View>
          {isOwner ? (
            <Text variant="caption" tone="muted">
              that’s you
            </Text>
          ) : null}
        </View>
      </Card>

      {/* Member-only tools. */}
      {isOwner && isStall ? (
        <>
          <Button
            title="➕ Add an item to your stall"
            onPress={() => router.push({ pathname: '/register', params: { type: 'item' } })}
            style={styles.manageBtn}
          />
          <Button
            title="🛠️ Manage stall"
            variant="secondary"
            onPress={() => router.push(`/stall/${business.id}`)}
            style={styles.manageBtn}
          />
        </>
      ) : null}
      {(isOwner || isSuper) && !isStall ? (
        <Button
          title={isOwner ? '✏️ Edit business page' : '🛡️ Edit page (super-admin)'}
          onPress={() => router.push(`/manage/${business.id}`)}
          style={styles.manageBtn}
        />
      ) : null}
      {isMember ? (
        <Button
          title="🏢 Business workspace"
          variant="secondary"
          onPress={() => router.push(`/workspace/${business.id}`)}
          style={styles.manageBtn}
        />
      ) : null}

      {/* Super-admin: hand this listing to a different owner. */}
      {isSuper ? (
        <Card style={styles.adminCard}>
          <Text weight="semibold">🛡️ Super-admin</Text>
          <Text variant="caption" tone="muted" style={styles.adminSub}>
            Current owner: {owner?.name ?? 'Unknown'}
            {isOwner ? ' · that’s you' : ''}
          </Text>
          {reassignOpen ? (
            <>
              <OwnerPicker
                value={newOwner}
                onChange={setNewOwner}
                selfLabel={currentUser ? `Me (${currentUser.name})` : 'Me'}
                hideSelf
              />
              <View style={styles.adminButtons}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => {
                    setReassignOpen(false);
                    setNewOwner(null);
                    setReassignMsg(null);
                  }}
                  style={styles.adminBtn}
                />
                <Button
                  title={newOwner ? `Make ${newOwner.name} the owner` : 'Pick a new owner'}
                  onPress={doReassign}
                  loading={reassigning}
                  style={styles.adminBtnWide}
                />
              </View>
            </>
          ) : (
            <Button
              title="Change owner"
              variant="secondary"
              onPress={() => setReassignOpen(true)}
              style={styles.adminOpenBtn}
            />
          )}
          {reassignMsg ? (
            <Text
              variant="caption"
              tone={reassignMsg.startsWith('✓') ? 'brand' : 'danger'}
              style={styles.adminSub}
            >
              {reassignMsg}
            </Text>
          ) : null}
        </Card>
      ) : null}
    </Screen>

      {/* Sticky order bar — appears once something is picked on this page or
          the catalog screen (they share one cart). */}
      {cart.itemCount > 0 ? (
        <View
          style={[
            styles.bar,
            {
              backgroundColor: colors.headerTint,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom + spacing.md,
            },
          ]}
        >
          <View style={styles.rowInfo}>
            <Text weight="bold">
              {cart.itemCount} item{cart.itemCount === 1 ? '' : 's'}
            </Text>
            <Text variant="caption" tone="muted">
              {totalLabel(cartTotal)}
            </Text>
          </View>
          <Button
            title="Place order"
            icon="cart"
            variant="cta"
            onPress={() => router.push(`/cart/${business.id}`)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** The icon for a block's own door on the action row. */
function doorIcon(bucket: string): IconName {
  if (bucket === 'menu') return 'cart';
  if (bucket === 'products') return 'bag';
  if (bucket === 'rentals') return 'key';
  if (bucket === 'plans') return 'ticket';
  return 'calendar';
}

/** One of the round icon buttons in the top bar. */
function HeaderAction({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.headerBtn,
        { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.6 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={18} color={colors.text} strokeWidth={2.2} />
    </Pressable>
  );
}

/**
 * True when the business lists anything a customer could put on a request.
 * Rentals count: a flat or a bike is requested through the same flow, which is
 * why a rental listing had no action button at all before.
 */
/** "Track my child" / "Track my children" / "Track my goods" / mixed. */
function trackLabel(items: TrackedItem[]): string {
  const kinds = new Set(items.map((i) => i.kind));
  if (kinds.size > 1) return '📍 Live tracking';
  if (kinds.has('child')) return items.length > 1 ? '📍 Track my children' : '📍 Track my child';
  return '📍 Track my goods';
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  roomForBar: { paddingBottom: 110 },
  tabsBleed: { marginHorizontal: -spacing.lg, marginTop: spacing.lg },
  tabs: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowInfo: { flex: 1 },
  ordersCard: { marginTop: spacing.md },
  stallGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  stallCell: { width: '48%' },
  actions: { marginTop: spacing.lg },
  actionBtn: { marginBottom: spacing.md },
  showcaseBtn: { marginTop: spacing.md },
  ownerCard: { marginTop: spacing.xl },
  ownerLabel: { letterSpacing: 1, marginBottom: 2 },
  manageBtn: { marginTop: spacing.md },
  adminCard: { marginTop: spacing.lg },
  adminSub: { marginTop: spacing.xs },
  adminOpenBtn: { marginTop: spacing.md },
  adminButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  adminBtn: { flex: 1 },
  adminBtnWide: { flex: 2 },
});
