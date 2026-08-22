# Localo — Test data pack (accounts, businesses, employees)

Everything you need to hand-create a realistic test world that exercises **every**
listing shape and every module the app has. Nothing here changes code — it is
data to type into the app.

Companion file: **[TEST-CHECKLIST.md](TEST-CHECKLIST.md)** — the feature-by-feature
list of what to test once this data exists.

---

## 0. First: how the app decides what you see

Home is capped at **20 km** (`HOME_RADIUS_KM` in `app/(tabs)/index.tsx`) — every
listing inside that ring, nearest first, nothing beyond it. There is no count
limit. Search and the category pages are deliberately **not** capped: someone who
typed a specific thing would rather travel for it than see "no results".

| Screen | What it fetches | Radius | Cap |
|---|---|---|---|
| **Home** (`app/(tabs)/index.tsx`) | `businesses.list({ near, sortByDistance: true, maxDistanceKm: HOME_RADIUS_KM })` | **20 km** | none — everything inside the ring, sorted nearest-first |
| **Category page** (`app/browse/[type].tsx`) | same call, then filtered by intent/tag client-side | none | none |
| **Search** (`app/search.tsx`) | same call + text match | none | none |
| **Map** (`app/map.tsx`) | `maxDistanceKm: 5` | **5 km** | none |
| **Location picker dots** (register) | `maxDistanceKm: 5` | 5 km | none |
| **Home ad slot — free offers** | `FREE_REACH_KM` = **2 km**, widened toward `COLD_START_REACH_KM` = 25 km only while fewer than `MIN_SLOT_CARDS` qualify | 2 → 25 km | slot size |
| **Home ad slot — sponsored** | `SPONSORED_REACH_KM` = **25 km** | 25 km | — |
| **Deals feed** (`app/deals.tsx`) | customer's own range picker `1, 2, 5, 10, 25, 50, 100, 200 km, Anywhere`, default **10 km** | picked | — |

**What that means for testing:** the two far-away listings in this pack are there
to prove the boundary from both sides. `Mahakal Dhaba` (~15 km) is **inside** the
ring — it must appear on Home, last. `Ujjain Tent House` (~55 km) is **outside**
it — it must NOT appear on Home at all, but must still be findable by **search**
and on its **category page**, and its sponsored ad can still reach you (ads have
their own 25 km rule). If GPS hasn't resolved yet there is no "here" to measure
from, so the cap is ignored and everything lists — that is intentional, not a bug.

---

## 1. Ground rules before you create anything

1. **Username rules** (`assertUsername`): 3–20 characters, must **start with a
   letter**, then letters/numbers/dots/underscores only, lower-case. Every name
   below already obeys this.
2. **Password**: minimum 6 characters. Use **`test1234`** for every account in
   this pack so you never have to look one up.
3. **Always fill the display name.** It is optional at sign-up, but employee
   linking and customer lookup search **by display name only**
   (`UserRepository.search` filters on `u.name`). An account with no name is
   invisible when you try to add it to a team. Names are given below.
4. **Create employee accounts BEFORE the business.** The register wizard's team
   step links an existing user; if the account does not exist yet you can only
   add an unlinked name (which then cannot sign in, receive calls or be a driver).
5. **One stall per account.** Registering a second `item` listing folds the item
   into the same stall. That is the intended behaviour — test it, do not fight it.
6. **Sign-in accepts** username, or an email/phone for older accounts. New
   accounts here are username + password.
7. **Supabase "Confirm email" must stay OFF** (synthetic `<username>@localo.app`
   addresses have no inbox).
8. **Super-admin** already exists — phone `8827548423` / `Sagar@2004`. Do not
   recreate it; use it for ad review, onboarding-for-someone and owner reassign.
9. **Location pins**: distances below are *relative to wherever you test from*.
   Indore landmarks are suggestions — what matters is the **spread**: a couple
   under 1 km, several 2–8 km, one ~15 km, one ~55 km.
10. **Guests**: keep one browser window signed out at all times. Half the gating
    bugs only show up to a guest.

---

## 2. Master account list

Password for all: **`test1234`**

