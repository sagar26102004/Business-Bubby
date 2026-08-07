/** Users (profiles) — ports MockUserRepository over the `profiles` table. */
import type { User } from '@/domain/types';
import { prisma } from '@/db';
import { asData, rowsData, toJson } from '@/lib/data';
import { notFound } from '@/http/errors';

export const userService = {
  async getById(id: string): Promise<User | null> {
    const row = await prisma.profile.findUnique({ where: { id } });
    return row ? asData<User>(row) : null;
  },

  async list(): Promise<User[]> {
    return rowsData<User>(await prisma.profile.findMany());
  },

  async search(term: string): Promise<User[]> {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    // Small directory — filter by name in JS. Every NAMED account is reachable:
    // search is how a business links a teammate or picks who to bill, and
    // `isProfilePublic` only governs whether an employee profile page is
    // tappable. Anonymous guests have an empty name, so they never match.
    return (await this.list()).filter((u) => !!u.name && u.name.toLowerCase().includes(q));
  },

  async update(id: string, patch: Partial<User>): Promise<User> {
    const current = (await this.getById(id)) ?? ({ id, name: 'You', isProfilePublic: true } as User);
    const next = { ...current, ...patch, id };
    const row = await prisma.profile.findUnique({ where: { id } });
    if (!row) throw notFound(`User ${id} not found`);
    await prisma.profile.update({ where: { id }, data: { data: toJson(next) } });
    return next;
  },
};
