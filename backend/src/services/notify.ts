/**
 * Notification writer — the backend equivalent of the mock's `notify()`.
 *
 * Inserts a notification row for a recipient. Recipients are real signed-in
 * users; a guest recipient (non-uuid id, e.g. 'guest') has no inbox, so those
 * are skipped — matching the app, where the alerts tab needs an account.
 */
import type { AppNotification } from '@/domain/types';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { isUuid, toJson } from '@/lib/data';

export type NotificationDraft = Omit<AppNotification, 'id' | 'read' | 'createdAt'>;

export async function notify(draft: NotificationDraft): Promise<void> {
  if (!isUuid(draft.recipientId)) return; // guests / sentinels have no inbox
  const id = newUuid();
  const createdAt = new Date().toISOString();
  const data: AppNotification = { ...draft, id, read: false, createdAt };
  await prisma.notification.create({
    data: { id, recipientId: draft.recipientId, read: false, data: toJson(data) },
  });
}
