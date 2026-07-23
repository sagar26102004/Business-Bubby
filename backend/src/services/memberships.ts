/** Memberships — ports MockMembershipRepository (cycles, payments, enrol flow). */
import type { Business, Membership, MembershipPayment, MonthlySpend } from '@/domain/types';
import type {
  AcceptEnrollInput,
  EnrollRequestInput,
  NewMembershipInput,
  ReportPaymentInput,
} from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, jsonEquals, rowsData, toJson, uuidOrNull } from '@/lib/data';
import { formatMoney } from '@/lib/money';
import { notFound } from '@/http/errors';
import { notify } from './notify';

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

async function bizName(businessId: string, fallback: string): Promise<string> {
  const row = await prisma.business.findUnique({ where: { id: businessId } });
  return row ? asData<Business>(row).name : fallback;
}

async function paymentsFor(membershipId: string): Promise<MembershipPayment[]> {
  return rowsData<MembershipPayment>(
    await prisma.membershipPayment.findMany({ where: { membershipId } }),
  );
}

async function paymentSummary(
  membershipId: string,
  periodStart: Date,
): Promise<Membership['payment']> {
  const mine = await paymentsFor(membershipId);
  const approved = mine.filter((p) => p.status === 'approved');
  const cyclePays = mine.filter((p) => sameCycle(p.periodStart, periodStart.toISOString()));
  const pending = cyclePays.find((p) => p.status === 'pending');
  const status: 'paid' | 'pending' | 'unpaid' = cyclePays.some((p) => p.status === 'approved')
    ? 'paid'
    : pending
      ? 'pending'
      : 'unpaid';
  const daysOverdue =
    status === 'unpaid'
      ? Math.max(0, Math.floor((Date.now() - periodStart.getTime()) / 86_400_000))
      : 0;
  return {
    status,
    periodStart: periodStart.toISOString(),
    daysOverdue,
    monthsPaid: approved.length,
    totalPaid: approved.reduce((sum, p) => sum + p.amount, 0),
    pendingPaymentId: pending?.id,
  };
}

async function hydrate(m: Membership): Promise<Membership> {
  const now = new Date();
  let renewed = new Date(m.startedAt);
  while (m.status === 'active' && addMonths(renewed, 1) <= now) {
    renewed = addMonths(renewed, 1);
  }
  const base: Membership = {
    ...m,
    businessName: await bizName(m.businessId, m.businessName),
    renewedAt: renewed.toISOString(),
    expiresAt: addMonths(renewed, 1).toISOString(),
  };
  if (m.status !== 'active') return base;
  return { ...base, payment: await paymentSummary(m.id, renewed) };
}

async function findMembership(id: string): Promise<Membership | null> {
  const row = await prisma.membership.findUnique({ where: { id } });
  return row ? asData<Membership>(row) : null;
}

async function saveMembership(m: Membership): Promise<Membership> {
  await prisma.membership.update({
    where: { id: m.id },
    data: { customerId: uuidOrNull(m.customerId), data: toJson(m) },
  });
  return hydrate(m);
}

