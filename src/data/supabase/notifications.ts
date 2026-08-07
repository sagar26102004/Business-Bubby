/**
 * Supabase-backed NotificationRepository over the `notifications` table. The
 * `read` flag lives in a real column (RLS + cheap unread counts); the rest of
 * the object rides in `data`. On read we take `read` from the column so the two
 * never drift.
 */
import type { AppNotification, User } from '@/domain/types';
import type { NotificationRepository } from '@/data/repositories';
import { isNotificationMuted } from '@/domain/notifications';
import { sb, isUuid } from './shared';

/**
 * The alert families this recipient has silenced. Stored on their profile so a
 * mute follows them across devices. Failures are swallowed — a profile we
 * can't read just means nothing is muted, never a broken Alerts tab.
 */
async function mutesOf(recipientId: string): Promise<string[] | undefined> {
  const { data } = await sb().from('profiles').select('data').eq('id', recipientId).maybeSingle();
  return (data?.data as User | undefined)?.mutedNotifications;
}

export function createSupabaseNotifications(): NotificationRepository {
  return {
    async listForUser(recipientId: string): Promise<AppNotification[]> {
      // A logged-out viewer is 'guest' — not a uuid, and with no inbox of their
      // own. Return empty rather than letting the uuid cast error (22P02) bubble.
      if (!isUuid(recipientId)) return [];
      const [{ data, error }, mutes] = await Promise.all([
        sb()
          .from('notifications')
          .select('data, read')
          .eq('recipient_id', recipientId)
          .order('created_at', { ascending: false }),
        mutesOf(recipientId),
      ]);
      if (error) throw error;
      return (data ?? [])
        .map((r) => ({ ...(r.data as AppNotification), read: r.read as boolean }))
        .filter((n) => !isNotificationMuted(n, mutes));
    },

    async unreadCount(recipientId: string): Promise<number> {
      if (!isUuid(recipientId)) return 0;
      const mutes = await mutesOf(recipientId);
      if (!mutes || mutes.length === 0) {
        // Nothing silenced — keep the cheap head count.
        const { count, error } = await sb()
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_id', recipientId)
          .eq('read', false);
        if (error) throw error;
        return count ?? 0;
      }
      // Muted families have to be filtered on the object, so fetch and count.
      const { data, error } = await sb()
        .from('notifications')
        .select('data')
        .eq('recipient_id', recipientId)
        .eq('read', false);
      if (error) throw error;
      return (data ?? []).filter((r) => !isNotificationMuted(r.data as AppNotification, mutes)).length;
    },

    async markRead(id: string): Promise<void> {
      const { error } = await sb().from('notifications').update({ read: true }).eq('id', id);
      if (error) throw error;
    },

    async markAllRead(recipientId: string): Promise<void> {
      if (!isUuid(recipientId)) return;
      const { error } = await sb()
        .from('notifications')
        .update({ read: true })
        .eq('recipient_id', recipientId)
        .eq('read', false);
      if (error) throw error;
    },
  };
}
