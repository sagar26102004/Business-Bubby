/**
 * The Supabase repository set.
 *
 * Migration is incremental: repositories that have been moved to Supabase are
 * layered over a full mock set, so the app always has a complete `Repositories`
 * object and keeps working while the rest are ported. As each group lands here,
 * it replaces its mock counterpart.
 *
 * Migrated so far: auth, users (profiles).
 * Still mock: businesses, employees, places, chat, orders, bills, bookings,
 *   notifications, calls, reviews, memberships, tracking, product threads,
 *   B2B chat, customers, logbook.
 */
import type { Repositories } from '@/data/repositories';
import { createMockRepositories } from '@/data/mock/mockRepositories';
import { createSupabaseAuth } from './auth';
import { createSupabaseUsers } from './users';

export function createSupabaseRepositories(): Repositories {
  const mock = createMockRepositories();
  return {
    ...mock,
    auth: createSupabaseAuth(),
    users: createSupabaseUsers(),
  };
}
