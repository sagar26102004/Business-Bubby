/**
 * Id helpers.
 *
 * Table primary keys are `uuid` columns, so a row id must be a real UUID. Nested
 * ids that live only inside `data` (order line ids, product ids, call
 * participant ids, thread keys) are plain text — any stable string works.
 */
import { randomUUID } from 'crypto';

/** A fresh UUID — used for row ids and any id stored in a uuid column. */
export const newUuid = (): string => randomUUID();

/**
 * A readable, prefixed id for values that live inside `data` only (never a uuid
 * column). Mirrors the mock's `nextId(prefix)` in spirit.
 */
export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;