> **You do not have to type any of this into the sign-up form.**
> `supabase/scripts/create_test_accounts.sql` creates every account below in one
> run — paste it into the Supabase SQL editor. It is idempotent, so re-running
> it fills in whatever is missing and resets the password on the rest.

### 2.1 Business owners

| # | Username | Display name | Business they create |
|---|---|---|---|
| 1 | `cornercafeown` | Ramesh Patel | Corner Cafe |
| 2 | `sparksown` | Anil Sharma | Sparks Electricals |
| 3 | `glowsalonown` | Kavita Nair | Glow Ladies Salon |
| 4 | `ironpeakown` | Mahendra Yadav | Iron Peak Gym |
| 5 | `sunbusown` | Deepak Chouhan | Sunrise School Transport |
| 6 | `shreerentown` | Sanjay Rathore | Shree Car & Bike Rentals |
| 7 | `aashiyanaown` | Imran Qureshi | Aashiyana Properties |
| 8 | `rangoliown` | Pooja Malviya | Rangoli Wedding Decor |
| 9 | `gurukulown` | Shrikant Dubey | Gurukul Coaching Classes |
| 10 | `coolairown` | Faizan Khan | CoolAir AC Service & Repair |
| 11 | `jaikiranaown` | Jai Prakash | Jai Kirana Store |
| 12 | `lifecareown` | Sunita Jain | LifeCare Medical Store *(solo — no team)* |
| 13 | `mahakalown` | Bhagwan Das | Mahakal Dhaba *(far, ~15 km)* |
| 14 | `ujjaintentown` | Om Prakash | Ujjain Tent House *(very far, ~55 km)* |

### 2.2 Employees

| Username | Display name | Business | Role (designation) | Level | Workspace access to grant |
|---|---|---|---|---|---|
| `cornercafeemp1` | Suresh Rawat | Corner Cafe | Manager | **manager** | Orders, Billing, Customers, Menu & pricing, Offers |
| `cornercafeemp2` | Vikram Solanki | Corner Cafe | Waiter | staff | **none** (proves a staff member sees nothing) |
| `cornercafeemp3` | Rekha Bai | Corner Cafe | Chef | staff | Menu & pricing only |
| `sparksemp1` | Nitin Verma | Sparks Electricals | Salesperson | staff | Orders, Billing |
| `sparksemp2` | Golu Yadav | Sparks Electricals | Delivery Boy | staff | Orders |
| `glowsalonemp1` | Anjali Rao | Glow Ladies Salon | Beautician | staff | Appointments |
| `glowsalonemp2` | Shalu Mehta | Glow Ladies Salon | Receptionist | **manager** | Appointments, Billing, Customers |
| `ironpeakemp1` | Ravi Thakur | Iron Peak Gym | Trainer | staff | Members |
| `ironpeakemp2` | Neelam Sisodiya | Iron Peak Gym | Receptionist | **manager** | Members, Billing, Customers |
| `sunbusemp1` | Arun Pawar | Sunrise School Transport | Manager | **manager** | Fleet & tracking, Members, Billing, Customers |
| `sunbusdrv1` | Ramlal Bhilala | Sunrise School Transport | Driver | staff | **none** (driver only — proves the sharing toggle needs no permission) |
| `sunbusdrv2` | Shyam Tomar | Sunrise School Transport | Driver | staff | none |
| `shreerentemp1` | Akash Jadhav | Shree Car & Bike Rentals | Manager | **manager** | Orders, Billing, Customers, Menu & pricing |
| `shreerentemp2` | Babu Lal | Shree Car & Bike Rentals | Driver | staff | none |
| `aashiyanaemp1` | Salman Sheikh | Aashiyana Properties | Broker | staff | Appointments, Customers |
| `rangoliemp1` | Tarun Gupta | Rangoli Wedding Decor | Photographer | staff | Appointments |
| `rangoliemp2` | Sheetal Chouhan | Rangoli Wedding Decor | Decorator | staff | Menu & pricing |
| `gurukulemp1` | Alok Mishra | Gurukul Coaching Classes | Teacher | **manager** | Members, Appointments, Billing |
| `gurukulemp2` | Priyanka Sen | Gurukul Coaching Classes | Teacher | staff | none |
| `coolairemp1` | Javed Ali | CoolAir AC Service & Repair | Technician | staff | Orders, Appointments |
| `coolairemp2` | Manoj Kumawat | CoolAir AC Service & Repair | Technician | staff | Logbook only |
| `jaikiranaemp1` | Chotu Yadav | Jai Kirana Store | Helper | staff | Orders |
| `mahakalemp1` | Kishore Baghel | Mahakal Dhaba | Cook | staff | Orders, Menu & pricing |

