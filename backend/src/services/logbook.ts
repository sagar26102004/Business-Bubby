/** Logbook — ports MockLogbookRepository (derived order entries + manual). */
import type { LogEntry, Order } from '@/domain/types';
import type { NewLogEntryInput } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { rowsData, toJson } from '@/lib/data';
import { orderLogEntry } from './orderUtils';

export const logbookService = {
  async listForBusiness(businessId: string): Promise<LogEntry[]> {
    const [orderRows, logRows] = await Promise.all([
      prisma.order.findMany({ where: { businessId } }),
      prisma.logEntry.findMany({ where: { businessId } }),
    ]);
    const derived = rowsData<Order>(orderRows).map(orderLogEntry);
    const manual = rowsData<LogEntry>(logRows);
    return [...derived, ...manual].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async addManual(input: NewLogEntryInput): Promise<LogEntry> {
    const title = input.title.trim();
    if (!title) throw new Error('Give the record a title.');
    const entry: LogEntry = {
      id: newUuid(),
      businessId: input.businessId,
      source: 'manual',
      title,
      details: input.details?.trim() || undefined,
      amount: input.amount,
      customerName: input.customerName?.trim() || undefined,
      recordedByName: input.recordedByName,
      createdAt: new Date().toISOString(),
    };
    await prisma.logEntry.create({
      data: { id: entry.id, businessId: entry.businessId, data: toJson(entry) },
    });
    return entry;
  },
};
