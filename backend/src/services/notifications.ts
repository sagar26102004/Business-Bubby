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
import { isNotificationMuted } from '@/domain/notifications';
import { isUuid, rowsData, toJson } from '@/lib/data';

/**
 * This user's muted families, as `"<businessId>:<category>"` keys.
 *
 * Reads `profiles_private`, NOT `profiles` — migration 0007 moved
 * `mutedNotifications` there alongside phone and email, since the public
 * profile document is world-readable and preferences are nobody else's
 * business. Best-effort: a failed lookup means "nothing muted", which shows
 * MORE than it should rather than silently swallowing someone's alerts.
 */
async function mutesOf(recipientId: string): Promise<string[]> {
  try {
    const row = await prisma.profilePrivate.findUnique({ where: { id: recipientId } });
    const data = (row?.data ?? {}) as { mutedNotifications?: string[] };
    return data.mutedNotifications ?? [];
  } catch {
    return [];
  }
}

export const notificationService = {
  async listForUser(recipientId: string): Promise<AppNotification[]> {
    if (!isUuid(recipientId)) return [];
    const [rows, mutes] = await Promise.all([
      prisma.notification.findMany({
        where: { recipientId },
        orderBy: { createdAt: 'desc' },
      }),
      mutesOf(recipientId),
    ]);
    // Muting is enforced on READ, so nothing is ever blocked or lost — the
    // orders, calls and messages behind a muted alert stay fully visible in the
    // workspace, they just stop shouting.
    return rowsData<AppNotification>(rows).filter((n) => !isNotificationMuted(n, mutes));
  },

  async unreadCount(recipientId: string): Promise<number> {
    if (!isUuid(recipientId)) return 0;
    const mutes = await mutesOf(recipientId);
    // Keep the cheap COUNT for the overwhelmingly common case of no mutes;
    // only pay for reading the rows when there is something to filter.
    if (mutes.length === 0) {
      return prisma.notification.count({ where: { recipientId, read: false } });
    }
    const rows = await prisma.notification.findMany({ where: { recipientId, read: false } });
    return rowsData<AppNotification>(rows).filter((n) => !isNotificationMuted(n, mutes)).length;
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
