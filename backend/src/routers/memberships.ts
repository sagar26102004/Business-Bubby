import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, userId, optionalUserId } from '@/http/context';
import { requireBusinessMember, requireCustomerOrMember, requireSelf } from '@/authz';
import { membershipService } from '@/services/memberships';
import { prisma } from '@/db';
import { asData } from '@/lib/data';
import type { MembershipPayment } from '@/domain/types';
import { notFound } from '@/http/errors';

export const membershipsRouter = Router();

async function loadMembership(id: string) {
  const m = await membershipService.getById(id);
  if (!m) throw notFound(`Membership ${id} not found`);
  return m;
}

// ── Reads ────────────────────────────────────────────────────────────────
membershipsRouter.get('/customer/:customerId', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.customerId);
  return membershipService.listForCustomer(req.params.customerId);
}));

membershipsRouter.get('/customer/:customerId/monthly-spend', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.customerId);
  return membershipService.monthlySpend(req.params.customerId);
}));

membershipsRouter.get('/business/:businessId', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return membershipService.listForBusiness(req.params.businessId);
}));

membershipsRouter.get('/business/:businessId/cancelled', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return membershipService.listCancelledForBusiness(req.params.businessId);
}));

membershipsRouter.get('/business/:businessId/requests', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return membershipService.listRequests(req.params.businessId);
}));

membershipsRouter.get('/:id', requireAuth, route(async (req) => {
  const m = await loadMembership(req.params.id);
  await requireCustomerOrMember(m.businessId, m.customerId, optionalUserId(req));
  return m;
}));

membershipsRouter.get('/:id/payments', requireAuth, route(async (req) => {
  const m = await loadMembership(req.params.id);
  await requireCustomerOrMember(m.businessId, m.customerId, optionalUserId(req));
  return membershipService.listPayments(req.params.id);
}));

// ── Business-created / managed ─────────────────────────────────────────────
membershipsRouter.post('/', requireAuth, route(async (req) => {
  await requireBusinessMember(req.body.businessId, optionalUserId(req));
  return membershipService.add(req.body);
}));

membershipsRouter.post('/request', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.body.customerId);
  return membershipService.request(req.body);
}));

const memberAction = (fn: (id: string, req: import('express').Request) => Promise<unknown>) =>
  route(async (req) => {
    const m = await loadMembership(req.params.id);
    await requireBusinessMember(m.businessId, optionalUserId(req));
    return fn(req.params.id, req);
  });

membershipsRouter.post('/:id/accept', requireAuth, memberAction((id, req) => membershipService.accept(id, req.body)));
membershipsRouter.post('/:id/reject', requireAuth, memberAction((id) => membershipService.reject(id)));
membershipsRouter.post('/:id/cancel', requireAuth, memberAction((id) => membershipService.cancel(id)));
membershipsRouter.post('/:id/reenroll', requireAuth, memberAction((id) => membershipService.reenroll(id)));
membershipsRouter.post('/:id/start-date', requireAuth, memberAction((id, req) => membershipService.setStartDate(id, req.body.startedAt)));
membershipsRouter.post('/:id/reassign', requireAuth, memberAction((id, req) => membershipService.reassign(id, req.body.toCustomerId, req.body.toCustomerName)));
membershipsRouter.post('/:id/detach', requireAuth, memberAction((id) => membershipService.detach(id)));
membershipsRouter.post('/:id/rename', requireAuth, memberAction((id, req) => membershipService.renameEnrollee(id, req.body.name)));
membershipsRouter.post('/:id/record-payment', requireAuth, memberAction((id, req) =>
  membershipService.recordPayment({ ...req.body, membershipId: id }),
));

// ── Customer self-service ──────────────────────────────────────────────────
membershipsRouter.post('/:id/report-payment', requireAuth, route(async (req) => {
  const m = await loadMembership(req.params.id);
  requireSelf(userId(req), m.customerId);
  return membershipService.reportPayment({ ...req.body, membershipId: req.params.id });
}));

// ── Payment approval (members) ─────────────────────────────────────────────
async function paymentBusiness(paymentId: string): Promise<string> {
  const row = await prisma.membershipPayment.findUnique({ where: { id: paymentId } });
  if (!row) throw notFound(`Payment ${paymentId} not found`);
  return asData<MembershipPayment>(row).businessId;
}

membershipsRouter.post('/payments/:paymentId/approve', requireAuth, route(async (req) => {
  await requireBusinessMember(await paymentBusiness(req.params.paymentId), optionalUserId(req));
  return membershipService.approvePayment(req.params.paymentId, req.body.byName);
}));

membershipsRouter.post('/payments/:paymentId/reject', requireAuth, route(async (req) => {
  await requireBusinessMember(await paymentBusiness(req.params.paymentId), optionalUserId(req));
  return membershipService.rejectPayment(req.params.paymentId, req.body.byName);
}));
