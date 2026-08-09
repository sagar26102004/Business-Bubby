/**
 * Platform super-admins on the API — mirror of src/domain/superAdmin.ts.
 * A super-admin can register a business for anyone and reassign ownership.
 *
 * THE HOLE THIS CLOSES
 * This used to decide operator status from `profiles.data.isSuperAdmin` plus a
 * phone allow-list — both of which live inside a document the user themselves
 * can rewrite through `PATCH /api/users/:id`. Anyone signed in could therefore
 * promote themselves and then update ANY business on the platform. The
 * authorization check was reading a field the subject controlled.
 *
 * THE FIX
 * The grant lives in `platform_admins` (migration 0006), a table with RLS on
 * and NO write policy at all — the only way to hand it out is the service role
 * (the SQL editor). Nothing a user can PATCH has any bearing on it.
 *
 * ⚠️ Do NOT reintroduce a phone or profile-flag branch here. The phone list in
 * the app's domain copy is provisioning documentation, not a trust path, and
 * `phone` is user-writable too.
 */
import { prisma } from '@/db';

/** Is this signed-in user a super-admin? Reads the grant table, nothing else. */
export async function isSuperAdmin(uid: string | null): Promise<boolean> {
  if (!uid) return false;
  return (await prisma.platformAdmin.count({ where: { userId: uid } })) > 0;
}
