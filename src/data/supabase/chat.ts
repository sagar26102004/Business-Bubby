/**
 * Supabase-backed ChatRepository (B2C) over the `chat_messages` table. One
 * thread per customer per business, keyed by (business_id, participant_id);
 * participant_id is a user id or the literal 'guest'.
 */
import type { ChatMessage } from '@/domain/types';
import type {
  ChatAuthor,
  ChatRepository,
  ChatThreadSummary,
  CustomerThreadSummary,
} from '@/data/repositories';
import { sb, uuid, nowIso, notify } from './shared';

const threadKeyFor = (businessId: string, participantId: string) => `${businessId}:${participantId}`;

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  const ids = userIds.filter((id) => id && id !== 'guest');
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await sb().from('profiles').select('id, data').in('id', ids);
  (data ?? []).forEach((r) => out.set(r.id as string, (r.data as { name: string }).name));
  return out;
}

export function createSupabaseChat(): ChatRepository {
  return {
    async listThread(businessId: string, participantId: string): Promise<ChatMessage[]> {
      const { data, error } = await sb()
        .from('chat_messages')
        .select('data')
        .eq('business_id', businessId)
        .eq('participant_id', participantId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => r.data as ChatMessage);
    },

    async send(
      businessId: string,
      participantId: string,
      body: string,
      author: ChatAuthor,
      extra?: { billId?: string },
    ): Promise<ChatMessage[]> {
      const message: ChatMessage = {
        id: uuid(),
        threadKey: threadKeyFor(businessId, participantId),
        authorType: author.type,
        authorName: author.name,
        body: body.trim(),
        billId: extra?.billId,
        createdAt: nowIso(),
      };
      const { error } = await sb().from('chat_messages').insert({
        id: message.id,
        business_id: businessId,
        participant_id: participantId,
        data: message,
      });
      if (error) throw error;

      if (author.type === 'business') {
        const { data } = await sb().from('businesses').select('data').eq('id', businessId).maybeSingle();
        const businessName = (data?.data as { name?: string } | undefined)?.name ?? 'A business';
        await notify({
          recipientId: participantId,
          kind: 'chat_reply',
          title: `${author.name} from ${businessName}`,
          body: body.trim(),
          businessId,
        });
      }
      return this.listThread(businessId, participantId);
    },

    async listBusinessThreads(businessId: string): Promise<ChatThreadSummary[]> {
      const { data, error } = await sb()
        .from('chat_messages')
        .select('participant_id, data, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      const names = await namesFor(rows.map((r) => r.participant_id as string));
      const byPid = new Map<string, ChatThreadSummary>();
      for (const r of rows) {
        const pid = r.participant_id as string;
        const m = r.data as ChatMessage;
        const cur = byPid.get(pid);
        if (!cur) {
          byPid.set(pid, {
            businessId,
            participantId: pid,
            participantName: pid === 'guest' ? 'Guest' : names.get(pid) ?? pid,
            lastBody: m.body,
            lastAt: m.createdAt,
            lastAuthorType: m.authorType,
            count: 1,
          });
        } else {
          cur.lastBody = m.body;
          cur.lastAt = m.createdAt;
          cur.lastAuthorType = m.authorType;
          cur.count += 1;
        }
      }
      return [...byPid.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    },

    async listCustomerThreads(participantId: string): Promise<CustomerThreadSummary[]> {
      const { data, error } = await sb()
        .from('chat_messages')
        .select('business_id, data, created_at')
        .eq('participant_id', participantId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      const bizIds = Array.from(new Set(rows.map((r) => r.business_id as string)));
      const bizNames = new Map<string, string>();
      if (bizIds.length > 0) {
        const { data: bs } = await sb().from('businesses').select('id, data').in('id', bizIds);
        (bs ?? []).forEach((r) => bizNames.set(r.id as string, (r.data as { name: string }).name));
      }
      const byBiz = new Map<string, CustomerThreadSummary>();
      for (const r of rows) {
        const bid = r.business_id as string;
        const m = r.data as ChatMessage;
        const cur = byBiz.get(bid);
        if (!cur) {
          byBiz.set(bid, {
            businessId: bid,
            businessName: bizNames.get(bid) ?? 'A business',
            lastBody: m.body,
            lastAt: m.createdAt,
            lastAuthorType: m.authorType,
            count: 1,
          });
        } else {
          cur.lastBody = m.body;
          cur.lastAt = m.createdAt;
          cur.lastAuthorType = m.authorType;
          cur.count += 1;
        }
      }
      return [...byBiz.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    },
  };
}
