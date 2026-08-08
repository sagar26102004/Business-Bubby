/**
 * Platform super-admins — privileged operators who can list businesses for
 * anyone, price their offerings and put their first offers up.
 *
 * THE GRANT LIVES IN THE DATABASE, in the `platform_admins` table
 * (supabase/migrations/0006_platform_admins.sql). That table has RLS on and no
 * insert/update/delete policy at all, so the only way to hand out the grant is
 * the service role — a session can read whether IT is an admin and nothing
 * more. `User.isSuperAdmin` is therefore a DERIVED, session-only field: the
 * auth repository stamps it from that table when it builds the signed-in user,
 * and it is never persisted back onto the profile (a database trigger strips it
 * from every profile write anyway).
 *
 * It used to be read straight off `profiles.data`, which every user can
 * rewrite — so anyone could promote themselves with a single PATCH. Never make
 * an authorization decision from a field the subject controls; if you need a
 * new privileged flag, give it its own table with no write policy.
 */
import type { User } from './types';

/**
 * Phone numbers that get the grant when an account is PROVISIONED — used by
 * `supabase/scripts/create_super_admin.sql` and by the mock backend so dev mode
 * has an admin to test with. NOT a trust path: the live app never decides
 * access from a phone number, because `profiles.data` is user-writable.
 */
export const SUPER_ADMIN_PHONES: readonly string[] = ['8827548423'];

/** Strip everything but digits, so "+91 88275 48423" matches "8827548423". */
const digits = (value?: string): string => (value ?? '').replace(/\D/g, '');

/** Provisioning helper — is this the phone of an account we grant on setup? */
export function isSuperAdminPhone(phone?: string): boolean {
  const d = digits(phone);
  if (!d) return false;
  return SUPER_ADMIN_PHONES.some((p) => {
    const pd = digits(p);
    // Match on the trailing digits so a country-code prefix doesn't matter.
    return d === pd || d.endsWith(pd);
  });
}

/**
 * Is this user a platform super-admin? Reads ONLY the derived flag the auth
 * repository stamped from `platform_admins` — deliberately not the phone, and
 * deliberately not anything else the user could have written themselves.
 */
export function isSuperAdminUser(user?: Pick<User, 'isSuperAdmin'> | null): boolean {
  return user?.isSuperAdmin === true;
}
