/**
 * Platform super-admins — privileged operators who can list businesses for
 * anyone and hand ownership to another user.
 *
 * Identity is derived from the account's PHONE NUMBER (a fixed allow-list),
 * so it survives a mock reset and needs no schema change to grant. The flag is
 * ALSO mirrored onto the profile (`User.isSuperAdmin`) when the account is
 * provisioned, because the Supabase RLS policies read it there (they can't run
 * this TypeScript) — but the phone list stays the source of truth the UI trusts.
 */
import type { User } from './types';

/** Phone numbers (digits only) that are platform super-admins. */
export const SUPER_ADMIN_PHONES: readonly string[] = ['8827548423'];

/** Strip everything but digits, so "+91 88275 48423" matches "8827548423". */
const digits = (value?: string): string => (value ?? '').replace(/\D/g, '');

/** Does this phone number belong to a super-admin? */
export function isSuperAdminPhone(phone?: string): boolean {
  const d = digits(phone);
  if (!d) return false;
  return SUPER_ADMIN_PHONES.some((p) => {
    const pd = digits(p);
    // Match on the trailing digits so a country-code prefix doesn't matter.
    return d === pd || d.endsWith(pd);
  });
}

/** Is this user a platform super-admin (by flag or by their phone)? */
export function isSuperAdminUser(user?: User | null): boolean {
  if (!user) return false;
  return user.isSuperAdmin === true || isSuperAdminPhone(user.phone);
}
