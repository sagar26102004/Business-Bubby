import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, optionalUserId, userId } from '@/http/context';
import { isBusinessMember, requireBusinessMember, requireSelf } from '@/authz';
import { bizChatService } from '@/services/bizChat';
import { forbidden } from '@/http/errors';

export const bizChatRouter = Router();

bizChatRouter.get('/user/:userId/threads', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.userId);
  return bizChatService.listThreadsForUser(req.params.userId);
}));

bizChatRouter.get('/messages', requireAuth, route(async (req) => {
  const a = String(req.query.a);
  const b = String(req.query.b);
  const uid = optionalUserId(req);
  if (!(await isBusinessMember(a, uid)) && !(await isBusinessMember(b, uid))) throw forbidden();
  return bizChatService.listMessages(a, b);
}));

bizChatRouter.post('/send', requireAuth, route(async (req) => {
  await requireBusinessMember(req.body.fromBusinessId, optionalUserId(req));
  return bizChatService.send(req.body);
}));
