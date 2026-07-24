/**
 * Supabase-backed ReviewRepository over the `reviews` table (public read;
 * author writes own). The rating aggregate is NOT written back to the business
 * (a customer can't update a business under RLS) — `businesses` computes
 * ratingAvg/ratingCount live from this table instead.
 */
import type { Business, Review } from '@/domain/types';
import type {
  NewReviewInput,
  ReviewEligibility,
  ReviewRepository,
} from '@/data/repositories';
import { sb, uuid, nowIso, notify, byNewest } from './shared';

async function eligibilityFor(businessId: string, customerId: string): Promise<ReviewEligibility> {
  if (!customerId || customerId === 'guest') {
    return { eligible: false, reason: 'Sign in to rate businesses.' };
  }
  const { data: bizRow } = await sb().from('businesses').select('data').eq('id', businessId).maybeSingle();
  const business = bizRow?.data as Business | undefined;
  if (business?.ownerId === customerId) {
    return { eligible: false, reason: 'You can’t rate your own business.' };
  }
  const [ordersR, bookingsR, billsR] = await Promise.all([
    sb().from('orders').select('data').eq('business_id', businessId).eq('customer_id', customerId),
    sb().from('bookings').select('data').eq('business_id', businessId).eq('customer_id', customerId),
    sb().from('bills').select('id').eq('business_id', businessId).eq('customer_id', customerId).limit(1),
  ]);
  const hasOrder = (ordersR.data ?? []).some((r) => (r.data as { status: string }).status === 'accepted');
  const hasBooking = (bookingsR.data ?? []).some((r) => {
    const s = (r.data as { status: string }).status;
    return s === 'accepted' || s === 'completed';
  });
  const hasBill = (billsR.data ?? []).length > 0;
  if (hasOrder || hasBooking || hasBill) return { eligible: true };
  return {
    eligible: false,
    reason:
      'Ratings come only from verified customers. Place an order, book a service, or get billed by this business first — then you can rate your experience.',
  };
}

export function createSupabaseReviews(): ReviewRepository {
  return {
    async listForBusiness(businessId: string): Promise<Review[]> {
      const { data, error } = await sb().from('reviews').select('data').eq('business_id', businessId);
      if (error) throw error;
      return (data ?? [])
        .map((r) => r.data as Review)
        .sort(byNewest((r) => r.updatedAt ?? r.createdAt));
    },

    async getMine(businessId: string, customerId: string): Promise<Review | null> {
      const { data, error } = await sb()
        .from('reviews')
        .select('data')
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .maybeSingle();
      if (error) throw error;
      return data ? (data.data as Review) : null;
    },

    async checkEligibility(businessId: string, customerId: string): Promise<ReviewEligibility> {
      return eligibilityFor(businessId, customerId);
    },

    async submit(input: NewReviewInput): Promise<Review> {
      const rating = Math.round(input.rating);
      if (rating < 1 || rating > 5) throw new Error('Pick a rating from 1 to 5 stars.');
      const comment = input.comment?.trim() || undefined;
      if (rating <= 2 && !comment) {
        throw new Error('Please write what went wrong — a reason is required with 1 and 2 star ratings.');
      }
      const { data: bizRow } = await sb().from('businesses').select('data').eq('id', input.businessId).maybeSingle();
      const business = bizRow?.data as Business | undefined;
      if (!business) throw new Error(`Business ${input.businessId} not found`);

      const existing = await this.getMine(input.businessId, input.customerId);
      if (!existing) {
        const gate = await eligibilityFor(input.businessId, input.customerId);
        if (!gate.eligible) throw new Error(gate.reason ?? 'Only customers can rate this business.');
      }

      if (existing) {
        const next: Review = {
          ...existing,
          rating,
          comment,
          customerName: input.customerName,
          updatedAt: nowIso(),
        };
        const { error } = await sb()
          .from('reviews')
          .update({ data: next })
          .eq('business_id', input.businessId)
          .eq('customer_id', input.customerId);
        if (error) throw error;
        return next;
      }

      const review: Review = {
        id: uuid(),
        businessId: input.businessId,
        customerId: input.customerId,
        customerName: input.customerName,
        rating,
        comment,
        createdAt: nowIso(),
      };
      const { error } = await sb().from('reviews').insert({
        id: review.id,
        business_id: input.businessId,
        customer_id: input.customerId,
        data: review,
      });
      if (error) throw error;

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
}
