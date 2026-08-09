import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, userId, optionalUserId } from '@/http/context';
import { requireBusinessMember, requireCustomerOrMember, requireSelf } from '@/authz';
import { orderService } from '@/services/orders';
import { notFound } from '@/http/errors';

export const ordersRouter = Router();

async function loadOrder(id: string) {
  const order = await orderService.getById(id);
  if (!order) throw notFound(`Order ${id} not found`);
  return order;
}

ordersRouter.post('/', requireAuth, route(async (req) => {
  await requireCustomerOrMember(req.body.businessId, req.body.customerId, optionalUserId(req));
  return orderService.create(req.body, optionalUserId(req));
}));

ordersRouter.get('/business/:businessId', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return orderService.listForBusiness(req.params.businessId);
}));

ordersRouter.get('/business/:businessId/tables', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return orderService.tableStatus(req.params.businessId);
}));

ordersRouter.get('/customer/:customerId', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.customerId);
  const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : undefined;
  return orderService.listForCustomer(req.params.customerId, businessId);
}));

ordersRouter.get('/:id', requireAuth, route(async (req) => {
  const order = await loadOrder(req.params.id);
  await requireCustomerOrMember(order.businessId, order.customerId, optionalUserId(req));
  return order;
}));

ordersRouter.post('/:id/respond', requireAuth, route(async (req) => {
  const order = await loadOrder(req.params.id);
  await requireBusinessMember(order.businessId, optionalUserId(req));
  const { keptLineIds, respondedByName, message, counterPrices } = req.body;
  return orderService.respond(req.params.id, keptLineIds, respondedByName, message, counterPrices);
}));

ordersRouter.post('/:id/reject', requireAuth, route(async (req) => {
  const order = await loadOrder(req.params.id);
  await requireBusinessMember(order.businessId, optionalUserId(req));
  return orderService.reject(req.params.id, req.body.respondedByName, req.body.message);
}));

ordersRouter.post('/:id/proposal', requireAuth, route(async (req) => {
  const order = await loadOrder(req.params.id);
  await requireCustomerOrMember(order.businessId, order.customerId, optionalUserId(req));
  return orderService.decideProposal(req.params.id, !!req.body.accept);
}));

ordersRouter.post('/:id/append', requireAuth, route(async (req) => {
  const order = await loadOrder(req.params.id);
  await requireCustomerOrMember(order.businessId, order.customerId, optionalUserId(req));
  return orderService.appendLines(req.params.id, req.body.lines, optionalUserId(req));
}));

ordersRouter.post('/:id/move-to-billing', requireAuth, route(async (req) => {
  const order = await loadOrder(req.params.id);
  await requireBusinessMember(order.businessId, optionalUserId(req));
  return orderService.moveToBilling(req.params.id, req.body.issuedByName);
}));

ordersRouter.post('/:id/delivered', requireAuth, route(async (req) => {
  const order = await loadOrder(req.params.id);
  await requireBusinessMember(order.businessId, optionalUserId(req));
  return orderService.markDelivered(req.params.id, req.body.byName);
}));
