import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, optionalUserId } from '@/http/context';
import { requireBusinessMember } from '@/authz';
import { logbookService } from '@/services/logbook';

export const logbookRouter = Router();

logbookRouter.get('/business/:businessId', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return logbookService.listForBusiness(req.params.businessId);
}));

logbookRouter.post('/', requireAuth, route(async (req) => {
  await requireBusinessMember(req.body.businessId, optionalUserId(req));
  return logbookService.addManual(req.body);
}));
