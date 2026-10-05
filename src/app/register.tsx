/**
 * List yourself on Localo — a step-by-step wizard (one question per screen,
 * like setting up a dating profile) instead of one long form.
 *
 * There are NO business categories to pick. The only fork is the first
 * question — "a business" vs "selling my own stuff" (personal stall).
 * Businesses describe themselves with TAGS and answer plain capability
 * questions (sell things? renewing plans? one-off services? rent anything
 * out?); the internal `ListingType` is DERIVED from those answers (rents only
 * → rental, sells/food-tagged → shop, services only → service) — owners never
 * see it.
 *
 * PLANS and SERVICES are asked separately on purpose. They are the same shape
 * and are shown to customers identically, but they are taken differently: a
 * plan is ENROLLED in and renews (a gym membership, a tuition batch, a tiffin
 * plan), landing in the workspace's Members section; a service is REQUESTED
 * once (an electrician at the house), landing on the orders desk. One list
 * asked once could only ever be half right.
 *
 * ONE PLACE REDESIGN (2026-10, docs/redesign-one-place/register-*.png): the
 * business flow is FOUR PHASES, shown as "Step N of 4" by StepHeader:
 *
 *   1 Identity  — (owner) → identity: business model, name, #tags, tagline,
 *                 description, hours
 *   2 Location  — location: operating model (premises vs mobile/home, which
 *                 hides the exact address) + map pin + address
 *   3 Offerings — blocks: ToggleCards for menu/products, plans, services,
 *                 rentals (they set the same Yes/No answers the old one-question
 *                 steps did) → catalog: one card per enabled block, holding the
 *                 existing editors and the paste-a-list importer
 *   4 Launch    — team → review: live card preview, workspace modules, the
 *                 phase strip, Publish
 *
 * The business model (service / shop / rentals) only PRE-TICKS blocks; the
 * listing type is still derived from what's actually listed.
 *
 *   stall (ON HOLD — lib/onHold.ts): kind → category → basics → location → review
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PLAN_BASES,
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
  PLAN_SECTIONS,
  RENTAL_SECTIONS,
  SERVICE_SECTIONS,
  serviceJobs,
} from '@/domain/offeringSections';
import { isSuperAdminUser } from '@/domain/superAdmin';
import {
  AVAILABLE_MODULES,
  COMING_SOON_MODULES,
  getModule,
  suggestModules,
  type ModuleId,
} from '@/domain/modules';
import type {
  Business,
  GeoPoint,
  ListingType,
  LocationKind,
  MenuItem,
  PlanBasis,
  PlanItem,
  RentalBasis,
  RentalItem,
  ServiceItem,
  User,
  VehicleKind,
} from '@/domain/types';
import type { NewBusinessInput, NewEmployeeInput } from '@/data/repositories';
import { useAuth, useRepositories } from '@/data/DataProvider';
import { formatMoney, parsePrice, sanitizePriceInput } from '@/lib/money';
import { useAsync } from '@/lib/useAsync';
import { clearRegisterDraft, loadRegisterDraft, saveRegisterDraft } from '@/lib/registerDraft';
import {
  AutocompleteInput,
  BottomActionBar,
  Button,
  Card,
  Icon,
  IconTile,
  Input,
  Screen,
  SectionHeader,
  StepHeader,
  Tag,
  Text,
  ToggleCard,
  type IconName,
} from '@/components/ui';
import { BusinessCard } from '@/features/businesses/BusinessCard';
import { EmployeeEditor } from '@/features/businesses/EmployeeEditor';
import { FoodMenuEditor } from '@/features/businesses/FoodMenuEditor';
import { LocationPicker } from '@/features/businesses/LocationPicker';
import { GoodsEditor } from '@/features/businesses/GoodsEditor';
import { OfferingFolderEditor } from '@/features/businesses/OfferingFolderEditor';
import {
  GOODS_EXAMPLE,
  INLINE_EXAMPLES,
  MENU_EXAMPLE,
  OfferingImport,
  PLAN_EXAMPLE,
  RENTAL_EXAMPLE,
  SERVICE_EXAMPLE,
} from '@/features/offerings/OfferingImport';
import {
  toMenuItem,
  toPlanItem,
  toProductItem,
  toRentalItem,
  toServiceItem,
} from '@/features/offerings/importOfferings';
import { OwnerPicker } from '@/features/businesses/OwnerPicker';
import { OpeningHoursField } from '@/features/businesses/OpeningHoursField';
import { hasUsableHours, summarizeHours, type OpeningHours } from '@/domain/hours';
import { TagPicker } from '@/features/businesses/TagPicker';
import { PhotosField } from '@/features/media/PhotosField';
import { radius, spacing, useColors } from '@/theme/theme';
import { ON_HOLD } from '@/lib/onHold';

/** The only fork in the wizard — who is listing. */
type ListingKind = 'business' | 'stall';

const KIND_OPTIONS: { id: ListingKind; icon: string; title: string; blurb: string }[] = [
  {
    id: 'business',
    icon: '🏢',
    title: 'A business',
    blurb: 'A shop, food place, services, rentals — anything with customers.',
  },
  // ON HOLD (redesign 2026-10): stall — "Selling my own stuff" is hidden.
  // {
  //   id: 'stall',
  //   icon: '🏷️',
  //   title: 'Selling my own stuff',
  //   blurb: 'Personal items in one stall — a phone, a car, furniture…',
  // },
];

type StepId =
  | 'identity'
  | 'blocks'
  | 'catalog'
  | 'kind'
  | 'owner'
  | 'category'
  | 'basics'
  | 'sell'
  | 'plans'
  | 'services'
  | 'rent'
  | 'modules'
  | 'location'
  | 'team'
  | 'review';

/** Draft format for this wizard — see RegisterDraft.version. */
const DRAFT_VERSION = 2;

/** How the business mainly works. It only PRE-TICKS the matching blocks. */
type BusinessModel = 'service' | 'shop' | 'rental';

const MODEL_OPTIONS: {
  id: BusinessModel;
  icon: IconName;
  title: string;
  blurb: string;
  chips: string[];
}[] = [
  {
    id: 'service',
    icon: 'tools',
    title: 'Service / freelancer / contractor',
    blurb: 'Plumbers, electricians, tutors, salons, mechanics and other mobile professionals.',
    chips: ['Requests', 'Rate card', 'Calls'],
  },
  {
    id: 'shop',
    icon: 'store',
    title: 'Shop / counter store',
    blurb: 'Cafes, bakeries, kirana, restaurants, showrooms, boutiques.',
    chips: ['Catalog', 'Dine-in tabs', 'Orders'],
  },
  {
    id: 'rental',
    icon: 'key',
    title: 'Rentals',
    blurb: 'Flats and PGs, vehicles, tents & sound, equipment, costumes.',
    chips: ['Per-day / per-month', 'Requests'],
  },
];

