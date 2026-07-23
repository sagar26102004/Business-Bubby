import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, userId, optionalUserId } from '@/http/context';
import { requireBusinessMember, requireCustomerOrMember, requireSelf } from '@/authz';
import { chatService } from '@/services/chat';

export const chatRouter = Router();

chatRouter.get('/business/:businessId/thread/:participantId', requireAuth, route(async (req) => {
  await requireCustomerOrMember(req.params.businessId, req.params.participantId, optionalUserId(req));
  return chatService.listThread(req.params.businessId, req.params.participantId);
}));

chatRouter.post('/business/:businessId/thread/:participantId', requireAuth, route(async (req) => {
  await requireCustomerOrMember(req.params.businessId, req.params.participantId, optionalUserId(req));
  const { body, author, extra } = req.body;
  return chatService.send(req.params.businessId, req.params.participantId, body, author, extra);
}));

chatRouter.get('/business/:businessId/threads', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return chatService.listBusinessThreads(req.params.businessId);
}));

chatRouter.get('/customer/:participantId/threads', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.participantId);
  return chatService.listCustomerThreads(req.params.participantId);
}));