export const membershipService = {
  async listForCustomer(customerId: string): Promise<Membership[]> {
    const rows = await prisma.membership.findMany({
      where: { data: jsonEquals('customerId', customerId) },
    });
    const active = rowsData<Membership>(rows).filter((m) => m.status === 'active' && !m.standalone);
    const hydrated = await Promise.all(active.map(hydrate));
    return hydrated.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  },

  async monthlySpend(customerId: string): Promise<MonthlySpend[]> {
    const rows = await prisma.membership.findMany({
      where: { data: jsonEquals('customerId', customerId) },
    });
    const relevant = rowsData<Membership>(rows).filter(
      (m) => !m.standalone && (m.status === 'active' || m.status === 'cancelled'),
    );
    const mine = await Promise.all(relevant.map(hydrate));
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
        .filter(
          (m) => new Date(m.startedAt) < monthEnd && (!m.endedAt || new Date(m.endedAt) >= cursor),
        )
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
    const rows = rowsData<Membership>(await prisma.membership.findMany({ where: { businessId } }));
    const active = rows.filter((m) => m.status === 'active');
    const hydrated = await Promise.all(active.map(hydrate));
    return hydrated.sort((a, b) => a.customerName.localeCompare(b.customerName));
  },

  async listCancelledForBusiness(businessId: string): Promise<Membership[]> {
    const rows = rowsData<Membership>(await prisma.membership.findMany({ where: { businessId } }));
    const cancelled = rows.filter((m) => m.status === 'cancelled');
    const hydrated = await Promise.all(cancelled.map(hydrate));
    return hydrated.sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
  },

  async listRequests(businessId: string): Promise<Membership[]> {
    const rows = rowsData<Membership>(await prisma.membership.findMany({ where: { businessId } }));
    const pending = rows.filter((m) => m.status === 'pending');
    const hydrated = await Promise.all(pending.map(hydrate));
    return hydrated.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  },

  async getById(id: string): Promise<Membership | null> {
    const m = await findMembership(id);
    return m ? hydrate(m) : null;
  },

  async add(input: NewMembershipInput): Promise<Membership> {
    const bizRow = await prisma.business.findUnique({ where: { id: input.businessId } });
    if (!bizRow) throw notFound(`Business ${input.businessId} not found`);
    const business = asData<Business>(bizRow);
    const started = new Date();
    const membership: Membership = {
      id: newUuid(),
      businessId: input.businessId,
      businessName: business.name,
      customerId: input.customerId,
      customerName: input.customerName,
      planName: input.planName,
      pricePerMonth: input.pricePerMonth,
      startedAt: started.toISOString(),
      renewedAt: started.toISOString(),
      expiresAt: addMonths(started, 1).toISOString(),
      status: 'active',
    };
    await prisma.membership.create({
      data: {
        id: membership.id,
        businessId: membership.businessId,
        customerId: uuidOrNull(membership.customerId),
        data: toJson(membership),
      },
    });
    return membership;
  },

  async request(input: EnrollRequestInput): Promise<Membership> {
    const bizRow = await prisma.business.findUnique({ where: { id: input.businessId } });
    if (!bizRow) throw notFound(`Business ${input.businessId} not found`);
    const business = asData<Business>(bizRow);
    const now = new Date();
    const membership: Membership = {
      id: newUuid(),
      businessId: input.businessId,
      businessName: business.name,
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
    await prisma.membership.create({
      data: {
        id: membership.id,
        businessId: membership.businessId,
        customerId: uuidOrNull(membership.customerId),
        data: toJson(membership),
      },
    });
    const who = input.enrolleeName?.trim()
      ? `${input.customerName} (for ${input.enrolleeName.trim()})`
      : input.customerName;
    await notify({
      recipientId: business.ownerId,
      kind: 'enroll_requested',
      title: `New enrolment request · ${business.name}`,
      body: input.requestedPlan?.trim()
        ? `${who} wants to enrol: “${input.requestedPlan.trim()}”.`
        : `${who} wants to enrol — set their plan to confirm.`,
      businessId: business.id,
    });
    return membership;
  },

  async accept(id: string, input: AcceptEnrollInput): Promise<Membership> {
    const m = await findMembership(id);
    if (!m) throw notFound(`Membership ${id} not found`);
    if (m.status !== 'pending') throw new Error('This request was already responded to.');
    const started = new Date();
    m.planName = input.planName;
    m.pricePerMonth = input.pricePerMonth;
    m.startedAt = started.toISOString();
    m.renewedAt = started.toISOString();
    m.expiresAt = addMonths(started, 1).toISOString();
    m.status = 'active';
    const out = await saveMembership(m);
    await notify({
      recipientId: m.customerId,
      kind: 'enroll_update',
      title: `Enrolment confirmed · ${m.businessName}`,
      body: `You're enrolled in ${input.planName} — ${formatMoney(input.pricePerMonth)}/mo. See it in your Subscriptions.`,
      businessId: m.businessId,
    });
    return out;
  },

  async reject(id: string): Promise<Membership> {
    const m = await findMembership(id);
    if (!m) throw notFound(`Membership ${id} not found`);
    if (m.status !== 'pending') throw new Error('This request was already responded to.');
    m.status = 'rejected';
    m.endedAt = new Date().toISOString();
    const out = await saveMembership(m);
    await notify({
      recipientId: m.customerId,
      kind: 'enroll_update',
      title: `Enrolment declined · ${m.businessName}`,
      body: `${m.businessName} couldn't take your enrolment request right now.`,
      businessId: m.businessId,
    });
    return out;
  },

  async cancel(id: string): Promise<Membership> {
    const m = await findMembership(id);
    if (!m) throw notFound(`Membership ${id} not found`);
    m.status = 'cancelled';
    m.endedAt = new Date().toISOString();
    return saveMembership(m);
  },

  async reenroll(id: string): Promise<Membership> {
    const m = await findMembership(id);
    if (!m) throw notFound(`Membership ${id} not found`);
    const started = new Date();
    m.status = 'active';
    m.startedAt = started.toISOString();
    m.renewedAt = started.toISOString();
    m.expiresAt = addMonths(started, 1).toISOString();
    m.endedAt = undefined;
    const out = await saveMembership(m);
    if (!m.standalone) {
      await notify({
        recipientId: m.customerId,
        kind: 'enroll_update',
        title: `Re-enrolled · ${m.businessName}`,
        body: `You're back on ${m.planName} — ${formatMoney(m.pricePerMonth)}/mo. See it in your Subscriptions.`,
        businessId: m.businessId,
      });
    }
    return out;
  },

  async setStartDate(id: string, startedAt: string): Promise<Membership> {
    const m = await findMembership(id);
    if (!m) throw notFound(`Membership ${id} not found`);
    const when = new Date(startedAt);
    if (isNaN(when.getTime())) throw new Error('Enter a valid date.');
    if (when.getTime() > Date.now()) throw new Error('The enrolment date can’t be in the future.');
    m.startedAt = when.toISOString();
    return saveMembership(m);
  },

  async reassign(id: string, toCustomerId: string, toCustomerName: string): Promise<Membership> {
    const m = await findMembership(id);
    if (!m) throw notFound(`Membership ${id} not found`);
    if (!m.enrolleeName && m.customerName) m.enrolleeName = m.customerName;
    m.customerId = toCustomerId;
    m.customerName = toCustomerName;
    m.standalone = false;
    const out = await saveMembership(m);
    if (m.status === 'active') {
      await notify({
        recipientId: toCustomerId,
        kind: 'enroll_update',
        title: `Plan moved to your account · ${m.businessName}`,
        body: `“${m.planName}”${m.enrolleeName ? ` for ${m.enrolleeName}` : ''} is now on your account — ${formatMoney(m.pricePerMonth)}/mo. See it in your Subscriptions.`,
        businessId: m.businessId,
      });
    }
    return out;
  },

  async detach(id: string): Promise<Membership> {
    const m = await findMembership(id);
    if (!m) throw notFound(`Membership ${id} not found`);
    m.customerName = m.enrolleeName || m.customerName;
    m.customerId = `standalone:${m.id}`;
    m.enrolleeName = undefined;
    m.standalone = true;
    return saveMembership(m);
  },

  async renameEnrollee(id: string, name: string): Promise<Membership> {
    const m = await findMembership(id);
    if (!m) throw notFound(`Membership ${id} not found`);
    const clean = name.trim();
    if (!clean) throw new Error('Enter a name.');
    if (m.enrolleeName && !m.standalone) m.enrolleeName = clean;
    else m.customerName = clean;
    return saveMembership(m);
  },

  async listPayments(membershipId: string): Promise<MembershipPayment[]> {
    const rows = await paymentsFor(membershipId);
    return rows.sort(
      (a, b) =>
        b.periodStart.localeCompare(a.periodStart) || b.reportedAt.localeCompare(a.reportedAt),
    );
  },

  async reportPayment(input: ReportPaymentInput): Promise<MembershipPayment> {
    const m = await findMembership(input.membershipId);
    if (!m) throw notFound(`Membership ${input.membershipId} not found`);
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
      id: newUuid(),
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
      reportedAt: new Date().toISOString(),
    };
    await prisma.membershipPayment.create({
      data: { id: pay.id, membershipId: m.id, data: toJson(pay) },
    });
    const bizRow = await prisma.business.findUnique({ where: { id: m.businessId } });
    if (bizRow) {
      const business = asData<Business>(bizRow);
      await notify({
        recipientId: business.ownerId,
        kind: 'payment_reported',
        title: `Payment reported · ${business.name}`,
        body: `${m.customerName}${m.enrolleeName ? ` (for ${m.enrolleeName})` : ''} says they paid ${formatMoney(
          m.pricePerMonth,
        )} for ${m.planName}. Approve it.`,
        businessId: business.id,
        membershipId: m.id,
      });
    }
    return pay;
  },

  async recordPayment(input: ReportPaymentInput & { byName: string }): Promise<MembershipPayment> {
    const m = await findMembership(input.membershipId);
    if (!m) throw notFound(`Membership ${input.membershipId} not found`);
    const existing = await paymentsFor(m.id);
    const live = existing.find(
      (p) => sameCycle(p.periodStart, input.periodStart) && p.status === 'approved',
    );
    if (live) throw new Error('This month is already paid.');
    const now = new Date().toISOString();
    const pay: MembershipPayment = {
      id: newUuid(),
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
    await prisma.membershipPayment.create({
      data: { id: pay.id, membershipId: m.id, data: toJson(pay) },
    });
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
    const row = await prisma.membershipPayment.findUnique({ where: { id } });
    if (!row) throw notFound(`Payment ${id} not found`);
    const pay = asData<MembershipPayment>(row);
    if (pay.status !== 'pending') throw new Error('This payment was already decided.');
    pay.status = 'approved';
    pay.decidedByName = byName;
    pay.decidedAt = new Date().toISOString();
    await prisma.membershipPayment.update({ where: { id }, data: { data: toJson(pay) } });
    const m = await findMembership(pay.membershipId);
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
    const row = await prisma.membershipPayment.findUnique({ where: { id } });
    if (!row) throw notFound(`Payment ${id} not found`);
    const pay = asData<MembershipPayment>(row);
    if (pay.status !== 'pending') throw new Error('This payment was already decided.');
    pay.status = 'rejected';
    pay.decidedByName = byName;
    pay.decidedAt = new Date().toISOString();
    await prisma.membershipPayment.update({ where: { id }, data: { data: toJson(pay) } });
    const m = await findMembership(pay.membershipId);
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
