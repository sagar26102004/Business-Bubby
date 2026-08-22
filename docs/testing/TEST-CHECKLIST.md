# Localo — Full feature test checklist

Every feature the app has today, grouped by area, with the account from
**[TEST-DATA.md](TEST-DATA.md)** to use for each. Tick as you go.

Legend for who to be signed in as:
**G** = signed-out guest · **C** = a customer account · **O** = a business owner ·
**M** = a manager-level employee · **S** = a staff employee with no permissions ·
**A** = the super-admin (`8827548423`).

---

## 1. Accounts & identity

- [ ] Sign up with username + password only (leave name, email, phone blank) — works
- [ ] Sign up with a username that breaks a rule: 2 chars, starts with a digit, has a dash, 21 chars — each is refused with a readable message
- [ ] Sign up with a 5-character password — refused
- [ ] Sign up with the same username twice — refused
- [ ] Sign in by username; sign in by phone/email for an older account (the seeded ten, super-admin)
- [ ] Wrong password → inline error, not a popup
- [ ] Sign out returns you to guest browsing
- [ ] Edit profile: change display name, add email + phone (bad email / 9-digit phone are refused)
- [ ] Toggle **profile public/private** → check the employee page is tappable / not tappable from a business page
- [ ] Change password, then sign in with the new one
- [ ] Google sign-in button — expect "not configured" (known state, just confirm it fails cleanly)
- [ ] Delete account with no listings → works; delete an owner with a staffed business → **blocked** with the reason listed
- [ ] **G**: browse, open a business, call, chat → guest is allowed; picking Home/Work place or publishing a business → routed to sign-in

## 2. Location & distance

- [ ] First launch asks for GPS permission; **Current** place shows your real position
- [ ] Deny permission → falls back to the seeded Indore point, app still works
- [ ] Add saved places **Home** and **Work** (`/saved-places`), switch between them from the Home dropdown
- [ ] Switching place **re-sorts the business list** (Jai Kirana ~800 m should lead from your test point)
- [ ] Distance labels render sensibly at 800 m, 5 km, 15 km, 55 km
- [ ] **G**: tapping Home/Work in the dropdown shows the lock and routes to sign-in
- [ ] Map screen: real street tiles, blue dot, 1/3/5 km rings, only businesses **within 5 km** plotted (B13/B14 must be absent)
- [ ] Tap a map marker → card → business page
- [ ] **Home 20 km radius:** Mahakal Dhaba (~15 km) **is** on Home, last; Ujjain Tent House (~55 km) is **not**
- [ ] The 55 km listing is still findable by **search** and on its **category page** (the cap is Home-only)
- [ ] Switch the active place to one nearer/further and watch a listing cross the boundary in and out
- [ ] Empty state names the radius ("Nothing listed within 20 km…") rather than reading as "nothing exists"
- [ ] Before GPS resolves (or with permission denied and no fallback point) the list is **not** empty — the cap is skipped when there is no "here"
- [ ] A sponsored ad from the 15 km business still shows on Home (ads keep their own 25 km reach, independent of this cap)

## 3. Home / browse / search

- [ ] Category strip: every intent from `INTENT_CATEGORIES` renders, active one is underlined and coloured
- [ ] Picking a category filters the list inline (no navigation) and re-scopes the deals carousel heading
- [ ] Subcategory tiles appear under the strip and only show tags actually present nearby
- [ ] Tapping a tile opens `/browse/<intent>?sub=<Tag>` with that chip pre-selected
- [ ] **Multi-intent test:** CoolAir (B10) appears under **Home Services** AND **Electronics**
- [ ] **Rentals** intent shows B6, B7, B14; **Stalls** intent shows the three stalls
- [ ] Sticky search bar pins to the top once you scroll past it
- [ ] Search: typing shows debounced suggestions from real data (business names, dish names, product names, tags)
- [ ] Search "brownie" finds Corner Cafe by a **menu item**; "Bullet" finds the rental; "iPhone" finds Rohit's stall
- [ ] Search results are sorted by distance with a result count
- [ ] Empty search / no results → empty state, not a crash
- [ ] Home refetches on tab focus (register a business in another window, come back, it appears)

