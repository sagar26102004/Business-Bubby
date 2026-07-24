/**
 * Supabase-backed EmployeeRepository over the `employees` table (public read;
 * members write). Adding/removing a member also updates the business's
 * call/chat routing arrays, mirroring registration.
 */
import type { Business, Employee } from '@/domain/types';
import { normalizeRole } from '@/domain/roles';
import type { EmployeeRepository, NewEmployeeInput } from '@/data/repositories';
import { sb, uuid, uuidOrNull } from './shared';

async function loadBusiness(id: string): Promise<Business | null> {
  const { data, error } = await sb().from('businesses').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? (data.data as Business) : null;
}

async function saveBusiness(b: Business): Promise<void> {
  const { error } = await sb().from('businesses').update({ data: b }).eq('id', b.id);
  if (error) throw error;
}

export function createSupabaseEmployees(): EmployeeRepository {
  return {
    async listByBusiness(businessId: string): Promise<Employee[]> {
      const { data, error } = await sb()
        .from('employees')
        .select('data')
        .eq('business_id', businessId);
      if (error) throw error;
      return (data ?? []).map((r) => r.data as Employee);
    },

    async getById(id: string): Promise<Employee | null> {
      const { data, error } = await sb().from('employees').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? (data.data as Employee) : null;
    },

    async listBusinessesForUser(userId: string): Promise<Business[]> {
      const { data, error } = await sb()
        .from('employees')
        .select('business_id')
        .eq('user_id', userId);
      if (error) throw error;
      const ids = Array.from(new Set((data ?? []).map((r) => r.business_id as string)));
      if (ids.length === 0) return [];
      const { data: rows, error: bErr } = await sb().from('businesses').select('data').in('id', ids);
      if (bErr) throw bErr;
      return (rows ?? []).map((r) => r.data as Business);
    },

    async update(id: string, patch: Partial<Employee>): Promise<Employee> {
      const current = await this.getById(id);
      if (!current) throw new Error(`Employee ${id} not found`);
      const next = { ...current, ...patch };
      const { error } = await sb()
        .from('employees')
        .update({ data: next, user_id: uuidOrNull(next.userId) })
        .eq('id', id);
      if (error) throw error;
      return next;
    },

    async add(businessId: string, input: NewEmployeeInput): Promise<Employee> {
      const business = await loadBusiness(businessId);
      if (!business) throw new Error(`Business ${businessId} not found`);
      const employee: Employee = {
        id: uuid(),
        businessId,
        displayName: input.displayName,
        role: normalizeRole(input.role),
        level: input.level ?? 'staff',
        userId: input.userId,
      };
      const { error } = await sb()
        .from('employees')
        .insert({ id: employee.id, business_id: businessId, user_id: uuidOrNull(input.userId), data: employee });
      if (error) throw error;
      business.employeeIds = [...(business.employeeIds ?? []), employee.id];
      business.callHandlerIds = [...(business.callHandlerIds ?? []), employee.id];
      business.chatRecipientIds = [...(business.chatRecipientIds ?? []), employee.id];
      await saveBusiness(business);
      return employee;
    },

    async remove(id: string): Promise<void> {
      const removed = await this.getById(id);
      if (!removed) return;
      const { error } = await sb().from('employees').delete().eq('id', id);
      if (error) throw error;
      const business = await loadBusiness(removed.businessId);
      if (business) {
        business.employeeIds = (business.employeeIds ?? []).filter((eid) => eid !== id);
        business.callHandlerIds = (business.callHandlerIds ?? []).filter((eid) => eid !== id);
        business.chatRecipientIds = (business.chatRecipientIds ?? []).filter((eid) => eid !== id);
        await saveBusiness(business);
      }
    },
  };
}