*(LifeCare Medical Store and Ujjain Tent House deliberately have **no employees**.)*

### 2.3 Stall sellers (personal stalls — `item` listings)

| Username | Display name | Stall becomes |
|---|---|---|
| `rohitseller` | Rohit Verma | "Rohit Verma's Stall" (rename it later to test Manage) |
| `meenaseller` | Meena Joshi | "Meena Joshi's Stall" |
| `karanseller` | Karan Singh | "Karan Singh's Stall" |

### 2.4 Pure customers (no business — these are your buyers)

| Username | Display name | What they are for |
|---|---|---|
| `custaarav` | Aarav Mehta | Main buyer: orders, dine-in tab, reviews, chat, calls, gym membership, **also a bus parent** |
| `custpriya` | Priya Sethi | Bookings (salon, site visit), party request, tracked goods parcel, muted-notification tests |
| `custvikas` | Vikas Chauhan | Product-thread questions & price offers on stalls, rentals, B2C chat |
| `custneha` | Neha Bansal | Enrols **two children** in coaching (multi-enrollee), low-star review with reason, guest→sign-in flows |

**Total: 14 owners + 23 employees + 3 stall sellers + 4 customers = 44 accounts.**
See §5 for a slimmer "Tier 1 only" path (16 accounts) if that is too many at once.

---

## 3. Business creation sheets

Each sheet = the answers to type into the register wizard, in wizard order:
**tags → basics → sell? → services? → rent? → workspace modules → location → team → review**,
plus the Manage/Workspace setup to do afterwards.

---

### B1 — Corner Cafe · *shop (food), dine-in* — `cornercafeown`

* **Listing kind:** A business
* **Tags:** `Cafe`, `Coffee`, `Snacks`, `Breakfast`, `Family Dining`, `Takeaway`
* **Name:** Corner Cafe · **Tagline:** Coffee, sandwiches and a corner to sit
* **Description:** A small neighbourhood cafe. Filter coffee, grilled sandwiches, brownies. Eight tables, open till late.
* **Hours:** Mon–Sun 08:00–23:00
* **Serve food or drinks? YES** → menu, with category groups:
  * *Beverages* — Filter Coffee `60`, Cold Coffee `120`, Masala Chai `25`, Fresh Lime Soda `50`
  * *Snacks* — Veg Sandwich `90`, Cheese Grilled Sandwich `140`, French Fries `110`, Paneer Roll `130`
  * *Desserts* — Chocolate Brownie `95`, Baked Cheesecake `160`
  * **Add photos to at least 2 items** (tests `PhotosField` upload into the `media` bucket)
* **Services? No · Rent? No**
* **Modules:** Orders, Billing & invoices, Customers
* **Location:** Vijay Nagar — pin **~1 km** away
* **Team:** `cornercafeemp1` Manager · `cornercafeemp2` Waiter · `cornercafeemp3` Chef
* **After publishing:**
  * Manage → **Tables: 8** (turns orders into dine-in tabs with table numbers)
  * Manage → **Party packages:** "Birthday Basic" `4500` (up to 15 guests, cake + decor), "Office Get-together" `9000` (up to 30 guests, snacks platter)
  * Manage → **Calls & chat:** owner handles calls **ON**; call handler = `cornercafeemp1`; chat recipients = `cornercafeemp1`, `cornercafeemp2`
  * Manage → **Details:** upload a **display picture** (`coverImageUrl`)
  * Workspace → **Offers:** (1) "Cold coffee + sandwich" tag `COMBO`, `149` was `210`, with a **photo**; (2) "Brownie hour 5–7pm" tag `40% OFF`, `57` was `95`, with a **vertical video reel (<=60 s)**
  * Showcase: 2 photos
* **Proves:** food menu + category dropdowns, dine-in running tab, adding a second round, Move-to-billing, party flow, tables, offers with photo AND reel, three levels of staff access.

