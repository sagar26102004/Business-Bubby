# Localo — Product Direction

Decided 2026-07-10. This is the north star for architecture and feature work.
The mistake to avoid: classifying businesses by **what they are** instead of
**what they offer** (customer side) and **what they need to manage**
(business side). A restaurant, gym, salon, electrician, and taxi company look
different but their operations overlap heavily.

## Localo is two products

### 1. Customer marketplace (discovery)

Customers don't think in business types — they think "I need a plumber",
"best biryani", "rent a bike". So discovery is powered by **tags, search,
location, ratings, and availability**:

- **Tags, not exclusive categories.** Every business carries many tags
  (`Business.tags`, vocabulary in `src/domain/tags.ts` → `TAG_CATALOG`).
  An MRF dealer is `Tyres` + `Wheel alignment` + `Vehicle service`; a cafe is
  `Cafe` + `Takeaway` + `Fast Food`. One business appears under many filters.
- **Intents, then tags, then businesses.** The Home tiles are the customer
  categories in `src/domain/intents.ts` (Food / Health / Beauty / Fashion /
  Home Services / Vehicles / Education / Rentals / Stalls / …, 18 total as of
  2026-07-11) — each a bundle of catalog tags, so a business belongs to every
  category it matches. The four ListingTypes are no longer customer-facing;
  they survive only as internal capability wiring. Browse pages filter by the
  category's tags as chips; search matches names, tags, products, menus,
  services.
- Future: natural-language search mapped to tags, "Trending" /
  "Newly opened" home sections.
- Never expose internal machinery (modules, repositories) to customers. The
  customer app answers one question fast: *"can this business provide what
  I'm looking for?"*

### 2. Business Operating System (workspace)

Don't ask "what type of business are you?" — ask **"what do you want to
manage?"**. The workspace becomes **modules** a business enables — the full
catalog with status lives in **`docs/modules.md`** (decided 2026-07-11):

```
Orders · Billing/Invoices · Bookings/Appointments · Menu/Catalog ·
QR Ordering · Online Store · Delivery · Inventory · Staff · Attendance ·
Fleet & Tracking · Rental Management · Expenses · Accounting ·
Analytics/Reports · Customers/CRM · Memberships · Subscriptions ·
Coupons & Deals · Loyalty · WhatsApp Notifications
```

**Chat, Calls, Notifications, Reviews and the business page are universal —
every business has them, they are never opt-in modules.**

A cafe enables Orders + Menu + Billing + Tables; an electrician enables
Appointments + Customers + Billing; a truck owner enables Fleet + Drivers +
Billing. Tags may pre-suggest module defaults at registration, but never
decide which modules a business gets.

Much of this already exists as repository-shaped features (orders, billing,
bookings, chat, calls, tracking, customers). The "modules" step is:

1. Add `Business.modules: string[]` (enabled modules, defaulted from the
   registration capability answers: sells products → Orders/Billing, offers
   services → Bookings, has fleet → Tracking, …).
2. Workspace renders sections from `modules` instead of hardcoded role checks.
3. New modules (memberships, subscriptions, inventory counts, analytics)
   arrive as new repository interfaces + workspace sections — each owns its
   own data and can evolve independently (Shopify/Odoo-style plugins).

This work rides on the real backend (Supabase — deferred until the app is
otherwise done). Keep the repository-interface rule: every module is an
interface first, mock second, real backend third.

## Onboarding (the register wizard) — implemented 2026-07-11

Wizard-style, capability-first, **no category question**:

1. Business or personal stall? (the only fork — anyone can answer it)
2. Tags — how customers find you
3. Name & basics
4. Capability questions, each Yes/No: sell things? offer services?
   rent anything out (per day/month)? — the internal ListingType is DERIVED
   from these (rents only → rental; sells/food → shop; services only →
   service); owners never see it
5. Workspace modules (pre-selected from the answers)
6. Location pin + address (office question only when nothing is sold/rented)
7. Team → review

## Rollout phases (which businesses to serve first)

- **Phase 1** — simple needs, clear value: kirana/grocery, cafes,
  restaurants, bakeries, home-based sellers (stalls), clothing, mobile
  repair, salons, electricians, plumbers, tutors, gyms.
- **Phase 2** — medical stores, hardware, furniture, florists, laundry,
  tent houses, photographers, travel agencies.
- **Phase 3** — logistics/fleets, hotels, schools, clinics, manufacturing
  (industry-specific workflows).

## Status

- ✅ Tags: domain vocabulary, register tag step, tag-aware browse chips,
  tag-aware search, seed retagged, dine-in detection by tag.
- ✅ Tag catalog expanded to ~350 tags (2026-07-11) — broad anchors AND
  pinpoint specialties across food, retail, home services, vehicles, care,
  health, education, creative, events, professional, stay, rentals,
  agriculture & industry.
- ✅ Module catalog named + documented in `docs/modules.md` (2026-07-11);
  chat/calls/notifications/reviews declared universal.
- ✅ Intent categories replace the 4 type tiles (2026-07-11):
  `domain/intents.ts`, two-row swipeable Home grid, intent-driven
  `/browse/[intent-id]` pages with the category's tags as chips.
- ✅ Two-part app (2026-07-11): Flipkart-style 🛍️ Explore | 🏢 My Business
  pill switcher on Home and My Business.
- ✅ Flipkart-style Home (2026-07-11): inline category strip (underlined
  active chip) → one-row subcategory emoji tiles → category-scoped deals
  "ad" → filtered nearby list; `tagEmoji` map in `domain/intents.ts`.
- ✅ B2B chat (2026-07-11): business↔business threads (`BizChatRepository`),
  💬 button on My Business's top bar; B2C chat stays on the Explore side.
- ✅ Category-free registration (2026-07-11): business-vs-stall fork +
  capability questions; ListingType derived, never asked.
- ✅ One stall per user with front-door access (My Biz → View your stall →
  add items).
- ✅ `Business.modules` + module-driven workspace (2026-07-11, mock-first):
  "Set up your workspace" opt-in step in the register wizard (pre-selected
  from capability answers + tags), workspace sections render from the
  enabled modules, Manage gets "Workspace tools" toggles, and the business
  page hides Order/Party/Book buttons for modules the business turned off.
  Legacy/seed businesses without an explicit list keep every available
  module.
- ⏳ Intent-based home sections, NL search, payments, delivery, memberships.
