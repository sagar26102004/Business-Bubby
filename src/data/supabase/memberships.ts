/**
 * Supabase-backed MembershipRepository over `memberships` + `membership_payments`.
 * Billing cycles and the current-cycle payment standing are derived on read
 * (hydrate), exactly like the mock — `startedAt` is the source of truth.
 */
import type { Business, Membership, MembershipPayment, MonthlySpend } from '@/domain/types';
import type {
  AcceptEnrollInput,
  EnrollRequestInput,
  MembershipRepository,
  NewMembershipInput,
  ReportPaymentInput,
} from '@/data/repositories';
import { formatMoney } from '@/lib/money';
import { sb, uuid, nowIso, isUuid, uuidOrNull, notify } from './shared';

function addMonths(iso: string | Date, n: number): Date {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + n);
  return d;
}

function sameCycle(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
}

async function businessInfo(id: string): Promise<{ name: string; ownerId: string } | null> {
  const { data } = await sb().from('businesses').select('data').eq('id', id).maybeSingle();
  if (!data) return null;
  const b = data.data as Business;
  return { name: b.name, ownerId: b.ownerId };
}

async function paymentsFor(membershipId: string): Promise<MembershipPayment[]> {
  const { data } = await sb().from('membership_payments').select('data').eq('membership_id', membershipId);
  return (data ?? []).map((r) => r.data as MembershipPayment);
}

function paymentSummary(payments: MembershipPayment[], periodStart: Date): Membership['payment'] {
  const approved = payments.filter((p) => p.status === 'approved');
  const cyclePays = payments.filter((p) => sameCycle(p.periodStart, periodStart.toISOString()));
  const pending = cyclePays.find((p) => p.status === 'pending');
  const status: 'paid' | 'pending' | 'unpaid' = cyclePays.some((p) => p.status === 'approved')
    ? 'paid'
    : pending
      ? 'pending'
      : 'unpaid';
  const daysOverdue =
    status === 'unpaid' ? Math.max(0, Math.floor((Date.now() - periodStart.getTime()) / 86_400_000)) : 0;
  return {
    status,
    periodStart: periodStart.toISOString(),
    daysOverdue,
    monthsPaid: approved.length,
    totalPaid: approved.reduce((sum, p) => sum + p.amount, 0),
    pendingPaymentId: pending?.id,
  };
}

