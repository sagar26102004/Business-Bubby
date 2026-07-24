/**
 * Supabase-backed BookingRepository over the `bookings` table.
 */
import type { Booking, BookingStatus } from '@/domain/types';
import type { BookingRepository, NewBookingInput } from '@/data/repositories';
import { sb, uuid, nowIso, uuidOrNull, notify, byNewest } from './shared';

async function businessName(businessId: string): Promise<{ name: string; ownerId: string } | null> {
  const { data } = await sb().from('businesses').select('data').eq('id', businessId).maybeSingle();
  if (!data) return null;
  const b = data.data as { name: string; ownerId: string };
  return { name: b.name, ownerId: b.ownerId };
}

export function createSupabaseBookings(): BookingRepository {
  return {
    async create(input: NewBookingInput): Promise<Booking> {
      const booking: Booking = {
        id: uuid(),
        businessId: input.businessId,
        customerId: input.customerId,
        customerName: input.customerName,
        serviceName: input.serviceName,
        price: input.price,
        when: input.when,
        note: input.note,
        status: 'requested',
        createdAt: nowIso(),
      };
      const { error } = await sb().from('bookings').insert({
        id: booking.id,
        business_id: input.businessId,
        customer_id: uuidOrNull(input.customerId),
        data: booking,
      });
      if (error) throw error;

      const biz = await businessName(input.businessId);
      if (biz) {
        await notify({
          recipientId: biz.ownerId,
          kind: 'booking_requested',
          title: `New booking · ${biz.name}`,
          body: `${input.customerName} requested "${input.serviceName}" for ${input.when}`,
          businessId: input.businessId,
        });
      }
      return booking;
    },

    async listForBusiness(businessId: string): Promise<Booking[]> {
      const { data, error } = await sb()
        .from('bookings')
        .select('data')
        .eq('business_id', businessId);
      if (error) throw error;
      return (data ?? []).map((r) => r.data as Booking).sort(byNewest((b) => b.createdAt));
    },

    async listForCustomer(customerId: string): Promise<Booking[]> {
      const { data, error } = await sb()
        .from('bookings')
        .select('data')
        .eq('customer_id', customerId);
      if (error) throw error;
      return (data ?? []).map((r) => r.data as Booking).sort(byNewest((b) => b.createdAt));
    },

    async updateStatus(id: string, status: BookingStatus): Promise<Booking> {
      const { data, error } = await sb().from('bookings').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Booking ${id} not found`);
      const booking = { ...(data.data as Booking), status };
      const { error: uErr } = await sb().from('bookings').update({ data: booking }).eq('id', id);
      if (uErr) throw uErr;

      if (status === 'accepted' || status === 'declined') {
        const biz = await businessName(booking.businessId);
        await notify({
          recipientId: booking.customerId,
          kind: 'booking_update',
          title: `Booking ${status} · ${biz?.name ?? 'Business'}`,
          body: `Your "${booking.serviceName}" for ${booking.when} was ${status}.`,
          businessId: booking.businessId,
        });
      }
      return booking;
    },
  };
}
