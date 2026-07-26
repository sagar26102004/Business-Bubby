/** Catalog — the app's growing collection of dishes/services/products/tags. */
import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, userId } from '@/http/context';
import { requireSuperAdmin } from '@/authz';
import type { CatalogEntryKind } from '@/domain/types';
import { catalogService } from '@/services/catalog';

export const catalogRouter = Router();

const kindOf = (v: unknown): CatalogEntryKind | undefined =>
  v === 'tag' || v === 'dish' || v === 'service' || v === 'product' ? v : undefined;

// List entries. Any signed-in user reads the approved (live) set; the full set —
// including hidden rows — is the super-admin's moderation view (?scope=all).
catalogRouter.get('/', requireAuth, route(async (req) => {
  const kind = kindOf(req.query.kind);
  if (req.query.scope === 'all') {
    await requireSuperAdmin(userId(req));
    return catalogService.listAll(kind);
  }
  return catalogService.listApproved(kind);
}));

// Best-effort capture on behalf of the caller (their uid is `addedBy`).
catalogRouter.post('/capture', requireAuth, route(async (req) =>
  catalogService.capture(req.body?.entries ?? [], userId(req)),
));

// Super-admin adds a business tag by hand.
catalogRouter.post('/tags', requireAuth, route(async (req) => {
  await requireSuperAdmin(userId(req));
  return catalogService.addTag(req.body?.name ?? '');
}));

// Super-admin hides / restores an entry.
catalogRouter.patch('/:id', requireAuth, route(async (req) => {
  await requireSuperAdmin(userId(req));
  return catalogService.setApproved(req.params.id, req.body?.approved === true);
}));

// Super-admin permanently deletes an entry.
catalogRouter.delete('/:id', requireAuth, route(async (req) => {
  await requireSuperAdmin(userId(req));
  await catalogService.remove(req.params.id);
  return {};
}));
