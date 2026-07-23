import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, optionalUserId } from '@/http/context';
import { requireBusinessMember, requireOwner } from '@/authz';
import { customerService } from '@/services/customers';

export const customersRouter = Router();

customersRouter.get('/business/:businessId', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return customerService.listForBusiness(req.params.businessId);
}));

customersRouter.post('/business/:businessId/favorite', requireAuth, route(async (req) => {
  await requireOwner(req.params.businessId, optionalUserId(req));
  await customerService.setFavorite(req.params.businessId, req.body.customerKey, !!req.body.favorite);
  return { ok: true };
}));
