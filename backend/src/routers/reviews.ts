import { Router } from 'express';
import { route } from '@/http/handler';
import { optionalAuth, requireAuth, userId } from '@/http/context';
import { requireSelf } from '@/authz';
import { reviewService } from '@/services/reviews';

export const reviewsRouter = Router();

reviewsRouter.get('/business/:businessId', optionalAuth, route(async (req) =>
  reviewService.listForBusiness(req.params.businessId),
));

reviewsRouter.get('/business/:businessId/mine/:customerId', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.customerId);
  return reviewService.getMine(req.params.businessId, req.params.customerId);
}));

reviewsRouter.get('/business/:businessId/eligibility/:customerId', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.customerId);
  return reviewService.checkEligibility(req.params.businessId, req.params.customerId);
}));

reviewsRouter.post('/', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.body.customerId);
  return reviewService.submit(req.body);
}));