## 4. Business page

- [ ] Top bar has **Call · Chat · QR** as round buttons beside the back chevron
- [ ] Hero: display picture, name, provider type, tagline, rating, open/closed badge, tags, description, hours, location line, distance, **Get directions**
- [ ] Open/closed badge is correct for Glow Salon on a **Monday** (closed) and Sparks on a **Sunday** (closed)
- [ ] Offerings section shows only the blocks that exist (menu / products / services / rentals / party packages)
- [ ] Category chips inside a block expand inline; "+N more" hands over to the full screen
- [ ] Customer action buttons at the foot of the offerings section are the right ones per business (Order / Buy / Enroll / Book / Party / Continue tab / Track)
- [ ] Showcase slider auto-rotates; tap opens a full-screen swipeable pager; a video plays inline
- [ ] Showcase link chips (B8) open Instagram / Drive / YouTube
- [ ] Reviews section: average, 5→1 star breakdown, tapping a bar **filters**, tapping again clears
- [ ] Owner section at the bottom; team members are **not** listed to customers
- [ ] Member-only tools (Edit page, Workspace) show only to owner/employees
- [ ] Page refetches on focus — edit a rating and come back, the average has changed
- [ ] QR screen renders a scannable code; scanning it on a phone opens the business page
- [ ] `/scan` on web shows the paste-a-link fallback; on a phone it opens the camera

## 5. Registering a listing (the wizard)

- [ ] Progress bar advances; Back never loses answers
- [ ] "Next" is never silently disabled — an incomplete step explains what is missing
- [ ] Tags step: pick from suggestions **and** type a custom tag
- [ ] Yes/No branch steps skip ahead correctly on "No"
- [ ] Food-tagged business publishes items as a **menu**; non-food as **products**
- [ ] Services step files each service under a SERVICE_SECTIONS chip
- [ ] Rentals step asks per day / per month and files under RENTAL_SECTIONS chips
- [ ] Workspace modules step: picking **Fleet & live tracking** lets you stage vehicles (plate + kind + pet name) which exist right after publish
- [ ] Location step: pin drag, address free text, State → City → Country typeahead
- [ ] Location privacy flags (is home / hide precise location) are respected on the business page
- [ ] Team step: search a registered user by **display name**, link them, set role + level
- [ ] Team step: add an **unlinked** name (no account) — it should be allowed but never receive calls
- [ ] Review step: tapping a row jumps back to that step
- [ ] Publish → lands in My Business, and appears on Home within one refresh
- [ ] `?type=item` from a stall's Add-an-item button preselects the stall flow
- [ ] Derived listing type is right: rents only → rental, food/sells → shop, services only → service

## 6. Manage (the twelve tiles)

- [ ] Hub shows a summary line on each tile ("12 dishes", "Mon–Sat 9:00–19:00", "No tables")
- [ ] **Details** — name, tagline, description, display picture upload
- [ ] **Tags** — add/remove, and the business moves category on Home accordingly
- [ ] **Hours** — per-day, closed days, and the open/closed badge follows
- [ ] **Availability** — rental taken/available, per day vs per month
- [ ] **Menu** — add/edit/remove dishes, categories, photos
- [ ] **Products / Services / Rentals** — same, each with prices and sections
- [ ] **Tables** — set 8, clear to none, and check dine-in behaviour changes
- [ ] **Parties** — add/edit party packages
- [ ] **Calls & chat** — call handlers, `ownerHandlesCalls` off, chat recipients, scan handlers, per-member rank and "show on page"
- [ ] **Tools** — enable/disable modules and watch workspace tiles appear/disappear
- [ ] A member with **Menu & pricing** only (`cornercafeemp3`) sees ONLY the catalog tiles
- [ ] Cache check: edit a price, go back — the hub summary is already fresh
- [ ] **Delete listing** — owner only, type-the-name confirm; an employee cannot see it