---

### B2 — Sparks Electricals · *shop (products) + services* — `sparksown`

* **Tags:** `Electrical Shop`, `Hardware`, `Home Appliances`, `Electrician`
* **Name:** Sparks Electricals · **Tagline:** Wiring, fittings and everything electrical
* **Hours:** Mon–Sat 10:00–20:30, Sun closed
* **Sell products? YES**
  * LED Bulb 9W `90`, Ceiling Fan `1650`, Copper Wire 90m `1250`, Extension Board `320`, MCB 16A `240`, Inverter Battery `8900`
* **Offer services? YES** → *Home services › Electrical*
  * House wiring visit `400`, Fan installation `250`, Inverter setup `900`
* **Rent? No**
* **Modules:** Orders, Billing & invoices, Customers, Delivery
* **Location:** Palasia — pin **~3 km** away
* **Team:** `sparksemp1` Salesperson · `sparksemp2` Delivery Boy
* **After publishing:** Manage → Calls & chat → **owner handles calls OFF**, handlers = both employees; chat recipient = `sparksemp1`
* **Proves:** a listing with BOTH products and services, owner opting out of calls (the ring goes only to staff), delivery module, an order proposal (business unticks the Inverter Battery line).

---

### B3 — Glow Ladies Salon · *service, bookings* — `glowsalonown`

* **Tags:** `Ladies Salon`, `Beauty Parlour`, `Bridal Makeup`, `Mehndi`, `Nail Art`
* **Name:** Glow Ladies Salon · **Tagline:** Hair, skin and bridal — by appointment
* **Hours:** Tue–Sun 10:00–20:00, Mon closed
* **Sell? No · Rent? No**
* **Services? YES** → *Beauty & grooming*
  * Hair → Haircut & styling `300`, Hair spa `900`
  * Skin & facial → Fruit facial `700`, Clean-up `450`
  * Makeup → Party makeup `1500`, **Bridal makeup** `8000`
  * Nails → Gel nails `1200`
* **Modules:** Appointments & bookings, Billing & invoices, Customers
* **Location:** Sudama Nagar — pin **~4 km** away
* **Team:** `glowsalonemp1` Beautician · `glowsalonemp2` Receptionist (manager)
* **After publishing:** chat recipient = `glowsalonemp2`; showcase 3 photos + 1 video
* **Proves:** a booking-only business (no Order button), booking accept/decline notifications, the Mon-closed open/closed badge.

---

### B4 — Iron Peak Gym · *service + memberships* — `ironpeakown`

* **Tags:** `Gym`, `Fitness`, `Personal Trainer`, `Yoga`
* **Name:** Iron Peak Gym · **Tagline:** Weights, cardio and 6 am yoga
* **Hours:** Mon–Sat 05:30–22:00, Sun 06:00–11:00
* **Services? YES** → *Health & wellness › Yoga & fitness*
  * Monthly membership `1200`, Quarterly membership `3000`, Personal training (monthly) `4000`, Morning yoga batch `800`
* **Modules:** Memberships, Billing & invoices, Customers, Staff attendance
* **Location:** Vijay Nagar — pin **~2 km** away
* **Team:** `ironpeakemp1` Trainer · `ironpeakemp2` Receptionist (manager)
* **Proves:** the **Enroll** button (separate from Order), pending membership → accept with plan + ₹/month, the customer's **Subs tab**, month-by-month spend popup, "Renews soon", cancel keeping history.

---

### B5 — Sunrise School Transport · *service + fleet & live tracking* — `sunbusown`

* **Tags:** `School Bus Service`, `Transport`, `Bus Service`
* **Name:** Sunrise School Transport · **Tagline:** Safe school runs, tracked live
* **Hours:** Mon–Sat 06:00–18:00
* **Services? YES** → *Transport & moving › Goods transport* (or Other)
  * School bus seat — one way `900`, Both ways `1500`, Van seat (both ways) `1800`
