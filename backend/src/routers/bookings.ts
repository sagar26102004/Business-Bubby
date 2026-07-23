import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, userId, optionalUserId } from '@/http/context';
import { requireBusinessMember, requireCustomerOrMember, requireSelf } from '@/authz';
import { bookingService } from '@/services/bookings';
import { prisma } from '@/db';
import { asData } from '@/lib/data';
import type { Booking } from '@/domain/types';
import { notFound } from '@/http/errors';

export const bookingsRouter = Router();

bookingsRouter.post('/', requireAuth, route(async (req) => {
  await requireCustomerOrMember(req.body.businessId, req.body.customerId, optionalUserId(req));
  return bookingService.create(req.body);
}));

bookingsRouter.get('/business/:businessId', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return bookingService.listForBusiness(req.params.businessId);
}));

bookingsRouter.get('/customer/:customerId', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.customerId);
  return bookingService.listForCustomer(req.params.customerId);
}));

bookingsRouter.post('/:id/status', requireAuth, route(async (req) => {
  const row = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!row) throw notFound(`Booking ${req.params.id} not found`);
  const booking = asData<Booking>(row);
  await requireCustomerOrMember(booking.businessId, booking.customerId, optionalUserId(req));
  return bookingService.updateStatus(req.params.id, req.body.status);
}));
