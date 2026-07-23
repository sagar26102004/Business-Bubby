/** Notifications — ports MockNotificationRepository. */
import type { AppNotification } from '@/domain/types';
import { prisma } from '@/db';
import { rowsData, toJson } from '@/lib/data';

export const notificationService = {
  async listForUser(recipientId: string): Promise<AppNotification[]> {
    const rows = await prisma.notification.findMany({
      where: { recipientId },
      orderBy: { createdAt: 'desc' },
    });
    return rowsData<AppNotification>(rows);
  },

  async unreadCount(recipientId: string): Promise<number> {
    return prisma.notification.count({ where: { recipientId, read: false } });
  },

  async markRead(id: string): Promise<void> {
    const row = await prisma.notification.findUnique({ where: { id } });
    if (!row) return;
    const data = { ...(row.data as object), read: true } as AppNotification;
    await prisma.notification.update({ where: { id }, data: { read: true, data: toJson(data) } });
  },

  async markAllRead(recipientId: string): Promise<void> {
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
