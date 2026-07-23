/** Product threads — ports MockProductThreadRepository (public Q&A + offers). */
import type { Business, ProductMessage } from '@/domain/types';
import type { NewProductMessageInput } from '@/domain/contracts';
import { prisma } from '@/db';
import { newUuid } from '@/lib/ids';
import { asData, rowsData, toJson, uuidOrNull } from '@/lib/data';
import { notFound } from '@/http/errors';
import { notify } from './notify';

async function findBusiness(id: string): Promise<Business | null> {
  const row = await prisma.business.findUnique({ where: { id } });
  return row ? asData<Business>(row) : null;
}

export const productThreadService = {
  async listForProduct(businessId: string, productId: string): Promise<ProductMessage[]> {
    const rows = await prisma.productMessage.findMany({
      where: { businessId, productId },
      orderBy: { createdAt: 'asc' },
    });
    return rowsData<ProductMessage>(rows);
  },

  async listForBusiness(businessId: string): Promise<ProductMessage[]> {
    const rows = await prisma.productMessage.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });
    return rowsData<ProductMessage>(rows);
  },

  async setPinned(
    businessId: string,
    productId: string,
    messageId: string,
    pinned: boolean,
    actorId: string,
  ): Promise<ProductMessage> {
    const business = await findBusiness(businessId);
    if (!business) throw notFound(`Business ${businessId} not found`);
    if (business.ownerId !== actorId) throw new Error('Only the seller can pin messages.');
    const row = await prisma.productMessage.findUnique({ where: { id: messageId } });
    if (!row || row.businessId !== businessId || row.productId !== productId) {
      throw notFound(`Message ${messageId} not found`);
    }
    const message = { ...asData<ProductMessage>(row), pinned };
    await prisma.productMessage.update({ where: { id: messageId }, data: { data: toJson(message) } });
    return message;
  },

  async post(input: NewProductMessageInput): Promise<ProductMessage> {
    const business = await findBusiness(input.businessId);
    if (!business) throw notFound(`Business ${input.businessId} not found`);
    const product = business.products?.find((p) => p.id === input.productId);
    if (!product) throw notFound(`Product ${input.productId} not found`);
    if (!input.text.trim() && !input.offerPrice) {
      throw new Error('Write a question, or propose a price.');
    }

    const fromSeller = business.ownerId === input.authorId;
    const message: ProductMessage = {
      id: newUuid(),
      businessId: input.businessId,
      productId: input.productId,
      authorId: input.authorId,
      authorName: input.authorName,
      fromSeller,
      text: input.text.trim(),
      offerPrice: input.offerPrice,
      replyToId: input.replyToId,
      createdAt: new Date().toISOString(),
    };
    await prisma.productMessage.create({
      data: {
        id: message.id,
        businessId: message.businessId,
        productId: message.productId,
        authorId: uuidOrNull(message.authorId),
        data: toJson(message),
      },
    });

    if (!fromSeller) {
      await notify({
        recipientId: business.ownerId,
        kind: 'product_question',
        title: `${input.authorName} on ${product.name}`,
        body: input.offerPrice
          ? `Offered ${input.offerPrice}${message.text ? ` — ${message.text}` : ''}`
          : message.text,
        businessId: business.id,
        productId: product.id,
      });
    } else if (input.replyToId) {
      const answeredRow = await prisma.productMessage.findUnique({ where: { id: input.replyToId } });
      const answered = answeredRow ? asData<ProductMessage>(answeredRow) : undefined;
      if (answered && answered.authorId !== input.authorId) {
        await notify({
          recipientId: answered.authorId,
          kind: 'product_reply',
          title: `${business.name} replied`,
          body: message.text || `About ${product.name}`,
          businessId: business.id,
          productId: product.id,
        });
      }
    }
    return message;
  },
};
