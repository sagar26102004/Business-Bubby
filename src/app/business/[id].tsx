/**
 * Business detail — organised as four sections, top to bottom:
 *
 *  1. WHO THEY ARE — the display picture, name, tagline, description, status
 *     and location with a single "Get directions" button + the distance.
 *  2. WHAT THEY OFFER — menu, services and rentals (and products) side by side,
 *     each opening by category, with the action buttons (order, book, enrol…)
 *     at the foot of the section.
 *  3. SHOWCASE — an auto-rotating slider of their work, full-screen on tap.
 *  4. RATINGS & REVIEWS — the star breakdown, filterable, over a rotating
 *     slider of what customers wrote.
 *
 * Call, Chat and the QR code live in the top bar beside the back button, so the
 * three things you always want are one tap away wherever you've scrolled to.
 * The page closes with the owner and the member-only tools.
 */
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { Business, TrackedItem, User } from '@/domain/types';
import { commerceVocab, getSubcategory, offersDineIn, rentalBasisLabel } from '@/domain/catalog';
import { hasModule } from '@/domain/modules';
import {
  RENTAL_SECTIONS,
  SERVICE_SECTIONS,
  rentalCategory,
  sortBySection,
} from '@/domain/offeringSections';
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
  LoadingView,
  Screen,
  Text,
  type IconName,
} from '@/components/ui';
import { BusinessHero } from '@/features/businesses/BusinessHero';
import { OfferingsSection, type OfferingGroup } from '@/features/businesses/OfferingsSection';
import { OffersSection } from '@/features/businesses/OffersSection';
import { liveOffers } from '@/features/businesses/offerUtils';
import { ProductTile } from '@/features/businesses/ProductTile';
import { PortfolioGallery } from '@/features/businesses/PortfolioGallery';
import { ShowcaseLinks } from '@/features/businesses/ShowcaseLinks';
import { ReviewsSection } from '@/features/businesses/ReviewsSection';
import { OwnerPicker } from '@/features/businesses/OwnerPicker';
import { spacing, useColors } from '@/theme/theme';

