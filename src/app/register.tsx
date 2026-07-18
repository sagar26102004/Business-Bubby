/**
 * List yourself on Localo — a step-by-step wizard (one question per screen,
 * like setting up a dating profile) instead of one long form.
 *
 * There are NO business categories to pick. The only fork is the first
 * question — "a business" vs "selling my own stuff" (personal stall).
 * Businesses describe themselves with TAGS and answer plain capability
 * questions (sell things? offer services? rent anything out?); the internal
 * `ListingType` is DERIVED from those answers (rents only → rental,
 * sells/food-tagged → shop, services only → service) — owners never see it.
 *
 *   business: kind → tags → basics → sell? → services? → rent? → modules → location → team → review
 *   stall:    kind → category → basics → location (first item only) → review
 *
 * "?" steps are Yes/No questions — answering "No" skips ahead, "Yes" reveals
 * the editor. Items still fold into the user's PERSONAL STALL (one 'item'
 * listing per user; the first item creates it).
 *
 * The "modules" step is the workspace opt-in (domain/modules.ts): the owner
 * picks the tools they'll manage the business with, pre-selected from their
 * earlier answers. Stalls skip it — a stall keeps the default workspace.
 *
 * The location step works like a delivery app: pin on a map (LocationPicker,
 * default = current location) + free-text address/city/state. Businesses that
 * don't sell goods or rent things are also asked "Do you have an office?" —
 * brokers/agents do, plumbers travel (kind: 'office' vs 'service_area',
 * which drives "Serves <area>" display).
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  RENTAL_BASES,
  VEHICLE_KINDS,
  defaultStallName,
  getSubcategory,
  getType,
  getVehicleKind,
  rentalBasisLabel,
} from '@/domain/catalog';
import { COUNTRIES, STATE_NAMES, citiesForState, stateForCity } from '@/domain/geoCatalog';
import { SUGGESTED_BUSINESS_TAGS, hasTag, isFoodShop } from '@/domain/tags';
import {
  AVAILABLE_MODULES,
  COMING_SOON_MODULES,
  getModule,
  suggestModules,
  type ModuleId,
} from '@/domain/modules';
import type {
  GeoPoint,
  ListingType,
  LocationKind,
  MenuItem,
  RentalBasis,
  RentalItem,
  ServiceItem,
  VehicleKind,
} from '@/domain/types';
import type { NewBusinessInput, NewEmployeeInput } from '@/data/repositories';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
import { useAsync } from '@/lib/useAsync';
import { AutocompleteInput, Button, Card, Input, Screen, Tag, Text } from '@/components/ui';
import { EmployeeEditor } from '@/features/businesses/EmployeeEditor';
import { FoodMenuEditor } from '@/features/businesses/FoodMenuEditor';
import { LocationPicker } from '@/features/businesses/LocationPicker';
import { OfferingsEditor } from '@/features/businesses/OfferingsEditor';
import { TagPicker } from '@/features/businesses/TagPicker';
import { PhotosField } from '@/features/media/PhotosField';
import { radius, spacing, useColors } from '@/theme/theme';

/** The only fork in the wizard — who is listing. */
type ListingKind = 'business' | 'stall';

const KIND_OPTIONS: { id: ListingKind; icon: string; title: string; blurb: string }[] = [
  {
    id: 'business',
    icon: '🏢',
    title: 'A business',
    blurb: 'A shop, food place, services, rentals — anything with customers.',
  },
  {
    id: 'stall',
    icon: '🏷️',
    title: 'Selling my own stuff',
    blurb: 'Personal items in one stall — a phone, a car, furniture…',
  },
];

type StepId =
  | 'kind'
  | 'category'
  | 'basics'
  | 'sell'
  | 'services'
  | 'rent'
  | 'modules'
  | 'location'
  | 'team'
  | 'review';

/** Tri-state answer to a Yes/No step: unanswered until the user picks. */
type Choice = 'yes' | 'no' | null;

/** A fleet vehicle staged on the modules step, created right after publish. */
interface VehicleDraft {
  registrationNumber: string;
  kind: VehicleKind;
  /** Optional pet name, e.g. "Bus 1 — morning route". */
  petName?: string;
}

