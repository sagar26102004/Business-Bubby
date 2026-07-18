/**
 * Common job roles / designations for a business's team — so the owner types a
 * few letters and picks one (Manager, Chef, Driver…) instead of writing it out,
 * the same way dishes work. Free text stays allowed; this is only a suggestion
 * list, fed to `AutocompleteInput` (which does the prefix-first filtering).
 *
 * The most generic, cross-business roles sit first so they show before the user
 * types anything. Everything after is the long tail, grouped for readability.
 */

/** Given to any employee whose role the owner didn't specify. */
export const DEFAULT_ROLE = 'Staff';

export const ROLE_SUGGESTIONS: string[] = [
  // Generic (shown before the user types) — the everyday designations.
  'Manager',
  'Staff',
  'Assistant',
  'Supervisor',
  'Cashier',
  'Helper',
  // Front desk & office
  'Receptionist',
  'Assistant Manager',
  'Billing Executive',
  'Accountant',
  'Admin',
  'Office Boy',
  'Peon',
  // Food & restaurant
  'Chef',
  'Head Chef',
  'Sous Chef',
  'Cook',
  'Waiter',
  'Server',
  'Steward',
  'Barista',
  'Bartender',
  'Kitchen Helper',
  'Dishwasher',
  'Delivery Boy',
  'Delivery Partner',
  // Shop & retail
  'Salesperson',
  'Sales Executive',
  'Shop Assistant',
  'Store Keeper',
  'Packer',
  // Trades & services
  'Electrician',
  'Plumber',
  'Carpenter',
  'Mechanic',
  'Technician',
  'Painter',
  'Welder',
  'Fitter',
  'Fabricator',
  'Cleaner',
  'Housekeeping',
  'Security Guard',
  'Guard',
  'Gardener',
  'Tailor',
  'Barber',
  'Beautician',
  'Hair Stylist',
  // Transport & fleet
  'Driver',
  'Conductor',
  'Loader',
  // Coaching, fitness & health
  'Teacher',
  'Tutor',
  'Instructor',
  'Trainer',
  'Coach',
  'Yoga Instructor',
  'Doctor',
  'Nurse',
  'Pharmacist',
  'Compounder',
  // Entry level
  'Trainee',
  'Apprentice',
  'Intern',
];

/**
 * Normalise a typed role for storage: trimmed, or the default when blank. This
 * is what guarantees every employee ends up with a role.
 */
export function normalizeRole(role?: string): string {
  const trimmed = role?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_ROLE;
}
