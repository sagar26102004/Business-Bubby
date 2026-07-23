import { Router } from 'express';
import { route } from '@/http/handler';
import { optionalAuth, requireAuth, userId } from '@/http/context';
import { requireSelf } from '@/authz';
import { productThreadService } from '@/services/productThreads';

export const productThreadsRouter = Router();

productThreadsRouter.get('/business/:businessId/product/:productId', optionalAuth, route(async (req) =>
  productThreadService.listForProduct(req.params.businessId, req.params.productId),
));

productThreadsRouter.get('/business/:businessId', optionalAuth, route(async (req) =>
  productThreadService.listForBusiness(req.params.businessId),
));

productThreadsRouter.post('/', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.body.authorId);
  return productThreadService.post(req.body);
}));

// Pin/unpin — ownership is enforced inside the service via the actor id.
productThreadsRouter.post(
  '/business/:businessId/product/:productId/message/:messageId/pin',
  requireAuth,
  route(async (req) =>
    productThreadService.setPinned(
      req.params.businessId,
      req.params.productId,
      req.params.messageId,
      !!req.body.pinned,
      userId(req),
    ),
  ),
);
