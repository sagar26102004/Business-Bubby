/**
 * Supabase-backed NotificationRepository over the `notifications` table. The
 * `read` flag lives in a real column (RLS + cheap unread counts); the rest of
 * the object rides in `data`. On read we take `read` from the column so the two
 * never drift.
 */
import type { AppNotification } from '@/domain/types';
import type { NotificationRepository } from '@/data/repositories';
import { sb } from './shared';

export function createSupabaseNotifications(): NotificationRepository {
  return {
    async listForUser(recipientId: string): Promise<AppNotification[]> {
      const { data, error } = await sb()
        .from('notifications')
        .select('data, read')
        .eq('recipient_id', recipientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...(r.data as AppNotification), read: r.read as boolean }));
    },

    async unreadCount(recipientId: string): Promise<number> {
      const { count, error } = await sb()
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', recipientId)
        .eq('read', false);
      if (error) throw error;
      return count ?? 0;
    },

    async markRead(id: string): Promise<void> {
      const { error } = await sb().from('notifications').update({ read: true }).eq('id', id);
      if (error) throw error;
    },

    async markAllRead(recipientId: string): Promise<void> {
      const { error } = await sb()
        .from('notifications')
        .update({ read: true })
        .eq('recipient_id', recipientId)
        .eq('read', false);
      if (error) throw error;
    },
  };
}