* **Modules:** **Fleet & live tracking**, Memberships, Billing & invoices, Customers
* **Location:** Bhawarkuan — pin **~5 km** away
* **Team:** `sunbusemp1` Manager · `sunbusdrv1` Driver · `sunbusdrv2` Driver
* **After publishing — Fleet & tracking screen:**
  * Vehicle 1: plate `MP09 AB 1234`, kind **Bus**, pet name "Sunrise 1", driver = `sunbusdrv1`
  * Vehicle 2: plate `MP09 CD 5678`, kind **Van**, pet name "Sunrise 2", driver = `sunbusdrv2`
  * Tracked item 1: kind **child**, name "Aarav Jr", customer `custaarav`, on Sunrise 1
  * Tracked item 2: kind **child**, name "Ansh", customer `custneha`, on Sunrise 1
  * Tracked item 3: kind **goods**, name "Parcel — Priya", customer `custpriya`, on Sunrise 2
* **Proves:** vehicles + drivers, the driver's "Share my live location" toggle (with **no** workspace permissions), members seeing the whole fleet vs a customer seeing only their own vehicle, the "Track my child" button on the business page.

---

### B6 — Shree Car & Bike Rentals · *rental, per day* — `shreerentown`

* **Tags:** `Car Rental`, `Bike Rental`, `Wedding Car`, `Taxi`
* **Name:** Shree Car & Bike Rentals · **Tagline:** Self-drive cars and bikes, by the day
* **Rent anything out? YES · basis: per day**
  * *Cars* → Hatchback: Swift `1800`; Sedan: Dzire `2200`; SUV: Ertiga `3000`; Luxury: Wedding Ciaz `6500`
  * *Bikes* → Scooter: Activa `500`; Motorcycle: Bullet 350 `1200`
* **Sell? No · Services? No**
* **Modules:** Orders, Billing & invoices, Customers
* **Location:** Rajwada — pin **~6 km** away
* **Team:** `shreerentemp1` Manager · `shreerentemp2` Driver
* **After publishing:** Manage → **Availability** → mark "Bullet 350" **taken**, leave the rest available
* **Proves:** rental basis per day, the Rentals intent tile, the availability toggle without deleting a listing, ordering a rental.

---

### B7 — Aashiyana Properties · *rental, per month (real estate)* — `aashiyanaown`

* **Tags:** `Real Estate`, `Property Dealer`, `Flats & Rooms`, `PG & Hostel`, `Shop for Rent`
* **Name:** Aashiyana Properties · **Tagline:** Flats, PGs and shops on rent in Indore
* **Rent anything out? YES · basis: per month**
  * *Flats & rooms* → 1 BHK, Scheme 54 `9000`; 2 BHK, Vijay Nagar `16000`; 3 BHK, Nipania `28000`; PG bed (girls) `5500`; Shop / office, MG Road `22000`
* **Modules:** Appointments & bookings, Customers, Billing & invoices
* **Location:** Scheme 54 — pin **~2.5 km** away
* **Team:** `aashiyanaemp1` Broker
* **Proves:** monthly rental basis alongside B6's per-day one, a rental business that takes **bookings** (site visits) rather than orders, Rentals + Professional intents both matching.

---

### B8 — Rangoli Wedding Decor · *service + heavy showcase* — `rangoliown`

* **Tags:** `Wedding Decor`, `Wedding Planner`, `Tent House`, `Lighting & Decoration`, `Wedding Photography`, `DJ & Sound`
* **Name:** Rangoli Wedding Decor · **Tagline:** Mandaps, haldi stages and lights
* **Services? YES** → *Events*
  * Decoration → Haldi stage decor `15000`, Mandap decor `45000`
  * Photography → Wedding shoot (1 day) `25000`
  * Sound & lighting → DJ + lights `18000`
  * Tent & furniture → Shamiyana + 100 chairs `12000`
* **Modules:** Appointments & bookings, Billing & invoices, Customers
* **Location:** Nipania — pin **~8 km** away
* **Team:** `rangoliemp1` Photographer · `rangoliemp2` Decorator
* **After publishing — Showcase screen:**
  * Add **3 photos**, then try a **4th** → expect the cap message (3 photos max)
  * Add **1 video (<=60 s)**, then try a **2nd** → expect the cap message
  * Add **showcase links** (uncapped): an Instagram profile, a Google Drive folder, a YouTube video — check each chip picks up the right kind
