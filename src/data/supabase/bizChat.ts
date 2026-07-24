/**
 * Supabase-backed BizChatRepository (B2B) over the `biz_chat_messages` table.
 * One thread per pair of businesses; RLS already limits reads to members of
 * either side, so a plain select returns exactly the caller's threads.
 */
import type { BizChatMessage, Business } from '@/domain/types';
import type {
  BizChatRepository,
  BizThreadSummary,
  NewBizMessageInput,
} from '@/data/repositories';
import { sb, uuid, nowIso } from './shared';

const bizThreadKey = (a: string, b: string) => [a, b].sort().join('|');

async function myBusinessIds(userId: string): Promise<Set<string>> {
  const [owned, employed] = await Promise.all([
    sb().from('businesses').select('id').eq('owner_id', userId),
    sb().from('employees').select('business_id').eq('user_id', userId),
  ]);
  const ids = new Set<string>();
  (owned.data ?? []).forEach((r) => ids.add(r.id as string));
  (employed.data ?? []).forEach((r) => ids.add(r.business_id as string));
  return ids;
}

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await sb().from('businesses').select('id, data').in('id', Array.from(new Set(ids)));
  (data ?? []).forEach((r) => out.set(r.id as string, (r.data as Business).name));
  return out;
}

export function createSupabaseBizChat(): BizChatRepository {
  return {
    async listThreadsForUser(userId: string): Promise<BizThreadSummary[]> {
      const mine = await myBusinessIds(userId);
      if (mine.size === 0) return [];
      const { data, error } = await sb()
        .from('biz_chat_messages')
        .select('data')
        .order('created_at', { ascending: true });
      if (error) throw error;
      const messages = (data ?? []).map((r) => r.data as BizChatMessage);
      const names = await namesFor(messages.flatMap((m) => m.threadKey.split('|')));

      const threads = new Map<string, BizThreadSummary>();
      for (const m of messages) {
        const [a, b] = m.threadKey.split('|');
        const myId = mine.has(a) ? a : mine.has(b) ? b : null;
        if (!myId) continue;
        const otherId = myId === a ? b : a;
        threads.set(`${m.threadKey}:${myId}`, {
          threadKey: m.threadKey,
          businessId: myId,
          businessName: names.get(myId) ?? 'My business',
          otherBusinessId: otherId,
          otherBusinessName: names.get(otherId) ?? 'Business',
          lastBody: m.body,
          lastAt: m.at,
          lastFromBusinessId: m.fromBusinessId,
        });
      }
      return [...threads.values()].sort((x, y) => y.lastAt.localeCompare(x.lastAt));
    },

    async listMessages(businessA: string, businessB: string): Promise<BizChatMessage[]> {
      const key = bizThreadKey(businessA, businessB);
      const { data, error } = await sb()
        .from('biz_chat_messages')
        .select('data')
        .eq('thread_key', key)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const messages = (data ?? []).map((r) => r.data as BizChatMessage);
      const names = await namesFor(messages.map((m) => m.fromBusinessId));
      return messages.map((m) => ({ ...m, fromBusinessName: names.get(m.fromBusinessId) ?? m.fromBusinessName }));
    },

    async send(input: NewBizMessageInput): Promise<BizChatMessage[]> {
      const { data: fromRow } = await sb().from('businesses').select('data').eq('id', input.fromBusinessId).maybeSingle();
      const from = fromRow?.data as Business | undefined;
      if (!from) throw new Error(`Business ${input.fromBusinessId} not found`);
      const message: BizChatMessage = {
        id: uuid(),
        threadKey: bizThreadKey(input.fromBusinessId, input.toBusinessId),
        fromBusinessId: input.fromBusinessId,
        fromBusinessName: from.name,
        authorName: input.authorName,
        body: input.body,
        at: nowIso(),
      };
      const { error } = await sb().from('biz_chat_messages').insert({
        id: message.id,
        thread_key: message.threadKey,
        from_business_id: input.fromBusinessId,
        to_business_id: input.toBusinessId,
        data: message,
      });
      if (error) throw error;
      return this.listMessages(input.fromBusinessId, input.toBusinessId);
    },
  };
}
