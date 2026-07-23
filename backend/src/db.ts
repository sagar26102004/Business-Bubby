/**
 * The Prisma client — the single connection to the shared Supabase Postgres.
 *
 * This uses the DIRECT/privileged DATABASE_URL, which BYPASSES Row-Level
 * Security. Access is therefore enforced by the API itself (see src/authz.ts),
 * exactly reimplementing supabase/migrations/0002_policies.sql.
 */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
