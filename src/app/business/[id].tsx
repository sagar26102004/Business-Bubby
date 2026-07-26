/**
 * Business detail. Shows the listing, a privacy-respecting location, contact
 * actions, and — last, folded away — the team, where each employee links to
 * their public profile (when they've enabled one).
 */
import { Fragment, useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { Business, Employee, PlaceKind, TrackedItem, User } from '@/domain/types';
import { commerceVocab, formatDistance, getSubcategory, getType, offersDineIn, rentalBasisLabel } from '@/domain/catalog';
import { hasModule } from '@/domain/modules';
import { isSuperAdminUser } from '@/domain/superAdmin';
import { openState, weeklySchedule } from '@/domain/hours';
import { haversineKm } from '@/lib/geo';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { useAsync } from '@/lib/useAsync';
import {
  Button,
  Card,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
  Stars,
  Tag,
  Text,
} from '@/components/ui';
import { EmployeeRow } from '@/features/employees/EmployeeRow';
import { CatalogAccordion } from '@/features/businesses/CatalogAccordion';
import { ProductTile } from '@/features/businesses/ProductTile';
import { PortfolioGallery } from '@/features/businesses/PortfolioGallery';
import { OwnerPicker } from '@/features/businesses/OwnerPicker';
import { canShowPreciseLocation, hasShowableCoordinates, locationSummary } from '@/features/businesses/location';
import { radius, spacing, useColors } from '@/theme/theme';

const PLACE_ICONS: Record<PlaceKind, string> = {
  current: '🧭',
  home: '🏠',
  work: '💼',
  custom: '📌',
};

export default function BusinessDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const repos = useRepositories();
  const colors = useColors();
  const router = useRouter();
  const { currentUser } = useAuth();

  const { data, loading, error, reload } = useAsync(async () => {
    const business = await repos.businesses.getById(id);
    if (!business) return null;
    const [employees, owner] = await Promise.all([
      repos.employees.listByBusiness(business.id),
      repos.users.getById(business.ownerId),
    ]);
    // Resolve which linked accounts are public so rows know if they're tappable.
    const users = await Promise.all(
      employees.map((e) => (e.userId ? repos.users.getById(e.userId) : Promise.resolve(null))),
    );
    const publicByEmployeeId: Record<string, boolean> = {};
    employees.forEach((e, i) => {
      publicByEmployeeId[e.id] = !!users[i]?.isProfilePublic;
    });
    // Children/goods this business tracks for the viewer — enables live tracking.
    const myTrackedItems = currentUser
      ? await repos.tracking.listItemsForCustomer(currentUser.id, business.id)
      : [];
    // The viewer's order history with this business — powers "My orders".
    const myOrders = await repos.orders.listForCustomer(currentUser?.id ?? 'guest', business.id);
    // Rentals: distances from the property to Current/Home/Work.
    const places = business.type === 'rental' ? await repos.places.listPlaces() : [];
    // Verified-customer reviews + whether the viewer already left one.
    const reviews = await repos.reviews.listForBusiness(business.id);
    const myReview = currentUser
      ? await repos.reviews.getMine(business.id, currentUser.id)
      : null;
    return { business, employees, owner, publicByEmployeeId, myTrackedItems, myOrders, places, reviews, myReview };
  }, [id, currentUser?.id]);

  // The team sits at the bottom, folded away — customers come to order.
  const [teamOpen, setTeamOpen] = useState(false);
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

  const { business, employees, owner, publicByEmployeeId, myTrackedItems, myOrders, places, reviews, myReview } = data;
  const showPrecise = canShowPreciseLocation(business.location);
  const isOwner = currentUser?.id === business.ownerId;
  const isMember = isOwner || employees.some((e) => e.userId && e.userId === currentUser?.id);
  const isSuper = isSuperAdminUser(currentUser);

  const hasMenu = (business.menu?.length ?? 0) > 0;
  // Enrol/Subscribe and Order are now two distinct buttons on two distinct
  // modules. The commerce vocab tells us which mode this business is by its
  // tags: enrol (gym/classes) or subscribe (tiffin/bus/milk) get the
  // membership button; its label is the vocab's action. The Order button then
  // always reads plainly "Order"/"Buy" — never relabelled to Enrol.
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

  const managers = employees.filter((e) => e.level === 'manager');
  // Staff stay off the page unless the owner features them (Manage). Featured
  // members group under their designation, so headings read CHEF, WAITER, …
  const featuredStaff = employees.filter((e) => e.level !== 'manager' && e.showOnPage);
  const staffGroups: { designation: string; members: Employee[] }[] = [];
  for (const emp of featuredStaff) {
    const designation = emp.role?.trim() || 'Staff';
    let group = staffGroups.find((g) => g.designation === designation);
    if (!group) {
      group = { designation, members: [] };
      staffGroups.push(group);
    }
    group.members.push(emp);
  }
  const visibleTeamCount = 1 + managers.length + featuredStaff.length;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: business.name }} />

      <Text variant="title" weight="bold" style={styles.name}>
        {business.name}
      </Text>
      {business.providerType ? (
        <Text tone="muted" style={styles.provider}>
          {business.providerType}
        </Text>
      ) : null}
      {business.tagline ? (
        <Text tone="muted" variant="subheading" style={styles.tagline}>
          {business.tagline}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        <Stars rating={business.ratingAvg} count={business.ratingCount} size={15} />
      </View>

      {business.tags && business.tags.length > 0 ? (
        <View style={styles.tags}>
          {business.tags.map((t) => (
            <Tag key={t} label={t} />
          ))}
        </View>
      ) : null}

      {business.description ? (
        <Text style={styles.description}>{business.description}</Text>
      ) : null}

      {/* Open/closed status + the hours you can reach them — sits right under
          the name & description, not up in the app bar. Open/Closed is computed
          from structured hours when present, else the stored openNow flag. */}
      {(() => {
        const status = openState(business);
        const todayLabel = status.todayLabel ?? business.hours;
        if (!business.rentalStatus && typeof status.open !== 'boolean' && !todayLabel) return null;
        return (
          <View style={styles.statusRow}>
            {business.rentalStatus ? (
              <View
                style={[
                  styles.statusPill,
                  {
                    backgroundColor:
                      business.rentalStatus === 'available' ? colors.success : colors.danger,
                  },
                ]}
              >
                <Text variant="caption" weight="semibold" tone="inverse">
                  {business.rentalStatus === 'available' ? 'Available' : 'Rented'}
                </Text>
              </View>
            ) : typeof status.open === 'boolean' ? (
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: status.open ? colors.success : colors.textMuted },
                ]}
              >
                <Text variant="caption" weight="semibold" tone="inverse">
                  {status.open ? 'Open Now' : 'Closed'}
                </Text>
              </View>
            ) : null}
            {todayLabel ? (
              <View style={[styles.statusPill, { backgroundColor: colors.surfaceAlt }]}>
                <Text variant="caption" weight="semibold" tone="muted">
                  🕒 {todayLabel}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })()}

      {/* Full weekly schedule (today highlighted) when structured hours exist. */}
      {business.openingHours ? (
        <Card style={styles.scheduleCard}>
          {weeklySchedule(business.openingHours).map((row) => (
            <View key={row.label} style={styles.scheduleRow}>
              <Text weight={row.today ? 'bold' : 'regular'} tone={row.today ? 'brand' : 'default'}>
                {row.label}
              </Text>
              <Text
                weight={row.today ? 'semibold' : 'regular'}
                tone={row.text === 'Closed' ? 'muted' : 'default'}
              >
                {row.text}
              </Text>
            </View>
          ))}
          {business.openingHours.note ? (
            <Text variant="caption" tone="muted" style={styles.scheduleNote}>
              {business.openingHours.note}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Location — right with the description, and it respects the owner's
          privacy choice */}
      <SectionTitle>Location</SectionTitle>
      <Card>
        <Text weight="medium">📍 {locationSummary(business.location)}</Text>
        {business.location.isHome ? (
          <Text variant="caption" tone="muted" style={styles.locNote}>
            {showPrecise
              ? 'Home-based business'
              : 'Runs from home — exact address hidden by the owner'}
          </Text>
        ) : null}
        {business.type === 'rental' && business.location.point
          ? places.map((p) => {
              const km = formatDistance(haversineKm(business.location.point!, p.point));
              if (!km) return null;
              return (
                <Text key={p.id} variant="caption" tone="muted" style={styles.locNote}>
                  {PLACE_ICONS[p.kind]} {km} from{' '}
                  {p.kind === 'current' ? 'your current location' : p.label}
                </Text>
              );
            })
          : null}
        {/* Directions — opens the exact spot with a blue route from where you
            are now, Google-Maps style. Only when the owner shares a precise pin. */}
        {hasShowableCoordinates(business.location) ? (
          <Button
            title="🧭 Get directions"
            variant="secondary"
            onPress={() => router.push(`/directions/${business.id}`)}
            style={styles.directionsBtn}
          />
        ) : null}
      </Card>

      {/* Work showcase — the business's portfolio of past work */}
      {(business.portfolio?.length ?? 0) > 0 || isMember ? (
        <>
          <SectionTitle>Work showcase</SectionTitle>
          {(business.portfolio?.length ?? 0) > 0 ? (
            <PortfolioGallery items={business.portfolio!} />
          ) : (
            <Text variant="label" tone="muted">
              Show customers your past work — photos and videos appear here.
            </Text>
          )}
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

      {/* Everything the viewer ever ordered here, paid or not — sits directly
          above the menu, where someone reordering looks first. */}
      {myOrders.length > 0 ? (
        <Card onPress={() => router.push(`/orders/${business.id}`)} style={styles.ordersCard}>
          <View style={styles.menuRow}>
            <Text style={styles.menuIcon}>📦</Text>
            <View style={styles.menuInfo}>
              <Text weight="semibold">
                My {vocab.requestNoun}s
              </Text>
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

      {/* Menu — for cafes, restaurants, bakeries. Not a dropdown on this page
          any more: it's a full screen of its own (photos, veg dots, ADD
          buttons), because browsing a menu IS the ordering flow. */}
      {hasMenu ? (
        <Card onPress={() => router.push(`/menu/${business.id}`)}>
          <View style={styles.menuRow}>
            <Text style={styles.menuIcon}>📖</Text>
            <View style={styles.menuInfo}>
              <Text weight="semibold">View menu &amp; order</Text>
              <Text variant="caption" tone="muted">
                {business.menu!.length} dish{business.menu!.length === 1 ? '' : 'es'}
              </Text>
            </View>
            <Text tone="muted">›</Text>
          </View>
        </Card>
      ) : null}

      {/* A personal stall shows its items picture-first, exactly like the
          Stalls feed — every tile is tappable and opens that item's own page
          (photos + the public questions/offers chat). Other businesses (a tyre
          range, hardware stock) keep the collapsed, category-grouped list. */}
      {business.type === 'item' && business.products && business.products.length > 0 ? (
        <>
          <SectionTitle>Items for sale</SectionTitle>
          <View style={styles.stallGrid}>
            {business.products.map((p) => (
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
                    onPress: () =>
                      p.id ? router.push(`/product/${business.id}/${p.id}`) : undefined,
                  }}
                />
              </View>
            ))}
          </View>
        </>
      ) : business.products && business.products.length > 0 ? (
        <>
          <SectionTitle>Products</SectionTitle>
          <CatalogAccordion
            items={business.products.map((p) => ({
              name: p.name,
              price: p.price,
              description: p.description,
              category: getSubcategory('item', p.subcategoryId)?.name,
            }))}
            label="products"
            icon="🛍️"
          />
        </>
      ) : null}

      {/* For rent — each thing with its price on the business's rental basis */}
      {business.rentals && business.rentals.length > 0 ? (
        <>
          <SectionTitle>🔑 For rent{rentalBasisLabel(business.rentalBasis) ? ` · ${rentalBasisLabel(business.rentalBasis)!.toLowerCase()}` : ''}</SectionTitle>
          <Card>
            {business.rentals.map((item, i) => (
              <View
                key={`${item.name}-${i}`}
                style={[
                  styles.menuRow,
                  i < business.rentals!.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View style={styles.menuInfo}>
                  <Text weight="medium">{item.name}</Text>
                  {getSubcategory('rental', item.subcategoryId) || item.description ? (
                    <Text variant="caption" tone="muted">
                      {[getSubcategory('rental', item.subcategoryId)?.name, item.description]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  ) : null}
                </View>
                {item.price ? (
                  <Text weight="semibold" tone="brand">
                    {item.price}
                  </Text>
                ) : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {/* Party packages — birthdays, functions… quoted & negotiated via the
          order flow ("🎉 Plan a party" in the actions below) */}
      {business.partyPackages && business.partyPackages.length > 0 ? (
        <>
          <SectionTitle>🎉 Party packages</SectionTitle>
          <Card>
            {business.partyPackages.map((pkg, i) => (
              <View
                key={`${pkg.name}-${i}`}
                style={[
                  styles.menuRow,
                  i < business.partyPackages!.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View style={styles.menuInfo}>
                  <Text weight="medium">{pkg.name}</Text>
                  {pkg.description ? (
                    <Text variant="caption" tone="muted">
                      {pkg.description}
                    </Text>
                  ) : null}
                </View>
                {pkg.price ? (
                  <Text weight="semibold" tone="brand">
                    {pkg.price}
                  </Text>
                ) : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {/* Services & prices — for service providers; each is bookable. Collapsed
          behind a "View services" bar to match the menu and products. */}
      {business.services && business.services.length > 0 ? (
        <>
          <SectionTitle>Services &amp; prices</SectionTitle>
          <CatalogAccordion items={business.services} label="services" icon="🛠️" />
        </>
      ) : null}

      {/* Ratings & reviews — verified customers only (fraud-proof by design) */}
      <SectionTitle>Ratings &amp; reviews</SectionTitle>
      <Card>
        <View style={styles.reviewSummary}>
          <Stars rating={business.ratingAvg} count={business.ratingCount} size={16} />
        </View>
        <Text variant="caption" tone="muted" style={styles.reviewNote}>
          🛡️ Ratings come only from verified customers — people with an order,
          booking, or bill from this business.
        </Text>
        {reviews.slice(0, 5).map((r) => (
          <View
            key={r.id}
            style={[styles.reviewRow, { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <View style={styles.reviewHead}>
              <Text weight="semibold" style={styles.reviewName} numberOfLines={1}>
                {r.customerName}
              </Text>
              <Text style={{ color: colors.star }}>
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </Text>
            </View>
            {r.comment ? (
              <Text variant="label" tone="muted" style={styles.reviewComment}>
                {r.comment}
              </Text>
            ) : null}
          </View>
        ))}
        {reviews.length === 0 ? (
          <Text variant="label" tone="muted" style={styles.reviewEmpty}>
            No written reviews yet — be the first verified customer to rate.
          </Text>
        ) : null}
        {!isOwner ? (
          <Button
            title={myReview ? '✏️ Edit your rating' : '⭐ Rate this business'}
            variant="secondary"
            onPress={() =>
              currentUser ? router.push(`/review/${business.id}`) : router.push('/sign-in')
            }
            style={styles.reviewBtn}
          />
        ) : null}
      </Card>

      {/* Contact: track + order + book (services) + call + chat */}
      <View style={styles.actions}>
        {myTrackedItems.length > 0 && hasModule(business, 'tracking') ? (
          <Button
            title={trackLabel(myTrackedItems)}
            onPress={() => router.push(`/track/${business.id}`)}
            style={styles.bookBtn}
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
              currentUser ? router.push(`/enroll/${business.id}`) : router.push('/sign-in')
            }
            style={styles.bookBtn}
          />
        ) : null}
        {/* Ordering, parties and appointments only show when the business
            runs that workspace module — otherwise requests would land nowhere.
            With a menu, ordering starts on the menu screen; everything else
            keeps the pick-from-a-list order form. A membership business's order
            button stays a plain "Order" (for one-off goods) — enrolling is the
            separate button above. */}
        {hasCatalog(business) && hasModule(business, 'orders') ? (
          <Button
            title={orderAction}
            onPress={() =>
              router.push(hasMenu ? `/menu/${business.id}` : `/order/new/${business.id}`)
            }
            style={styles.bookBtn}
          />
        ) : null}
        {/* A confirmed dine-in tab is still open — go straight back to the menu
            to add another round to it. */}
        {openTab && hasMenu ? (
          <Button
            title="🍽️ Continue my order"
            variant="secondary"
            onPress={() => router.push(`/menu/${business.id}`)}
            style={styles.bookBtn}
          />
        ) : null}
        {hasModule(business, 'orders') &&
        (offersDineIn(business) || (business.partyPackages?.length ?? 0) > 0) ? (
          <Button
            title="🎉 Plan a party"
            variant="secondary"
            onPress={() => router.push(`/party/${business.id}`)}
            style={styles.bookBtn}
          />
        ) : null}
        {/* Bookable when it's a service provider OR lists services (a tyre
            shop that fits tyres) — and runs the bookings module. */}
        {(business.type === 'service' || (business.services?.length ?? 0) > 0) &&
        hasModule(business, 'bookings') ? (
          <Button
            title="📅 Book an appointment"
            onPress={() => router.push(`/book/${business.id}`)}
            style={styles.bookBtn}
          />
        ) : null}
        <View style={styles.contactRow}>
          <Button
            title="📞 Call"
            variant={business.type === 'service' || hasCatalog(business) ? 'secondary' : 'primary'}
            onPress={() => router.push(`/call/${business.id}`)}
            style={styles.contactBtn}
          />
          <Button
            title="💬 Chat"
            variant="secondary"
            onPress={() => router.push(`/chat/${business.id}`)}
            style={styles.contactBtn}
          />
        </View>
        {isOwner && business.type === 'item' ? (
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
        {isOwner && business.type !== 'item' ? (
          <Button
            title="✏️ Edit business page"
            onPress={() => router.push(`/manage/${business.id}`)}
            style={styles.manageBtn}
          />
        ) : null}
        <Button
          title="🔳 QR code & share link"
          variant="secondary"
          onPress={() => router.push(`/qr/${business.id}`)}
          style={styles.manageBtn}
        />
        {isMember ? (
          <Button
            title="🏢 Business workspace"
            variant="secondary"
            onPress={() => router.push(`/workspace/${business.id}`)}
            style={styles.manageBtn}
          />
        ) : null}
      </View>

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

      {/* Team, last and folded away: customers come here to order, not to read
          the staff list. Owner → managers → featured staff (under their
          designation). */}
      <Card style={styles.teamCard} padded={false}>
        <Pressable
          onPress={() => setTeamOpen((v) => !v)}
          style={styles.teamBar}
          accessibilityRole="button"
          accessibilityState={{ expanded: teamOpen }}
          accessibilityLabel={`Team, ${visibleTeamCount} ${visibleTeamCount === 1 ? 'person' : 'people'}`}
        >
          <Text style={styles.menuIcon}>👥</Text>
          <View style={styles.menuInfo}>
            <Text weight="semibold">Team</Text>
            <Text variant="caption" tone="muted">
              {visibleTeamCount} {visibleTeamCount === 1 ? 'person' : 'people'}
            </Text>
          </View>
          <Text tone="muted">{teamOpen ? '▲' : '▼'}</Text>
        </Pressable>

        {teamOpen ? (
          <View style={styles.teamBody}>
            <Text variant="caption" weight="semibold" tone="muted" style={styles.teamGroup}>
              OWNER
            </Text>
            <Card style={styles.ownerCard}>
              <Text weight="semibold">{owner?.name ?? 'Owner'}</Text>
              <Text variant="caption" tone="muted">
                Owner{isOwner ? ' · that’s you' : ''}
              </Text>
            </Card>

            {managers.length > 0 ? (
              <>
                <Text variant="caption" weight="semibold" tone="muted" style={styles.teamGroup}>
                  MANAGERS
                </Text>
                {managers.map((emp: Employee) => (
                  <EmployeeRow key={emp.id} employee={emp} isPublic={publicByEmployeeId[emp.id]} />
                ))}
              </>
            ) : null}

            {/* Staff are private by default — only members the owner features
                show, each named under their designation. */}
            {staffGroups.map((group) => (
              <Fragment key={group.designation}>
                <Text variant="caption" weight="semibold" tone="muted" style={styles.teamGroup}>
                  {group.designation.toUpperCase()}
                </Text>
                {group.members.map((emp: Employee) => (
                  <EmployeeRow key={emp.id} employee={emp} isPublic={publicByEmployeeId[emp.id]} />
                ))}
              </Fragment>
            ))}
          </View>
        ) : null}
      </Card>
    </Screen>
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
    <Text variant="subheading" weight="semibold" style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  scheduleCard: { marginBottom: spacing.lg, gap: spacing.xs },
  scheduleRow: { flexDirection: 'row', justifyContent: 'space-between' },
  scheduleNote: { marginTop: spacing.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  name: { marginBottom: spacing.xs },
  provider: { marginBottom: spacing.xs },
  tagline: { marginBottom: spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg },
  description: { marginBottom: spacing.lg },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.md },
  locNote: { marginTop: spacing.xs },
  directionsBtn: { marginTop: spacing.md },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  menuInfo: { flex: 1 },
  menuIcon: { fontSize: 22 },
  ordersCard: { marginBottom: spacing.sm },
  stallGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md },
  stallCell: { width: '48%' },
  teamCard: { marginTop: spacing.lg },
  teamBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  teamBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  teamGroup: { letterSpacing: 1, marginTop: spacing.md, marginBottom: spacing.sm },
  reviewSummary: { marginBottom: spacing.sm },
  reviewNote: { marginBottom: spacing.md },
  reviewRow: { paddingVertical: spacing.md },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  reviewName: { flexShrink: 1 },
  reviewComment: { marginTop: spacing.xs },
  reviewEmpty: { marginBottom: spacing.md },
  reviewBtn: { marginTop: spacing.sm },
  showcaseBtn: { marginTop: spacing.md },
  ownerCard: { marginBottom: spacing.sm },
  actions: { marginTop: spacing.xl },
  bookBtn: { marginBottom: spacing.md },
  contactRow: { flexDirection: 'row', gap: spacing.md },
  contactBtn: { flex: 1 },
  manageBtn: { marginTop: spacing.md },
  adminCard: { marginTop: spacing.lg },
  adminSub: { marginTop: spacing.xs },
  adminOpenBtn: { marginTop: spacing.md },
  adminButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  adminBtn: { flex: 1 },
  adminBtnWide: { flex: 2 },
});
