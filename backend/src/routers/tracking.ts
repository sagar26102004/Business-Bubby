import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, optionalUserId, userId } from '@/http/context';
import { requireBusinessMember, requireSelf, hasTrackedItem, isBusinessMember } from '@/authz';
import { trackingService } from '@/services/tracking';
import { prisma } from '@/db';
import { asData } from '@/lib/data';
import type { TrackedItem, Vehicle } from '@/domain/types';
import { forbidden, notFound } from '@/http/errors';

export const trackingRouter = Router();

async function vehicleBusiness(id: string): Promise<string> {
  const row = await prisma.vehicle.findUnique({ where: { id } });
  if (!row) throw notFound(`Vehicle ${id} not found`);
  return asData<Vehicle>(row).businessId;
}

async function itemBusiness(id: string): Promise<string> {
  const row = await prisma.trackedItem.findUnique({ where: { id } });
  if (!row) throw notFound(`Tracked item ${id} not found`);
  return asData<TrackedItem>(row).businessId;
}

trackingRouter.get('/business/:businessId/vehicles', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return trackingService.listVehicles(req.params.businessId);
}));

trackingRouter.post('/business/:businessId/vehicles', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return trackingService.addVehicle({ ...req.body, businessId: req.params.businessId });
}));

trackingRouter.patch('/vehicles/:id', requireAuth, route(async (req) => {
  await requireBusinessMember(await vehicleBusiness(req.params.id), optionalUserId(req));
  return trackingService.updateVehicle(req.params.id, req.body);
}));

trackingRouter.delete('/vehicles/:id', requireAuth, route(async (req) => {
  await requireBusinessMember(await vehicleBusiness(req.params.id), optionalUserId(req));
  await trackingService.removeVehicle(req.params.id);
  return { ok: true };
}));

trackingRouter.get('/business/:businessId/items', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return trackingService.listItems(req.params.businessId);
}));

trackingRouter.get('/customer/:customerId/items', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.customerId);
  const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : undefined;
  return trackingService.listItemsForCustomer(req.params.customerId, businessId);
}));

trackingRouter.post('/items', requireAuth, route(async (req) => {
  await requireBusinessMember(req.body.businessId, optionalUserId(req));
  return trackingService.addItem(req.body);
}));

trackingRouter.patch('/items/:id', requireAuth, route(async (req) => {
  await requireBusinessMember(await itemBusiness(req.params.id), optionalUserId(req));
  return trackingService.updateItem(req.params.id, req.body);
}));

trackingRouter.delete('/items/:id', requireAuth, route(async (req) => {
  await requireBusinessMember(await itemBusiness(req.params.id), optionalUserId(req));
  await trackingService.removeItem(req.params.id);
  return { ok: true };
}));

// Driver toggles own sharing; a member may toggle a driver's too.
trackingRouter.post('/business/:businessId/sharing', requireAuth, route(async (req) => {
  const uid = optionalUserId(req);
  const target = req.body.userId as string;
  if (uid !== target && !(await isBusinessMember(req.params.businessId, uid))) throw forbidden();
  await trackingService.setSharing(req.params.businessId, target, !!req.body.active);
  return { ok: true };
}));

trackingRouter.get('/business/:businessId/sharing/:userId', requireAuth, route(async (req) => {
  const uid = optionalUserId(req);
  if (uid !== req.params.userId && !(await isBusinessMember(req.params.businessId, uid))) throw forbidden();
  return { sharing: await trackingService.isSharing(req.params.businessId, req.params.userId) };
}));

// Members see the whole fleet; a customer sees it only if they track an item here.
trackingRouter.get('/business/:businessId/live', requireAuth, route(async (req) => {
  const uid = optionalUserId(req);
  const allowed =
    (await isBusinessMember(req.params.businessId, uid)) ||
    (await hasTrackedItem(req.params.businessId, uid));
  if (!allowed) throw forbidden();
  return trackingService.getLiveVehicles(req.params.businessId);
}));
