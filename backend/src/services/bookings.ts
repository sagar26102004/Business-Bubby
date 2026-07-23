/** Bookings — ports MockBookingRepository. */
import type { Booking, BookingStatus, Business } from '@/domain/types';
import type { NewBookingInput } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, jsonEquals, rowsData, toJson, uuidOrNull } from '@/lib/data';
import { notFound } from '@/http/errors';
import { notify } from './notify';

async function findBusiness(id: string): Promise<Business | null> {
  const row = await prisma.business.findUnique({ where: { id } });
  return row ? asData<Business>(row) : null;
}

export const bookingService = {
  async create(input: NewBookingInput): Promise<Booking> {
    const booking: Booking = {
      id: newUuid(),
      businessId: input.businessId,
      customerId: input.customerId,
      customerName: input.customerName,
      serviceName: input.serviceName,
      price: input.price,
      when: input.when,
      note: input.note,
      status: 'requested',
      createdAt: new Date().toISOString(),
    };
    await prisma.booking.create({
      data: {
        id: booking.id,
        businessId: booking.businessId,
        customerId: uuidOrNull(booking.customerId),
        data: toJson(booking),
      },
    });

    const business = await findBusiness(input.businessId);
    if (business) {
      await notify({
        recipientId: business.ownerId,
        kind: 'booking_requested',
        title: `New booking · ${business.name}`,
        body: `${input.customerName} requested "${input.serviceName}" for ${input.when}`,
        businessId: business.id,
      });
    }
    return booking;
  },

  async listForBusiness(businessId: string): Promise<Booking[]> {
    const rows = await prisma.booking.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    return rowsData<Booking>(rows);
  },

  async listForCustomer(customerId: string): Promise<Booking[]> {
    const rows = await prisma.booking.findMany({
      where: { data: jsonEquals('customerId', customerId) },
      orderBy: { createdAt: 'desc' },
    });
    return rowsData<Booking>(rows);
  },

  async updateStatus(id: string, status: BookingStatus): Promise<Booking> {
    const row = await prisma.booking.findUnique({ where: { id } });
    if (!row) throw notFound(`Booking ${id} not found`);
    const booking = asData<Booking>(row);
    booking.status = status;
    await prisma.booking.update({ where: { id }, data: { data: toJson(booking) } });

    if (status === 'accepted' || status === 'declined') {
      const business = await findBusiness(booking.businessId);
      await notify({
        recipientId: booking.customerId,
        kind: 'booking_update',
        title: `Booking ${status} · ${business?.name ?? 'Business'}`,
        body: `Your "${booking.serviceName}" for ${booking.when} was ${status}.`,
        businessId: booking.businessId,
      });
    }
    return booking;
  },
};
