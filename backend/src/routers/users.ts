import { Router } from 'express';
import { route } from '@/http/handler';
import { optionalAuth, optionalUserId, requireAuth, userId } from '@/http/context';
import { isSuperAdmin, requireSelf } from '@/authz';
import { userService } from '@/services/users';

export const usersRouter = Router();

// Public on purpose — the directory is how a business links a teammate or picks
// who to bill. The VIEWER is threaded through so the service can decide what to
// reveal: everyone gets the public card, only a super-admin sees phone/email.
// Do not "fix" the exposure by requiring auth here; a signed-in stranger is
// exactly the threat model, and the stripping in the service is the real guard.
usersRouter.get('/', optionalAuth, route(async (req) => userService.list(optionalUserId(req))));

usersRouter.get('/search', optionalAuth, route(async (req) =>
  userService.search(
    typeof req.query.q === 'string' ? req.query.q : '',
    optionalUserId(req),
  ),
));

// The derived super-admin flag for the CALLER. `isSuperAdmin` is no longer
// stored on the profile (it was user-writable, i.e. self-granting), so the app
// asks for it per session — the api auth repo mirrors Path A's withAdminFlag.
// Declared before '/:id' so it isn't swallowed as a user id.
usersRouter.get('/me/is-super-admin', requireAuth, route(async (req) => ({
  isSuperAdmin: await isSuperAdmin(userId(req)),
})));

usersRouter.get('/:id', optionalAuth, route(async (req) =>
  userService.getById(req.params.id, optionalUserId(req)),
));

usersRouter.patch('/:id', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.id);
  return userService.update(req.params.id, req.body);
}));