export default function RegisterScreen() {
  const repos = useRepositories();
  const { currentUser, isGuest } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [stepIndex, setStepIndex] = useState(0);

  const [kind, setKind] = useState<ListingKind>('business');
  const [kindChosen, setKindChosen] = useState(false);
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  // Stall items pick ONE category (stall browsing runs on it); businesses
  // carry many TAGS — what they offer, not a box they're forced into.
  const [subcategoryId, setSubcategoryId] = useState<string | undefined>();
  const [tags, setTags] = useState<string[]>([]);
  const [priceLabel, setPriceLabel] = useState('');
  // Stall items only — the photos buyers swipe through; the first is the cover.
  const [images, setImages] = useState<string[]>([]);
  // One "what do you sell" list — publishes as a MENU for food-tagged
  // businesses and as a PRODUCT catalog for everyone else.
  const [sellItems, setSellItems] = useState<MenuItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [rentalBasis, setRentalBasis] = useState<RentalBasis | undefined>();
  const [rentalItems, setRentalItems] = useState<RentalItem[]>([]);
  // Fleet vehicles staged on the modules step (tracking module), created
  // right after the business itself.
  const [vehicleDrafts, setVehicleDrafts] = useState<VehicleDraft[]>([]);

  // Workspace tools — null until the owner touches the picker, so the
  // pre-selection keeps following their earlier answers (see suggestModules).
  const [modules, setModules] = useState<ModuleId[] | null>(null);

  const [sellChoice, setSellChoice] = useState<Choice>(null);
  const [servicesChoice, setServicesChoice] = useState<Choice>(null);
  const [rentChoice, setRentChoice] = useState<Choice>(null);
  const [teamChoice, setTeamChoice] = useState<Choice>(null);

  // Only businesses that don't sell goods or rent get the office question:
  // insurance agents/brokers have an office, plumbers travel.
  const [hasOffice, setHasOffice] = useState<Choice>(null);
  // The map pin — set delivery-app style on the LocationPicker.
  const [point, setPoint] = useState<GeoPoint | undefined>();
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('India');

  const [employees, setEmployees] = useState<NewEmployeeInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Why: a silently disabled Next button reads as broken. Next stays tappable
  // and tapping it while a step is incomplete explains exactly what's missing.
  const [stepError, setStepError] = useState<string | null>(null);

  const isItem = kind === 'stall';
  const itemSubcategories = useMemo(() => getType('item')?.subcategories ?? [], []);

  // Personal stall: items don't become standalone listings — they're added as
  // products of the user's single stall (created with their first item).
  const { data: myStall } = useAsync(
    async () => (currentUser ? repos.businesses.getStallForOwner(currentUser.id) : null),
    [currentUser?.id],
  );
  const stallName =
    myStall?.name ?? (currentUser ? defaultStallName(currentUser.name) : 'your personal stall');
  // An existing stall already has a location — don't ask again.
  const addingToStall = isItem && !!myStall;

  const stepIds = useMemo<StepId[]>(() => {
    if (isItem) {
      return addingToStall
        ? ['kind', 'category', 'basics', 'review']
        : ['kind', 'category', 'basics', 'location', 'review'];
    }
    return ['kind', 'category', 'basics', 'sell', 'services', 'rent', 'modules', 'location', 'team', 'review'];
  }, [isItem, addingToStall]);

  const safeIndex = Math.min(stepIndex, stepIds.length - 1);
  const step = stepIds[safeIndex];
  const isLastStep = step === 'review';

  // What the answers add up to. Owners never pick this — the capability
  // questions decide it: rents only → rental; sells or food-tagged → shop;
  // services only → service; a bare page defaults to shop (a storefront).
  const sells = sellChoice === 'yes' && sellItems.length > 0;
  const serves = servicesChoice === 'yes' && services.length > 0;
  const rents = rentChoice === 'yes';
  const derivedType: ListingType = isItem
    ? 'item'
    : rents && !sells && !serves
      ? 'rental'
      : !sells && serves && !isFoodShop(tags)
        ? 'service'
        : 'shop';

  // Ask about an office only when there's no shopfront implied by the answers.
  const askOffice = !isItem && sellChoice !== 'yes' && rentChoice !== 'yes';

  const chooseKind = (next: ListingKind) => {
    setKind(next);
    setKindChosen(true);
    setStepError(null);
    setStepIndex(1);
  };

  // "/register?type=item" (e.g. the stall's Add-an-item button) lands
  // straight on the stall flow; any other preset goes to the business flow.
  const params = useLocalSearchParams<{ type?: string }>();
  useEffect(() => {
    if (params.type && !kindChosen) chooseKind(params.type === 'item' ? 'stall' : 'business');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stepValid = (id: StepId): boolean => {
    switch (id) {
      case 'kind':
        return kindChosen;
      case 'category':
        return isItem ? !!subcategoryId : tags.length > 0;
      case 'basics':
        return name.trim().length > 1;
      case 'sell':
        return sellChoice !== null;
      case 'services':
        return servicesChoice !== null;
      case 'rent':
        return (
          rentChoice !== null &&
          (rentChoice !== 'yes' || (!!rentalBasis && rentalItems.length > 0))
        );
      case 'team':
        return teamChoice !== null;
      case 'location':
        return !askOffice || hasOffice !== null;
      default:
        return true;
    }
  };

  /** What to tell the user when they hit Next on an incomplete step. */
  const missingFor = (id: StepId): string => {
    switch (id) {
      case 'kind':
        return 'Tap one of the options to continue.';
      case 'category':
        return isItem
          ? 'Pick a category to continue.'
          : 'Add at least one tag so customers can find you.';
      case 'basics':
        return isItem
          ? 'Give your item a name (at least 2 characters) to continue.'
          : 'Add a name (at least 2 characters) to continue.';
      case 'rent':
        if (rentChoice !== 'yes') return 'Choose Yes or No to continue.';
        if (!rentalBasis) return 'Also pick per day or per month below.';
        return 'Add at least one thing you rent out (tap “Add rental” after typing it).';
      case 'team':
        return 'Choose “I have a team” or “Just me” to continue.';
      case 'location':
        return 'Tell us if you have an office to continue.';
      case 'sell':
      case 'services':
        return 'Choose Yes or No to continue.';
      default:
        return '';
    }
  };

  const goNext = () => {
    setStepError(null);
    setStepIndex((i) => Math.min(i + 1, stepIds.length - 1));
  };
  const goBack = () => {
    setStepError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  };
  const handleNext = () => {
    if (!stepValid(step)) {
      setStepError(missingFor(step));
      return;
    }
    goNext();
  };

  // Item category picks always SELECT (no tap-again-to-deselect — that left
  // Next silently disabled) and advance on their own once the step is done.
  const pickSubcategory = (id: string) => {
    setSubcategoryId(id);
    goNext();
  };
  const jumpTo = (id: StepId) => {
    const i = stepIds.indexOf(id);
    if (i >= 0) {
      setStepError(null);
      setStepIndex(i);
    }
  };

  /**
   * Answer a Yes/No step. "No" moves straight on; anything already typed is
   * kept (in case they come back) but excluded from the published listing.
   */
  const answer = (set: (c: Choice) => void) => (choice: Choice) => {
    set(choice);
    if (choice === 'no') goNext();
  };

  // Pre-selected workspace tools, following the answers so far; the picker
  // shows these until the owner changes something, then their set wins.
  const suggestedModules = useMemo(
    () =>
      suggestModules({
        type: derivedType,
        tags,
        hasProducts: sells && !isFoodShop(tags),
        hasServices: serves,
        hasMenu: sells && isFoodShop(tags),
      }),
    [derivedType, tags, sells, serves],
  );
  const chosenModules = modules ?? suggestedModules;
  const toggleModule = (id: ModuleId) => {
    setModules(
      chosenModules.includes(id)
        ? chosenModules.filter((m) => m !== id)
        : [...chosenModules, id],
    );
  };

  const canSubmit =
    name.trim().length > 1 &&
    (isItem ? !!subcategoryId : tags.length > 0) &&
    (rentChoice === 'yes' ? !!rentalBasis : true) &&
    !submitting;

  const submit = async () => {
    if (!currentUser) {
      router.push('/sign-in');
      return;
    }
    if (!canSubmit) {
      // Jump straight to the incomplete step and say what's missing —
      // Alert.alert is a no-op on web, so inline feedback is the only kind
      // guaranteed to show everywhere.
      const target: StepId = name.trim().length <= 1 ? 'basics' : 'category';
      jumpTo(target);
      setStepError(missingFor(target));
      return;
    }

    const locationKind: LocationKind =
      derivedType === 'service' && hasOffice !== 'yes' ? 'service_area' : 'office';
    const location = {
      kind: locationKind,
      isHome: false,
      hidePreciseLocation: false,
      addressLine: addressLine.trim() || undefined,
      city: city.trim() || undefined,
      region: region.trim() || undefined,
      country: country.trim() || undefined,
      point,
    };

    const input: NewBusinessInput = isItem
      ? {
          // The listing is the user's personal stall; the item itself rides
          // along as a product. The repository appends to an existing stall.
          name: myStall?.name ?? defaultStallName(currentUser.name),
          tagline: 'Personal items for sale',
          type: 'item',
          products: [
            {
              name: name.trim(),
              price:
                parsePrice(priceLabel) !== undefined
                  ? formatMoney(parsePrice(priceLabel)!)
                  : undefined,
              description: description.trim() || undefined,
              images: images.length > 0 ? images : undefined,
              subcategoryId,
            },
          ],
          location,
          employees: [],
        }
      : (() => {
          // Food-tagged businesses publish their items as a MENU; everyone
          // else's items are a PRODUCT catalog — one question, two shapes.
          const foodShop = isFoodShop(tags);
          const items = sellChoice === 'yes' && sellItems.length > 0 ? sellItems : undefined;
          return {
            name: name.trim(),
            tagline: tagline.trim() || undefined,
            description: description.trim() || undefined,
            type: derivedType,
            // Tags drive discovery; a matching classic subcategory (Cafe →
            // cafe) is derived for anything still keyed on it.
            subcategoryId: getType(derivedType)?.subcategories.find((s) => hasTag(tags, s.name))?.id,
            tags: tags.length > 0 ? tags : undefined,
            menu: foodShop ? items : undefined,
            products: !foodShop ? items : undefined,
            services:
              servicesChoice !== 'no' && services.length > 0 ? services : undefined,
            rentalBasis: rentChoice === 'yes' ? rentalBasis : undefined,
            rentals:
              rentChoice === 'yes' && rentalItems.length > 0 ? rentalItems : undefined,
            modules: chosenModules,
            location,
            employees: teamChoice === 'no' ? [] : employees,
          };
        })();

    setSubmitting(true);
    try {
      const created = await repos.businesses.create(input, currentUser.id);
      // Vehicles staged on the modules step become the new fleet. Drivers are
      // pinned later in Fleet & tracking (employees don't exist until now).
      if (!isItem && chosenModules.includes('tracking')) {
        for (const draft of vehicleDrafts) {
          await repos.tracking.addVehicle({
            businessId: created.id,
            name: draft.petName?.trim() || undefined,
            registrationNumber: draft.registrationNumber,
            kind: draft.kind,
          });
        }
      }
      resetForm();
      // Replace the wizard in history so Back from the new listing's page
      // returns to My Business, not into the emptied form.
      router.replace(`/business/${created.id}`);
    } catch (err) {
      setStepError(
        `Could not list business — ${err instanceof Error ? err.message : 'try again.'}`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStepIndex(0);
    setKind('business');
    setKindChosen(false);
    setName('');
    setTagline('');
    setDescription('');
    setSubcategoryId(undefined);
    setTags([]);
    setPriceLabel('');
    setSellItems([]);
    setServices([]);
    setRentalBasis(undefined);
    setRentalItems([]);
    setVehicleDrafts([]);
    setModules(null);
    setSellChoice(null);
    setServicesChoice(null);
    setRentChoice(null);
    setTeamChoice(null);
    setHasOffice(null);
    setPoint(undefined);
    setAddressLine('');
    setCity('');
    setRegion('');
    setCountry('India');
    setEmployees([]);
  };

  const heading = (): { title: string; subtitle?: string } => {
    switch (step) {
      case 'kind':
        return {
          title: 'What are you listing?',
          subtitle: 'Just this one question — no categories to figure out.',
        };
      case 'category':
        if (isItem) {
          return {
            title: 'What kind of item is it?',
            subtitle: 'Pick the closest match so people nearby can find you.',
          };
        }
        return {
          title: 'How will customers find you?',
          subtitle:
            'Add tags for everything you do — a tyre dealer is “Tyres” + “Wheel alignment” + “Vehicle service”. More tags, easier to find.',
        };
      case 'basics':
        return {
          title: isItem ? 'Describe your item' : 'Tell customers about it',
          subtitle: isItem
            ? 'A clear name and price help it sell faster.'
            : 'A name is required — everything else can be added later.',
        };
      case 'sell':
        return isFoodShop(tags)
          ? {
              title: 'Do you serve food or drinks?',
              subtitle:
                'Build your menu from the ready-made sections — Soups, Main Course, Beverages. Customers browse it on your page and order from it.',
            }
          : {
              title: 'Do you sell any products?',
              subtitle: 'Everything you stock — customers pick from this list when they order.',
            };
      case 'services':
        return {
          title: 'Do you offer services?',
          subtitle:
            'A tyre shop fits tyres; an electronics shop repairs — list each with a price so customers can book and order.',
        };
      case 'rent':
        return {
          title: 'Do you rent anything out?',
          subtitle:
            'Flats, vehicles, equipment, costumes — list each thing with its price, per day or per month.',
        };
      case 'modules':
        return {
          title: 'Set up your workspace',
          subtitle:
            'Pick the tools you’ll run the business with — we’ve pre-selected some from your answers. Change anytime in Manage.',
        };
      case 'location':
        return {
          title: 'Where do you operate?',
          subtitle: 'Set your pin like in a delivery app, then write the address your way.',
        };
      case 'team':
        return {
          title: 'Just you, or a team?',
          subtitle: 'Add employees now or anytime later in Manage.',
        };
      case 'review':
        return {
          title: 'Ready to publish?',
          subtitle: 'Check everything looks right — tap a row to change it.',
        };
    }
  };

  const { title, subtitle } = heading();

  const renderStep = () => {
    switch (step) {
      case 'kind':
        return (
          <View style={styles.optionList}>
            {KIND_OPTIONS.map((o) => (
              <Card
                key={o.id}
                onPress={() => chooseKind(o.id)}
                style={kindChosen && kind === o.id ? { borderColor: colors.brand, borderWidth: 1.5 } : undefined}
              >
                <View style={styles.typeRow}>
                  <Text style={styles.typeIcon}>{o.icon}</Text>
                  <View style={styles.typeInfo}>
                    <Text weight="semibold">{o.title}</Text>
                    <Text variant="caption" tone="muted">
                      {o.blurb}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        );

      case 'category':
        return (
          <>
            {isItem ? (
              <Card style={styles.banner}>
                <Text weight="semibold">
                  🏷️ {myStall ? `Goes into ${myStall.name}` : `We’ll set up ${stallName} for you`}
                </Text>
                <Text variant="caption" tone="muted">
                  {myStall
                    ? 'Everything you sell lives in your personal stall — this item will be listed there alongside the rest.'
                    : 'Everything you sell lives in one personal stall named after you (rename it anytime in Manage). Buyers browse the stall and find each item inside it.'}
                </Text>
              </Card>
            ) : null}

            {isItem ? (
              <View style={styles.pillRow}>
                {itemSubcategories.map((s) => (
                  <Tag
                    key={s.id}
                    label={s.name}
                    icon={s.icon}
                    selected={subcategoryId === s.id}
                    onPress={() => pickSubcategory(s.id)}
                    style={styles.pill}
                  />
                ))}
              </View>
            ) : (
              <TagPicker value={tags} onChange={setTags} suggestions={SUGGESTED_BUSINESS_TAGS} />
            )}

            {!stepValid('category') ? (
              <Text variant="caption" tone="muted">
                {isItem ? 'Tap a category to continue.' : 'Add at least one tag to continue.'}
              </Text>
            ) : null}
          </>
        );

      case 'basics':
        return (
          <>
            <Input
              label={isItem ? 'Item name' : 'Business name'}
              placeholder={isItem ? 'What are you selling? e.g. iPhone 15 Pro' : 'e.g. Sparks Electrical, Meera’s Cafe'}
              value={name}
              onChangeText={setName}
            />
            {!isItem ? (
              <Input
                label="Tagline (optional)"
                placeholder="One line about what you offer"
                value={tagline}
                onChangeText={setTagline}
              />
            ) : null}
            {/* Only stall items carry a price here — a business prices its
                menu / products / services / rentals on their own steps. */}
            {isItem ? (
              <>
                <Input
                  label="Asking price (optional)"
                  placeholder="e.g. 720"
                  value={priceLabel}
                  onChangeText={(t) => setPriceLabel(sanitizePriceInput(t))}
                  keyboardType="numeric"
                />
                {/* Stalls are browsed picture-first — an item with photos is
                    what buyers actually stop on, and swipe through. */}
                <PhotosField
                  label="Photos of the item (optional)"
                  value={images}
                  onChange={setImages}
                />
              </>
            ) : null}
            <Input
              label="Description (optional)"
              placeholder="Tell customers more…"
              value={description}
              onChangeText={setDescription}
              multiline
              style={styles.multiline}
            />
          </>
        );

      case 'sell': {
        const foodShop = isFoodShop(tags);
        return (
          <>
            <YesNoRow
              value={sellChoice}
              yesLabel={foodShop ? 'Yes, add my menu' : 'Yes, I sell products'}
              noLabel={foodShop ? 'No menu' : 'No products'}
              onPick={answer(setSellChoice)}
            />
            {sellChoice === 'yes' ? (
              foodShop ? (
                // Food menus use the prebuilt library (Soups, Main Course,
                // Beverages › Tea…) — no section is invented or typed.
                <FoodMenuEditor value={sellItems} onChange={setSellItems} />
              ) : (
                <OfferingsEditor
                  value={sellItems}
                  onChange={setSellItems}
                  namePlaceholder="Product (e.g. Touring tyre 205/55 R16)"
                  addLabel="Add item"
                />
              )
            ) : null}
          </>
        );
      }

      case 'services':
        return (
          <>
            <YesNoRow
              value={servicesChoice}
              yesLabel="Yes, I offer services"
              noLabel="No services"
              onPick={answer(setServicesChoice)}
            />
            {servicesChoice === 'yes' ? (
              <OfferingsEditor
                value={services}
                onChange={setServices}
                namePlaceholder="Service (e.g. Wheel alignment)"
                addLabel="Add service"
              />
            ) : null}
          </>
        );

      case 'rent':
        return (
          <>
            <YesNoRow
              value={rentChoice}
              yesLabel="Yes, I rent things out"
              noLabel="Nothing for rent"
              yesIcon="🔑"
              onPick={answer(setRentChoice)}
            />
            {rentChoice === 'yes' ? (
              <>
                <Text variant="label" weight="semibold" style={styles.sectionLabel}>
                  Rented out per day or per month?
                </Text>
                <Text variant="caption" tone="muted" style={styles.hint}>
                  Pick “Day or month” if you offer both — you won’t need to list it again.
                </Text>
                <View style={styles.pillRow}>
                  {RENTAL_BASES.map((b) => (
                    <Tag
                      key={b.id}
                      label={b.label}
                      icon={b.icon}
                      selected={rentalBasis === b.id}
                      onPress={() => setRentalBasis(b.id)}
                      style={styles.pill}
                    />
                  ))}
                </View>

                <Text variant="label" weight="semibold" style={styles.sectionLabel}>
                  What do you rent out?
                </Text>
                <Text variant="caption" tone="muted" style={styles.hint}>
                  List each thing with its{rentalBasis === 'monthly' ? ' monthly' : rentalBasis === 'daily' ? ' daily' : ''} price and pick what kind of thing it is.
                </Text>
                <OfferingsEditor
                  value={rentalItems}
                  onChange={setRentalItems}
                  namePlaceholder="e.g. 2BHK flat, Activa 6G, DSLR kit"
                  addLabel="Add rental"
                  categoryOptions={getType('rental')?.subcategories}
                  categoryOptionsLabel="What kind of thing is it?"
                />
              </>
            ) : null}
          </>
        );

      case 'modules':
        return (
          <>
            <Card style={styles.banner}>
              <Text weight="semibold">💬 Chat & 📞 calls are always included</Text>
              <Text variant="caption" tone="muted">
                Every business talks to customers — these tools are extras for running your
                day-to-day operations.
              </Text>
            </Card>
            <View style={styles.optionList}>
              {AVAILABLE_MODULES.map((m) => {
                const selected = chosenModules.includes(m.id);
                return (
                  <Card
                    key={m.id}
                    onPress={() => toggleModule(m.id)}
                    style={selected ? { borderColor: colors.brand, borderWidth: 1.5 } : undefined}
                  >
                    <View style={styles.typeRow}>
                      <Text style={styles.typeIcon}>{m.icon}</Text>
                      <View style={styles.typeInfo}>
                        <Text weight="semibold">{m.label}</Text>
                        <Text variant="caption" tone="muted">
                          {m.description}
                        </Text>
                      </View>
                      <Text weight="bold" tone={selected ? 'brand' : 'muted'} style={styles.moduleTick}>
                        {selected ? '✓' : '+'}
                      </Text>
                    </View>
                  </Card>
                );
              })}
            </View>
            {chosenModules.includes('tracking') ? (
              <>
                <Text variant="label" weight="semibold" style={styles.sectionLabel}>
                  🚌 Your vehicles
                </Text>
                <Text variant="caption" tone="muted" style={styles.hint}>
                  Add each vehicle by its number — pin drivers to them later in Fleet
                  &amp; tracking. You can also skip this and add them there.
                </Text>
                <VehicleDraftEditor value={vehicleDrafts} onChange={setVehicleDrafts} />
              </>
            ) : null}

            <Text variant="label" weight="semibold" style={styles.sectionLabel}>
              Coming soon
            </Text>
            <View style={styles.pillRow}>
              {COMING_SOON_MODULES.map((m) => (
                <Tag key={m.id} label={m.label} icon={m.icon} style={styles.pill} />
              ))}
            </View>
          </>
        );

      case 'location':
        return (
          <>
            {askOffice ? (
              <>
                <Text variant="label" weight="semibold" style={styles.questionLabel}>
                  Do you have an office?
                </Text>
                <YesNoRow
                  value={hasOffice}
                  yesLabel="Yes, we have an office"
                  noLabel="No, I go to customers"
                  yesIcon="🏢"
                  noIcon="🚗"
                  onPick={setHasOffice}
                />
              </>
            ) : null}

            <Text variant="label" weight="semibold" style={styles.questionLabel}>
              {askOffice && hasOffice === 'no'
                ? 'Pin where you’re based'
                : 'Pin your location on the map'}
            </Text>
            <LocationPicker value={point} onChange={setPoint} />

            <Input
              label="Address (optional)"
              placeholder="Shop no., building, street, area — write it your way"
              value={addressLine}
              onChangeText={setAddressLine}
              multiline
              style={styles.addressBox}
            />
            {/* State first — picking it narrows the city suggestions. */}
            <AutocompleteInput
              label="State"
              placeholder="Start typing your state…"
              value={region}
              onChangeText={setRegion}
              options={country.trim().toLowerCase() === 'india' || !country.trim() ? STATE_NAMES : []}
              onSelect={() => setCountry('India')}
            />
            <AutocompleteInput
              label="City"
              placeholder="Start typing your city…"
              value={city}
              onChangeText={setCity}
              options={citiesForState(region)}
              onSelect={(picked) => {
                // Picking a known city fills in its state and country too.
                const state = stateForCity(picked);
                if (state) setRegion(state);
                setCountry('India');
              }}
            />
            <AutocompleteInput
              label="Country"
              placeholder="Country"
              value={country}
              onChangeText={setCountry}
              options={COUNTRIES}
            />
          </>
        );

      case 'team':
        return (
          <>
            <YesNoRow
              value={teamChoice}
              yesLabel="I have a team"
              noLabel="Just me"
              yesIcon="👥"
              noIcon="🙋"
              onPick={answer(setTeamChoice)}
            />
            {teamChoice === 'yes' ? (
              <>
                <Text variant="caption" tone="muted" style={styles.hint}>
                  Add employees by name, or link their account so customers can view their profile.
                </Text>
                <EmployeeEditor value={employees} onChange={setEmployees} />
              </>
            ) : null}
          </>
        );

      case 'review': {
        const rows: { id: StepId; label: string; value: string }[] = [
          {
            id: 'kind',
            label: 'Listing',
            value: isItem ? '🏷️ Personal stall item' : '🏢 Business',
          },
          isItem
            ? {
                id: 'category' as StepId,
                label: 'Category',
                value: getSubcategory('item', subcategoryId)?.name ?? '— pick one',
              }
            : {
                id: 'category' as StepId,
                label: 'Tags',
                value: tags.length > 0 ? tags.join(' · ') : '— add tags',
              },
          { id: 'basics', label: isItem ? 'Item' : 'Name', value: name.trim() || '— add a name' },
        ];
        if (isItem && priceLabel.trim())
          rows.push({ id: 'basics', label: 'Price', value: priceLabel.trim() });
        if (stepIds.includes('sell')) {
          rows.push({
            id: 'sell',
            label: isFoodShop(tags) ? 'Menu' : 'Products',
            value:
              sellChoice !== 'no' && sellItems.length > 0
                ? `${sellItems.length} item${sellItems.length === 1 ? '' : 's'}`
                : 'None',
          });
        }
        if (stepIds.includes('services')) {
          rows.push({
            id: 'services',
            label: 'Services',
            value:
              servicesChoice !== 'no' && services.length > 0 ? `${services.length} listed` : 'None',
          });
        }
        if (stepIds.includes('rent')) {
          rows.push({
            id: 'rent',
            label: 'For rent',
            value:
              rentChoice === 'yes'
                ? [
                    rentalItems.length > 0
                      ? `${rentalItems.length} item${rentalItems.length === 1 ? '' : 's'}`
                      : '— list what you rent',
                    rentalBasisLabel(rentalBasis) ?? '— choose day/month',
                  ].join(' · ')
                : 'Nothing',
          });
        }
        if (stepIds.includes('modules')) {
          rows.push({
            id: 'modules',
            label: 'Workspace',
            value:
              chosenModules.length > 0
                ? chosenModules.map((id) => getModule(id)?.label ?? id).join(' · ')
                : 'Chat & calls only',
          });
          if (chosenModules.includes('tracking') && vehicleDrafts.length > 0) {
            rows.push({
              id: 'modules',
              label: 'Fleet',
              value: `${vehicleDrafts.length} vehicle${vehicleDrafts.length === 1 ? '' : 's'}`,
            });
          }
        }
        rows.push({
          id: stepIds.includes('location') ? 'location' : 'review',
          label: 'Location',
          value: addingToStall
            ? 'From your stall'
            : [
                askOffice
                  ? hasOffice === 'yes'
                    ? '🏢 Office'
                    : '🚗 Goes to customers'
                  : undefined,
                city.trim() || undefined,
                point ? '📍 pin set' : undefined,
              ]
                .filter(Boolean)
                .join(' · ') || '— set your location',
        });
        if (stepIds.includes('team')) {
          rows.push({
            id: 'team',
            label: 'Team',
            value:
              teamChoice !== 'no' && employees.length > 0
                ? `${employees.length} member${employees.length === 1 ? '' : 's'}`
                : 'Just you',
          });
        }

        return (
          <>
            {isGuest ? (
              <Card onPress={() => router.push('/sign-in')} style={styles.banner}>
                <Text weight="semibold">🔒 Sign in to publish</Text>
                <Text variant="caption" tone="muted">
                  Your answers are saved on this screen — sign in and come back to publish.
                </Text>
              </Card>
            ) : null}

            {isItem ? (
              <Card style={styles.banner}>
                <Text weight="semibold">
                  🏷️ {myStall ? `Goes into ${myStall.name}` : `Creates ${stallName}`}
                </Text>
              </Card>
            ) : null}

            <Card>
              {rows.map((row, i) => (
                <Pressable
                  key={`${row.label}-${i}`}
                  onPress={() => jumpTo(row.id)}
                  style={[styles.summaryRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                >
                  <Text variant="caption" tone="muted" style={styles.summaryLabel}>
                    {row.label}
                  </Text>
                  <Text weight="medium" style={styles.summaryValue}>
                    {row.value}
                  </Text>
                  <Text tone="muted">›</Text>
                </Pressable>
              ))}
            </Card>
          </>
        );
      }
    }
  };

  return (
    <Screen padded={false}>
      {/* Step body — keyed by step so navigating always starts at the top.
          The progress header scrolls WITH the body (nothing is pinned up top):
          on long steps like the menu editor a sticky header would eat the
          screen just as the list grows. */}
      <ScrollView
        key={step}
        style={styles.flex}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={[styles.progressTrack, { backgroundColor: colors.surfaceAlt }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: colors.accent, width: `${((safeIndex + 1) / stepIds.length) * 100}%` },
              ]}
            />
          </View>
          <Text variant="caption" tone="muted" style={styles.stepCounter}>
            Step {safeIndex + 1} of {stepIds.length}
          </Text>
          <Text variant="title" weight="bold">
            {title}
          </Text>
          {subtitle ? (
            <Text tone="muted" variant="caption" style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {renderStep()}
      </ScrollView>

      {/* Footer: Back + Next / Publish */}
      <View
        style={[
          styles.footer,
          { borderTopColor: colors.border, paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        {stepError && (isLastStep || !stepValid(step)) ? (
          <Text variant="caption" tone="danger" style={styles.footerError}>
            {stepError}
          </Text>
        ) : null}
        <View style={styles.footerButtons}>
          {safeIndex > 0 ? (
            <Button title="Back" variant="secondary" onPress={goBack} style={styles.backButton} />
          ) : null}
          {isLastStep ? (
            <Button
              title={
                isGuest
                  ? 'Sign in to publish'
                  : isItem
                    ? myStall
                      ? 'Add to my stall'
                      : 'Publish my stall'
                    : 'Publish listing'
              }
              onPress={submit}
              loading={submitting}
              style={styles.nextButton}
            />
          ) : (
            <Button title="Next" onPress={handleNext} style={styles.nextButton} />
          )}
        </View>
      </View>
    </Screen>
  );
}

/**
 * Stage fleet vehicles on the modules step: number plate + what kind it is,
 * with an optional pet name. They're created right after the business is.
 */
function VehicleDraftEditor({
  value,
  onChange,
}: {
  value: VehicleDraft[];
  onChange: (next: VehicleDraft[]) => void;
}) {
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [kind, setKind] = useState<VehicleKind>('car');
  const [petName, setPetName] = useState('');
  // Why: a silently disabled Add button reads as broken — keep it tappable
  // and explain what's missing instead.
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const plate = registrationNumber.trim();
    if (plate.length < 4) {
      setError('Type the vehicle number first — e.g. MP09 AB 1234. Only the pet name is optional.');
      return;
    }
    onChange([...value, { registrationNumber: plate, kind, petName: petName.trim() || undefined }]);
    setRegistrationNumber('');
    setPetName('');
    setError(null);
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <View>
      {value.length > 0 ? (
        <Card style={styles.vehicleList}>
          {value.map((v, i) => (
            <View key={`${v.registrationNumber}-${i}`} style={styles.vehicleRow}>
              <Text style={styles.vehicleIcon}>{getVehicleKind(v.kind).icon}</Text>
              <View style={styles.vehicleInfo}>
                <Text weight="medium">{v.petName || v.registrationNumber}</Text>
                {v.petName ? (
                  <Text variant="caption" tone="muted">
                    {v.registrationNumber}
                  </Text>
                ) : null}
              </View>
              <Text tone="danger" weight="semibold" onPress={() => remove(i)}>
                ✕
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Input
        label="Vehicle number"
        placeholder="e.g. MP09 AB 1234"
        value={registrationNumber}
        onChangeText={(t) => {
          setRegistrationNumber(t);
          if (error) setError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Text variant="label" weight="semibold" style={styles.vehicleKindLabel}>
        What is it?
      </Text>
      <View style={styles.pillRow}>
        {VEHICLE_KINDS.map((k) => (
          <Tag
            key={k.id}
            label={k.name}
            icon={k.icon}
            selected={kind === k.id}
            onPress={() => setKind(k.id)}
            style={styles.pill}
          />
        ))}
      </View>
      <Input
        label="Pet name (optional)"
        placeholder="e.g. Bus 1 — morning route"
        value={petName}
        onChangeText={setPetName}
        onSubmitEditing={add}
      />
      {error ? (
        <Text variant="caption" tone="danger" style={styles.hint}>
          {error}
        </Text>
      ) : null}
      <Button title="Add vehicle" variant="secondary" onPress={add} />
    </View>
  );
}

/** The Yes / No answer cards for optional wizard steps. */
function YesNoRow({
  value,
  yesLabel,
  noLabel,
  yesIcon = '✅',
  noIcon = '➖',
  onPick,
}: {
  value: Choice;
  yesLabel: string;
  noLabel: string;
  yesIcon?: string;
  noIcon?: string;
  onPick: (choice: Choice) => void;
}) {
  const colors = useColors();

  const option = (choice: 'yes' | 'no', icon: string, label: string) => {
    const selected = value === choice;
    return (
      <Pressable
        onPress={() => onPick(choice)}
        style={[
          styles.choiceCard,
          {
            backgroundColor: selected ? colors.brandSoft : colors.surface,
            borderColor: selected ? colors.brand : colors.border,
          },
        ]}
      >
        <Text style={styles.choiceIcon}>{icon}</Text>
        <Text weight={selected ? 'semibold' : 'medium'} tone={selected ? 'brand' : 'default'}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.choiceRow}>
      {option('yes', yesIcon, yesLabel)}
      {option('no', noIcon, noLabel)}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Sits inside the scrolling body, which already supplies the page padding.
  header: { marginBottom: spacing.lg },
  progressTrack: { height: 5, borderRadius: radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.pill },
  stepCounter: { marginTop: spacing.sm, marginBottom: spacing.xs },
  subtitle: { marginTop: spacing.xs },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerError: { marginBottom: spacing.sm, textAlign: 'center' },
  footerButtons: { flexDirection: 'row', gap: spacing.md },
  backButton: { flex: 1 },
  nextButton: { flex: 2 },
  optionList: { gap: spacing.md },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  typeIcon: { fontSize: 30 },
  typeInfo: { flex: 1 },
  banner: { marginBottom: spacing.lg },
  sectionLabel: { marginTop: spacing.md, marginBottom: spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  pill: { marginRight: 0 },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  addressBox: { minHeight: 72, textAlignVertical: 'top' },
  questionLabel: { marginBottom: spacing.sm },
  hint: { marginBottom: spacing.md },
  choiceRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  choiceCard: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
  choiceIcon: { fontSize: 26 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  summaryLabel: { width: 76 },
  summaryValue: { flex: 1 },
  moduleTick: { fontSize: 18 },
  vehicleList: { marginBottom: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  vehicleIcon: { fontSize: 20 },
  vehicleInfo: { flex: 1 },
  vehicleKindLabel: { marginBottom: spacing.sm },
});
