import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, userId } from '@/http/context';
import { requireSelf } from '@/authz';
import { notificationService } from '@/services/notifications';
import { prisma } from '@/db';

export const notificationsRouter = Router();

notificationsRouter.get('/user/:recipientId', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.recipientId);
  return notificationService.listForUser(req.params.recipientId);
}));

notificationsRouter.get('/user/:recipientId/unread-count', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.recipientId);
  return { count: await notificationService.unreadCount(req.params.recipientId) };
}));

notificationsRouter.post('/:id/read', requireAuth, route(async (req) => {
  const row = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (row) requireSelf(userId(req), row.recipientId);
  await notificationService.markRead(req.params.id);
  return { ok: true };
}));

notificationsRouter.post('/user/:recipientId/read-all', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.recipientId);
  await notificationService.markAllRead(req.params.recipientId);
  return { ok: true };
}));
