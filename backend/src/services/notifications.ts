/**
 * Notifications — ports MockNotificationRepository.
 *
 * `recipient_id` is a real uuid COLUMN, so a synthetic id (a logged-out viewer
 * arrives as the literal 'guest') would make Postgres throw 22P02 rather than
 * simply match nothing. Every recipient-scoped call therefore early-returns the
 * empty result for a non-uuid id — a guest has no notifications by definition.
 */
import type { AppNotification } from '@/domain/types';
import { prisma } from '@/db';
import { isUuid, rowsData, toJson } from '@/lib/data';

export const notificationService = {
  async listForUser(recipientId: string): Promise<AppNotification[]> {
    if (!isUuid(recipientId)) return [];
    const rows = await prisma.notification.findMany({
      where: { recipientId },
      orderBy: { createdAt: 'desc' },
    });
    return rowsData<AppNotification>(rows);
  },

  async unreadCount(recipientId: string): Promise<number> {
    if (!isUuid(recipientId)) return 0;
    return prisma.notification.count({ where: { recipientId, read: false } });
  },

  async markRead(id: string): Promise<void> {
    const row = await prisma.notification.findUnique({ where: { id } });
    if (!row) return;
    const data = { ...(row.data as object), read: true } as AppNotification;
    await prisma.notification.update({ where: { id }, data: { read: true, data: toJson(data) } });
  },

  async markAllRead(recipientId: string): Promise<void> {
    if (!isUuid(recipientId)) return;
    const rows = await prisma.notification.findMany({ where: { recipientId, read: false } });
    await Promise.all(
      rows.map((row) =>
        prisma.notification.update({
          where: { id: row.id },
          data: { read: true, data: toJson({ ...(row.data as object), read: true }) },
        }),
      ),
    );
  },
};
