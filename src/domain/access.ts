/**
 * Service access — which workspace tools each team member may open.
 *
 * The owner has everything. Employees are granted access per service on the
 * Access & permissions screen, which writes `Employee.permissions`. This is a
 * separate axis from customer-contact ROUTING (who rings on calls, who replies
 * to chats, who scans order QRs — those stay on the Business and are set in
 * Manage): access is "can this member open the Billing tool?", routing is "does
 * this member receive the customer's call?".
 *
 * Plain data, like the module and tag catalogs: a new grantable service is
 * added here, tied to the module that must be enabled for it to be offered.
 */
import type { Business, Employee, User } from './types';
import { hasModule, type ModuleId } from './modules';
import { isSuperAdminUser } from './superAdmin';

/**
 * Who's looking. Just enough of a User to answer both questions these rules
 * ask: "which account is this?" and "is it a platform super-admin?".
 *
 * A SUPER-ADMIN passes every check below. They onboard businesses for owners
 * who aren't running the app themselves — listing the shop, pricing its menu,
 * putting its first offers up — so they stand in for the owner everywhere. This
 * mirrors the database: supabase/migrations/0004_super_admin.sql already lets
 * `is_super_admin()` update ANY business, so gating them out here would only
 * hide a power Postgres grants regardless.
 */
export type Viewer = Pick<User, 'id' | 'isSuperAdmin' | 'phone'> | null | undefined;

export type ServiceId =
  | 'orders'
  | 'billing'
  | 'bookings'
  | 'customers'
  | 'members'
  | 'fleet'
  | 'logbook'
  | 'offerings'
  | 'offers';

export interface ServiceDef {
  id: ServiceId;
  label: string;
  icon: string;
  /** One line for the Access screen. */
  description: string;
  /**
   * The module that must be enabled for this service to exist. Undefined =
   * universal (the logbook is always available, like chat).
   */
  module?: ModuleId;
}

export const SERVICE_CATALOG: ServiceDef[] = [
  {
    id: 'orders',
    label: 'Orders',
    icon: '🛒',
    description: 'Review, accept and respond to customer orders.',
    module: 'orders',
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: '🧾',
    description: 'Bill customers and see every bill issued.',
    module: 'billing',
  },
  {
    id: 'bookings',
    label: 'Appointments',
    icon: '📅',
    description: 'Accept or decline booking requests.',
    module: 'bookings',
  },
  {
    id: 'customers',
    label: 'Customers',
    icon: '👥',
    description: 'See everyone who dealt with the business.',
    module: 'customers',
  },
  {
    id: 'members',
    label: 'Members',
    icon: '🎫',
    description: 'Manage paid monthly plans.',
    module: 'memberships',
  },
  {
    id: 'fleet',
    label: 'Fleet & tracking',
    icon: '🚌',
    description: 'Vehicles, drivers and live location.',
    module: 'tracking',
  },
  {
    id: 'logbook',
    label: 'Logbook',
    icon: '📒',
    description: 'The record book of orders — read it and add manual records.',
  },
  // Universal, like the logbook: every business has something it sells and can
  // promote, whichever modules it runs.
  {
    id: 'offerings',
    label: 'Menu & pricing',
    icon: '📝',
    description: 'Edit the menu, products, services and rentals — names, prices and photos.',
  },
  {
    id: 'offers',
    label: 'Offers',
    icon: '🎉',
    description: 'Create discounted bundles of what you sell, shown on your page.',
  },
];

export function getService(id: string): ServiceDef | undefined {
  return SERVICE_CATALOG.find((s) => s.id === id);
}

/**
 * The services this business actually offers — every universal one plus those
 * whose module is enabled. This is the set the Access screen shows toggles for.
 */
export function offeredServices(business: Business): ServiceDef[] {
  return SERVICE_CATALOG.filter((s) => !s.module || hasModule(business, s.module));
}

/** Owner or a manager — the roles that see every tool by default. */
export function isManagerOrOwner(
  business: Pick<Business, 'ownerId'>,
  employee: Pick<Employee, 'level'> | undefined,
  viewer: Viewer,
): boolean {
  if (isSuperAdminUser(viewer)) return true;
  if (!viewer) return false;
  if (viewer.id === business.ownerId) return true;
  return (employee?.level ?? 'staff') === 'manager';
}

/**
 * Is this viewer on the business's team at all — owner, employee, or a
 * super-admin standing in? The gate every workspace screen opens with, before
 * the finer per-service check.
 */
export function isBusinessTeamMember(
  business: Pick<Business, 'ownerId'>,
  employee: Pick<Employee, 'id'> | undefined | null,
  viewer: Viewer,
): boolean {
  if (isSuperAdminUser(viewer)) return true;
  if (!viewer) return false;
  return viewer.id === business.ownerId || !!employee;
}

/**
 * May this viewer open a given workspace service?
 *  - A platform super-admin always can (see `Viewer`).
 *  - The owner always can.
 *  - A non-member never can.
 *  - A MANAGER with no explicit permission list keeps full access — managers
 *    are trusted with every tool until the owner narrows them.
 *  - A STAFF member with no explicit list gets NOTHING: a freshly-added driver
 *    or helper opens the workspace to a blank slate until the owner grants them
 *    the tools they need. (This is the safe default — least privilege.)
 *  - Otherwise the service must be in their granted list.
 */
export function canAccessService(
  business: Pick<Business, 'ownerId'>,
  employee: Pick<Employee, 'permissions' | 'level'> | undefined | null,
  viewer: Viewer,
  serviceId: ServiceId,
): boolean {
  if (isSuperAdminUser(viewer)) return true;
  if (!viewer) return false;
  if (viewer.id === business.ownerId) return true;
  if (!employee) return false;
  if (!employee.permissions) return (employee.level ?? 'staff') === 'manager';
  return employee.permissions.includes(serviceId);
}
