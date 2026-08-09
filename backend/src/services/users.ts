/**
 * Users (profiles) — ports MockUserRepository over the `profiles` table.
 *
 * ⚠️ TWO HALVES, ONE `User`. `profiles` is the PUBLIC directory card (name,
 * avatar, isProfilePublic) — anyone may read it, including guests, because the
 * directory is how a business links a teammate or picks who to bill.
 * `profiles_private` (migration 0007) holds `phone`, `email` and
 * `mutedNotifications`.
 *
 * On Path A that split is enforced by RLS. Prisma connects with the privileged
 * URL and BYPASSES RLS, so THIS SERVICE is the only thing standing between a
 * caller and every user's phone number — `GET /api/users` and
 * `/api/users/search` are `optionalAuth`, so the threat model includes both
 * guests and any signed-in stranger. Never widen these reads without a check.
 */
import type { User } from '@/domain/types';
import { prisma } from '@/db';
import { asData, rowsData, toJson } from '@/lib/data';
import { isSuperAdmin } from '@/lib/superAdmin';
import { notFound } from '@/http/errors';

/** Fields that live in `profiles_private` and must never ride the public card. */
const PRIVATE_KEYS = ['phone', 'email', 'mutedNotifications'] as const;

/** Strip the private half from a profile document. */
function publicCard(user: User): User {
  const card = { ...user };
  for (const key of PRIVATE_KEYS) delete (card as Record<string, unknown>)[key];
  return card;
}

/** The private half for one user, or {} when there is no row yet. */
async function privateHalf(id: string): Promise<Partial<User>> {
  const row = await prisma.profilePrivate.findUnique({ where: { id } });
  return ((row?.data ?? {}) as Partial<User>) ?? {};
}

export const userService = {
  /**
   * One profile. The private half comes back ONLY for the account itself or a
   * super-admin; for anyone else this is the public card, which is the point.
   * `viewerId` is optional so existing public callers keep working — omitted
   * means "a stranger", the safe default.
   */
  async getById(id: string, viewerId?: string | null): Promise<User | null> {
    const row = await prisma.profile.findUnique({ where: { id } });
    if (!row) return null;
    const card = publicCard(asData<User>(row));
    const maySeePrivate = !!viewerId && (viewerId === id || (await isSuperAdmin(viewerId)));
    if (!maySeePrivate) return card;
    return { ...card, ...(await privateHalf(id)) };
  },

  /**
   * The public directory. Private fields are stripped for everyone except a
   * super-admin — a signed-in stranger is exactly the threat here, so this is
   * NOT fixed by requiring auth.
   */
  async list(viewerId?: string | null): Promise<User[]> {
    const users = rowsData<User>(await prisma.profile.findMany());
    if (viewerId && (await isSuperAdmin(viewerId))) {
      const privates = await prisma.profilePrivate.findMany();
      const byId = new Map(privates.map((p) => [p.id, (p.data ?? {}) as Partial<User>]));
      return users.map((u) => ({ ...publicCard(u), ...(byId.get(u.id) ?? {}) }));
    }
    return users.map(publicCard);
  },

  async search(term: string, viewerId?: string | null): Promise<User[]> {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    // Small directory — filter by name in JS. Every NAMED account is reachable:
    // search is how a business links a teammate or picks who to bill, and
    // `isProfilePublic` only governs whether an employee profile page is
    // tappable. Anonymous guests have an empty name, so they never match.
    return (await this.list(viewerId)).filter(
      (u) => !!u.name && u.name.toLowerCase().includes(q),
    );
  },

  /**
   * Update a profile, writing each half to its own table.
   *
   * ⚠️ WHITELISTED, never spread. This used to merge the whole request body
   * into the stored document, which meant `PATCH /api/users/<me>` with
   * `{"isSuperAdmin": true}` granted platform-operator rights, and a forged
   * `phone` could impersonate an allow-listed account. Prisma bypasses RLS, so
   * migration 0006's `protect_profile_fields` trigger does NOT cover this path
   * — this whitelist is the only guard Path B has.
   */
  async update(id: string, patch: Partial<User>): Promise<User> {
    const row = await prisma.profile.findUnique({ where: { id } });
    if (!row) throw notFound(`User ${id} not found`);
    const current = publicCard(asData<User>(row));

    // --- public half ---
    const publicPatch: Partial<User> = {};
    if (patch.name !== undefined) publicPatch.name = patch.name;
    if (patch.isProfilePublic !== undefined) publicPatch.isProfilePublic = patch.isProfilePublic;
    if (patch.avatarUrl !== undefined) publicPatch.avatarUrl = patch.avatarUrl;
    if (patch.bio !== undefined) publicPatch.bio = patch.bio;

    const nextPublic = { ...current, ...publicPatch, id };
    // Derived per request from platform_admins — never stored, so strip any
    // copy left behind by an older write.
    delete (nextPublic as { isSuperAdmin?: boolean }).isSuperAdmin;
    await prisma.profile.update({ where: { id }, data: { data: toJson(nextPublic) } });

    // --- private half ---
    const currentPrivate = await privateHalf(id);
    const privatePatch: Partial<User> = {};
    if (patch.phone !== undefined) privatePatch.phone = patch.phone;
    if (patch.email !== undefined) privatePatch.email = patch.email;
    if (patch.mutedNotifications !== undefined) {
      privatePatch.mutedNotifications = patch.mutedNotifications;
    }
    const nextPrivate = { ...currentPrivate, ...privatePatch };
    if (Object.keys(privatePatch).length > 0) {
      await prisma.profilePrivate.upsert({
        where: { id },
        create: { id, data: toJson(nextPrivate), updatedAt: new Date() },
        update: { data: toJson(nextPrivate), updatedAt: new Date() },
      });
    }

    // The caller is always the account itself (requireSelf on the route), so
    // returning the merged view is correct here.
    return { ...nextPublic, ...nextPrivate };
  },
};
