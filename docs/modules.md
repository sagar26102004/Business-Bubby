# Localo — Workspace Module Catalog

Decided 2026-07-11 (extends `direction.md`). The business workspace is built
from **opt-in modules** — at registration the owner picks what they want to
manage, and can enable/disable modules later in Manage. This is the
"customize your workspace" model: we never hardcode what a category of
business needs, because every business needs something different.

Two vocabulary notes:

- **"Module" here = product-side unit** (a workspace section + its data). On
  the backend each module is a repository interface first, a mock second, a
  Supabase implementation third. Whether the real backend physically splits
  into microservices per module is an infra decision we stay open to — the
  interface boundary is what guarantees we can.
- **Tags describe the business to customers; modules describe what the
  business manages.** Tags may *suggest* module defaults during registration,
  but never force them, and no feature should key off a tag when it should
  key off a module.

## Always on — every business gets these, never opt-in

| Capability | Why universal |
|---|---|
| Business page + QR code | It IS the listing |
| 💬 Chat (customer thread + business inbox) | Baseline communication |
| 📞 Calls (in-app voice, handler assignment) | Baseline communication |
| 🔔 Notifications | Delivery channel for everything else |
| ⭐ Ratings & reviews | Marketplace trust — a business can't opt out |
| Team basics (owner → managers → staff) | Other modules assign work to people |

## Modules

Status: ✅ built · 🟡 partially built · ⏳ not built (waits for real backend
unless noted).

### Sell & serve

| Module | What it does | Status / where |
|---|---|---|
| **Orders** | Cart-style requests, proposals (untick lines), dine-in tabs, party requests | ✅ `OrderRepository` |
| **Billing & Invoices** | Bills by hand or auto on acceptance, share, send-in-chat | ✅ `BillRepository` (Invoices = same module) |
| **Bookings & Appointments** | Service requests, accept/decline, accepted list | ✅ `BookingRepository` |
| **Menu / Catalog** | Products, services, menu with categories | ✅ on `Business` (`products`/`services`/`menu`) |
| **QR Ordering** | Table/counter QR → order without an account | 🟡 QR deep-link to page exists (`/qr/[businessId]`); table-scoped ordering ⏳ |
| **Online Store** | Public storefront with checkout | ⏳ rides on Orders + payments |
| **Delivery** | Assign orders to riders, delivery status, live location | ⏳ composes Orders + Tracking |

### Operations

| Module | What it does | Status / where |
|---|---|---|
| **Inventory** | Stock counts, low-stock alerts, auto-decrement on orders | ⏳ new repo |
| **Staff** | Roles, chat/call assignment, show-on-page | ✅ `EmployeeRepository` |
| **Attendance** | Staff check-in/out, leave, shifts | ⏳ extends Staff |
| **Fleet & Vehicle Tracking** | Vehicles, drivers, live location, tracked items (child/goods) | ✅ `TrackingRepository` |
| **Rental Management** | Availability calendar, deposits, due-back reminders | ⏳ new repo |
| **Expenses** | Money-out ledger | ⏳ new repo |
| **Accounting** | Books view over bills + expenses, GST summaries | ⏳ composes Billing + Expenses |
| **Analytics & Reports** | Sales, footfall, top items, exportable reports | ⏳ read-only over other modules' data |

### Customers & growth

| Module | What it does | Status / where |
|---|---|---|
| **Customers (CRM)** | Everyone who ever did business, favourites, totals; later: notes, follow-ups | ✅ lite `CustomerRepository`; CRM extras ⏳ |
| **Memberships** | Enroll customers into monthly plans (gym, batch, tuition, bus seat); customer sees them in the Subs tab with renewal dates + monthly spend breakdown | ✅ `MembershipRepository` (2026-07-11) |
| **Subscriptions** | Recurring daily/weekly orders (milk, tiffin, newspaper) | ⏳ new repo |
| **Coupons & Deals** | Limited-time offers, promo codes | 🟡 `Business.deals` + Browse carousel exist; coupons/redemption ⏳ |
| **Loyalty Program** | Points/stamps per visit or spend | ⏳ new repo |
| **WhatsApp Notifications** | Mirror order/bill/booking events to WhatsApp | ⏳ real backend only — a channel adapter behind `NotificationRepository`, not a separate data model |

## How modules ship (the contract)

Steps 1–3 shipped mock-first on 2026-07-11: `Business.modules`, the
register-wizard opt-in step, module-driven workspace + business-page
actions, and Manage toggles. The module catalog itself lives in
`src/domain/modules.ts` (plain data, like tags).

1. `Business.modules: string[]` — stable ids (`'orders'`, `'billing'`,
   `'inventory'`, …).
2. **Registration** gets a "what do you want to manage?" step. Defaults are
   inferred from the capability answers already asked (sells products →
   orders+billing; offers services → bookings; rents out → rentals) and from
   tags as *suggestions* (Gym → memberships, Milk Dairy → subscriptions,
   School Bus Service → fleet). Owner can tick anything on/off.
3. **Workspace** renders sections from `business.modules` instead of
   hardcoded checks; Manage gets an "Apps / Modules" screen to toggle later.
4. Every module = its own repository interface + mock + (later) Supabase
   impl. A module owns its data; cross-module features (Accounting,
   Analytics, Delivery) read through other modules' interfaces.
5. Disabled ≠ deleted: toggling a module off hides its workspace section but
   keeps its data.

## Example workspaces

- **Cafe** — Orders, Menu, Billing, QR Ordering, Customers (+ Coupons)
- **Electrician** — Bookings, Customers, Billing
- **Gym** — Memberships, Attendance, Staff, Billing
- **Milk dairy** — Subscriptions, Delivery, Billing, Customers
- **Truck owner** — Fleet & Tracking, Staff, Billing, Expenses
- **Tent house** — Rental Management, Bookings, Billing, Inventory
- **Boutique** — Orders, Inventory, Billing, Customers, Coupons

Same platform, seven different workspaces — no category decides any of it.
