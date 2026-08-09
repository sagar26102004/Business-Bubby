/**
 * Supabase-backed PushRepository over the `push_tokens` table (migration 0011).
 *
 * A row is one DEVICE: `token` is the primary key, so re-registering the same
 * device updates the owner rather than piling up duplicates — which matters
 * when two people share a phone, or a user signs out and someone else signs in.
 * RLS lets you touch only your own rows; the edge function that actually SENDS
 * the pushes reads everyone's with the service role.
 */
import type { PushRepository } from '@/data/repositories';
import { sb, currentUserId, nowIso } from './shared';

export function createSupabasePush(): PushRepository {
  return {
    async register(token: string, platform: string): Promise<void> {
      const userId = await currentUserId();
      // A guest has no inbox to ring — nothing to register.
      if (!userId || !token) return;
      const { error } = await sb()
        .from('push_tokens')
        .upsert(
          { token, user_id: userId, platform, updated_at: nowIso() },
          { onConflict: 'token' },
        );
      if (error) throw error;
    },

    async isRegistered(token: string): Promise<boolean> {
      const userId = await currentUserId();
      if (!userId || !token) return false;
      // RLS already limits SELECT to your own rows, so a row coming back is
      // proof of BOTH halves at once: the token is stored, and it is stored
      // against the account asking. `user_id` is matched explicitly anyway —
      // relying on a policy to enforce what the caller means is how a policy
      // change quietly turns a check into a lie.
      const { data, error } = await sb()
        .from('push_tokens')
        .select('token')
        .eq('token', token)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return false;
      return !!data;
    },

    async unregister(token: string): Promise<void> {
      if (!token) return;
      // RLS scopes the delete to the caller's own rows, so a stale token
      // belonging to someone else is simply left alone.
      const { error } = await sb().from('push_tokens').delete().eq('token', token);
      if (error) throw error;
    },
  };
}