* **Proves:** showcase caps and their error messages, showcaseLinks host detection, inline video playback, one business landing in **Events** AND **Digital** intents.

---

### B9 — Gurukul Coaching Classes · *education + memberships* — `gurukulown`

* **Tags:** `Coaching`, `Home Tuition`, `Competitive Exams`, `Spoken English`, `Tutor`
* **Name:** Gurukul Coaching Classes · **Tagline:** Class 6–12, NEET & JEE foundation
* **Hours:** Mon–Sat 07:00–20:00
* **Services? YES** → *Classes & coaching*
  * School tuition → Class 9–10 batch `1500`, Class 11–12 batch `2200`
  * Competitive exams → NEET foundation `3500`, JEE foundation `3500`
  * Languages → Spoken English `1200`
* **Modules:** Memberships, Appointments & bookings, Billing & invoices, Customers, Staff attendance
* **Location:** Bhawarkuan — pin **~5 km** away
* **Team:** `gurukulemp1` Teacher (manager) · `gurukulemp2` Teacher
* **Proves:** a SECOND memberships business, so the Subs tab groups by business and the monthly total adds up across two; `custneha` enrolling **two children in one go** (multi-enrollee Enroll screen).

---

### B10 — CoolAir AC Service & Repair · *multi-intent service* — `coolairown`

* **Tags:** `AC Repair`, `AC Installation`, `Fridge Repair`, `Washing Machine Repair`, `Home Appliances`
* **Name:** CoolAir AC Service & Repair · **Tagline:** Same-day AC, fridge and washing machine repair
* **Services? YES**
  * *Repairs › AC* → AC service `599`, Gas refill `2400`
  * *Repairs › Refrigerator* → Fridge repair visit `450`
  * *Repairs › Washing machine* → Washing machine repair `500`
  * *Installation & fitting › AC* → Split AC installation `1600`
* **Modules:** Orders, Appointments & bookings, Billing & invoices, Customers
* **Location:** Annapurna — pin **~7 km** away
* **Team:** `coolairemp1` Technician · `coolairemp2` Technician
* **Proves:** the tags-first promise — this ONE listing must appear under **Home Services** *and* **Electronics**; a service order the business **partly accepts** (untick "Gas refill" → proposal → customer accepts → bill for the rest); the logbook-only permission.

---

### B11 — Jai Kirana Store · *grocery shop + B2B supplier* — `jaikiranaown`

* **Tags:** `Kirana Store`, `Grocery`, `General Store`, `Dairy`
* **Name:** Jai Kirana Store · **Tagline:** Daily needs, delivered in the colony
* **Hours:** Mon–Sun 07:00–22:00
* **Sell products? YES**
  * Toor Dal 1 kg `150`, Sugar 1 kg `48`, Amul Milk 500 ml `28`, Atta 5 kg `260`, Detergent 1 kg `120`, Cooking Oil 1 L `140`
