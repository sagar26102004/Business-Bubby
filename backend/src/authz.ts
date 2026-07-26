/**
 * Authorization — the reimplementation of supabase/migrations/0002_policies.sql
 * as explicit checks (Prisma bypasses RLS with the privileged connection, so the
 * API is the gate).
 *
 * The one primitive every rule builds on is `isBusinessMember`: a user is a
 * member of a business if they own it OR are an employee (with a linked account)
 * of it. From there:
 *   - directory data (profiles, businesses, employees, reviews, product threads)
 *     is world-readable;
 *   - private data (orders, bills, chats, calls, memberships, tracking,
 *     bookings) is customer-or-member;
 *   - notifications are recipient-only;
 *   - reviews / product messages are author-only writes;
 *   - log entries are members-only.
 * Controllers call these helpers before mutating.
 */
import { prisma } from '@/db';
import { forbidden, notFound } from '@/http/errors';
import { isSuperAdmin } from '@/lib/superAdmin';

export { isSuperAdmin } from '@/lib/superAdmin';

/** Throw 403 unless the acting user is a platform super-admin. */
export async function requireSuperAdmin(uid: string | null): Promise<void> {
  if (!(await isSuperAdmin(uid))) {
    throw forbidden('Only a platform super-admin can do this.');
  }
}

/** Owner or employee of the business. Guests (null) are never members. */
export async function isBusinessMember(businessId: string, uid: string | null): Promise<boolean> {
  if (!uid) return false;
  const owns = await prisma.business.count({ where: { id: businessId, ownerId: uid } });
  if (owns > 0) return true;
  const employed = await prisma.employee.count({ where: { businessId, userId: uid } });
  return employed > 0;
}

/** Throw 403 unless the user is a member of the business. */
export async function requireBusinessMember(businessId: string, uid: string | null): Promise<void> {
  if (!(await isBusinessMember(businessId, uid))) {
    throw forbidden('Only the business team can do this.');
  }
}

/** Throw 403 unless the user is the business owner. */
export async function requireOwner(businessId: string, uid: string | null): Promise<void> {
  if (!uid) throw forbidden();
  const owns = await prisma.business.count({ where: { id: businessId, ownerId: uid } });
  if (owns === 0) throw forbidden('Only the owner can do this.');
}

/** Throw 403 unless the user is the customer OR a member of the business. */
export async function requireCustomerOrMember(
  businessId: string,
  customerId: string | null | undefined,
  uid: string | null,
): Promise<void> {
  if (uid && customerId && uid === customerId) return;
  if (await isBusinessMember(businessId, uid)) return;
  throw forbidden();
}

/** Throw 403 unless the acting user IS the target user. */
export function requireSelf(uid: string | null, target: string): void {
  if (!uid || uid !== target) throw forbidden();
}

/** True when the user has a tracked item riding with a business (tracking read). */
export async function hasTrackedItem(businessId: string, uid: string | null): Promise<boolean> {
  if (!uid) return false;
  const rows = await prisma.trackedItem.findMany({ where: { businessId } });
  return rows.some((r) => (r.data as { customerId?: string }).customerId === uid);
}

/** Load a business's owner_id, or 404. */
export async function businessOwnerId(businessId: string): Promise<string> {
  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerId: true },
  });
  if (!row) throw notFound(`Business ${businessId} not found`);
  return row.ownerId;
}
