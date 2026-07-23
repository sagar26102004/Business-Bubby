/** Employees — ports MockEmployeeRepository. */
import type { Business, Employee } from '@/domain/types';
import type { NewEmployeeInput } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, rowsData, toJson, uuidOrNull } from '@/lib/data';
import { normalizeRole } from '@/lib/roles';
import { notFound } from '@/http/errors';

async function findBusiness(id: string): Promise<Business | null> {
  const row = await prisma.business.findUnique({ where: { id } });
  return row ? asData<Business>(row) : null;
}

export const employeeService = {
  async listByBusiness(businessId: string): Promise<Employee[]> {
    return rowsData<Employee>(await prisma.employee.findMany({ where: { businessId } }));
  },

  async getById(id: string): Promise<Employee | null> {
    const row = await prisma.employee.findUnique({ where: { id } });
    return row ? asData<Employee>(row) : null;
  },

  async listBusinessesForUser(userId: string): Promise<Business[]> {
    const emps = await prisma.employee.findMany({ where: { userId }, select: { businessId: true } });
    const ids = Array.from(new Set(emps.map((e) => e.businessId)));
    if (!ids.length) return [];
    return rowsData<Business>(await prisma.business.findMany({ where: { id: { in: ids } } }));
  },

  async update(id: string, patch: Partial<Employee>): Promise<Employee> {
    const existing = await this.getById(id);
    if (!existing) throw notFound(`Employee ${id} not found`);
    const next = { ...existing, ...patch, id, businessId: existing.businessId };
    await prisma.employee.update({
      where: { id },
      data: { userId: uuidOrNull(next.userId), data: toJson(next) },
    });
    return next;
  },

  async add(businessId: string, input: NewEmployeeInput): Promise<Employee> {
    const business = await findBusiness(businessId);
    if (!business) throw notFound(`Business ${businessId} not found`);
    const employee: Employee = {
      id: newUuid(),
      businessId,
      displayName: input.displayName,
      role: normalizeRole(input.role),
      level: input.level ?? 'staff',
      userId: input.userId,
    };
    await prisma.employee.create({
      data: { id: employee.id, businessId, userId: uuidOrNull(employee.userId), data: toJson(employee) },
    });
    // Mirror registration: new member rings on calls + receives chats by default.
    business.employeeIds = [...(business.employeeIds ?? []), employee.id];
    business.callHandlerIds = [...(business.callHandlerIds ?? []), employee.id];
    business.chatRecipientIds = [...(business.chatRecipientIds ?? []), employee.id];
    await prisma.business.update({ where: { id: businessId }, data: { data: toJson(business) } });
    return employee;
  },

  async remove(id: string): Promise<void> {
    const employee = await this.getById(id);
    if (!employee) return;
    await prisma.employee.delete({ where: { id } });
    const business = await findBusiness(employee.businessId);
    if (business) {
      business.employeeIds = (business.employeeIds ?? []).filter((eid) => eid !== id);
      business.callHandlerIds = (business.callHandlerIds ?? []).filter((eid) => eid !== id);
      business.chatRecipientIds = (business.chatRecipientIds ?? []).filter((eid) => eid !== id);
      await prisma.business.update({
        where: { id: business.id },
        data: { data: toJson(business) },
      });
    }
  },
};
