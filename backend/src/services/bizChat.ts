/** B2B chat — ports MockBizChatRepository. */
import type { BizChatMessage, Business } from '@/domain/types';
import type { BizThreadSummary, NewBizMessageInput } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, rowsData, toJson } from '@/lib/data';
import { notFound } from '@/http/errors';

const bizThreadKey = (a: string, b: string) => [a, b].sort().join('|');

async function businessNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.business.findMany({ where: { id: { in: ids } } });
  return new Map(rowsData<Business>(rows).map((b) => [b.id, b.name]));
}

export const bizChatService = {
  async listThreadsForUser(userId: string): Promise<BizThreadSummary[]> {
    const [owned, employed] = await Promise.all([
      prisma.business.findMany({ where: { ownerId: userId }, select: { id: true } }),
      prisma.employee.findMany({ where: { userId }, select: { businessId: true } }),
    ]);
    const mine = new Set<string>([...owned.map((b) => b.id), ...employed.map((e) => e.businessId)]);
    if (!mine.size) return [];

    const rows = await prisma.bizChatMessage.findMany({ orderBy: { createdAt: 'asc' } });
    const msgs = rowsData<BizChatMessage>(rows);
    const names = await businessNames([...new Set(rows.flatMap((r) => [r.fromBusinessId, r.toBusinessId]))]);

    const threads = new Map<string, BizThreadSummary>();
    for (const m of msgs) {
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
    const rows = await prisma.bizChatMessage.findMany({
      where: { threadKey: key },
      orderBy: { createdAt: 'asc' },
    });
    const names = await businessNames([...new Set(rows.map((r) => r.fromBusinessId))]);
    return rowsData<BizChatMessage>(rows).map((m) => ({
      ...m,
      fromBusinessName: names.get(m.fromBusinessId) ?? m.fromBusinessName,
    }));
  },

  async send(input: NewBizMessageInput): Promise<BizChatMessage[]> {
    const fromRow = await prisma.business.findUnique({ where: { id: input.fromBusinessId } });
    if (!fromRow) throw notFound(`Business ${input.fromBusinessId} not found`);
    const from = asData<Business>(fromRow);
    const id = newUuid();
    const message: BizChatMessage = {
      id,
      threadKey: bizThreadKey(input.fromBusinessId, input.toBusinessId),
      fromBusinessId: input.fromBusinessId,
      fromBusinessName: from.name,
      authorName: input.authorName,
      body: input.body,
      at: new Date().toISOString(),
    };
    await prisma.bizChatMessage.create({
      data: {
        id,
        threadKey: message.threadKey,
        fromBusinessId: input.fromBusinessId,
        toBusinessId: input.toBusinessId,
        data: toJson(message),
      },
    });
    return this.listMessages(input.fromBusinessId, input.toBusinessId);
  },
};