## 7. Access & permissions (the part most likely to leak)

- [ ] **S** (`cornercafeemp2`, no permissions): workspace shows essentially nothing; direct URLs to orders/billing/customers are refused
- [ ] **M** (`cornercafeemp1`): sees orders, billing, customers, catalog — but not owner-only actions (delete)
- [ ] `coolairemp2` (logbook only) can open the logbook and nothing else
- [ ] `sunbusdrv1` (no permissions) still sees the **Share my live location** toggle
- [ ] A non-member opening `/workspace/<id>` directly is turned away
- [ ] A customer opening `/bills/<id>` or `/customers/<id>` directly is turned away
- [ ] **A** (super-admin) can open any business's manage/workspace

## 8. Orders

- [ ] Customer order: quantity steppers, note, running total, menu category dropdowns with picked counts
- [ ] Order lands as `requested`, business gets a notification deep-linking to it
- [ ] **Accept all** → `accepted` + bill auto-issued (non-dine-in: Sparks, LifeCare)
- [ ] **Untick a line** → `proposed`; customer sees included vs struck-out lines with prices
- [ ] Customer **accepts** a proposal → bill for the included lines
- [ ] Customer **declines** a proposal → order closes, business notified
- [ ] **Reject with a message** → customer sees the message
- [ ] **Dine-in tab (B1):** accepting does NOT bill; table number auto-assigned to the lowest free table
- [ ] Adding a second round appends to the same tab and returns it to `requested`
- [ ] **Move to billing** from the order page AND from the workspace open-tab card
- [ ] Two customers on tabs at once get different table numbers
- [ ] Party request: package or custom, guests/when/occasion, optional budget → business counters → customer accepts → billed after
- [ ] `/orders/<businessId>` — member sees all orders, customer sees only their own
- [ ] **My Orders tab** — every order across all businesses, IN PROGRESS vs PAST, proposals flagged, refreshes on focus
- [ ] Buying a **stall item** goes through the same order flow
- [ ] Ordering a **rental** works and the rental basis shows on the line

## 9. Billing

- [ ] Auto bill on order acceptance carries the right lines and total
- [ ] Manual bill: pick a known customer from chats/orders, quick-add catalog lines, add a custom line
- [ ] Manual bill to a **walk-in** typed name
- [ ] Bill detail renders the invoice properly
- [ ] **Share** → native share sheet on phone, Web Share/clipboard on web (text bill for now)
- [ ] **Send in customer's chat** → appears as a tappable bill card in the thread
- [ ] `/bills/<businessId>` lists every bill, members only
- [ ] `bill_issued` notification deep-links to the bill

## 10. Bookings / appointments

- [ ] Book from a service business: free-text date/time
- [ ] Owner notified; accept and decline both notify the customer
- [ ] A booking business shows no Order button, and vice versa
- [ ] Accepted bookings appear in the workspace list
- [ ] `custneha`'s declined site visit at Aashiyana reads correctly on both sides

## 11. Memberships / Subs

- [ ] Customer taps **Enroll / Subscribe** on B4 and B9 — a different flow from Order
- [ ] Multi-enrollee: `custneha` adds two children in one go → **two separate pending requests**
- [ ] Blank enrollee name falls back to "Member 1" / "Member 2"
- [ ] Business accepts with plan name + ₹/month; declines the other
- [ ] Subs tab groups by business, shows subscribed / last renewed / renews dates
- [ ] "Renews soon" appears inside 7 days
- [ ] This-month total card is right across BOTH businesses
- [ ] Month-by-month popup pages back through history
- [ ] Cancel a membership → stops future, keeps past months

## 12. Chat (B2C) and B2B

- [ ] Customer chat: one thread per business, business replies show "‹member› from ‹business›"
- [ ] Business inbox lists threads per customer; the right members can reply
- [ ] A member with no chat permission cannot open the inbox
- [ ] Notification when a business replies; unread badge on the tab
- [ ] **G**: a guest can chat, and the thread survives them signing in
- [ ] **B2B**: `cornercafeown` chats *as* Corner Cafe to Jai Kirana; either side's members can reply; bubbles attributed "‹member› · ‹business›"
- [ ] B2B "chat as" picker lists only businesses you own/work at, stalls excluded
- [ ] Start a new B2B thread by name search

