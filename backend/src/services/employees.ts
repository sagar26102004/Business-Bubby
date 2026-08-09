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

  /**
   * Update a team member's row.
   *
   * ⚠️ RANK AND IDENTITY ARE OWNER-ONLY. `level` lives inside the employee
   * document and this route is member-level, so without this guard any staff
   * member could `PATCH {"level":"manager"}` on their OWN row and promote
   * themselves — and with `userId` writable they could point a row at a
   * different account. `privileged` is true only for the business owner or a
   * platform super-admin; everyone else keeps the stored values.
   */
  async update(id: string, patch: Partial<Employee>, privileged = false): Promise<Employee> {
    const existing = await this.getById(id);
    if (!existing) throw notFound(`Employee ${id} not found`);
    const safePatch = { ...patch };
    if (!privileged) {
      delete safePatch.level;
      delete safePatch.userId;
    }
    // businessId can never move, for anyone — a row belongs to one business.
    delete (safePatch as { businessId?: string }).businessId;
    const next = { ...existing, ...safePatch, id, businessId: existing.businessId };
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
