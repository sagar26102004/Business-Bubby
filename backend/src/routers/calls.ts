import { Router } from 'express';
import { route } from '@/http/handler';
import { requireAuth, userId, optionalUserId } from '@/http/context';
import { requireBusinessMember, requireCustomerOrMember, requireSelf } from '@/authz';
import { callService } from '@/services/calls';
import { notFound } from '@/http/errors';

export const callsRouter = Router();

async function loadCall(id: string) {
  const call = await callService.getById(id);
  if (!call) throw notFound(`Call ${id} not found`);
  return call;
}

callsRouter.post('/start', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.body.customer?.id);
  return callService.start(req.body.businessId, req.body.customer);
}));

/**
 * Decline from a phone whose app is CLOSED — the notification's Decline pill.
 *
 * ⚠️ DELIBERATELY UNAUTHENTICATED (no `requireAuth`). A killed app has nothing
 * to sign with: there is no session, and whatever access token it cached may
 * have expired hours ago. The device's Expo push token IS the credential — it
 * is the address the call was rung on — and the service resolves it to a user
 * before checking that user is a still-ringing participant on this call. It
 * must NOT fall through to the `/:id/decline` guard above, which expects an
 * authenticated caller.
 *
 * The call id travels in the BODY rather than the path because the native side
 * stores exactly one endpoint URL (`setDeclineEndpoint`) and posts
 * `{ callId, pushToken }` to it, mirroring the `call-decline` edge function.
 */
callsRouter.post('/decline-by-device', route(async (req) => {
  const { callId, pushToken } = (req.body ?? {}) as { callId?: string; pushToken?: string };
  return callService.declineByDevice(callId ?? '', pushToken ?? '');
}));

// Workspace call log. Business-scoped, so members only — this mirrors the
// member branch of the `calls_read` RLS policy (the customer branch is
// irrelevant for a whole-business listing).
callsRouter.get('/business/:businessId', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  return callService.listForBusiness(req.params.businessId, since);
}));

callsRouter.get('/incoming/:userId', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.userId);
  return callService.getIncomingForUser(req.params.userId);
}));

callsRouter.get('/:id', requireAuth, route(async (req) => {
  const call = await loadCall(req.params.id);
  await requireCustomerOrMember(call.businessId, call.customerId, optionalUserId(req));
  return call;
}));

callsRouter.post('/:id/join', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.body.participantId);
  return callService.join(req.params.id, req.body.participantId);
}));

callsRouter.post('/:id/decline', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.body.participantId);
  return callService.decline(req.params.id, req.body.participantId);
}));

callsRouter.post('/:id/leave', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.body.participantId);
  return callService.leave(req.params.id, req.body.participantId);
}));

// Live audio: the service checks the caller is a participant before minting.
callsRouter.post('/:id/token', requireAuth, route(async (req) =>
  callService.getAudioToken(req.params.id, userId(req)),
));