export default function BusinessDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  // `isGuest` covers both a logged-out viewer and one browsing on a throwaway
  // anonymous identity (gained by calling or chatting) — neither can own a
  // rating or a membership, so both are sent to sign-in for those.
  const { currentUser, isGuest } = useAuth();

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

  // Refetch when coming back from rate/order/chat screens so fresh reviews and
  // counts show — but keep the current content on screen while it reloads.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) reload();
      else focusedOnce.current = true;
    }, [reload]),
  );

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
  const isStall = business.type === 'item';
  // The page is what CUSTOMERS see, members included — a paused offer stays off
  // it. Status lives in Workspace › Offers, where it can be explained.
  const offers = liveOffers(business);

  const hasMenu = (business.menu?.length ?? 0) > 0;
  // Enrol/Subscribe and Order are two distinct buttons on two distinct modules.
  // The commerce vocab tells us which mode this business is by its tags: enrol
  // (gym/classes) or subscribe (tiffin/bus/milk) get the membership button; its
  // label is the vocab's action. The Order button then always reads plainly
  // "Order"/"Buy" — never relabelled to Enrol.
  const vocab = commerceVocab(business);
  const isMembershipMode = vocab.mode === 'enroll' || vocab.mode === 'subscribe';
  const membershipAction = vocab.customerAction; // "🎟️ Enroll" / "🔁 Subscribe"
  const orderAction = hasMenu
    ? '📖 Menu'
    : isMembershipMode
      ? '🛒 Order'
      : vocab.customerAction;
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
  const groups: OfferingGroup[] = [];
  if (hasMenu) {
    groups.push({
      key: 'menu',
      icon: '📖',
      title: 'Menu',
      subtitle: `${business.menu!.length} dish${business.menu!.length === 1 ? '' : 'es'}`,
      entries: business.menu!.map((m) => ({
        name: m.name,
        price: m.price,
        description: m.description,
        category: m.category,
        subcategory: m.subcategory,
      })),
      seeAll: { label: 'Full menu', onPress: () => router.push(`/menu/${business.id}`) },
    });
  }
  if ((business.services?.length ?? 0) > 0) {
    groups.push({
      key: 'services',
      icon: '🛠️',
      title: 'Services',
      subtitle: `${business.services!.length} service${business.services!.length === 1 ? '' : 's'}`,
      entries: sortBySection(business.services!, SERVICE_SECTIONS),
    });
  }
  if ((business.rentals?.length ?? 0) > 0) {
    const basis = rentalBasisLabel(business.rentalBasis);
    groups.push({
      key: 'rentals',
      icon: '🔑',
      title: 'For rent',
      subtitle: [
        `${business.rentals!.length} item${business.rentals!.length === 1 ? '' : 's'}`,
        basis?.toLowerCase(),
      ]
        .filter(Boolean)
        .join(' · '),
      // Older rentals only carry a browse subcategoryId — rentalCategory() turns
      // that into their section so nothing lands ungrouped.
      entries: sortBySection(
        business.rentals!.map((item) => ({ ...item, category: rentalCategory(item) })),
        RENTAL_SECTIONS,
      ),
    });
  }
  // A stall's products are shown picture-first below instead of as a list.
  if (!isStall && (business.products?.length ?? 0) > 0) {
    groups.push({
      key: 'products',
      icon: '🛍️',
      title: 'Products',
      subtitle: `${business.products!.length} item${business.products!.length === 1 ? '' : 's'}`,
      entries: business.products!.map((p) => ({
        name: p.name,
        price: p.price,
        description: p.description,
        category: getSubcategory('item', p.subcategoryId)?.name,
      })),
    });
  }
  if ((business.partyPackages?.length ?? 0) > 0) {
    groups.push({
      key: 'party',
      icon: '🎉',
      title: 'Party packages',
      subtitle: `${business.partyPackages!.length} package${business.partyPackages!.length === 1 ? '' : 's'}`,
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

  return (
    <Screen scroll>
      <Stack.Screen
        options={{
          title: business.name,
          // Call / Chat / QR live in the top bar — always reachable.
          headerRight: () => (
            <View style={styles.headerActions}>
              <HeaderAction
                icon="phone"
                label="Call this business"
                onPress={() => router.push(`/call/${business.id}`)}
              />
              <HeaderAction
                icon="chat"
                label="Chat with this business"
                onPress={() => router.push(`/chat/${business.id}`)}
              />
              <HeaderAction
                icon="scan"
                label="QR code and share link"
                onPress={() => router.push(`/qr/${business.id}`)}
              />
            </View>
          ),
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
      />

      {/* Offers — the business's own promotions, straight under the
          description so they're the first thing read after the intro. */}
      <OffersSection offers={offers} />

      {/* ——— 2. What they offer ——— */}
      {hasOfferings ? <SectionTitle>What we offer</SectionTitle> : null}

      <OfferingsSection groups={groups} />

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
            <Text style={styles.rowIcon}>📦</Text>
            <View style={styles.rowInfo}>
              <Text weight="semibold">My {vocab.requestNoun}s</Text>
              <Text variant="caption" tone="muted">
                {myOrders.length} past {vocab.requestNoun}
                {myOrders.length === 1 ? '' : 's'}
                {openTab ? ' · 1 open now' : ''}
              </Text>
            </View>
            <Text tone="muted">›</Text>
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
        {/* Enrol/Subscribe — its OWN button and flow, separate from ordering.
            A membership-type business (gym, classes, tiffin, bus) running the
            memberships module lets customers request to join; the request lands
            in the workspace Members section to accept and set the plan + price. */}
        {isMembershipMode && hasModule(business, 'memberships') ? (
          <Button
            title={membershipAction}
            onPress={() =>
              isGuest ? router.push('/sign-in') : router.push(`/enroll/${business.id}`)
            }
            style={styles.actionBtn}
          />
        ) : null}
        {/* Ordering, parties and appointments only show when the business runs
            that workspace module — otherwise requests would land nowhere. With
            a menu, ordering starts on the menu screen; everything else keeps the
            pick-from-a-list order form. */}
        {hasCatalog(business) && hasModule(business, 'orders') ? (
          <Button
            title={orderAction}
            onPress={() =>
              router.push(hasMenu ? `/menu/${business.id}` : `/order/new/${business.id}`)
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
        <>
          <SectionTitle>Work showcase</SectionTitle>
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
        </>
      ) : null}

      {/* ——— 4. Ratings & reviews ——— */}
      <SectionTitle>Ratings &amp; reviews</SectionTitle>
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
          <Text style={styles.rowIcon}>👤</Text>
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
  );
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

/** True when the business lists anything a customer could put on an order. */
function hasCatalog(b: Business): boolean {
  return (b.products?.length ?? 0) + (b.menu?.length ?? 0) + (b.services?.length ?? 0) > 0;
}

/** "Track my child" / "Track my children" / "Track my goods" / mixed. */
function trackLabel(items: TrackedItem[]): string {
  const kinds = new Set(items.map((i) => i.kind));
  if (kinds.size > 1) return '📍 Live tracking';
  if (kinds.has('child')) return items.length > 1 ? '📍 Track my children' : '📍 Track my child';
  return '📍 Track my goods';
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="subheading" weight="bold" style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.md },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowInfo: { flex: 1 },
  rowIcon: { fontSize: 22 },
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
