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
import type { Business, Employee } from './types';
import { hasModule, type ModuleId } from './modules';

export type ServiceId =
  | 'orders'
  | 'billing'
  | 'bookings'
  | 'customers'
  | 'members'
  | 'fleet'
  | 'logbook';

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

/**
 * May this viewer open a given workspace service?
 *  - The owner always can.
 *  - A non-member never can.
 *  - A member with NO explicit permission list keeps full access (legacy /
 *    freshly-added members work until the owner narrows them).
 *  - Otherwise the service must be in their granted list.
 */
export function canAccessService(
  business: Pick<Business, 'ownerId'>,
  employee: Pick<Employee, 'permissions'> | undefined,
  viewerId: string | undefined,
  serviceId: ServiceId,
): boolean {
  if (!viewerId) return false;
  if (viewerId === business.ownerId) return true;
  if (!employee) return false;
  if (!employee.permissions) return true;
  return employee.permissions.includes(serviceId);
}
