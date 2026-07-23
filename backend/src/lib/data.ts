/**
 * Small helpers bridging Prisma rows (document model) and domain objects.
 *
 * Every table stores the domain object in `data` (jsonb); services read
 * `row.data as T`. Scoping columns are derived from the domain object on write.
 *
 * Guest identity: the app uses the literal string 'guest' (and `standalone:…`
 * for detached members) as a customer id. Those aren't UUIDs, so the uuid
 * scoping COLUMN is stored as null for them while `data.customerId` keeps the
 * real value — customer-scoped queries therefore filter on the JSON path, not
 * the column, to match the mock exactly.
 */
import type { Prisma } from '@prisma/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s?: string | null): boolean => !!s && UUID_RE.test(s);

/** The value for a uuid scoping column: the id when it's a real uuid, else null. */
export const uuidOrNull = (id?: string | null): string | null => (isUuid(id) ? (id as string) : null);

/** Read a row's domain object. */
export const asData = <T>(row: { data: Prisma.JsonValue }): T => row.data as unknown as T;

/** Read many rows' domain objects. */
export const rowsData = <T>(rows: { data: Prisma.JsonValue }[]): T[] =>
  rows.map((r) => r.data as unknown as T);

/** A Prisma JSON-path filter matching `data.<key> === value` (Postgres). */
export const jsonEquals = (key: string, value: string): Prisma.JsonFilter => ({
  path: [key],
  equals: value,
});

/** Store a domain object as a jsonb column value. */
export const toJson = <T>(value: T): Prisma.InputJsonValue => value as unknown as Prisma.InputJsonValue;