/** The Location phase's operating models — `hasOffice` 'yes' / 'no'. */
const OPERATING: {
  id: 'yes' | 'no';
  icon: IconName;
  title: string;
  blurb: string;
  note: string;
  noteIcon: IconName;
}[] = [
  {
    id: 'yes',
    icon: 'store',
    title: 'Physical shop, showroom or studio',
    blurb: 'e.g. Cafe, tyre showroom, salon, bakery, coaching centre.',
    note: 'Customers visit you — your exact pin and full address show on the map.',
    noteIcon: 'pin',
  },
  {
    id: 'no',
    icon: 'truck',
    title: 'Mobile service, or from home',
    blurb: 'e.g. Plumber, electrician, school van, home tutor, home baker.',
    note: 'Home address hidden — customers only see your neighborhood area.',
    noteIcon: 'shield',
  },
];

/** The four phases the steps are grouped under (StepHeader's "Step N of 4"). */
const PHASES = ['Business identity', 'Location & privacy', 'Offerings', 'Review & launch'] as const;

function phaseOf(id: StepId): number {
  switch (id) {
    case 'location':
      return 2;
    case 'blocks':
    case 'catalog':
    case 'sell':
    case 'plans':
    case 'services':
    case 'rent':
      return 3;
    case 'modules':
    case 'team':
    case 'review':
      return 4;
    default:
      return 1;
  }
}

/** Tri-state answer to a Yes/No step: unanswered until the user picks. */
type Choice = 'yes' | 'no' | null;

/** A fleet vehicle staged on the modules step, created right after publish. */
interface VehicleDraft {
  registrationNumber: string;
  kind: VehicleKind;
  /** Optional pet name, e.g. "Bus 1 — morning route". */
  petName?: string;
}

/**
 * A snapshot of every wizard answer — persisted so an accidental exit doesn't
 * lose progress. Mirrors the component's form state exactly.
 */
interface RegisterDraft {
  /** Draft format — bumped when the step list changes; older drafts are dropped. */
  version?: number;
  savedAt: number;
  model?: BusinessModel | null;
  stepIndex: number;
  kind: ListingKind;
  kindChosen: boolean;
  name: string;
  tagline: string;
  description: string;
  openingHours?: OpeningHours;
  subcategoryId?: string;
  tags: string[];
  priceLabel: string;
  images: string[];
  sellItems: MenuItem[];
  plans: PlanItem[];
  planBasis?: PlanBasis;
  services: ServiceItem[];
  rentalBasis?: RentalBasis;
  rentalItems: RentalItem[];
  vehicleDrafts: VehicleDraft[];
  modules: ModuleId[] | null;
  sellChoice: Choice;
  plansChoice: Choice;
  servicesChoice: Choice;
  rentChoice: Choice;
  teamChoice: Choice;
  hasOffice: Choice;
  point?: GeoPoint;
  addressLine: string;
  city: string;
  region: string;
  country: string;
  employees: NewEmployeeInput[];
  owner: User | null;
}

