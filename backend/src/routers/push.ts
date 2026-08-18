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
import { badRequest } from '@/http/errors';
import { pushService } from '@/services/push';

export const pushRouter = Router();

pushRouter.post('/tokens', requireAuth, route(async (req) => {
  const { token, platform } = (req.body ?? {}) as { token?: string; platform?: string };
  // A REAL error, not a quiet `{ ok: false }` 200. The registrar reports what
  // the server says; answering 200 to a registration that did not happen is how
  // a phone ends up permanently unreachable while the call-alerts check shows a
  // cheerful tick.
  if (!token) throw badRequest('A push token is required.');
  await pushService.register(userId(req), token, platform);
  return { ok: true };
}));

/**
 * Will this account be rung on this handset? A bare boolean.
 *
 * Answers for the CALLING user's own token only — a bare token lookup would be
 * an oracle for whether someone else's device is registered.
 */
pushRouter.get('/tokens/:token/registered', requireAuth, route(async (req) =>
  pushService.isRegistered(userId(req), req.params.token),
));

pushRouter.delete('/tokens/:token', requireAuth, route(async (req) => {
  await pushService.unregister(userId(req), req.params.token);
  return { ok: true };
}));