## 13. Voice calls

- [ ] Pre-call screen names who will ring
- [ ] Corner Cafe: rings owner **and** `cornercafeemp1` at once
- [ ] Sparks (owner opted out): rings **only** the two employees
- [ ] LifeCare (solo): rings only the owner
- [ ] Answer on one device → the other handler sees "teammate answered — join?"
- [ ] Group join / leave / end each update the participant list
- [ ] Mute works; the audio-route picker lists earpiece and speaker (earpiece is the default)
- [ ] Press **back** during a call → the green tap-to-return bar appears and the audio keeps running
- [ ] Nobody answers → missed-call notification + a row in the call log
- [ ] Decline → shows as declined to the caller
- [ ] **G**: a guest can call (anonymous sign-in happens silently)
- [ ] Call log (`/workspace/<id>/calls`) shows the last 7 days: answered, missed, declined, duration, who picked up
- [ ] A missed call from a signed-in caller taps through to their chat thread
- [ ] Kill the app mid-call (swipe from Recents) → the other side's call ends within the lease window, and the log row shows `ended`, not a stuck `active`
- [ ] *(phone build only)* incoming call rings + vibrates with the app closed; the lock-screen call UI appears

## 14. Live tracking / fleet

- [ ] Fleet screen: add/edit/remove vehicles, pin a driver to each
- [ ] Register tracked items (child / goods) against a customer and a vehicle
- [ ] Driver toggles **Share my live location** on → appears live; off → disappears
- [ ] Member map shows **both** buses; `custaarav` sees only Sunrise 1
- [ ] "Track my child / goods" button shows on the business page only for customers with a tracked item
- [ ] Map polls and the marker visibly moves (simulated movement)

## 15. Stalls & product threads

- [ ] First item creates "‹Name›'s Stall"; the second item **folds in** (no second listing)
- [ ] Rename the stall in Manage
- [ ] Stalls tab: picture-first grid, price badge, seller · distance
- [ ] Category chips filter by the item categories actually present
- [ ] An item with no photo falls back to the category emoji tile
- [ ] Product page: swipeable photo carousel with dots, price, description, seller card
- [ ] Public thread: anyone signed in asks a question; a **price offer** via the 💰 toggle
- [ ] Seller's reply nests under the question; two conversations run side by side
- [ ] **Accept ₹X & mark sold** posts the reply and closes the item in one action
- [ ] Sold item stays listed, faded, with a SOLD badge; the thread stays readable
- [ ] Seller notified of questions/offers; asker notified of the reply; both deep-link to the item
- [ ] **G**: a guest can read a thread but is routed to sign-in to post

## 16. Reviews

- [ ] A customer with **no** history cannot review (gate screen)
- [ ] A customer with an accepted order / booking / bill **can**
- [ ] Chats and calls alone do **not** unlock reviewing
- [ ] An owner cannot review their own business
- [ ] 1★ and 2★ **require** a written comment (try to submit without one)
- [ ] Re-submitting edits the existing review rather than adding a second
- [ ] Average and count update on the business page immediately after
- [ ] Owner gets a `review_posted` notification
- [ ] Star-breakdown bars filter the review slider

## 17. Offers, ads & the promote flow

- [ ] Create an offer with a photo; create one with a **video reel**
- [ ] Offers show on the business page and in the Home ad slot
- [ ] Free offer reach: Corner Cafe (1 km) shows; Mahakal (15 km) does **not** — unless cold-start widening fills a thin slot
- [ ] Buy an ad plan → lands `pending`, the clock has not started
- [ ] **A**: `/ad-review` shows it, approve → it goes live and **now** the clock starts; try reject and mark-paid too
- [ ] Sponsored card shows on Home from 15 km away (25 km reach) and is labelled **Sponsored**
- [ ] Tapping a sponsored card records a tap and opens the business
- [ ] Promote screen shows progress against the promised views + the "Who saw it" distance-band report
- [ ] Pausing the underlying offer takes the ad down
- [ ] Deals feed: full-screen swipe-up, reels autoplay on the page in view, intent chips, Reels-only filter
- [ ] Range picker 1 → 200 km → Anywhere changes what appears (B13 at 25 km, B14 at 100 km)
- [ ] "See all" from Home carries the place and category over

