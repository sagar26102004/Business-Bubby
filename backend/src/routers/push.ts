/**
 * Push token registration.
 *
 * Both routes are authenticated and SELF-ONLY: the user id comes from the JWT
 * and never from the body, so one account can't register or revoke another's
 * device. There is deliberately no GET — a token is a routable address for a
 * specific handset, and nobody has any business enumerating them.
 */
import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, userId } from '@/http/context';
import { pushService } from '@/services/push';

export const pushRouter = Router();

pushRouter.post('/tokens', requireAuth, route(async (req) => {
  const { token, platform } = (req.body ?? {}) as { token?: string; platform?: string };
  if (!token) return { ok: false };
  await pushService.register(userId(req), token, platform);
  return { ok: true };
}));

pushRouter.delete('/tokens/:token', requireAuth, route(async (req) => {
  await pushService.unregister(userId(req), req.params.token);
  return { ok: true };
}));
