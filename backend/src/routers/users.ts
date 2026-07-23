import { Router } from 'express';
import { route } from '@/http/handler';
import { optionalAuth, requireAuth, userId } from '@/http/context';
import { requireSelf } from '@/authz';
import { userService } from '@/services/users';

export const usersRouter = Router();

usersRouter.get('/', optionalAuth, route(async () => userService.list()));

usersRouter.get('/search', optionalAuth, route(async (req) =>
  userService.search(typeof req.query.q === 'string' ? req.query.q : ''),
));

usersRouter.get('/:id', optionalAuth, route(async (req) => userService.getById(req.params.id)));

usersRouter.patch('/:id', requireAuth, route(async (req) => {
  requireSelf(userId(req), req.params.id);
  return userService.update(req.params.id, req.body);
}));
