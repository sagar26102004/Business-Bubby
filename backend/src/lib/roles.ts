/** Role normalisation — ported from ../../../src/domain/roles.ts. */

export const DEFAULT_ROLE = 'Staff';

export function normalizeRole(role?: string): string {
  const trimmed = role?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_ROLE;
}
