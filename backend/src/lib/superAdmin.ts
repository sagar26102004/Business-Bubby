/**
 * Platform super-admins on the API — mirror of src/domain/superAdmin.ts. A
 * super-admin can register a business for anyone and reassign ownership. The
 * allow-list is by phone number; `isSuperAdmin(uid)` also honours the flag the
 * profile carries (set when the account was provisioned).
 */
import { prisma } from '@/db';
import type { User } from '@/domain/types';

/** Phone numbers (digits only) that are platform super-admins. */
export const SUPER_ADMIN_PHONES: readonly string[] = ['8827548423'];

const digits = (value?: string): string => (value ?? '').replace(/\D/g, '');

export function isSuperAdminPhone(phone?: string): boolean {
  const d = digits(phone);
  if (!d) return false;
  return SUPER_ADMIN_PHONES.some((p) => {
    const pd = digits(p);
    return d === pd || d.endsWith(pd);
  });
}

/** Is this signed-in user a super-admin? Reads their profile flag / phone. */
export async function isSuperAdmin(uid: string | null): Promise<boolean> {
  if (!uid) return false;
  const row = await prisma.profile.findUnique({ where: { id: uid } });
  if (!row) return false;
  const user = row.data as unknown as User;
  return user.isSuperAdmin === true || isSuperAdminPhone(user.phone);
}
