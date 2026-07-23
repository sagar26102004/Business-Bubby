import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, userId, optionalUserId } from '@/http/context';
import { requireBusinessMember, requireCustomerOrMember, requireSelf } from '@/authz';
import { billService } from '@/services/bills';
import { notFound } from '@/http/errors';

export const billsRouter = Router();

async function loadBill(id: string) {
  const bill = await billService.getById(id);
  if (!bill) throw notFound(`Bill ${id} not found`);
  return bill;
}

billsRouter.post('/', requireAuth, route(async (req) => {
  await requireBusinessMember(req.body.businessId, optionalUserId(req));
  return billService.create(req.body);
}));

billsRouter.get('/business/:businessId', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return billService.listForBusiness(req.params.businessId);
}));

billsRouter.get('/customer/:customerId', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.customerId);
  const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : undefined;
  return billService.listForCustomer(req.params.customerId, businessId);
}));

billsRouter.get('/:id', requireAuth, route(async (req) => {
  const bill = await loadBill(req.params.id);
  await requireCustomerOrMember(bill.businessId, bill.customerId, optionalUserId(req));
  return bill;
}));

billsRouter.post('/:id/send-to-chat', requireAuth, route(async (req) => {
  const bill = await loadBill(req.params.id);
  await requireBusinessMember(bill.businessId, optionalUserId(req));
  await billService.sendToChat(req.params.id, req.body.sentByName);
  return { ok: true };
}));

billsRouter.post('/:id/payment', requireAuth, route(async (req) => {
  const bill = await loadBill(req.params.id);
  await requireBusinessMember(bill.businessId, optionalUserId(req));
  return billService.setPaymentStatus(req.params.id, req.body.status, req.body.byName);
}));