export default function RegisterScreen() {
  const repos = useRepositories();
  const { currentUser, isGuest } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [stepIndex, setStepIndex] = useState(0);

  const [kind, setKind] = useState<ListingKind>('business');
  // ON HOLD (redesign 2026-10): stall — with only one kind left, it's chosen.
  const [kindChosen, setKindChosen] = useState<boolean>(ON_HOLD.stalls);
  const [model, setModel] = useState<BusinessModel | null>(null);
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  // Structured opening hours (per-day open/close) — drives the Open/Closed badge
  // and the timings on the business page. See domain/hours.ts.
  const [openingHours, setOpeningHours] = useState<OpeningHours | undefined>(undefined);
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
  // Renewing plans (enrolled in) and one-off services (requested) — two lists
  // because they are two different things to a customer, never one.
  const [plans, setPlans] = useState<PlanItem[]>([]);
  // The starting point for new plans; each one still carries its own period.
  const [planBasis, setPlanBasis] = useState<PlanBasis>('monthly');
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
  const [plansChoice, setPlansChoice] = useState<Choice>(null);
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
  // Super-admin only: who the listing belongs to. null = the super-admin
  // themselves. Ordinary users never see this step.
  const [owner, setOwner] = useState<User | null>(null);
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

  // Super-admins get an extra "who owns this" step (business flow only) so they
  // can register a listing on behalf of another user.
  const isSuper = isSuperAdminUser(currentUser);
  const stepIds = useMemo<StepId[]>(() => {
    if (isItem) {
      return addingToStall
        ? ['kind', 'category', 'basics', 'review']
        : ['kind', 'category', 'basics', 'location', 'review'];
    }
    // The four phases. The catalog step only exists once a block is switched on.
    const anyBlock =
      sellChoice === 'yes' || plansChoice === 'yes' || servicesChoice === 'yes' || rentChoice === 'yes';
    const all: StepId[] = [
      'kind',
      'identity',
      'location',
      'blocks',
      ...(anyBlock ? (['catalog'] as StepId[]) : []),
      'team',
      'review',
    ];
    // ON HOLD (redesign 2026-10): stall — no "what are you listing?" fork.
    const base = ON_HOLD.stalls ? all.filter((id) => id !== 'kind') : all;
    if (!isSuper) return base;
    const at = ON_HOLD.stalls ? 0 : 1;
    return [...base.slice(0, at), 'owner', ...base.slice(at)] as StepId[];
  }, [isItem, addingToStall, isSuper, sellChoice, plansChoice, servicesChoice, rentChoice]);

  const safeIndex = Math.min(stepIndex, stepIds.length - 1);
  const step = stepIds[safeIndex];
  const isLastStep = step === 'review';

  // What the answers add up to. Owners never pick this — the capability
  // questions decide it: rents only → rental; sells or food-tagged → shop;
  // services only → service; a bare page defaults to shop (a storefront).
  const sells = sellChoice === 'yes' && sellItems.length > 0;
  const enrols = plansChoice === 'yes' && plans.length > 0;
  // A gym is a service business whether what it lists is a monthly membership
  // or a one-off session, so both lists count toward the derived type.
  const serves = (servicesChoice === 'yes' && services.length > 0) || enrols;
  const rents = rentChoice === 'yes';
  const derivedType: ListingType = isItem
    ? 'item'
    : rents && !sells && !serves
      ? 'rental'
      : !sells && serves && !isFoodShop(tags)
        ? 'service'
        : 'shop';

  // Every business picks an operating model on the Location phase — premises
  // customers visit, or mobile / from home (exact address hidden).
  const askOffice = !isItem;

  const chooseKind = (next: ListingKind) => {
    setKind(next);
    setKindChosen(true);
    setStepError(null);
    setStepIndex(1);
  };

  const params = useLocalSearchParams<{ type?: string }>();

  // ── Draft autosave ────────────────────────────────────────────────────────
  // A long wizard where one stray back-tap wiped everything was the complaint.
  // We snapshot answers to storage and restore them on return.
  const hydratedRef = useRef(false);

  const buildSnapshot = (): RegisterDraft => ({
    version: DRAFT_VERSION,
    savedAt: Date.now(),
    model,
    stepIndex,
    kind,
    kindChosen,
    name,
    tagline,
    description,
    openingHours,
    subcategoryId,
    tags,
    priceLabel,
    images,
    sellItems,
    plans,
    planBasis,
    services,
    rentalBasis,
    rentalItems,
    vehicleDrafts,
    modules,
    sellChoice,
    plansChoice,
    servicesChoice,
    rentChoice,
    teamChoice,
    hasOffice,
    point,
    addressLine,
    city,
    region,
    country,
    employees,
    owner,
  });

  const applySnapshot = (d: RegisterDraft) => {
    setStepIndex(d.stepIndex ?? 0);
    setKind(d.kind ?? 'business');
    setKindChosen(d.kindChosen ?? false);
    setModel(d.model ?? null);
    setName(d.name ?? '');
    setTagline(d.tagline ?? '');
    setDescription(d.description ?? '');
    setOpeningHours(d.openingHours);
    setSubcategoryId(d.subcategoryId);
    setTags(d.tags ?? []);
    setPriceLabel(d.priceLabel ?? '');
    setImages(d.images ?? []);
    setSellItems(d.sellItems ?? []);
    setPlans(d.plans ?? []);
    setPlanBasis(d.planBasis ?? 'monthly');
    setServices(d.services ?? []);
    setRentalBasis(d.rentalBasis);
    setRentalItems(d.rentalItems ?? []);
    setVehicleDrafts(d.vehicleDrafts ?? []);
    setModules(d.modules ?? null);
    setSellChoice(d.sellChoice ?? null);
    setPlansChoice(d.plansChoice ?? null);
    setServicesChoice(d.servicesChoice ?? null);
    setRentChoice(d.rentChoice ?? null);
    setTeamChoice(d.teamChoice ?? null);
    setHasOffice(d.hasOffice ?? null);
    setPoint(d.point);
    setAddressLine(d.addressLine ?? '');
    setCity(d.city ?? '');
    setRegion(d.region ?? '');
    setCountry(d.country ?? 'India');
    setEmployees(d.employees ?? []);
    setOwner(d.owner ?? null);
  };

  // On mount: restore a saved draft if there is one, else honour a "?type="
  // preset ("/register?type=item" lands straight on the stall flow).
  useEffect(() => {
    let active = true;
    (async () => {
      const draft = await loadRegisterDraft<RegisterDraft>();
      if (!active) return;
      // ON HOLD (redesign 2026-10): stall — a saved stall draft is dropped.
      // A draft saved against the old ~11-step list would resume on the wrong
      // step, so anything older than this wizard's format is dropped.
      const usable =
        draft &&
        draft.version === DRAFT_VERSION &&
        draft.kindChosen &&
        !(ON_HOLD.stalls && draft.kind === 'stall');
      if (usable) {
        applySnapshot(draft);
      } else if (params.type && !kindChosen && !ON_HOLD.stalls) {
        chooseKind(params.type === 'item' ? 'stall' : 'business');
      }
      hydratedRef.current = true;
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the user has actually started (picked a kind and moved on), persist
  // every change — debounced so we don't hammer storage on each keystroke.
  const hasProgress =
    kindChosen && (stepIndex > 0 || name.trim().length > 0 || tags.length > 0);
  useEffect(() => {
    if (!hydratedRef.current || !hasProgress) return;
    const snap = buildSnapshot();
    const t = setTimeout(() => saveRegisterDraft(snap), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasProgress,
    stepIndex,
    model,
    kind,
    kindChosen,
    name,
    tagline,
    description,
    openingHours,
    subcategoryId,
    tags,
    priceLabel,
    images,
    sellItems,
    plans,
    planBasis,
    services,
    rentalBasis,
    rentalItems,
    vehicleDrafts,
    modules,
    sellChoice,
    plansChoice,
    servicesChoice,
    rentChoice,
    teamChoice,
    hasOffice,
    point,
    addressLine,
    city,
    region,
    country,
    employees,
    owner,
  ]);

  const stepValid = (id: StepId): boolean => {
    switch (id) {
      case 'kind':
        return kindChosen;
      case 'identity':
        return name.trim().length > 1 && tags.length > 0;
      case 'catalog':
        return rentChoice !== 'yes' || (!!rentalBasis && rentalItems.length > 0);
      case 'category':
        return isItem ? !!subcategoryId : tags.length > 0;
      case 'basics':
        return name.trim().length > 1;
      case 'sell':
        return sellChoice !== null;
      case 'plans':
        return plansChoice !== null;
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
      case 'identity':
        return name.trim().length <= 1
          ? 'Add your business name (at least 2 characters) to continue.'
          : 'Add at least one tag so customers can find you.';
      case 'catalog':
        if (!rentalBasis) return 'Rentals: pick per day or per month.';
        return 'Rentals: add at least one thing you rent out, or switch Rentals off.';
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
        return 'Choose how customers meet you to continue.';
      case 'sell':
      case 'plans':
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
        hasPlans: enrols,
        hasRentals: rents,
      }),
    [derivedType, tags, sells, serves, enrols, rents],
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
      // Jump straight to the incomplete step and say what's missing — inline
      // feedback beats a popup here, because it points AT the empty field.
      const target: StepId = isItem
        ? name.trim().length <= 1
          ? 'basics'
          : 'category'
        : 'identity';
      jumpTo(target);
      setStepError(missingFor(target));
      return;
    }

    // Mobile / from-home businesses keep their exact address private — only the
    // area shows (the redesign's "privacy shield").
    const mobile = !isItem && hasOffice === 'no';
    const locationKind: LocationKind =
      mobile && derivedType === 'service' ? 'service_area' : 'office';
    const location = {
      kind: locationKind,
      isHome: mobile,
      hidePreciseLocation: mobile,
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
            // Super-admin only: hand the listing to the chosen owner (else self).
            ownerId: owner?.id,
            // Tags drive discovery; a matching classic subcategory (Cafe →
            // cafe) is derived for anything still keyed on it.
            subcategoryId: getType(derivedType)?.subcategories.find((s) => hasTag(tags, s.name))?.id,
            tags: tags.length > 0 ? tags : undefined,
            menu: foodShop ? items : undefined,
            products: !foodShop ? items : undefined,
            // Structured hours drive Open/Closed; the free-text `hours` label is
            // derived from them as a compact fallback for older readers.
            openingHours,
            hours: summarizeHours(openingHours),
            services:
              servicesChoice !== 'no' && services.length > 0 ? services : undefined,
            plans: plansChoice !== 'no' && plans.length > 0 ? plans : undefined,
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
      // Published — the draft has served its purpose.
      await clearRegisterDraft();
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
    setKindChosen(ON_HOLD.stalls);
    setModel(null);
    setName('');
    setTagline('');
    setDescription('');
    setOpeningHours(undefined);
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
    setOwner(null);
  };

  const heading = (): { title: string; subtitle?: string } => {
    switch (step) {
      case 'kind':
        return {
          title: 'What are you listing?',
          subtitle: 'Just this one question — no categories to figure out.',
        };
      case 'identity':
        return {
          title: 'Tell us about your business',
          subtitle:
            'Pick how you work and how people will find you — everything can be changed later from your workspace.',
        };
      case 'blocks':
        return {
          title: 'What does your business offer?',
          subtitle:
            'Switch on the building blocks you run with. Each one adds a list to your page and its tools to your workspace.',
        };
      case 'catalog':
        return {
          title: 'Add your menu & catalog',
          subtitle:
            'Fill each block you switched on — tap from the ready-made library, or paste the whole list at once.',
        };
      case 'owner':
        return {
          title: 'Who owns this listing?',
          subtitle:
            'As a super-admin you can register on someone’s behalf. Leave it as yourself, or assign it to a registered user.',
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
      case 'plans':
        return {
          title: 'Do you offer anything that renews?',
          subtitle:
            'A gym membership, a class batch, a tiffin or bus plan — anything a customer stays on and pays for again. They ENROL in these; you confirm the plan and the price in Members.',
        };
      case 'services':
        return {
          title: 'Do you offer one-off services?',
          subtitle:
            'Work done once and paid for once — a repair, a home visit, a haircut. Pick a ready-made section and list what you do under it with a price. Customers REQUEST these; they land on your orders desk.',
        };
      case 'rent':
        return {
          title: 'Do you rent anything out?',
          subtitle:
            'Flats, vehicles, equipment, costumes — file each one under a ready-made section and give it a price, per day or per month.',
        };
      case 'modules':
        return {
          title: 'Set up your workspace',
          subtitle:
            'Pick the tools you’ll run the business with — we’ve pre-selected some from your answers. Change anytime in Manage.',
        };
      case 'location':
        return {
          title: 'Where do you meet your customers?',
          subtitle:
            'Choose your operating model — it decides how your location shows on maps and cards.',
        };
      case 'team':
        return {
          title: 'Just you, or a team?',
          subtitle: 'Add employees now or anytime later in Manage.',
        };
      case 'review':
        return {
          title: 'Ready to launch your page?',
          subtitle: 'Review your setup — tap anything to change it. It can all be edited later.',
        };
    }
  };

  const { title, subtitle } = heading();

  // Picking a business model pre-ticks its block — never un-ticks one.
  const pickModel = (m: BusinessModel) => {
    setModel(m);
    setStepError(null);
    if (m === 'service' && servicesChoice === null) setServicesChoice('yes');
    if (m === 'shop' && sellChoice === null) setSellChoice('yes');
    if (m === 'rental' && rentChoice === null) setRentChoice('yes');
  };

  // The Offerings phase's building blocks. Each switches the same Yes/No answer
  // the old one-question steps asked, so publishing is unchanged.
  const foodShopNow = isFoodShop(tags);
  const BLOCKS: {
    id: 'sell' | 'plans' | 'services' | 'rent';
    title: string;
    blurb: string;
    icon: IconName;
    unlocks: string[];
    value: Choice;
    set: (c: Choice) => void;
    count: number;
  }[] = [
    {
      id: 'sell',
      title: foodShopNow ? 'Food menu & drinks' : 'Products for sale',
      blurb: foodShopNow
        ? 'Cafes, restaurants, bakeries, cloud kitchens, juice bars.'
        : 'Retail, groceries, hardware, spare parts — everything you stock.',
      icon: foodShopNow ? 'utensils' : 'box',
      unlocks: foodShopNow ? ['Digital menu', 'Dine-in tabs', 'Orders'] : ['Catalog', 'Orders', 'Billing'],
      value: sellChoice,
      set: setSellChoice,
      count: sellItems.length,
    },
    {
      id: 'services',
      title: 'Services & repairs',
      blurb: 'One-off work — a repair, a home visit, a haircut. Customers request it.',
      icon: 'tools',
      unlocks: ['Rate card', 'Requests', 'Bookings'],
      value: servicesChoice,
      set: setServicesChoice,
      count: services.length,
    },
    {
      id: 'plans',
      title: 'Recurring plans & memberships',
      blurb: 'Gym passes, tuition batches, tiffin or school-bus plans — anything that renews.',
      icon: 'refresh',
      unlocks: ['Members', 'Dues', 'Renewals'],
      value: plansChoice,
      set: setPlansChoice,
      count: plans.length,
    },
    {
      id: 'rent',
      title: 'Rentals',
      blurb: 'Flats, vehicles, event gear, tools — priced per day or per month.',
      icon: 'key',
      unlocks: ['Per day / per month', 'Requests'],
      value: rentChoice,
      set: setRentChoice,
      count: rentalItems.length,
    },
  ];
  const enabledBlocks = BLOCKS.filter((b) => b.value === 'yes');

  // The review step's live preview — a Business shaped from the answers so far.
  const previewBusiness = {
    id: 'preview',
    ownerId: currentUser?.id ?? 'preview',
    name: name.trim() || 'Your business',
    tagline: tagline.trim() || undefined,
    type: derivedType,
    tags,
    openingHours,
    hours: summarizeHours(openingHours),
    menu: sellChoice === 'yes' && foodShopNow ? sellItems : undefined,
    products: sellChoice === 'yes' && !foodShopNow ? sellItems : undefined,
    services: servicesChoice === 'yes' ? services : undefined,
    plans: plansChoice === 'yes' ? plans : undefined,
    rentals: rentChoice === 'yes' ? rentalItems : undefined,
    rentalBasis,
    modules: chosenModules,
    location: {
      kind: 'office',
      isHome: hasOffice === 'no',
      hidePreciseLocation: hasOffice === 'no',
      city: city.trim() || undefined,
      region: region.trim() || undefined,
      point,
    },
  } as unknown as Business;

  const phase = phaseOf(step);
  const nextStep = stepIds[safeIndex + 1];
  const nextLabel =
    nextStep && phaseOf(nextStep) !== phase ? `Next: ${PHASES[phaseOf(nextStep) - 1]}` : 'Next';

  const renderStep = (id: StepId = step): ReactNode => {
    switch (id) {
      case 'identity':
        return (
          <>
            <SectionHeader
              title="1. How do you mainly work?"
              subtitle="Pick one — it switches on the right building blocks for you"
              style={styles.firstHeader}
            />
            <View style={styles.optionList}>
              {MODEL_OPTIONS.map((o) => {
                const on = model === o.id;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => pickModel(o.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [
                      styles.modelCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: on ? colors.brand : colors.border,
                        borderWidth: on ? 1.5 : 1,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.modelTop}>
                      <IconTile icon={o.icon} solid={on} />
                      <View
                        style={[
                          styles.radio,
                          {
                            borderColor: on ? colors.brand : colors.border,
                            backgroundColor: on ? colors.brand : colors.surface,
                          },
                        ]}
                      >
                        {on ? <Icon name="check" size={14} color={colors.textInverse} /> : null}
                      </View>
                    </View>
                    <Text variant="subheading" weight="bold">
                      {o.title}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {o.blurb}
                    </Text>
                    <View style={styles.chipWrap}>
                      {o.chips.map((c) => (
                        <Tag key={c} label={c} tone="soft" size="sm" />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <SectionHeader
              title="2. Business identity & discovery tags"
              subtitle="Shown in neighborhood search and on your page"
            />
            <Card>
              <Input
                label="Business / trade name *"
                placeholder="e.g. Sparks Electrical, Meera’s Cafe"
                value={name}
                onChangeText={setName}
              />
              <Text variant="label" weight="medium" style={styles.fieldLabel}>
                Category & trade tags *
              </Text>
              <Text variant="caption" tone="muted" style={styles.hint}>
                Add a tag for everything you do — a tyre dealer is “Tyres” + “Wheel alignment” +
                “Vehicle service”. More tags, easier to find.
              </Text>
              <TagPicker value={tags} onChange={setTags} suggestions={SUGGESTED_BUSINESS_TAGS} />
              <Input
                label="Short tagline"
                placeholder="One line about what you offer"
                value={tagline}
                onChangeText={setTagline}
                helper="Shown under your name on search cards"
              />
              <Input
                label="Description (optional)"
                placeholder="Tell customers more…"
                value={description}
                onChangeText={setDescription}
                multiline
                style={styles.multiline}
              />
            </Card>

            <SectionHeader
              title="3. Operating hours & calls"
              subtitle="Let neighbors know when you’re open and how to reach you"
            />
            <Card>
              <OpeningHoursField value={openingHours} onChange={setOpeningHours} />
            </Card>
            <Card style={styles.infoCard}>
              <IconTile icon="phone" size={40} />
              <View style={styles.flex}>
                <Text weight="bold">Private in-app voice calls & chat</Text>
                <Text variant="caption" tone="muted">
                  Always on. Customers reach you inside One Place — your phone number is never shown.
                </Text>
              </View>
              <Tag label="Included" tone="status" size="sm" />
            </Card>
          </>
        );

      case 'blocks':
        return (
          <>
            <Card>
              <View style={styles.infoRow}>
                <IconTile icon="check" size={36} />
                <View style={styles.flex}>
                  <Text weight="bold">Always included for every business</Text>
                  <Text variant="caption" tone="muted">
                    In-app voice calls, neighborhood chat and directions come with every page.
                  </Text>
                </View>
              </View>
              <View style={styles.chipWrap}>
                {['Voice', 'Chat', 'Route'].map((c) => (
                  <Tag key={c} label={c} tone="soft" size="sm" />
                ))}
              </View>
            </Card>
            <SectionHeader
              title="Building blocks"
              badge={`${enabledBlocks.length} of ${BLOCKS.length} on`}
            />
            <View style={styles.optionList}>
              {BLOCKS.map((b) => (
                <ToggleCard
                  key={b.id}
                  title={b.title}
                  blurb={b.blurb}
                  icon={b.icon}
                  value={b.value === 'yes'}
                  onChange={(on) => b.set(on ? 'yes' : 'no')}
                  unlocks={b.unlocks}
                />
              ))}
            </View>
            {enabledBlocks.length === 0 ? (
              <Text variant="caption" tone="muted" style={styles.hintTop}>
                Nothing switched on? That’s fine — your page can be a profile with chat and calls.
                Add lists anytime from your workspace.
              </Text>
            ) : null}
          </>
        );

      case 'catalog':
        return (
          <>
            <Card style={styles.blockCard}>
              <View style={styles.infoRow}>
                <IconTile icon="grid" size={36} />
                <View style={styles.flex}>
                  <Text weight="bold">Active blocks</Text>
                  <View style={styles.chipWrap}>
                    {enabledBlocks.map((b) => (
                      <Tag key={b.id} label={b.title} tone="status" size="sm" dot />
                    ))}
                  </View>
                </View>
              </View>
              <Text variant="caption" tone="muted" style={styles.hintTop}>
                Items land straight on your public page and your orders desk.
              </Text>
            </Card>
            {enabledBlocks.map((b) => (
              <Card key={b.id} style={styles.blockCard}>
                <View style={styles.blockHead}>
                  <IconTile icon={b.icon} />
                  <View style={styles.flex}>
                    <Text variant="subheading" weight="bold">
                      {b.title}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {b.blurb}
                    </Text>
                  </View>
                  <Tag
                    label={`${b.count} added`}
                    tone={b.count > 0 ? 'status' : 'default'}
                    size="sm"
                  />
                </View>
                {renderStep(b.id)}
              </Card>
            ))}
          </>
        );


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

      case 'owner':
        return (
          <>
            <Card style={styles.banner}>
              <Text weight="semibold">🛡️ Super-admin</Text>
              <Text variant="caption" tone="muted">
                You’re registering this listing. Assign it to whoever should own and
                manage it — they’ll get full control; you can change the owner later
                from the business page.
              </Text>
            </Card>
            <OwnerPicker
              value={owner}
              onChange={setOwner}
              selfLabel={currentUser ? `Me (${currentUser.name})` : 'Me'}
            />
          </>
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
              <>
                <Input
                  label="Tagline (optional)"
                  placeholder="One line about what you offer"
                  value={tagline}
                  onChangeText={setTagline}
                />
                <OpeningHoursField value={openingHours} onChange={setOpeningHours} />
              </>
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
            {step !== 'catalog' ? <YesNoRow
              value={sellChoice}
              yesLabel={foodShop ? 'Yes, add my menu' : 'Yes, I sell products'}
              noLabel={foodShop ? 'No menu' : 'No products'}
              onPick={answer(setSellChoice)}
            /> : null}
            {sellChoice === 'yes' ? (
              <>
                {/* Most owners already have the list written down somewhere —
                    let them drop the whole thing in rather than tap out sixty
                    rows. Whatever it produces lands in the editor below. */}
                <OfferingImport
                  value={sellItems}
                  onChange={setSellItems}
                  map={foodShop ? toMenuItem : toProductItem}
                  noun={foodShop ? 'dish' : 'product'}
                  example={foodShop ? MENU_EXAMPLE : GOODS_EXAMPLE}
                  inlineExample={foodShop ? INLINE_EXAMPLES.menu : INLINE_EXAMPLES.goods}
                />
                {foodShop ? (
                  // Food menus use the prebuilt library (Soups, Main Course,
                  // Beverages › Tea…) — no section is invented or typed.
                  <FoodMenuEditor value={sellItems} onChange={setSellItems} />
                ) : (
                  // A non-food shop builds its catalog the way a restaurant
                  // builds its menu — shelf › kind › brand, out of the goods
                  // library — instead of typing loose lines.
                  <GoodsEditor value={sellItems} onChange={setSellItems} />
                )}
              </>
            ) : null}
          </>
        );
      }

      case 'plans':
        return (
          <>
            {step !== 'catalog' ? <YesNoRow
              value={plansChoice}
              yesLabel="Yes, I have plans"
              noLabel="Nothing renews"
              onPick={answer(setPlansChoice)}
            /> : null}
            {plansChoice === 'yes' ? (
              <>
                <Text variant="label" weight="semibold" style={styles.sectionLabel}>
                  How often do most of them renew?
                </Text>
                <Text variant="caption" tone="muted" style={styles.hint}>
                  Just the starting point — each plan you add below carries its own
                  “per month” / “per year” sticker, so a monthly membership and an
                  annual one can sit side by side.
                </Text>
                <View style={styles.pillRow}>
                  {PLAN_BASES.map((b) => (
                    <Tag
                      key={b.id}
                      label={b.label}
                      icon={b.icon}
                      selected={planBasis === b.id}
                      onPress={() => setPlanBasis(b.id)}
                      style={styles.pill}
                    />
                  ))}
                </View>

                <Text variant="label" weight="semibold" style={styles.sectionLabel}>
                  What can people join?
                </Text>
                <OfferingImport
                  value={plans}
                  onChange={setPlans}
                  map={(row) => toPlanItem(row, planBasis)}
                  noun="plan"
                  example={PLAN_EXAMPLE}
                  inlineExample={INLINE_EXAMPLES.plans}
                />
                {/* Built exactly like the services list — same editor, same
                    folders. Only the library and the period chips differ. */}
                <OfferingFolderEditor
                  value={plans}
                  onChange={setPlans}
                  sections={PLAN_SECTIONS}
                  noun="plan"
                  hint="Tap what people can join — a membership, a batch, a monthly delivery."
                  newSectionPlaceholder="Section name — e.g. Swimming, Library"
                  customIcon="🎟️"
                  withDescription
                  descriptionPlaceholder="What’s included (optional)"
                  basisOptions={PLAN_BASES}
                  basisDefault={planBasis}
                  basisLabel="Renews…"
                />
              </>
            ) : null}
          </>
        );

      case 'services':
        return (
          <>
            {step !== 'catalog' ? <YesNoRow
              value={servicesChoice}
              yesLabel="Yes, one-off services"
              noLabel="No services"
              onPick={answer(setServicesChoice)}
            /> : null}
            {servicesChoice === 'yes' ? (
              <>
                <OfferingImport
                  value={services}
                  onChange={setServices}
                  map={toServiceItem}
                  noun="service"
                  example={SERVICE_EXAMPLE}
                  inlineExample={INLINE_EXAMPLES.services}
                />
                {/* Services are built the way the menu is — section › kind of
                    work, with the jobs people ask for offered inside. */}
                <OfferingFolderEditor
                  value={services}
                  onChange={setServices}
                  sections={SERVICE_SECTIONS}
                  noun="service"
                  hint="Tap a section to add the work you do. Skip the ones you don’t."
                  newSectionPlaceholder="Section name — e.g. Borewell, Solar"
                  customIcon="🛠️"
                  jobsFor={(section, kind) => serviceJobs(section.id, kind)}
                  withDescription
                  descriptionPlaceholder="What’s included (optional)"
                />
              </>
            ) : null}
          </>
        );

      case 'rent':
        return (
          <>
            {step !== 'catalog' ? <YesNoRow
              value={rentChoice}
              yesLabel="Yes, I rent things out"
              noLabel="Nothing for rent"
              onPick={answer(setRentChoice)}
            /> : null}
            {rentChoice === 'yes' ? (
              <>
                <Text variant="label" weight="semibold" style={styles.sectionLabel}>
                  Mostly per day or per month?
                </Text>
                <Text variant="caption" tone="muted" style={styles.hint}>
                  Just the starting point — each thing you add below carries its own
                  “per day” / “per month” sticker, so a flat can be monthly while your
                  scooter is daily.
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
                <OfferingImport
                  value={rentalItems}
                  onChange={setRentalItems}
                  map={(row) => toRentalItem(row, rentalBasis)}
                  noun="rental"
                  example={RENTAL_EXAMPLE}
                  inlineExample={INLINE_EXAMPLES.rentals}
                />
                <OfferingFolderEditor
                  value={rentalItems}
                  onChange={setRentalItems}
                  sections={RENTAL_SECTIONS}
                  noun="rental"
                  hint="Tap what you rent out — flats, PG beds, shops, vehicles. Skip the rest."
                  newSectionPlaceholder="Section name — e.g. Parking space"
                  customIcon="🔑"
                  folderLabel="What kind of thing? (optional)"
                  folderExample="Studio, Rooftop shop"
                  withDescription
                  descriptionPlaceholder="Condition, deposit, what’s included (optional)"
                  basisOptions={RENTAL_BASES}
                  basisDefault={rentalBasis}
                  basisLabel="Rented out per…"
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
                <SectionHeader
                  title="Operating model & address privacy"
                  icon="pin"
                  badge="Required"
                  style={styles.firstHeader}
                />
                <View style={[styles.optionList, styles.blockCard]}>
                  {OPERATING.map((o) => {
                    const on = hasOffice === o.id;
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => {
                          setHasOffice(o.id);
                          setStepError(null);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        style={({ pressed }) => [
                          styles.modelCard,
                          {
                            backgroundColor: colors.surface,
                            borderColor: on ? colors.brand : colors.border,
                            borderWidth: on ? 1.5 : 1,
                          },
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.modelTop}>
                          <IconTile icon={o.icon} solid={on} />
                          <View
                            style={[
                              styles.radio,
                              {
                                borderColor: on ? colors.brand : colors.border,
                                backgroundColor: on ? colors.brand : colors.surface,
                              },
                            ]}
                          >
                            {on ? <Icon name="check" size={14} color={colors.textInverse} /> : null}
                          </View>
                        </View>
                        <Text variant="subheading" weight="bold">
                          {o.title}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {o.blurb}
                        </Text>
                        <View
                          style={[
                            styles.noteRow,
                            { backgroundColor: on ? colors.brandSoft : colors.surfaceAlt },
                          ]}
                        >
                          <Icon name={o.noteIcon} size={14} color={colors.brandText} />
                          <Text variant="caption" style={styles.flex}>
                            {o.note}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
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
            id: isItem ? 'kind' : 'identity',
            label: 'Listing',
            value: isItem
              ? '🏷️ Personal stall item'
              : model
                ? `${MODEL_OPTIONS.find((m) => m.id === model)?.title ?? 'Business'}`
                : '🏢 Business',
          },
          isItem
            ? {
                id: 'category' as StepId,
                label: 'Category',
                value: getSubcategory('item', subcategoryId)?.name ?? '— pick one',
              }
            : {
                id: 'identity' as StepId,
                label: 'Tags',
                value: tags.length > 0 ? tags.join(' · ') : '— add tags',
              },
          {
            id: isItem ? 'basics' : 'identity',
            label: isItem ? 'Item' : 'Name',
            value: name.trim() || '— add a name',
          },
        ];
        if (stepIds.includes('owner')) {
          rows.splice(1, 0, {
            id: 'owner',
            label: 'Owner',
            value: owner ? owner.name : currentUser ? `${currentUser.name} (you)` : 'You',
          });
        }
        if (isItem && priceLabel.trim())
          rows.push({ id: 'basics', label: 'Price', value: priceLabel.trim() });
        if (!isItem && hasUsableHours(openingHours))
          rows.push({ id: 'identity', label: 'Hours', value: summarizeHours(openingHours) ?? '' });
        if (!isItem) {
          rows.push({
            id: sellChoice === 'yes' ? 'catalog' : 'blocks',
            label: isFoodShop(tags) ? 'Menu' : 'Products',
            value:
              sellChoice !== 'no' && sellItems.length > 0
                ? `${sellItems.length} item${sellItems.length === 1 ? '' : 's'}`
                : 'None',
          });
        }
        if (!isItem) {
          rows.push({
            id: plansChoice === 'yes' ? 'catalog' : 'blocks',
            label: 'Plans',
            value: plansChoice !== 'no' && plans.length > 0 ? `${plans.length} listed` : 'None',
          });
        }
        if (!isItem) {
          rows.push({
            id: servicesChoice === 'yes' ? 'catalog' : 'blocks',
            label: 'Services',
            value:
              servicesChoice !== 'no' && services.length > 0 ? `${services.length} listed` : 'None',
          });
        }
        if (!isItem) {
          rows.push({
            id: rentChoice === 'yes' ? 'catalog' : 'blocks',
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
        if (!isItem) {
          rows.push({
            id: 'review',
            label: 'Workspace',
            value:
              chosenModules.length > 0
                ? chosenModules.map((id) => getModule(id)?.label ?? id).join(' · ')
                : 'Chat & calls only',
          });
          if (chosenModules.includes('tracking') && vehicleDrafts.length > 0) {
            rows.push({
              id: 'review',
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
                    ? '🏪 Customers visit'
                    : hasOffice === 'no'
                      ? '🛡️ Mobile · address hidden'
                      : undefined
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

            {!isItem ? (
              <>
                <SectionHeader
                  title="Live customer preview"
                  subtitle="How neighbors will see you in their feed"
                  style={styles.firstHeader}
                />
                {/* A picture of the card, not a working one — nothing to open yet. */}
                <View pointerEvents="none">
                  <BusinessCard business={previewBusiness} />
                </View>

                <SectionHeader
                  title="Your workspace"
                  subtitle="Back-office tools, ready the moment you publish"
                  badge={`${chosenModules.length} on`}
                />
                <View style={styles.optionList}>
                  {AVAILABLE_MODULES.map((m) => (
                    <ToggleCard
                      key={m.id}
                      title={m.label}
                      blurb={m.description}
                      emoji={m.icon}
                      value={chosenModules.includes(m.id)}
                      onChange={() => toggleModule(m.id)}
                    />
                  ))}
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
                <View style={styles.chipWrapTop}>
                  <Text variant="caption" tone="muted">
                    Coming soon:
                  </Text>
                  {COMING_SOON_MODULES.map((m) => (
                    <Tag key={m.id} label={m.label} icon={m.icon} size="sm" />
                  ))}
                </View>
                <Text variant="caption" tone="muted" style={styles.hintTop}>
                  You can switch any tool on or off later in your workspace.
                </Text>

                <SectionHeader title="Onboarding steps" />
                <View style={styles.phaseRow}>
                  {PHASES.map((ph, i) => {
                    const first = stepIds.find((sid) => phaseOf(sid) === i + 1);
                    const current = i === PHASES.length - 1;
                    return (
                      <Pressable
                        key={ph}
                        onPress={() => (first ? jumpTo(first) : undefined)}
                        accessibilityRole="button"
                        accessibilityLabel={`Step ${i + 1}: ${ph}`}
                        style={[
                          styles.phaseCell,
                          {
                            backgroundColor: current ? colors.brand : colors.surface,
                            borderColor: current ? colors.brand : colors.border,
                          },
                        ]}
                      >
                        <Text variant="caption" weight="bold" tone={current ? 'inverse' : 'default'}>
                          Step {i + 1}
                        </Text>
                        <Text variant="caption" tone={current ? 'inverse' : 'muted'} numberOfLines={1}>
                          {ph.split(' ')[0]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <SectionHeader title="Everything you entered" subtitle="Tap a row to change it" />
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
      {/* The wizard draws its own header: "Step N of 4 · Phase" + progress. */}
      <Stack.Screen options={{ headerShown: false }} />
      <StepHeader
        step={phase}
        total={PHASES.length}
        phase={PHASES[phase - 1]}
        title="List a business"
        onBack={safeIndex > 0 ? goBack : () => router.back()}
      />
      {/* Step body — keyed by step so navigating always starts at the top. */}
      <ScrollView
        key={step}
        style={styles.flex}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Tag label={PHASES[phase - 1]} tone="soft" size="sm" lineIcon="sparkle" style={styles.eyebrow} />
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

      {/* Footer: ← Back + Next / Publish */}
      <BottomActionBar
        onBack={safeIndex > 0 ? goBack : undefined}
        primary={
          isLastStep
            ? {
                title: isGuest
                  ? 'Sign in to publish'
                  : isItem
                    ? myStall
                      ? 'Add to my stall'
                      : 'Publish my stall'
                    : 'Publish business page',
                icon: 'sparkle',
                onPress: submit,
                loading: submitting,
              }
            : { title: nextLabel, onPress: handleNext }
        }
      >
        {stepError && (isLastStep || !stepValid(step)) ? (
          <Text variant="caption" tone="danger" style={styles.footerError}>
            {stepError}
          </Text>
        ) : null}
      </BottomActionBar>
    </Screen>
  );
}

/**
 * Stage fleet vehicles on the modules step: number plate + what kind it is,
 * with an optional pet name. They're created right after the business is.
 */
/** Number plates, normalised for comparison: only letters/digits, upper-cased. */
const canonicalReg = (reg: string): string => reg.replace(/[^a-z0-9]/gi, '').toUpperCase();

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
  // Null = the fields add a new vehicle; a number = we're editing that row.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // Why: a silently disabled Add button reads as broken — keep it tappable
  // and explain what's missing instead.
  const [error, setError] = useState<string | null>(null);

  const resetFields = () => {
    setRegistrationNumber('');
    setKind('car');
    setPetName('');
    setEditingIndex(null);
    setError(null);
  };

  const submit = () => {
    const plate = registrationNumber.trim();
    if (plate.length < 4) {
      setError('Type the vehicle number first — e.g. MP09 AB 1234. Only the pet name is optional.');
      return;
    }
    // Catch a duplicate number plate HERE, not at publish. Compare a canonical
    // form (strip spaces/dashes, upper-case) so "MP09 AB 1234" and
    // "mp09-ab-1234" count as the same plate. When editing, skip the row itself.
    const canonical = canonicalReg(plate);
    const clash = value.some(
      (v, i) => i !== editingIndex && canonicalReg(v.registrationNumber) === canonical,
    );
    if (clash) {
      setError(`You've already added a vehicle with number ${plate}.`);
      return;
    }
    const draft: VehicleDraft = { registrationNumber: plate, kind, petName: petName.trim() || undefined };
    onChange(
      editingIndex === null
        ? [...value, draft]
        : value.map((v, i) => (i === editingIndex ? draft : v)),
    );
    resetFields();
  };

  const startEdit = (index: number) => {
    const v = value[index];
    setRegistrationNumber(v.registrationNumber);
    setKind(v.kind);
    setPetName(v.petName ?? '');
    setEditingIndex(index);
    setError(null);
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    // If the row being edited is removed (or shifts), drop back to add mode.
    if (editingIndex !== null) resetFields();
  };

  const editing = editingIndex !== null;

  return (
    <View>
      {value.length > 0 ? (
        <Card style={styles.vehicleList}>
          {value.map((v, i) => (
            <Pressable
              key={`${v.registrationNumber}-${i}`}
              onPress={() => startEdit(i)}
              style={[styles.vehicleRow, editingIndex === i ? styles.vehicleRowEditing : null]}
            >
              <Text style={styles.vehicleIcon}>{getVehicleKind(v.kind).icon}</Text>
              <View style={styles.vehicleInfo}>
                <Text weight="medium">{v.petName || v.registrationNumber}</Text>
                {v.petName ? (
                  <Text variant="caption" tone="muted">
                    {v.registrationNumber}
                  </Text>
                ) : null}
              </View>
              <Text tone="brand" weight="semibold" style={styles.vehicleEdit}>
                ✎
              </Text>
              <Text tone="danger" weight="semibold" onPress={() => remove(i)}>
                ✕
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {editing ? (
        <Text variant="caption" tone="brand" weight="semibold" style={styles.vehicleEditingHint}>
          Editing {value[editingIndex]?.petName || value[editingIndex]?.registrationNumber}
        </Text>
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
        onSubmitEditing={submit}
      />
      {error ? (
        <Text variant="caption" tone="danger" style={styles.hint}>
          {error}
        </Text>
      ) : null}
      <Button
        title={editing ? 'Save changes' : 'Add vehicle'}
        variant="secondary"
        onPress={submit}
      />
      {editing ? (
        <Button title="Cancel" variant="ghost" onPress={resetFields} style={styles.vehicleCancel} />
      ) : null}
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
  footerError: { textAlign: 'center' },
  // — One Place wizard (2026-10) —
  firstHeader: { marginTop: 0 },
  eyebrow: { marginBottom: spacing.sm },
  pressed: { opacity: 0.8 },
  modelCard: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  modelTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  chipWrapTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  fieldLabel: { marginBottom: spacing.xs },
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  hintTop: { marginTop: spacing.md },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  blockCard: { marginBottom: spacing.lg },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  phaseRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  phaseCell: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
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
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  vehicleRowEditing: { backgroundColor: 'rgba(37,99,235,0.08)' },
  vehicleIcon: { fontSize: 20 },
  vehicleInfo: { flex: 1 },
  vehicleEdit: { marginRight: spacing.xs },
  vehicleEditingHint: { marginBottom: spacing.sm },
  vehicleCancel: { marginTop: spacing.sm },
  vehicleKindLabel: { marginBottom: spacing.sm },
});
