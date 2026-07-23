import { Router } from 'express';
import { route } from '@/http/handler';
import { optionalAuth, requireAuth, optionalUserId } from '@/http/context';
import { requireBusinessMember } from '@/authz';
import { employeeService } from '@/services/employees';

export const employeesRouter = Router();

employeesRouter.get('/business/:businessId', optionalAuth, route(async (req) =>
  employeeService.listByBusiness(req.params.businessId),
));

employeesRouter.get('/user/:userId/businesses', optionalAuth, route(async (req) =>
  employeeService.listBusinessesForUser(req.params.userId),
));

employeesRouter.get('/:id', optionalAuth, route(async (req) => employeeService.getById(req.params.id)));

employeesRouter.post('/business/:businessId', requireAuth, route(async (req) => {
  await requireBusinessMember(req.params.businessId, optionalUserId(req));
  return employeeService.add(req.params.businessId, req.body);
}));

employeesRouter.patch('/:id', requireAuth, route(async (req) => {
  const emp = await employeeService.getById(req.params.id);
  if (emp) await requireBusinessMember(emp.businessId, optionalUserId(req));
  return employeeService.update(req.params.id, req.body);
}));

employeesRouter.delete('/:id', requireAuth, route(async (req) => {
  const emp = await employeeService.getById(req.params.id);
  if (emp) await requireBusinessMember(emp.businessId, optionalUserId(req));
  await employeeService.remove(req.params.id);
  return { ok: true };
}));