## 18. Notifications

- [ ] Alerts segment shows only **unread**; opening one removes it; "Mark all read" clears the list
- [ ] Unread badge on the tab updates
- [ ] Each family fires: order requested / order update, chat reply, missed call, booking, bill issued, review posted, product question / reply
- [ ] Deep links land on the right screen (order, bill, product, chat)
- [ ] Per-business mute (`Workspace → Manage notifications`) hides that family for that business only
- [ ] Global mute (`/notification-settings`, the 🔕 button) hides it everywhere
- [ ] A muted alert is **not lost** — the underlying order/call/message is still visible in the workspace
- [ ] Only the families a business's modules can produce are offered in its mute screen

## 19. Customers & favourites

- [ ] Customer list aggregates people from orders, bookings, bills, chats and calls
- [ ] A walk-in bill customer appears as `walkin:<name>`
- [ ] A guest's activity appears under `guest`
- [ ] Activity counts and total billed look right
- [ ] Owner stars a favourite → it pins to the top and survives a reload
- [ ] Quick links jump to the chat / orders / new bill for that customer

## 20. Super-admin / platform console

- [ ] **A**'s My Business tab renders the **console**, not a business list
- [ ] Stat strip: listings, ads waiting, ads live, collection
- [ ] Register a listing **on behalf of** another owner (owner picker in the wizard)
- [ ] `/admin/listings`: search any business, jump to its page / workspace / pricing / offers / promote
- [ ] `/admin/catalog`: tags & offerings curation
- [ ] Anything left under the admin's own account shows in Owned listings → **reassign owner** to the real owner
- [ ] Confirm an admin **cannot** delete someone else's listing (reassign first, by design)
- [ ] A non-admin hitting `/admin` gets the "Admins only" door

## 21. Media & uploads

- [ ] Photo upload from camera and gallery (phone); the file-dialog fallback on web
- [ ] Uploaded photos survive a reload (they are real URLs, not `blob:`)
- [ ] Multi-select, remove, "Make cover"
- [ ] Display picture on the business hero
- [ ] Video reel upload (<=60 s) plays inline in the deals feed
- [ ] Showcase caps: 3 photos + 1 video enforced with a clear message
- [ ] Signed out → uploads silently fall back to the local URI (no crash, no upload)

## 22. Cross-cutting / regression sweeps

- [ ] Responsive web: resize from phone width to desktop — grids gain columns, content stays centered, nothing overflows
- [ ] Dark mode / theme tokens: no hardcoded colours showing through
- [ ] Every screen's loading, error and empty states (kill the network mid-load once)
- [ ] Back navigation from every deep screen returns somewhere sensible (never a blank stack)
- [ ] Two devices / two browser windows: an action on one appears on the other after a refresh
- [ ] Sign out mid-flow (e.g. on the order screen) → routed cleanly, no stuck spinner
- [ ] Deleting a business cascades: its orders, bills, chats, reviews and vehicles disappear
- [ ] Verify build health after any code change: `npx tsc --noEmit` and `npx expo export --platform web` both exit 0

---

## Suggested test order

1. §1 accounts → §5 registering → §2 location (the world exists now)
2. §3 browse/search → §4 business page (customer-side reading)
3. §8 orders → §9 billing → §10 bookings → §11 memberships (transactions)
4. §12 chat → §13 calls → §18 notifications (communication)
5. §15 stalls → §16 reviews → §17 ads (marketplace)
6. §6 manage → §7 permissions → §14 fleet → §19 customers → §20 admin (business side)
7. §21 media → §22 sweeps (last, once there is real data to break)
