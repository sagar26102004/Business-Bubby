import { Router } from 'express';
import { route } from '@/http/handler';
import { optionalAuth, requireAuth, optionalUserId } from '@/http/context';
import {
  isBusinessOwner,
  isSuperAdmin,
  requireBusinessMember,
  requireOwner,
} from '@/authz';
import { notFound } from '@/http/errors';
import { employeeService } from '@/services/employees';

export const employeesRouter = Router();

employeesRouter.get('/business/:businessId', optionalAuth, route(async (req) =>
  employeeService.listByBusiness(req.params.businessId),
));

employeesRouter.get('/user/:userId/businesses', optionalAuth, route(async (req) =>
  employeeService.listBusinessesForUser(req.params.userId),
));

employeesRouter.get('/:id', optionalAuth, route(async (req) => employeeService.getById(req.params.id)));

/**
 * Load the employee or 404.
 *
 * ⚠️ These guards used to read `if (emp) await requireBusinessMember(...)`,
 * which FAILS OPEN: a missing row skipped the authz check entirely and the
 * mutation ran unauthenticated. Missing must be an error, never a bypass.
 */
async function mustLoad(id: string) {
  const emp = await employeeService.getById(id);
  if (!emp) throw notFound(`Employee ${id} not found`);
  return emp;
}

/** Owner (or super-admin) only — adding a team member is an ownership act. */
async function requireOwnerOrAdmin(businessId: string, uid: string | null): Promise<void> {
  if (await isSuperAdmin(uid)) return;
  await requireOwner(businessId, uid);
}

// Hiring and firing belong to the owner. As `requireBusinessMember` this let
// any staff member add colleagues — or delete the whole team.
employeesRouter.post('/business/:businessId', requireAuth, route(async (req) => {
  await requireOwnerOrAdmin(req.params.businessId, optionalUserId(req));
  return employeeService.add(req.params.businessId, req.body);
}));

// Members may edit a teammate's row (role, permissions, showOnPage) — but the
// service refuses the fields that would change RANK or identity.
employeesRouter.patch('/:id', requireAuth, route(async (req) => {
  const emp = await mustLoad(req.params.id);
  const uid = optionalUserId(req);
  await requireBusinessMember(emp.businessId, uid);
  const privileged =
    (await isSuperAdmin(uid)) ||
    (await isBusinessOwner(emp.businessId, uid));
  return employeeService.update(req.params.id, req.body, privileged);
}));

employeesRouter.delete('/:id', requireAuth, route(async (req) => {
  const emp = await mustLoad(req.params.id);
  await requireOwnerOrAdmin(emp.businessId, optionalUserId(req));
  await employeeService.remove(req.params.id);
  return { ok: true };
}));
