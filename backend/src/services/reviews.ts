/** Reviews — ports MockReviewRepository (verified-customer gate + aggregate). */
import type { Bill, Booking, Business, Order, Review } from '@/domain/types';
import type { NewReviewInput, ReviewEligibility } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, isUuid, jsonEquals, rowsData, toJson, uuidOrNull } from '@/lib/data';
import { notFound } from '@/http/errors';
import { notify } from './notify';

async function findBusiness(id: string): Promise<Business | null> {
  const row = await prisma.business.findUnique({ where: { id } });
  return row ? asData<Business>(row) : null;
}

async function eligibility(businessId: string, customerId: string): Promise<ReviewEligibility> {
  // Any synthetic id (the literal 'guest', `walkin:…`, `standalone:…`) is not a
  // signed-in account — and `reviews.customer_id` is a uuid column besides.
  if (!isUuid(customerId)) {
    return { eligible: false, reason: 'Sign in to rate businesses.' };
  }
  const business = await findBusiness(businessId);
  if (business?.ownerId === customerId) {
    return { eligible: false, reason: 'You can’t rate your own business.' };
  }
  const [orderRows, bookingRows, billRows] = await Promise.all([
    prisma.order.findMany({ where: { businessId, data: jsonEquals('customerId', customerId) } }),
    prisma.booking.findMany({ where: { businessId, data: jsonEquals('customerId', customerId) } }),
    prisma.bill.findMany({ where: { businessId, data: jsonEquals('customerId', customerId) } }),
  ]);
  const hasOrder = rowsData<Order>(orderRows).some((o) => o.status === 'accepted');
  const hasBooking = rowsData<Booking>(bookingRows).some(
    (b) => b.status === 'accepted' || b.status === 'completed',
  );
  const hasBill = rowsData<Bill>(billRows).length > 0;
  if (hasOrder || hasBooking || hasBill) return { eligible: true };
  return {
    eligible: false,
    reason:
      'Ratings come only from verified customers. Place an order, book a service, or get billed by this business first — then you can rate your experience.',
  };
}

export const reviewService = {
  async listForBusiness(businessId: string): Promise<Review[]> {
    const rows = rowsData<Review>(await prisma.review.findMany({ where: { businessId } }));
    return rows.sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
    );
  },

  async getMine(businessId: string, customerId: string): Promise<Review | null> {
    if (!isUuid(customerId)) return null;
    const row = await prisma.review.findUnique({
      where: { businessId_customerId: { businessId, customerId } },
    });
    return row ? asData<Review>(row) : null;
  },

  checkEligibility: (businessId: string, customerId: string) => eligibility(businessId, customerId),

  async submit(input: NewReviewInput): Promise<Review> {
    const rating = Math.round(input.rating);
    if (rating < 1 || rating > 5) throw new Error('Pick a rating from 1 to 5 stars.');
    const comment = input.comment?.trim() || undefined;
    if (rating <= 2 && !comment) {
      throw new Error('Please write what went wrong — a reason is required with 1 and 2 star ratings.');
    }

    const bizRow = await prisma.business.findUnique({ where: { id: input.businessId } });
    if (!bizRow) throw notFound(`Business ${input.businessId} not found`);
    const business = asData<Business>(bizRow);

    const existing = await this.getMine(input.businessId, input.customerId);
    if (!existing) {
      const gate = await eligibility(input.businessId, input.customerId);
      if (!gate.eligible) throw new Error(gate.reason ?? 'Only customers can rate this business.');
    }

    const count = business.ratingCount ?? 0;
    const avg = business.ratingAvg ?? 0;

    if (existing) {
      const total = avg * count - existing.rating + rating;
      business.ratingAvg = count > 0 ? Math.round((total / count) * 10) / 10 : rating;
      existing.rating = rating;
      existing.comment = comment;
      existing.customerName = input.customerName;
      existing.updatedAt = new Date().toISOString();
      await prisma.review.update({
        where: { businessId_customerId: { businessId: input.businessId, customerId: input.customerId } },
        data: { data: toJson(existing) },
      });
      await prisma.business.update({ where: { id: business.id }, data: { data: toJson(business) } });
      return existing;
    }

    business.ratingAvg = Math.round(((avg * count + rating) / (count + 1)) * 10) / 10;
    business.ratingCount = count + 1;

    const review: Review = {
      id: newUuid(),
      businessId: input.businessId,
      customerId: input.customerId,
      customerName: input.customerName,
      rating,
      comment,
      createdAt: new Date().toISOString(),
    };
    await prisma.review.create({
      data: {
        id: review.id,
        businessId: review.businessId,
        customerId: uuidOrNull(review.customerId) ?? review.customerId,
        data: toJson(review),
      },
    });
    await prisma.business.update({ where: { id: business.id }, data: { data: toJson(business) } });

    await notify({
      recipientId: business.ownerId,
      kind: 'review_posted',
      title: `New ${rating}★ rating · ${business.name}`,
      body: comment ?? `${input.customerName} rated their experience ${rating} out of 5.`,
      businessId: business.id,
    });
    return review;
  },
};
