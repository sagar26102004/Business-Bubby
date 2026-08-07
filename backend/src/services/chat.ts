/** B2C chat — ports MockChatRepository. */
import type { Business, ChatMessage, User } from '@/domain/types';
import type { ChatAuthor, ChatThreadSummary, CustomerThreadSummary } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, rowsData, toJson } from '@/lib/data';
import { notify } from './notify';

export const threadKeyFor = (businessId: string, participantId: string) =>
  `${businessId}:${participantId}`;

/**
 * The customer's display name for an inbox row. A guest who chatted through an
 * anonymous session has a profile created by the `handle_new_user` trigger with
 * an EMPTY name, so a bare profile read renders a blank row — the caller passes
 * the thread's messages and we fall back to what the sender called themselves,
 * then to 'Guest'.
 */
async function participantName(participantId: string, msgs: ChatMessage[] = []): Promise<string> {
  if (participantId === 'guest') return 'Guest';
  const row = await prisma.profile.findUnique({ where: { id: participantId } });
  const profileName = row ? asData<User>(row).name?.trim() : '';
  if (profileName) return profileName;
  const fromMessage = [...msgs]
    .reverse()
    .find((m) => m.authorType === 'customer' && m.authorName?.trim())?.authorName;
  return fromMessage?.trim() || 'Guest';
}

async function businessName(businessId: string): Promise<string> {
  const row = await prisma.business.findUnique({ where: { id: businessId } });
  return row ? asData<Business>(row).name : 'A business';
}

export const chatService = {
  async listThread(businessId: string, participantId: string): Promise<ChatMessage[]> {
    const rows = await prisma.chatMessage.findMany({
      where: { businessId, participantId },
      orderBy: { createdAt: 'asc' },
    });
    return rowsData<ChatMessage>(rows);
  },

  async send(
    businessId: string,
    participantId: string,
    body: string,
    author: ChatAuthor,
    extra?: { billId?: string },
  ): Promise<ChatMessage[]> {
    const message: ChatMessage = {
      id: newUuid(),
      threadKey: threadKeyFor(businessId, participantId),
      authorType: author.type,
      authorName: author.name,
      body: body.trim(),
      billId: extra?.billId,
      createdAt: new Date().toISOString(),
    };
    await prisma.chatMessage.create({
      data: { id: message.id, businessId, participantId, data: toJson(message) },
    });

    if (author.type === 'business') {
      await notify({
        recipientId: participantId,
        kind: 'chat_reply',
        title: `${author.name} from ${await businessName(businessId)}`,
        body: body.trim(),
        businessId,
      });
    }
    return this.listThread(businessId, participantId);
  },

  async listBusinessThreads(businessId: string): Promise<ChatThreadSummary[]> {
    const rows = await prisma.chatMessage.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });
    const byPid = new Map<string, ChatMessage[]>();
    for (const r of rows) {
      const m = asData<ChatMessage>(r);
      const pid = r.participantId;
      (byPid.get(pid) ?? byPid.set(pid, []).get(pid)!).push(m);
    }
    const out: ChatThreadSummary[] = [];
    for (const [pid, msgs] of byPid) {
      const last = msgs[msgs.length - 1];
      out.push({
        businessId,
        participantId: pid,
        participantName: await participantName(pid, msgs),
        lastBody: last?.body ?? '',
        lastAt: last?.createdAt ?? '',
        lastAuthorType: last?.authorType ?? 'customer',
        count: msgs.length,
      });
    }
    return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  },

  async listCustomerThreads(participantId: string): Promise<CustomerThreadSummary[]> {
    const rows = await prisma.chatMessage.findMany({
      where: { participantId },
      orderBy: { createdAt: 'asc' },
    });
    const byBiz = new Map<string, ChatMessage[]>();
    for (const r of rows) {
      const m = asData<ChatMessage>(r);
      (byBiz.get(r.businessId) ?? byBiz.set(r.businessId, []).get(r.businessId)!).push(m);
    }
    const out: CustomerThreadSummary[] = [];
    for (const [businessId, msgs] of byBiz) {
      const last = msgs[msgs.length - 1];
      out.push({
        businessId,
        businessName: await businessName(businessId),
        lastBody: last?.body ?? '',
        lastAt: last?.createdAt ?? '',
        lastAuthorType: last?.authorType ?? 'customer',
        count: msgs.length,
      });
    }
    return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  },
};