async function loadMembership(id: string): Promise<Membership> {
  const { data, error } = await sb().from('memberships').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Membership ${id} not found`);
  return data.data as Membership;
}

async function saveMembership(m: Membership): Promise<void> {
  const { error } = await sb()
    .from('memberships')
    .update({ data: m, customer_id: uuidOrNull(m.customerId) })
    .eq('id', m.id);
  if (error) throw error;
}

async function hydrate(m: Membership): Promise<Membership> {
  const now = new Date();
  let renewed = new Date(m.startedAt);
  while (m.status === 'active' && addMonths(renewed, 1) <= now) {
    renewed = addMonths(renewed, 1);
  }
  const info = await businessInfo(m.businessId);
  const base: Membership = {
    ...m,
    businessName: info?.name ?? m.businessName,
    renewedAt: renewed.toISOString(),
    expiresAt: addMonths(renewed, 1).toISOString(),
  };
  if (m.status !== 'active') return base;
  const payments = await paymentsFor(m.id);
  return { ...base, payment: paymentSummary(payments, renewed) };
}

const hydrateAll = (rows: Membership[]) => Promise.all(rows.map(hydrate));

export function createSupabaseMemberships(): MembershipRepository {
  return {
    async listForCustomer(customerId: string): Promise<Membership[]> {
      // 'guest' is not a uuid — a guest holds no plans.
      if (!isUuid(customerId)) return [];
      const { data, error } = await sb().from('memberships').select('data').eq('customer_id', customerId);
      if (error) throw error;
      const rows = (data ?? [])
        .map((r) => r.data as Membership)
        .filter((m) => m.status === 'active' && !m.standalone);
      const hydrated = await hydrateAll(rows);
      return hydrated.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },

    async monthlySpend(customerId: string): Promise<MonthlySpend[]> {
      if (!isUuid(customerId)) return [];
      const { data, error } = await sb().from('memberships').select('data').eq('customer_id', customerId);
      if (error) throw error;
      const rows = (data ?? [])
        .map((r) => r.data as Membership)
        .filter((m) => !m.standalone && (m.status === 'active' || m.status === 'cancelled'));
      const mine = await hydrateAll(rows);
      if (mine.length === 0) return [];
      const now = new Date();
      const earliest = mine.reduce((min, m) => (m.startedAt < min ? m.startedAt : min), mine[0].startedAt);
      const first = new Date(earliest);
      let cursor = new Date(first.getFullYear(), first.getMonth(), 1);
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const months: MonthlySpend[] = [];
      while (cursor <= currentMonth) {
        const monthEnd = addMonths(cursor, 1);
        const lines = mine
          .filter((m) => new Date(m.startedAt) < monthEnd && (!m.endedAt || new Date(m.endedAt) >= cursor))
          .map((m) => ({ businessName: m.businessName, planName: m.planName, amount: m.pricePerMonth }));
        months.push({
          month: cursor.toISOString(),
          total: lines.reduce((sum, l) => sum + l.amount, 0),
          lines,
        });
        cursor = monthEnd;
      }
      return months.reverse();
    },

    async listForBusiness(businessId: string): Promise<Membership[]> {
      const { data, error } = await sb().from('memberships').select('data').eq('business_id', businessId);
      if (error) throw error;
      const rows = (data ?? []).map((r) => r.data as Membership).filter((m) => m.status === 'active');
      const hydrated = await hydrateAll(rows);
      return hydrated.sort((a, b) => a.customerName.localeCompare(b.customerName));
    },

    async listCancelledForBusiness(businessId: string): Promise<Membership[]> {
      const { data, error } = await sb().from('memberships').select('data').eq('business_id', businessId);
      if (error) throw error;
      const rows = (data ?? []).map((r) => r.data as Membership).filter((m) => m.status === 'cancelled');
      const hydrated = await hydrateAll(rows);
      return hydrated.sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
    },

    async listRequests(businessId: string): Promise<Membership[]> {
      const { data, error } = await sb().from('memberships').select('data').eq('business_id', businessId);
      if (error) throw error;
      const rows = (data ?? []).map((r) => r.data as Membership).filter((m) => m.status === 'pending');
      const hydrated = await hydrateAll(rows);
      return hydrated.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },

    async getById(id: string): Promise<Membership | null> {
      const { data, error } = await sb().from('memberships').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? hydrate(data.data as Membership) : null;
    },

    async add(input: NewMembershipInput): Promise<Membership> {
      const info = await businessInfo(input.businessId);
      if (!info) throw new Error(`Business ${input.businessId} not found`);
      const started = new Date();
      const membership: Membership = {
        id: uuid(),
        businessId: input.businessId,
        businessName: info.name,
        customerId: input.customerId,
        customerName: input.customerName,
        planName: input.planName,
        pricePerMonth: input.pricePerMonth,
        startedAt: started.toISOString(),
        renewedAt: started.toISOString(),
        expiresAt: addMonths(started, 1).toISOString(),
        status: 'active',
      };
      const { error } = await sb().from('memberships').insert({
        id: membership.id,
        business_id: input.businessId,
        customer_id: uuidOrNull(input.customerId),
        data: membership,
      });
      if (error) throw error;
      return membership;
    },

    async request(input: EnrollRequestInput): Promise<Membership> {
      const info = await businessInfo(input.businessId);
      if (!info) throw new Error(`Business ${input.businessId} not found`);
      const now = new Date();
      const membership: Membership = {
        id: uuid(),
        businessId: input.businessId,
        businessName: info.name,
        customerId: input.customerId,
        customerName: input.customerName,
        planName: input.requestedPlan?.trim() || 'Enrolment request',
        requestedPlan: input.requestedPlan?.trim() || undefined,
        requestedPrice: input.requestedPrice,
        enrolleeName: input.enrolleeName?.trim() || undefined,
        pricePerMonth: 0,
        startedAt: now.toISOString(),
        renewedAt: now.toISOString(),
        expiresAt: addMonths(now, 1).toISOString(),
        status: 'pending',
      };
      const { error } = await sb().from('memberships').insert({
        id: membership.id,
        business_id: input.businessId,
        customer_id: uuidOrNull(input.customerId),
        data: membership,
      });
      if (error) throw error;
      const who = input.enrolleeName?.trim()
        ? `${input.customerName} (for ${input.enrolleeName.trim()})`
        : input.customerName;
      await notify({
        recipientId: info.ownerId,
        kind: 'enroll_requested',
        title: `New enrolment request · ${info.name}`,
        body: input.requestedPlan?.trim()
          ? `${who} wants to enrol: “${input.requestedPlan.trim()}”.`
          : `${who} wants to enrol — set their plan to confirm.`,
        businessId: input.businessId,
      });
      return membership;
    },

    async accept(id: string, input: AcceptEnrollInput): Promise<Membership> {
      const membership = await loadMembership(id);
      if (membership.status !== 'pending') throw new Error('This request was already responded to.');
      const started = new Date();
      membership.planName = input.planName;
      membership.pricePerMonth = input.pricePerMonth;
      membership.startedAt = started.toISOString();
      membership.renewedAt = started.toISOString();
      membership.expiresAt = addMonths(started, 1).toISOString();
      membership.status = 'active';
      await saveMembership(membership);
      await notify({
        recipientId: membership.customerId,
        kind: 'enroll_update',
        title: `Enrolment confirmed · ${membership.businessName}`,
        body: `You're enrolled in ${input.planName} — ${formatMoney(input.pricePerMonth)}/mo. See it in your Subscriptions.`,
        businessId: membership.businessId,
      });
      return hydrate(membership);
    },

    async reject(id: string): Promise<Membership> {
      const membership = await loadMembership(id);
      if (membership.status !== 'pending') throw new Error('This request was already responded to.');
      membership.status = 'rejected';
      membership.endedAt = nowIso();
      await saveMembership(membership);
      await notify({
        recipientId: membership.customerId,
        kind: 'enroll_update',
        title: `Enrolment declined · ${membership.businessName}`,
        body: `${membership.businessName} couldn't take your enrolment request right now.`,
        businessId: membership.businessId,
      });
      return hydrate(membership);
    },

    async cancel(id: string): Promise<Membership> {
      const membership = await loadMembership(id);
      membership.status = 'cancelled';
      membership.endedAt = nowIso();
      await saveMembership(membership);
      return hydrate(membership);
    },

    async reenroll(id: string): Promise<Membership> {
      const membership = await loadMembership(id);
      const started = new Date();
      membership.status = 'active';
      membership.startedAt = started.toISOString();
      membership.renewedAt = started.toISOString();
      membership.expiresAt = addMonths(started, 1).toISOString();
      membership.endedAt = undefined;
      await saveMembership(membership);
      if (!membership.standalone) {
        await notify({
          recipientId: membership.customerId,
          kind: 'enroll_update',
          title: `Re-enrolled · ${membership.businessName}`,
          body: `You're back on ${membership.planName} — ${formatMoney(membership.pricePerMonth)}/mo. See it in your Subscriptions.`,
          businessId: membership.businessId,
        });
      }
      return hydrate(membership);
    },

    async setStartDate(id: string, startedAt: string): Promise<Membership> {
      const membership = await loadMembership(id);
      const when = new Date(startedAt);
      if (isNaN(when.getTime())) throw new Error('Enter a valid date.');
      if (when.getTime() > Date.now()) throw new Error('The enrolment date can’t be in the future.');
      membership.startedAt = when.toISOString();
      await saveMembership(membership);
      return hydrate(membership);
    },

    async reassign(id: string, toCustomerId: string, toCustomerName: string): Promise<Membership> {
      const membership = await loadMembership(id);
      if (!membership.enrolleeName && membership.customerName) {
        membership.enrolleeName = membership.customerName;
      }
      membership.customerId = toCustomerId;
      membership.customerName = toCustomerName;
      membership.standalone = false;
      await saveMembership(membership);
      if (membership.status === 'active') {
        await notify({
          recipientId: toCustomerId,
          kind: 'enroll_update',
          title: `Plan moved to your account · ${membership.businessName}`,
          body: `“${membership.planName}”${
            membership.enrolleeName ? ` for ${membership.enrolleeName}` : ''
          } is now on your account — ${formatMoney(membership.pricePerMonth)}/mo. See it in your Subscriptions.`,
          businessId: membership.businessId,
        });
      }
      return hydrate(membership);
    },

    async detach(id: string): Promise<Membership> {
      const membership = await loadMembership(id);
      membership.customerName = membership.enrolleeName || membership.customerName;
      membership.customerId = `standalone:${membership.id}`;
      membership.enrolleeName = undefined;
      membership.standalone = true;
      await saveMembership(membership);
      return hydrate(membership);
    },

    async renameEnrollee(id: string, name: string): Promise<Membership> {
      const membership = await loadMembership(id);
      const clean = name.trim();
      if (!clean) throw new Error('Enter a name.');
      if (membership.enrolleeName && !membership.standalone) {
        membership.enrolleeName = clean;
      } else {
        membership.customerName = clean;
      }
      await saveMembership(membership);
      return hydrate(membership);
    },

    async listPayments(membershipId: string): Promise<MembershipPayment[]> {
      const payments = await paymentsFor(membershipId);
      return payments.sort(
        (a, b) => b.periodStart.localeCompare(a.periodStart) || b.reportedAt.localeCompare(a.reportedAt),
      );
    },

    async reportPayment(input: ReportPaymentInput): Promise<MembershipPayment> {
      const m = await loadMembership(input.membershipId);
      const existing = await paymentsFor(m.id);
      const live = existing.find(
        (p) => sameCycle(p.periodStart, input.periodStart) && p.status !== 'rejected',
      );
      if (live) {
        throw new Error(
          live.status === 'approved' ? 'This month is already paid.' : 'This month is already reported.',
        );
      }
      const pay: MembershipPayment = {
        id: uuid(),
        membershipId: m.id,
        businessId: m.businessId,
        customerId: m.customerId,
        periodStart: input.periodStart,
        amount: m.pricePerMonth,
        status: 'pending',
        method: input.method,
        paidToName: input.paidToName?.trim() || undefined,
        note: input.note?.trim() || undefined,
        reportedBy: 'customer',
        reportedByName: m.customerName,
        reportedAt: nowIso(),
      };
      const { error } = await sb()
        .from('membership_payments')
        .insert({ id: pay.id, membership_id: m.id, data: pay });
      if (error) throw error;
      const info = await businessInfo(m.businessId);
      if (info) {
        await notify({
          recipientId: info.ownerId,
          kind: 'payment_reported',
          title: `Payment reported · ${info.name}`,
          body: `${m.customerName}${m.enrolleeName ? ` (for ${m.enrolleeName})` : ''} says they paid ${formatMoney(
            m.pricePerMonth,
          )} for ${m.planName}. Approve it.`,
          businessId: m.businessId,
          membershipId: m.id,
        });
      }
      return pay;
    },

    async recordPayment(input: ReportPaymentInput & { byName: string }): Promise<MembershipPayment> {
      const m = await loadMembership(input.membershipId);
      const existing = await paymentsFor(m.id);
      const live = existing.find((p) => sameCycle(p.periodStart, input.periodStart) && p.status === 'approved');
      if (live) throw new Error('This month is already paid.');
      const now = nowIso();
      const pay: MembershipPayment = {
        id: uuid(),
        membershipId: m.id,
        businessId: m.businessId,
        customerId: m.customerId,
        periodStart: input.periodStart,
        amount: m.pricePerMonth,
        status: 'approved',
        method: input.method,
        paidToName: input.paidToName?.trim() || undefined,
        note: input.note?.trim() || undefined,
        reportedBy: 'business',
        reportedByName: input.byName,
        reportedAt: now,
        decidedByName: input.byName,
        decidedAt: now,
      };
      const { error } = await sb()
        .from('membership_payments')
        .insert({ id: pay.id, membership_id: m.id, data: pay });
      if (error) throw error;
      if (!m.standalone) {
        await notify({
          recipientId: m.customerId,
          kind: 'payment_update',
          title: `Payment recorded · ${m.businessName}`,
          body: `${input.byName} recorded your ${formatMoney(m.pricePerMonth)} payment for ${m.planName}.`,
          businessId: m.businessId,
          membershipId: m.id,
        });
      }
      return pay;
    },

    async approvePayment(id: string, byName: string): Promise<MembershipPayment> {
      const { data, error } = await sb().from('membership_payments').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Payment ${id} not found`);
      const pay = data.data as MembershipPayment;
      if (pay.status !== 'pending') throw new Error('This payment was already decided.');
      pay.status = 'approved';
      pay.decidedByName = byName;
      pay.decidedAt = nowIso();
      const { error: uErr } = await sb().from('membership_payments').update({ data: pay }).eq('id', id);
      if (uErr) throw uErr;
      const m = await loadMembership(pay.membershipId).catch(() => null);
      if (m && !m.standalone) {
        await notify({
          recipientId: m.customerId,
          kind: 'payment_update',
          title: `Payment approved · ${m.businessName}`,
          body: `Your ${formatMoney(pay.amount)} payment for ${m.planName} was confirmed.`,
          businessId: m.businessId,
          membershipId: m.id,
        });
      }
      return pay;
    },

    async rejectPayment(id: string, byName: string): Promise<MembershipPayment> {
      const { data, error } = await sb().from('membership_payments').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Payment ${id} not found`);
      const pay = data.data as MembershipPayment;
      if (pay.status !== 'pending') throw new Error('This payment was already decided.');
      pay.status = 'rejected';
      pay.decidedByName = byName;
      pay.decidedAt = nowIso();
      const { error: uErr } = await sb().from('membership_payments').update({ data: pay }).eq('id', id);
      if (uErr) throw uErr;
      const m = await loadMembership(pay.membershipId).catch(() => null);
      if (m && !m.standalone) {
        await notify({
          recipientId: m.customerId,
          kind: 'payment_update',
          title: `Payment not confirmed · ${m.businessName}`,
          body: `${byName} couldn't confirm your ${formatMoney(pay.amount)} payment for ${m.planName}. Please check with them.`,
          businessId: m.businessId,
          membershipId: m.id,
        });
      }
      return pay;
    },
  };
}