* **Modules:** Orders, Billing & invoices, Delivery, Customers
* **Location:** **the closest one — pin ~800 m away** (it should sit at the top of Home)
* **Team:** `jaikiranaemp1` Helper
* **Proves:** distance sorting (this must be #1 on Home), the Groceries intent, and **B2B chat**: sign in as `cornercafeown`, open B2B chat, chat *as* Corner Cafe to Jai Kirana Store asking for 5 kg sugar; reply from `jaikiranaown` — bubbles must be attributed "‹member› · ‹business›".

---

### B12 — LifeCare Medical Store · *solo owner, no team* — `lifecareown`

* **Tags:** `Medical Store`, `Pharmacy`
* **Name:** LifeCare Medical Store · **Tagline:** Medicines and daily health needs
* **Hours:** Mon–Sun 09:00–22:30
* **Sell products? YES** — Paracetamol strip `22`, Cough syrup `95`, Hand sanitiser `60`, Digital BP monitor `1850`, Glucometer strips `450`
* **Modules:** Orders, Billing & invoices
* **Location:** pin **~1.5 km** away
* **Team: NONE** — skip the team step entirely
* **Proves:** the solo path end-to-end — a workspace with no team section, calls ringing only the owner, chat with no recipients configured, and deleting the listing later (owner-only delete).

---

### B13 — Mahakal Dhaba · *far away (~15 km), food* — `mahakalown`

* **Tags:** `Dhaba`, `North Indian`, `Pure Veg`, `Family Dining`, `Restaurant`
* **Name:** Mahakal Dhaba · **Tagline:** Dal bafla on the highway
* **Serve food? YES** — *Main course*: Dal Bafla `180`, Paneer Butter Masala `260`, Jeera Rice `120`; *Breads*: Tandoori Roti `20`, Butter Naan `45`; *Sweets*: Gulab Jamun `60`
* **Modules:** Orders, Billing & invoices
* **Location:** Rau / Mhow road — pin **~15 km** away (just **inside** the 20 km Home ring)
* **Team:** `mahakalemp1` Cook
* **After publishing:** create an offer "Dal bafla thali" `149` was `220`, then **buy an ad plan** from Workspace → Promote (it lands `pending`)
* **Proves:** a listing near the edge of the ring still makes Home (last in the list); its free offer must **NOT** reach you (beyond `FREE_REACH_KM` 2 km) unless cold-start widening kicks in; after the super-admin approves the campaign it **must** appear (sponsored reach 25 km); in the deals feed it appears only once the range picker is at 25 km or wider.

---

### B14 — Ujjain Tent House · *very far (~55 km), rental* — `ujjaintentown`

* **Tags:** `Tent House`, `Equipment Rental`, `DJ & Sound`
* **Name:** Ujjain Tent House · **Tagline:** Tents, chairs and generators for any function
* **Rent anything out? YES · basis: per day**
  * *Tent & event gear* → Shamiyana 30x40 `6000`; Chairs & tables: 100 chairs `1500`; Generator: 5 KVA `2500`; Stage & truss: Stage 20x16 `4000`
* **Sell? No · Services? No**
* **Modules:** Orders, Billing & invoices
* **Location:** Ujjain — pin **~55 km** away (**outside** the 20 km Home ring)
* **Team: NONE**
* **Proves:** the Home radius actually holds — this listing must be **absent from Home** yet still reachable by **search** and from its **category page**; plus the `100 km` / `Anywhere` steps of the deals range picker and distance label formatting at long range.

---

### S1–S3 — Personal stalls (`item` listings)

Register from **My Business → Selling my own stuff**, or the Stalls tab's "＋ Sell something".
Add items **one at a time** — each new item folds into the same stall (that IS the test).

| Seller | Items (name · asking price · category · photos) |
|---|---|
| `rohitseller` | iPhone 15 Pro 256GB · `72000` · **Electronics** · 3 photos<br>Study Table · `2500` · **Furniture** · 1 photo<br>Royal Enfield Classic 350 (2019) · `135000` · **Vehicles** · 2 photos<br>Cricket Kit (bat + pads) · `1800` · **Other** · no photo *(tests the emoji fallback tile)* |
| `meenaseller` | Handmade Soy Candles (set of 3) · `250` · **Home & garden** · 2 photos<br>Jute Tote Bag · `400` · **Other** · 1 photo<br>Macrame Wall Hanging · `900` · **Home & garden** · 1 photo |
| `karanseller` | Semi-automatic Washing Machine · `6500` · **Appliances** · 2 photos<br>Double Bed with mattress · `8000` · **Furniture** · 2 photos<br>Hero Sprint Cycle · `3200` · **Vehicles** · 1 photo |

**After creating:**
* Rename Rohit's stall in Manage to **"Rohit's Corner"** (proves `defaultStallName` is renameable).
* As `custvikas`, on the iPhone product page: ask a **question**, and post a **price offer** of `65000`.
* As `rohitseller`: **reply** to the question (it should nest under it), then **Accept ₹65,000 & mark sold** on the offer.
* As `custaarav`: check the sold item still shows, faded, with a SOLD badge, and its thread is still readable.
* **Proves:** stall folding, one-listing-per-seller, stall chips filtering by item category, product page carousel, the PUBLIC product thread (nested replies), accept-and-sell in one action, seller/asker notifications.

---

## 4. Activity to generate after everything exists

Reviews, customer lists and the Subs tab need real history. Do these in order:

1. **Orders (dine-in tab):** `custaarav` orders 2 coffees + fries at Corner Cafe → `cornercafeemp1` accepts (stays an **open tab**, table auto-assigned) → Aarav adds a brownie (a second round) → a member hits **Move to billing**.
2. **Order proposal:** `custaarav` orders LED bulbs + an Inverter Battery from Sparks → `sparksemp1` unticks the battery → Aarav sees the struck-out line and **accepts** → bill for the rest. Repeat once and **decline**.
3. **Party request:** `custpriya` books "Birthday Basic" at Corner Cafe for 18 guests, Sat 7 pm → the business **counters** the price → Priya accepts → billed after the event.
4. **Booking:** `custpriya` books Bridal makeup at Glow Ladies Salon → `glowsalonemp2` accepts. `custneha` books a site visit at Aashiyana → **declined**.
5. **Membership:** `custaarav` enrols at Iron Peak Gym (Monthly `1200`) → accepted. `custneha` enrols **two children** at Gurukul (Class 9–10 `1500` each) → accepted. Cancel one later.
6. **Manual bill:** `lifecareown` bills a **walk-in** named "Ramu Kaka" (a `walkin:` customer key), and bills `custaarav` in-app → sends it into his chat.
7. **Chat:** `custvikas` messages CoolAir; `coolairemp1` replies → Vikas gets a notification.
8. **Call:** `custaarav` calls Corner Cafe (rings the owner + `cornercafeemp1`); once as a **guest** (anonymous sign-in); once with **nobody answering** → missed-call alert + a call-log row.
9. **Reviews (only now — they need a verified customer):** `custaarav` 5★ Corner Cafe with a comment; `custpriya` 4★ Glow Salon; `custneha` **2★** CoolAir → must **force a written reason**; `custvikas` tries to review Ujjain Tent House with no history → gate screen. Then `custaarav` **edits** his rating.
10. **Ads:** approve Mahakal Dhaba's campaign as super-admin, mark it paid, then view/tap the card from different distances and read the "Who saw it" band report.
11. **Tracking:** `sunbusdrv1` toggles "Share my live location" → `custaarav` opens "Track my child"; `sunbusemp1` sees both buses.
12. **Notifications:** `custpriya` **mutes** the orders family for Corner Cafe, places an order, and confirms no alert arrives but the order is still in her Orders tab.

---

## 5. If 44 accounts is too many — do it in tiers

**Tier 1 (16 accounts, covers ~80% of the app):**
`cornercafeown` + `cornercafeemp1` + `cornercafeemp2`, `sparksown` + `sparksemp1`,
`glowsalonown` + `glowsalonemp1`, `ironpeakown`, `sunbusown` + `sunbusdrv1`,
`shreerentown`, `rohitseller`, `custaarav`, `custpriya`, `lifecareown`, plus your super-admin.
→ B1, B2, B3, B4, B5, B6, B12, S1.

**Tier 2 (adds the rest of the shapes):** `aashiyanaown`, `rangoliown`, `gurukulown`,
`coolairown`, `jaikiranaown` + their employees, `meenaseller`, `custvikas`, `custneha`.
→ B7, B8, B9, B10, B11, S2.

**Tier 3 (distance & edge cases):** `mahakalown` + `mahakalemp1`, `ujjaintentown`,
`karanseller`, and the remaining "no permissions" employees.
→ B13, B14, S3.

---

## 6. Creation order (do not shuffle)

0. **Skip the sign-up form** — paste `supabase/scripts/create_test_accounts.sql`
   into the Supabase SQL editor and run it. It creates all 44 accounts below
   exactly as sign-up would (same trigger, same profile shape), is idempotent,
   and is not subject to the auth API's 30-signups-per-hour rate limit.
   *(30 of the 44 were already created this way on 2026-08-21; re-running the
   script fills in the rest and resets the password on the ones that exist.)*
1. All **employee** and **customer** accounts first (they must exist to be linked or found).
2. Then each **owner** account, and immediately its business (§3).
3. Then per-business **Manage** setup (tables, party packages, availability, calls & chat routing, display picture).
4. Then **Fleet** vehicles + tracked items (B5).
5. Then **offers** and one **ad campaign** (B1, B13).
6. Then the **stalls** (S1–S3).
7. Then the **activity** in §4 — reviews last, because they need order/booking/bill history.
